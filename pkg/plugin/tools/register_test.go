package tools

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/kubernetes/scheme"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdktools "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

func configMap(namespace, name string, labels map[string]string) *corev1.ConfigMap {
	return &corev1.ConfigMap{
		TypeMeta:   metav1.TypeMeta{APIVersion: "v1", Kind: "ConfigMap"},
		ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: name, Labels: labels, ManagedFields: []metav1.ManagedFieldsEntry{{Manager: "test"}}},
	}
}

func fakeClients(t *testing.T, objects ...runtime.Object) (*Clients, *dynamicfake.FakeDynamicClient) {
	t.Helper()
	typed := fake.NewSimpleClientset(
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "kube-system"}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "web"}},
	)
	discovery := typed.Discovery().(*fakediscovery.FakeDiscovery)
	discovery.Resources = []*metav1.APIResourceList{{
		GroupVersion: "v1",
		APIResources: []metav1.APIResource{
			{Name: "configmaps", Kind: "ConfigMap", Namespaced: true, Verbs: metav1.Verbs{"get", "list", "delete"}},
			{Name: "namespaces", Kind: "Namespace", Namespaced: false, Verbs: metav1.Verbs{"get", "list"}},
		},
	}}
	dynamicClient := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme.Scheme, map[schema.GroupVersionResource]string{
		{Group: "", Version: "v1", Resource: "configmaps"}: "ConfigMapList",
		{Group: "", Version: "v1", Resource: "namespaces"}: "NamespaceList",
	}, objects...)
	return &Clients{Core: typed.CoreV1(), Dynamic: dynamicClient, Discovery: discovery}, dynamicClient
}

func toolByName(t *testing.T, tools []sdktools.Tool, name string) sdktools.Tool {
	t.Helper()
	for _, tool := range tools {
		if tool.Name == name {
			return tool
		}
	}
	t.Fatalf("tool %s not registered", name)
	return sdktools.Tool{}
}

func call(t *testing.T, tool sdktools.Tool, args string) *sdktools.Result {
	t.Helper()
	ctx := types.NewPluginContextWithConnection(context.Background(), "test", nil, nil, &types.Connection{ID: "test"})
	result, err := tool.Handler(ctx, json.RawMessage(args))
	require.NoError(t, err)
	return result
}

func TestToolsRegisterAndValidate(t *testing.T) {
	clients, _ := fakeClients(t)
	tools := Tools(func(*types.PluginContext) (*Clients, error) { return clients, nil })
	require.Len(t, tools, 5)
	for _, tool := range tools {
		require.Equal(t, sdktools.ScopeConnection, tool.Scope, tool.Name)
	}
	require.True(t, toolByName(t, tools, "delete_resource").Annotations.Destructive)
	require.True(t, toolByName(t, tools, "list_resources").Annotations.ReadOnly)
}

func TestListNamespacesAndResources(t *testing.T) {
	clients, _ := fakeClients(t,
		configMap("default", "a", map[string]string{"app": "web"}),
		configMap("default", "b", nil),
		configMap("other", "c", map[string]string{"app": "web"}),
	)
	tools := Tools(func(*types.PluginContext) (*Clients, error) { return clients, nil })

	res := call(t, toolByName(t, tools, "list_namespaces"), `{}`)
	require.False(t, res.IsError)
	require.JSONEq(t, `{"namespaces":["default","kube-system"]}`, string(res.StructuredContent))

	res = call(t, toolByName(t, tools, "list_resources"), `{"apiVersion":"v1","kind":"ConfigMap","namespace":"default"}`)
	require.False(t, res.IsError, res.Content[0].Text)
	var listing struct {
		Items     []resourceSummary `json:"items"`
		Truncated bool              `json:"truncated"`
	}
	require.NoError(t, json.Unmarshal(res.StructuredContent, &listing))
	require.Len(t, listing.Items, 2)
	require.Equal(t, "a", listing.Items[0].Name)
	require.Equal(t, map[string]string{"app": "web"}, listing.Items[0].Labels)
	require.False(t, listing.Truncated)

	res = call(t, toolByName(t, tools, "list_resources"), `{"apiVersion":"v1","kind":"ConfigMap","limit":2}`)
	require.NoError(t, json.Unmarshal(res.StructuredContent, &listing))
	require.Len(t, listing.Items, 2, "limit applies across all namespaces")
	require.True(t, listing.Truncated)

	res = call(t, toolByName(t, tools, "list_resources"), `{"apiVersion":"v1","kind":"Mystery"}`)
	require.True(t, res.IsError)
	require.Contains(t, res.Content[0].Text, "unknown resource v1/Mystery")

	res = call(t, toolByName(t, tools, "list_resources"), `{"kind":"ConfigMap"}`)
	require.True(t, res.IsError)
	require.Contains(t, res.Content[0].Text, "apiVersion and kind are required")

	res = call(t, toolByName(t, tools, "list_resources"), `{"apiVersion":"v1","kind":"ConfigMap","bogus":1}`)
	require.True(t, res.IsError)
	require.Contains(t, res.Content[0].Text, "invalid arguments")
}

