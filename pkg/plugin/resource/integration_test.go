package resource

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniview/kubernetes/pkg/plugin/resource/resourcers"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakedynamic "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/dynamic/dynamicinformer"
	fakeclientset "k8s.io/client-go/kubernetes/fake"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource/plugintest"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource/resourcetest"
)

// ====================== Helpers ====================== //

var (
	integDeploymentGVR = schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}
	integPodGVR        = schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}
)

func newIntegPod(name, namespace string) *unstructured.Unstructured {
	return &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "v1",
			"kind":       "Pod",
			"metadata": map[string]interface{}{
				"name":      name,
				"namespace": namespace,
			},
		},
	}
}

func newIntegDeployment(name, namespace string, replicas int64) *unstructured.Unstructured {
	return &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "apps/v1",
			"kind":       "Deployment",
			"metadata": map[string]interface{}{
				"name":      name,
				"namespace": namespace,
			},
			"spec": map[string]interface{}{
				"replicas": replicas,
				"selector": map[string]interface{}{
					"matchLabels": map[string]interface{}{"app": name},
				},
				"template": map[string]interface{}{
					"metadata": map[string]interface{}{
						"labels": map[string]interface{}{"app": name},
					},
					"spec": map[string]interface{}{
						"containers": []interface{}{
							map[string]interface{}{
								"name":  name,
								"image": "nginx:latest",
							},
						},
					},
				},
			},
		},
	}
}

func mustJSON(v interface{}) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return data
}

// makeIntegClientSet creates a clients.ClientSet with fake K8s clients.
// preRegister lists GVRs whose informers should be pre-registered (for watch tests).
// typedObjects are seeded into the fake typed Clientset (for action tests).
// dynamicObjects are seeded into the fake dynamic client (for CRUD/watch tests).
func makeIntegClientSet(
	gvrToListKind map[schema.GroupVersionResource]string,
	preRegister []schema.GroupVersionResource,
	typedObjects []runtime.Object,
	dynamicObjects ...runtime.Object,
) *clients.ClientSet {
	scheme := runtime.NewScheme()
	dynamicClient := fakedynamic.NewSimpleDynamicClientWithCustomListKinds(scheme, gvrToListKind, dynamicObjects...)
	factory := dynamicinformer.NewDynamicSharedInformerFactory(dynamicClient, 0)

	for _, gvr := range preRegister {
		factory.ForResource(gvr).Informer()
	}

	fakeKube := fakeclientset.NewSimpleClientset(typedObjects...)

	return &clients.ClientSet{
		DynamicClient:          dynamicClient,
		DynamicInformerFactory: factory,
		KubeClient:             fakeKube,
	}
}

// integConnProvider returns a StubConnectionProvider that returns the given ClientSet.
func integConnProvider(cs *clients.ClientSet) *resourcetest.StubConnectionProvider[clients.ClientSet] {
	return &resourcetest.StubConnectionProvider[clients.ClientSet]{
		CreateClientFunc: func(_ context.Context) (*clients.ClientSet, error) {
			return cs, nil
		},
		LoadConnectionsFunc: func(_ context.Context) ([]types.Connection, error) {
			return []types.Connection{{ID: "test-conn", Name: "Test Cluster"}}, nil
		},
		GetNamespacesFunc: func(_ context.Context, _ *clients.ClientSet) ([]string, error) {
			return []string{"default"}, nil
		},
	}
}

// mountAndConnect mounts the harness, loads connections, and starts "test-conn".
func mountAndConnect(t *testing.T, cfg resource.ResourcePluginConfig[clients.ClientSet]) *plugintest.Harness[clients.ClientSet] {
	t.Helper()
	h := plugintest.Mount(t, cfg)
	h.LoadConnections()
	h.StartConnection("test-conn")
	return h
}

// ====================== Integration Tests ====================== //

