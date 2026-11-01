package klogconfig

import (
	"context"
	"errors"
	"flag"
	"testing"

	sdksettings "github.com/omniviewdev/plugin-sdk/pkg/v1/settings"
	"github.com/omniviewdev/plugin-sdk/settings"
	"github.com/stretchr/testify/require"
	"k8s.io/klog/v2"
)

type providerStub struct {
	settings.Provider
	value string
	err   error
}

func (p providerStub) GetString(_ string) (string, error) {
	return p.value, p.err
}

func TestSetting_DefaultNone(t *testing.T) {
	s := Setting()
	require.Equal(t, SettingID, s.ID)
	require.Equal(t, settings.Select, s.Type)
	require.Equal(t, LevelNone, s.Default)
	require.False(t, s.RequiresRestart)

	values := make([]string, 0, len(s.Options))
	for _, opt := range s.Options {
		v, ok := opt.Value.(string)
		require.True(t, ok)
		values = append(values, v)
	}

	require.Contains(t, values, LevelNone)
	require.Contains(t, values, LevelError)
	require.Contains(t, values, LevelWarn)
	require.Contains(t, values, LevelInfo)
	require.Contains(t, values, LevelDebug)
}

func TestResolveLevel(t *testing.T) {
	tests := []struct {
		name     string
		provider settings.Provider
		expected string
	}{
		{
			name:     "nil provider defaults to none",
			provider: nil,
			expected: LevelNone,
		},
		{
			name:     "empty setting defaults to none",
			provider: providerStub{value: ""},
			expected: LevelNone,
		},
		{
			name:     "normalizes case and spaces",
			provider: providerStub{value: "  DeBuG  "},
			expected: LevelDebug,
		},
		{
			name:     "invalid value defaults to none",
			provider: providerStub{value: "chatty"},
			expected: LevelNone,
		},
		{
			name:     "provider error defaults to none",
			provider: providerStub{err: errors.New("boom")},
			expected: LevelNone,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.expected, ResolveLevel(tt.provider))
		})
	}
}

func TestVerbosity(t *testing.T) {
	require.Equal(t, "0", Verbosity(LevelNone))
	require.Equal(t, "0", Verbosity(LevelError))
	require.Equal(t, "1", Verbosity(LevelWarn))
	require.Equal(t, "2", Verbosity(LevelInfo))
	require.Equal(t, "6", Verbosity(LevelDebug))
	require.Equal(t, "0", Verbosity("invalid"))
}

func TestConfigureDefaultsAndApply(t *testing.T) {
	fs := flag.NewFlagSet("klogconfig-test", flag.ContinueOnError)
	klog.InitFlags(fs)

	require.NoError(t, ConfigureDefaults(fs))
	require.Equal(t, "false", fs.Lookup("logtostderr").Value.String())
	require.Equal(t, "0", fs.Lookup("v").Value.String())

	require.NoError(t, ApplyFromProvider(fs, providerStub{value: LevelDebug}))
	require.Equal(t, "6", fs.Lookup("v").Value.String())

	require.NoError(t, Apply(fs, LevelInfo))
	require.Equal(t, "2", fs.Lookup("v").Value.String())
}

func TestConfigureDefaultsAndApply_NilFlagSet(t *testing.T) {
	require.Error(t, ConfigureDefaults(nil))
	require.Error(t, Apply(nil, LevelNone))
}

func TestApplyAndWatchHydrationAndCommittedChanges(t *testing.T) {
	fs := flag.NewFlagSet("klogconfig-hydration-test", flag.ContinueOnError)
	klog.InitFlags(fs)
	require.NoError(t, ConfigureDefaults(fs))
	provider := settings.NewProvider(settings.ProviderOpts{
		PluginID: "kubernetes",
		PluginSettings: []settings.Category{{
			ID:       "plugin",
			Settings: map[string]settings.Setting{SettingID: Setting()},
		}},
	})
	require.NoError(t, ApplyAndWatch(fs, provider, func(err error) {
		t.Errorf("unexpected apply error: %v", err)
	}))
	require.Equal(t, "0", fs.Lookup("v").Value.String())
	transport := sdksettings.NewProviderWrapper(provider)
	// The host hydrates persisted values through the same commit boundary.
	result, err := transport.CommitSettings(context.Background(), map[string]any{SettingID: LevelDebug}, nil)
	require.NoError(t, err)
	require.True(t, result.Applied)
	require.Equal(t, "6", fs.Lookup("v").Value.String())
	result, err = transport.CommitSettings(context.Background(), map[string]any{SettingID: LevelInfo}, func(values map[string]any) error {
		require.Equal(t, map[string]any{SettingID: LevelInfo}, values)
		// A saved edit must not apply before persistence succeeds.
		require.Equal(t, "6", fs.Lookup("v").Value.String())
		return nil
	})
	require.NoError(t, err)
	require.True(t, result.Applied)
	require.Equal(t, "2", fs.Lookup("v").Value.String())
	saveErr := errors.New("save failed")
	_, err = transport.CommitSettings(context.Background(), map[string]any{SettingID: LevelWarn}, func(map[string]any) error {
		return saveErr
	})
	require.ErrorIs(t, err, saveErr)
	require.Equal(t, "2", fs.Lookup("v").Value.String())
}
