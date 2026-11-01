package klogconfig

import (
	"flag"
	"fmt"
	"strings"
	"sync"

	"github.com/omniviewdev/plugin-sdk/settings"
)

const (
	// SettingID is the plugin setting ID used to control client-go/klog verbosity.
	SettingID = "client_log_level"

	LevelNone  = "none"
	LevelError = "error"
	LevelWarn  = "warn"
	LevelInfo  = "info"
	LevelDebug = "debug"
)

// Setting returns the plugin setting definition for controlling klog verbosity.
func Setting() settings.Setting {
	return settings.Setting{
		ID:          SettingID,
		Label:       "Kubernetes Client Log Level",
		Description: "Controls client-go (klog) verbosity. Default is none.",
		Type:        settings.Select,
		Default:     LevelNone,
		Options: []settings.SettingOption{
			{Label: "None", Description: "Disable client-go verbose logs", Value: LevelNone},
			{Label: "Error", Description: "Errors only", Value: LevelError},
			{Label: "Warn", Description: "Warnings and above", Value: LevelWarn},
			{Label: "Info", Description: "Informational logs", Value: LevelInfo},
			{Label: "Debug", Description: "Verbose client-go debug logs", Value: LevelDebug},
		},
	}
}

// ResolveLevel reads and normalizes the configured level from settings.
// Invalid, empty, or missing values default to "none".
func ResolveLevel(provider settings.Provider) string {
	if provider == nil {
		return LevelNone
	}

	level, err := provider.GetString(SettingID)
	if err != nil {
		return LevelNone
	}

	return normalizeLevel(level)
}

// Verbosity maps the logical setting level to klog's numeric verbosity flag.
func Verbosity(level string) string {
	switch normalizeLevel(level) {
	case LevelDebug:
		return "6"
	case LevelInfo:
		return "2"
	case LevelWarn:
		return "1"
	case LevelError, LevelNone:
		return "0"
	default:
		return "0"
	}
}

// ConfigureDefaults applies safe klog defaults for plugin startup.
func ConfigureDefaults(fs *flag.FlagSet) error {
	if fs == nil {
		return fmt.Errorf("flag set is nil")
	}

	if err := fs.Set("logtostderr", "false"); err != nil {
		return err
	}

	return fs.Set("v", Verbosity(LevelNone))
}

// Apply sets the klog verbosity on the provided FlagSet.
func Apply(fs *flag.FlagSet, level string) error {
	if fs == nil {
		return fmt.Errorf("flag set is nil")
	}

	return fs.Set("v", Verbosity(level))
}

// ApplyFromProvider resolves the level from settings and applies it to klog flags.
func ApplyFromProvider(fs *flag.FlagSet, provider settings.Provider) error {
	return Apply(fs, ResolveLevel(provider))
}

// ApplyAndWatch applies startup defaults, then reapplies settings after host
// hydration and committed changes. Call before serving the plugin.
func ApplyAndWatch(fs *flag.FlagSet, provider settings.Provider, reportError func(error)) error {
	if err := ApplyFromProvider(fs, provider); err != nil {
		return err
	}
	if provider == nil {
		return nil
	}
	// FlagSet.Set mutates its bookkeeping map; serialize concurrent callbacks.
	// Read the provider again under the lock instead of applying stale snapshots.
	var mu sync.Mutex
	provider.RegisterChangeHandler("plugin", func(_ map[string]any) {
		mu.Lock()
		defer mu.Unlock()
		if err := ApplyFromProvider(fs, provider); err != nil && reportError != nil {
			reportError(err)
		}
	})
	return nil
}

func normalizeLevel(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case LevelNone:
		return LevelNone
	case LevelError:
		return LevelError
	case LevelWarn:
		return LevelWarn
	case LevelInfo:
		return LevelInfo
	case LevelDebug:
		return LevelDebug
	default:
		return LevelNone
	}
}