func TestIntegration_CRUD_Deployment(t *testing.T) {
	logger := zap.NewNop().Sugar()

	cs := makeIntegClientSet(
		map[schema.GroupVersionResource]string{integDeploymentGVR: "DeploymentList"},
		nil, // no pre-registered informers — CRUD uses DynamicClient fallback
		nil, // no typed objects
		newIntegDeployment("existing-deploy", "default", 3),
	)

	// Use a base resourcer with SyncNever to avoid background watch goroutines.
	deployRes := resourcers.NewKubernetesResourcerBase[resourcers.MetaAccessor](
		logger, integDeploymentGVR, resourcers.WithSyncPolicy(resource.SyncNever),
	)

	cfg := resource.ResourcePluginConfig[clients.ClientSet]{
		Connections: integConnProvider(cs),
		Resources: []resource.ResourceRegistration[clients.ClientSet]{
			{
				Meta:      resource.ResourceMeta{Group: "apps", Version: "v1", Kind: "Deployment"},
				Resourcer: deployRes,
			},
		},
	}

	h := mountAndConnect(t, cfg)
	key := "apps::v1::Deployment"

	// List — should find the pre-seeded deployment.
	listResult := h.List(key, resource.ListInput{})
	require.True(t, listResult.Success)
	require.Len(t, listResult.Result, 1)

	// Get — retrieve the pre-seeded deployment.
	getResult := h.Get(key, resource.GetInput{ID: "existing-deploy", Namespace: "default"})
	require.True(t, getResult.Success)
	var obj map[string]interface{}
	require.NoError(t, json.Unmarshal(getResult.Result, &obj))
	md, _ := obj["metadata"].(map[string]interface{})
	assert.Equal(t, "existing-deploy", md["name"])

	// Create — add a new deployment.
	createResult := h.Create(key, resource.CreateInput{
		Namespace: "default",
		Input:     mustJSON(newIntegDeployment("new-deploy", "default", 2).Object),
	})
	require.True(t, createResult.Success)

	// List again — should now have 2 deployments.
	listResult = h.List(key, resource.ListInput{})
	require.True(t, listResult.Success)
	assert.Len(t, listResult.Result, 2)

	// Delete — remove the new deployment.
	deleteResult := h.Delete(key, resource.DeleteInput{ID: "new-deploy", Namespace: "default"})
	require.True(t, deleteResult.Success)

	// List again — back to 1.
	listResult = h.List(key, resource.ListInput{})
	require.True(t, listResult.Success)
	assert.Len(t, listResult.Result, 1)
}

func TestIntegration_Actions_Deployment(t *testing.T) {
	logger := zap.NewNop().Sugar()

	replicas := int32(3)
	typedDep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "my-deploy", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "my-deploy"}},
		},
	}

	cs := makeIntegClientSet(
		map[schema.GroupVersionResource]string{integDeploymentGVR: "DeploymentList"},
		nil,
		[]runtime.Object{typedDep}, // typed object for KubeClient Patch operations
	)

	deployRes := resourcers.NewDeploymentResourcer(logger)
	cfg := resource.ResourcePluginConfig[clients.ClientSet]{
		Connections: integConnProvider(cs),
		Resources: []resource.ResourceRegistration[clients.ClientSet]{
			{
				Meta:      resource.ResourceMeta{Group: "apps", Version: "v1", Kind: "Deployment"},
				Resourcer: deployRes,
			},
		},
	}

	h := mountAndConnect(t, cfg)
	key := "apps::v1::Deployment"

	// Scale action.
	scaleResult := h.ExecuteAction(key, "scale", resource.ActionInput{
		ID:        "my-deploy",
		Namespace: "default",
		Params:    map[string]interface{}{"replicas": float64(5)},
	})
	assert.True(t, scaleResult.Success)
	assert.Contains(t, scaleResult.Message, "scaled")

	// Pause action.
	pauseResult := h.ExecuteAction(key, "pause", resource.ActionInput{
		ID:        "my-deploy",
		Namespace: "default",
	})
	assert.True(t, pauseResult.Success)
	assert.Contains(t, pauseResult.Message, "paused")

	// Resume action.
	resumeResult := h.ExecuteAction(key, "resume", resource.ActionInput{
		ID:        "my-deploy",
		Namespace: "default",
	})
	assert.True(t, resumeResult.Success)
	assert.Contains(t, resumeResult.Message, "resumed")

	// Restart action (non-streaming).
	restartResult := h.ExecuteAction(key, "restart", resource.ActionInput{
		ID:        "my-deploy",
		Namespace: "default",
	})
	assert.True(t, restartResult.Success)
	assert.Contains(t, restartResult.Message, "Rollout restart initiated")
}

func TestIntegration_Watch_ReceivesEvents(t *testing.T) {
	logger := zap.NewNop().Sugar()

	cs := makeIntegClientSet(
		map[schema.GroupVersionResource]string{integPodGVR: "PodList"},
		[]schema.GroupVersionResource{integPodGVR}, // pre-register for watch sync
		nil,
		newIntegPod("pod-a", "default"),
		newIntegPod("pod-b", "default"),
	)

	podRes := resourcers.NewKubernetesResourcerBase[resourcers.MetaAccessor](logger, integPodGVR)
	cfg := resource.ResourcePluginConfig[clients.ClientSet]{
		Connections: integConnProvider(cs),
		Resources: []resource.ResourceRegistration[clients.ClientSet]{
			{
				Meta:      resource.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"},
				Resourcer: podRes,
			},
		},
	}

	h := mountAndConnect(t, cfg)

	// The 2 pre-seeded pods should appear as ADD events after sync.
	h.WaitForAdds(2, 5*time.Second)
}

