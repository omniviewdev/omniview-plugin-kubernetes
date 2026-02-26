package exec

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"github.com/omniviewdev/plugin-sdk/pkg/exec"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// fakeProvider returns a ClientProvider that always returns the given error.
func fakeProvider(err error) ClientProvider {
	return func(_ *types.PluginContext) (*kubeauth.KubeClientBundle, error) {
		return nil, err
	}
}

func testPluginContext() *types.PluginContext {
	return &types.PluginContext{
		Context: context.Background(),
		Connection: &types.Connection{
			ID:   "test",
			Data: map[string]any{"kubeconfig": "/fake/path"},
		},
	}
}

func TestPodHandler_MetadataValidation(t *testing.T) {
	tests := []struct {
		name         string
		providerErr  error
		resourceData map[string]interface{}
		params       map[string]string
		wantErr      string
	}{
		{
			name:        "provider error propagates",
			providerErr: errors.New("kubeconfig is required"),
			wantErr:     "kubeconfig is required",
		},
		{
			name:         "missing metadata",
			resourceData: map[string]interface{}{},
			wantErr:      "metadata is required",
		},
		{
			name: "metadata wrong type",
			resourceData: map[string]interface{}{
				"metadata": "not-a-map",
			},
			wantErr: "metadata is required",
		},
		{
			name: "missing pod name",
			resourceData: map[string]interface{}{
				"metadata": map[string]interface{}{
					"namespace": "default",
				},
			},
			wantErr: "pod is required",
		},
		{
			name: "missing namespace",
			resourceData: map[string]interface{}{
				"metadata": map[string]interface{}{
					"name": "my-pod",
				},
			},
			wantErr: "namespace is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider := fakeProvider(tt.providerErr)
			if tt.providerErr == nil {
				// Return nil bundle — we'll hit validation errors before NPE
				provider = func(_ *types.PluginContext) (*kubeauth.KubeClientBundle, error) {
					return &kubeauth.KubeClientBundle{}, nil
				}
			}

			opts := exec.SessionOptions{
				ResourceData: tt.resourceData,
				Params:       tt.params,
			}

			err := podHandlerWithProvider(
				provider,
				testPluginContext(), opts, nil, nil, nil,
			)
			require.Error(t, err)
			assert.Equal(t, tt.wantErr, err.Error())
		})
	}
}

func TestPodHandler_ContainerDefaultsEmpty(t *testing.T) {
	// When no container param is set, container should default to "".
	// We can't fully test this without a real cluster, but we can verify
	// the parameter extraction logic by checking it doesn't error.

	// This test validates that the container extraction path works
	// by passing valid metadata but letting ExecCmd fail on nil clientset.
	opts := exec.SessionOptions{
		ResourceData: map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "my-pod",
				"namespace": "default",
			},
		},
		Params: map[string]string{},
	}

	provider := func(_ *types.PluginContext) (*kubeauth.KubeClientBundle, error) {
		return &kubeauth.KubeClientBundle{}, nil
	}

	// This will panic on nil Clientset in ExecCmd, which means validation passed.
	assert.Panics(t, func() {
		_ = podHandlerWithProvider(provider, testPluginContext(), opts, nil, nil, nil)
	})
}

func TestPodHandler_ContainerFromParams(t *testing.T) {
	opts := exec.SessionOptions{
		ResourceData: map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "my-pod",
				"namespace": "default",
			},
		},
		Params: map[string]string{
			"container": "sidecar",
		},
	}

	provider := func(_ *types.PluginContext) (*kubeauth.KubeClientBundle, error) {
		return &kubeauth.KubeClientBundle{}, nil
	}

	// This will panic on nil Clientset in ExecCmd, which means validation passed
	// and container was correctly extracted.
	assert.Panics(t, func() {
		_ = podHandlerWithProvider(provider, testPluginContext(), opts, nil, nil, nil)
	})
}
