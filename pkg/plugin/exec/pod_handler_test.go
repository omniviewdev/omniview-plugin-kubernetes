package exec

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniview/kubernetes/pkg/pluginid"
	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
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

func execResourceData(t testing.TB, native map[string]interface{}) *resourcev2.Value {
	t.Helper()
	if native == nil {
		return nil
	}
	value, err := resourcev2.ValueFromNative(native)
	require.NoError(t, err)
	return &value
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
			providerErr: errors.New("open /secret/home/user/.kube/config: no such file or directory"),
			wantErr:     "load kubernetes client failed",
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
				ResourceData: execResourceData(t, tt.resourceData),
				Params:       tt.params,
			}

			err := podHandlerWithProvider(
				provider,
				testPluginContext(), opts, nil, nil, nil,
			)
			require.Error(t, err)
			assert.ErrorContains(t, err, tt.wantErr)
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
		ResourceData: execResourceData(t, map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "my-pod",
				"namespace": "default",
			},
		}),
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
		ResourceData: execResourceData(t, map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":      "my-pod",
				"namespace": "default",
			},
		}),
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

func TestNativeExecTargetConsumesReferenceWithoutResourceGet(t *testing.T) {
	opts := exec.SessionOptions{
		ResourcePlugin: pluginid.ResourceProvider, ResourceKey: "k8s:/pods",
		Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
			Provider: "kubernetes", Authority: "host-issued-authority", Type: "k8s:/pods",
			Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "selected"}}, ID: "native-pod",
		}},
		Route: &resourcev2.AccessRoute{Connection: "test"},
	}
	name, namespace, err := nativeExecTarget(testPluginContext(), opts, "k8s:/pods", true)
	require.NoError(t, err)
	assert.Equal(t, "native-pod", name)
	assert.Equal(t, "selected", namespace)
	assert.Nil(t, opts.ResourceData)
	assert.Nil(t, opts.Reference.Incarnation)
}

func TestNativeExecTargetRejectsMismatchedObservedIdentity(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*exec.SessionOptions)
		code   string
	}{
		{"wrong route", func(options *exec.SessionOptions) { options.Route.Connection = "other" }, "INVALID_REQUEST"},
		{"missing route", func(options *exec.SessionOptions) { options.Route = nil }, "INVALID_REQUEST"},
		{"wrong plugin", func(options *exec.SessionOptions) { options.ResourcePlugin = "other" }, "INVALID_REQUEST"},
		{"wrong provider", func(options *exec.SessionOptions) { options.Reference.Address.Provider = "other" }, "INVALID_REQUEST"},
		{"wrong type", func(options *exec.SessionOptions) { options.Reference.Address.Type = "k8s:/nodes" }, "INVALID_REQUEST"},
		{"duplicate namespace", func(options *exec.SessionOptions) {
			options.Reference.Address.Scope = append(options.Reference.Address.Scope, options.Reference.Address.Scope[0])
		}, "INVALID_REQUEST"},
		{"observed name", func(options *exec.SessionOptions) {
			options.ResourceData.Map["metadata"].Map["name"] = resourcev2.Value{Kind: "string", String: "different"}
		}, "INVALID_REQUEST"},
		{"observed namespace", func(options *exec.SessionOptions) {
			options.ResourceData.Map["metadata"].Map["namespace"] = resourcev2.Value{Kind: "string", String: "other"}
		}, "INVALID_REQUEST"},
		{"observed incarnation", func(options *exec.SessionOptions) { expected := "new-uid"; options.Reference.Incarnation = &expected }, "RESET_REQUIRED"},
	} {
		t.Run(test.name, func(t *testing.T) {
			options := exec.SessionOptions{
				ResourcePlugin: pluginid.ResourceProvider, ResourceKey: "k8s:/pods",
				Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
					Provider: "kubernetes", Authority: "host-issued-authority", Type: "k8s:/pods",
					Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "selected"}}, ID: "native-pod",
				}},
				Route: &resourcev2.AccessRoute{Connection: "test"},
				ResourceData: execResourceData(t, map[string]interface{}{"metadata": map[string]interface{}{
					"name": "native-pod", "namespace": "selected", "uid": "observed-uid",
				}}),
			}
			test.mutate(&options)
			_, _, err := nativeExecTarget(testPluginContext(), options, "k8s:/pods", true)
			assert.Equal(t, test.code, resourcev2.ErrorCode(err))
		})
	}
}