func TestIntegration_Health_Deployment(t *testing.T) {
	logger := zap.NewNop().Sugar()

	cs := makeIntegClientSet(
		map[schema.GroupVersionResource]string{integDeploymentGVR: "DeploymentList"},
		nil, nil,
	)

	deployRes := resourcers.NewDeploymentResourcer(logger)
	cfg := resource.ResourcePluginConfig[clients.ClientSet]{
		Connections: integConnProvider(cs),
		Resources: []resource.ResourceRegistration[clients.ClientSet]{
			{
				Meta:      resource.ResourceMeta{Group: "apps", Version: "v1", Kind: "Deployment"},
				Resourcer: deployRes,
			},
		},
	}

	h := mountAndConnect(t, cfg)

	// Healthy deployment: all replicas available.
	replicas := int32(3)
	dep := appsv1.Deployment{
		Spec:   appsv1.DeploymentSpec{Replicas: &replicas},
		Status: appsv1.DeploymentStatus{AvailableReplicas: 3},
	}
	data, err := json.Marshal(dep)
	require.NoError(t, err)

	health := h.GetHealth("test-conn", "apps::v1::Deployment", data)
	require.NotNil(t, health)
	assert.Equal(t, resource.HealthHealthy, health.Status)
	assert.Equal(t, "Available", health.Reason)

	// Degraded deployment: partial availability.
	dep.Status.AvailableReplicas = 1
	data, _ = json.Marshal(dep)
	health = h.GetHealth("test-conn", "apps::v1::Deployment", data)
	require.NotNil(t, health)
	assert.Equal(t, resource.HealthDegraded, health.Status)

	// Unhealthy deployment: no replicas available.
	dep.Status.AvailableReplicas = 0
	data, _ = json.Marshal(dep)
	health = h.GetHealth("test-conn", "apps::v1::Deployment", data)
	require.NotNil(t, health)
	assert.Equal(t, resource.HealthUnhealthy, health.Status)
}

func TestIntegration_PatternResourcer_CRD(t *testing.T) {
	logger := zap.NewNop().Sugar()

	widgetGVR := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	cs := makeIntegClientSet(
		map[schema.GroupVersionResource]string{widgetGVR: "WidgetList"},
		nil, nil,
	)

	cfg := resource.ResourcePluginConfig[clients.ClientSet]{
		Connections: integConnProvider(cs),
		Patterns: map[string]resource.Resourcer[clients.ClientSet]{
			"*": resourcers.NewKubernetesPatternResourcer(logger),
		},
	}

	h := mountAndConnect(t, cfg)
	key := "example.com::v1::Widget"

	// Create a widget CRD object through the pattern resourcer.
	widgetObj := map[string]interface{}{
		"apiVersion": "example.com/v1",
		"kind":       "Widget",
		"metadata": map[string]interface{}{
			"name":      "my-widget",
			"namespace": "default",
		},
		"spec": map[string]interface{}{
			"color": "blue",
		},
	}

	createResult := h.Create(key, resource.CreateInput{
		Namespace: "default",
		Input:     mustJSON(widgetObj),
	})
	require.True(t, createResult.Success)

	// Verify the created object.
	var created map[string]interface{}
	require.NoError(t, json.Unmarshal(createResult.Result, &created))
	md, _ := created["metadata"].(map[string]interface{})
	assert.Equal(t, "my-widget", md["name"])

	// Delete the widget through the pattern resourcer.
	deleteResult := h.Delete(key, resource.DeleteInput{
		ID:        "my-widget",
		Namespace: "default",
	})
	require.True(t, deleteResult.Success)
}

func TestIntegration_Relationships_Pod(t *testing.T) {
	logger := zap.NewNop().Sugar()

	cs := makeIntegClientSet(
		map[schema.GroupVersionResource]string{integPodGVR: "PodList"},
		nil, nil,
	)

	podRes := resourcers.NewPodResourcer(logger)
	cfg := resource.ResourcePluginConfig[clients.ClientSet]{
		Connections: integConnProvider(cs),
		Resources: []resource.ResourceRegistration[clients.ClientSet]{
			{
				Meta:      resource.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"},
				Resourcer: podRes,
			},
		},
	}

	// No need to start a connection for relationships — they are static declarations.
	h := plugintest.Mount(t, cfg)

	rels := h.GetRelationships("core::v1::Pod")
	require.Len(t, rels, 5)

	// Build a map by target resource key for easier assertions.
	relTargets := make(map[string]resource.RelationshipDescriptor)
	for _, rel := range rels {
		relTargets[rel.TargetResourceKey] = rel
	}

	assert.Contains(t, relTargets, "core::v1::Node")
	assert.Contains(t, relTargets, "core::v1::PersistentVolumeClaim")
	assert.Contains(t, relTargets, "core::v1::ConfigMap")
	assert.Contains(t, relTargets, "core::v1::Secret")
	assert.Contains(t, relTargets, "core::v1::ServiceAccount")

	// Verify relationship types.
	assert.Equal(t, resource.RelRunsOn, relTargets["core::v1::Node"].Type)
	assert.Equal(t, resource.RelUses, relTargets["core::v1::PersistentVolumeClaim"].Type)
	assert.Equal(t, resource.RelUses, relTargets["core::v1::ConfigMap"].Type)
	assert.Equal(t, resource.RelUses, relTargets["core::v1::Secret"].Type)
	assert.Equal(t, resource.RelUses, relTargets["core::v1::ServiceAccount"].Type)
}
