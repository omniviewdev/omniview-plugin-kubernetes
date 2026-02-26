package utils

import (
	"os"
	"testing"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestKubeClientsFromContext_NilConnection(t *testing.T) {
	pc := &types.PluginContext{Connection: nil}
	_, err := KubeClientsFromContext(pc)
	require.Error(t, err)
	assert.Equal(t, "kubeconfig is required", err.Error())
}

func TestKubeClientsFromContext_NilData(t *testing.T) {
	pc := &types.PluginContext{
		Connection: &types.Connection{ID: "ctx", Data: nil},
	}
	_, err := KubeClientsFromContext(pc)
	require.Error(t, err)
	assert.Equal(t, "kubeconfig is required", err.Error())
}

func TestKubeClientsFromContext_EmptyData(t *testing.T) {
	pc := &types.PluginContext{
		Connection: &types.Connection{ID: "ctx", Data: map[string]any{}},
	}
	_, err := KubeClientsFromContext(pc)
	require.Error(t, err)
	assert.Equal(t, "kubeconfig is required", err.Error())
}

func TestKubeClientsFromContext_WrongType(t *testing.T) {
	pc := &types.PluginContext{
		Connection: &types.Connection{
			ID:   "ctx",
			Data: map[string]any{"kubeconfig": 42},
		},
	}
	_, err := KubeClientsFromContext(pc)
	require.Error(t, err)
	assert.Equal(t, "kubeconfig is required and must be a string", err.Error())
}

func TestKubeClientsFromContext_ValidPath(t *testing.T) {
	// Write a minimal kubeconfig to a temp file.
	kubeconfigContent := `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://127.0.0.1:6443
  name: test
contexts:
- context:
    cluster: test
    user: test
  name: test
current-context: test
users:
- name: test
  user:
    token: fake-token
`
	tmpFile := t.TempDir() + "/kubeconfig"
	require.NoError(t, os.WriteFile(tmpFile, []byte(kubeconfigContent), 0644))

	pc := &types.PluginContext{
		Connection: &types.Connection{
			ID:   "test",
			Data: map[string]any{"kubeconfig": tmpFile},
		},
	}
	bundle, err := KubeClientsFromContext(pc)
	require.NoError(t, err)
	require.NotNil(t, bundle)
}