func TestGetAndDeleteResource(t *testing.T) {
	clients, dynamicClient := fakeClients(t, configMap("default", "demo", nil))
	tools := Tools(func(*types.PluginContext) (*Clients, error) { return clients, nil })

	res := call(t, toolByName(t, tools, "get_resource"), `{"apiVersion":"v1","kind":"ConfigMap","namespace":"default","name":"demo"}`)
	require.False(t, res.IsError, res.Content[0].Text)
	var object map[string]any
	require.NoError(t, json.Unmarshal(res.StructuredContent, &object))
	metadata := object["metadata"].(map[string]any)
	require.Equal(t, "demo", metadata["name"])
	require.NotContains(t, metadata, "managedFields")

	res = call(t, toolByName(t, tools, "get_resource"), `{"apiVersion":"v1","kind":"ConfigMap","name":"demo"}`)
	require.True(t, res.IsError)
	require.Contains(t, res.Content[0].Text, "namespace is required")

	res = call(t, toolByName(t, tools, "delete_resource"), `{"apiVersion":"v1","kind":"ConfigMap","namespace":"default"}`)
	require.True(t, res.IsError)
	require.Contains(t, res.Content[0].Text, "name is required")

	res = call(t, toolByName(t, tools, "delete_resource"), `{"apiVersion":"v1","kind":"ConfigMap","namespace":"default","name":"demo"}`)
	require.False(t, res.IsError, res.Content[0].Text)
	require.Equal(t, "Deleted ConfigMap/demo in default", res.Content[0].Text)
	_, err := dynamicClient.Resource(schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}).
		Namespace("default").Get(context.Background(), "demo", metav1.GetOptions{})
	require.Error(t, err, "object is gone")

	res = call(t, toolByName(t, tools, "delete_resource"), `{"apiVersion":"v1","kind":"ConfigMap","namespace":"default","name":"demo"}`)
	require.True(t, res.IsError)
	require.Contains(t, res.Content[0].Text, "not found")
}

func TestGetPodLogs(t *testing.T) {
	clients, _ := fakeClients(t)
	tools := Tools(func(*types.PluginContext) (*Clients, error) { return clients, nil })

	res := call(t, toolByName(t, tools, "get_pod_logs"), `{"namespace":"default","name":"web","tailLines":10}`)
	require.False(t, res.IsError, res.Content[0].Text)
	require.Equal(t, "fake logs", res.Content[0].Text)

	res = call(t, toolByName(t, tools, "get_pod_logs"), `{"namespace":"default"}`)
	require.True(t, res.IsError)
	require.Contains(t, res.Content[0].Text, "namespace and name are required")
}

func TestClientProviderErrorIsToolError(t *testing.T) {
	tools := Tools(func(*types.PluginContext) (*Clients, error) { return nil, context.DeadlineExceeded })
	res := call(t, toolByName(t, tools, "list_namespaces"), `{}`)
	require.True(t, res.IsError)
	require.Contains(t, res.Content[0].Text, "cannot connect to the cluster")
}