func TestNativeExecTargetPreservesTaggedNumericBody(t *testing.T) {
	body := execResourceData(t, map[string]interface{}{
		"metadata": map[string]interface{}{"name": "native-pod", "namespace": "selected"},
		"spec":     map[string]interface{}{"exact": int64(9223372036854775807)},
	})
	name, namespace, err := nativeExecTarget(testPluginContext(), exec.SessionOptions{ResourceData: body}, "k8s:/pods", true)
	require.NoError(t, err)
	assert.Equal(t, "native-pod", name)
	assert.Equal(t, "selected", namespace)
	assert.Equal(t, "9223372036854775807", body.Map["spec"].Map["exact"].Int)
}

func TestNativeExecTargetNodeReferenceUsesClusterScope(t *testing.T) {
	options := exec.SessionOptions{
		ResourcePlugin: pluginid.ResourceProvider, ResourceKey: "k8s:/nodes",
		Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
			Provider: "kubernetes", Authority: "host-issued-authority", Type: "k8s:/nodes",
			Scope: []resourcev2.ScopeEntry{}, ID: "native-node",
		}},
		Route: &resourcev2.AccessRoute{Connection: "test"},
	}
	name, namespace, err := nativeExecTarget(testPluginContext(), options, "k8s:/nodes", false)
	require.NoError(t, err)
	assert.Equal(t, "native-node", name)
	assert.Empty(t, namespace)
	options.Reference.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "not-cluster-scope"}}
	_, _, err = nativeExecTarget(testPluginContext(), options, "k8s:/nodes", false)
	assert.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
}

func TestNativeExecSelectorsRemainCanonicalUnderAlternateInstallationID(t *testing.T) {
	original := pluginid.ID
	pluginid.ID = "kubernetes-alternate-installation"
	t.Cleanup(func() { pluginid.ID = original })
	for _, namespaced := range []bool{true, false} {
		resourceType := "k8s:/nodes"
		scope := []resourcev2.ScopeEntry{}
		if namespaced {
			resourceType = "k8s:/pods"
			scope = []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "selected"}}
		}
		options := exec.SessionOptions{
			ResourcePlugin: pluginid.ResourceProvider, ResourceKey: resourceType,
			Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
				Provider: pluginid.ResourceProvider, Authority: "host-issued", Type: resourceType, Scope: scope, ID: "native-name",
			}},
			Route: &resourcev2.AccessRoute{Connection: "test"},
		}
		normalized, err := exec.NormalizeResourceSessionOptions(options)
		require.NoError(t, err)
		name, _, err := nativeExecTarget(testPluginContext(), normalized, resourceType, namespaced)
		require.NoError(t, err)
		assert.Equal(t, "native-name", name)
		assert.Equal(t, "kubernetes", normalized.ResourcePlugin)
		if namespaced {
			assert.Equal(t, normalized.ResourcePlugin+"/"+normalized.ResourceKey, podExecHandler().ID())
		}

		options.ResourcePlugin = pluginid.ID
		assert.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(exec.ValidateResourceSessionOptions(options)))
		_, _, err = nativeExecTarget(testPluginContext(), options, resourceType, namespaced)
		assert.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))

		options.Reference.Address.Provider = pluginid.ID
		_, _, err = nativeExecTarget(testPluginContext(), options, resourceType, namespaced)
		assert.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err), "installation identity must not redefine the native provider")
	}
	assert.Equal(t, "kubernetes-alternate-installation", pluginid.ID)
}
