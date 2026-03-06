package resourcers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// patternGVR matches the GVR that gvrFromMetaV1 constructs from patternMeta (pluralized, lowercase).
var patternGVR = schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}
var patternMeta = resource.ResourceMeta{Group: "apps", Version: "v1", Kind: "Deployment"}

func patternGVRListKinds() map[schema.GroupVersionResource]string {
	return map[schema.GroupVersionResource]string{
		patternGVR: "DeploymentList",
	}
}

func newPatternResourcer() *KubernetesPatternResourcer {
	logger := zap.NewNop().Sugar()
	return NewKubernetesPatternResourcer(logger)
}

// mustMarshal is a test helper that marshals v to json.RawMessage and fails the test on error.
func mustMarshal(t *testing.T, v interface{}) json.RawMessage {
	t.Helper()
	data, err := json.Marshal(v)
	require.NoError(t, err)
	return data
}

// mustUnmarshalMap is a test helper that unmarshals json.RawMessage into map[string]interface{}.
func mustUnmarshalMap(t *testing.T, raw json.RawMessage) map[string]interface{} {
	t.Helper()
	var m map[string]interface{}
	require.NoError(t, json.Unmarshal(raw, &m))
	return m
}

// seedDeployment creates a deployment via the DynamicClient so it exists for Update/Delete tests.
func seedDeployment(t *testing.T, cs *clients.ClientSet, name, namespace string) {
	t.Helper()
	dep := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "apps/v1",
		"kind":       "Deployment",
		"metadata": map[string]interface{}{
			"name":      name,
			"namespace": namespace,
		},
	}}
	_, err := cs.DynamicClient.Resource(patternGVR).Namespace(namespace).Create(
		context.Background(), dep, v1.CreateOptions{},
	)
	require.NoError(t, err)
}

func TestParseListV1(t *testing.T) {
	t.Run("converts items to json.RawMessage", func(t *testing.T) {
		list := &unstructured.UnstructuredList{
			Items: []unstructured.Unstructured{
				{Object: map[string]interface{}{
					"apiVersion": "v1",
					"kind":       "Pod",
					"metadata":   map[string]interface{}{"name": "pod-1", "namespace": "default"},
				}},
				{Object: map[string]interface{}{
					"apiVersion": "v1",
					"kind":       "Pod",
					"metadata":   map[string]interface{}{"name": "pod-2", "namespace": "default"},
				}},
			},
		}

		result, err := parseListV1(list)
		require.NoError(t, err)
		require.Len(t, result, 2)

		item0 := mustUnmarshalMap(t, result[0])
		item1 := mustUnmarshalMap(t, result[1])
		assert.Equal(t, "pod-1", item0["metadata"].(map[string]interface{})["name"])
		assert.Equal(t, "pod-2", item1["metadata"].(map[string]interface{})["name"])
	})

	t.Run("empty list returns empty slice", func(t *testing.T) {
		list := &unstructured.UnstructuredList{Items: []unstructured.Unstructured{}}
		result, err := parseListV1(list)
		require.NoError(t, err)
		assert.Empty(t, result)
	})

	t.Run("preserves all fields", func(t *testing.T) {
		list := &unstructured.UnstructuredList{
			Items: []unstructured.Unstructured{
				{Object: map[string]interface{}{
					"apiVersion": "apps/v1",
					"kind":       "Deployment",
					"metadata": map[string]interface{}{
						"name":      "deploy-1",
						"namespace": "production",
						"labels":    map[string]interface{}{"app": "web"},
					},
					"spec": map[string]interface{}{
						"replicas": int64(3),
					},
				}},
			},
		}

		result, err := parseListV1(list)
		require.NoError(t, err)
		require.Len(t, result, 1)

		item := mustUnmarshalMap(t, result[0])
		assert.Equal(t, "apps/v1", item["apiVersion"])
		assert.Equal(t, "Deployment", item["kind"])

		spec := item["spec"].(map[string]interface{})
		// json.Unmarshal decodes numbers as float64
		assert.Equal(t, float64(3), spec["replicas"])
	})
}

// ===================== PatternResourcer Create =====================

func TestPattern_Create_Success(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	r := newPatternResourcer()

	input := resource.CreateInput{
		Namespace: "default",
		Input: mustMarshal(t, map[string]interface{}{
			"apiVersion": "apps/v1",
			"kind":       "Deployment",
			"metadata": map[string]interface{}{
				"name":      "my-deploy",
				"namespace": "default",
			},
		}),
	}

	result, err := r.Create(context.Background(), cs, patternMeta, input)

	require.NoError(t, err)
	require.NotNil(t, result)
	m := mustUnmarshalMap(t, result.Result)
	assert.Equal(t, "my-deploy", m["metadata"].(map[string]interface{})["name"])
}

func TestPattern_Create_AlreadyExists(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	seedDeployment(t, cs, "existing", "default")
	r := newPatternResourcer()

	input := resource.CreateInput{
		Namespace: "default",
		Input: mustMarshal(t, map[string]interface{}{
			"apiVersion": "apps/v1",
			"kind":       "Deployment",
			"metadata": map[string]interface{}{
				"name":      "existing",
				"namespace": "default",
			},
		}),
	}

	result, err := r.Create(context.Background(), cs, patternMeta, input)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "already exists")
}

// ===================== PatternResourcer Update =====================

func TestPattern_Update_Success(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	seedDeployment(t, cs, "update-me", "default")
	r := newPatternResourcer()

	input := resource.UpdateInput{
		ID:        "update-me",
		Namespace: "default",
		Input: mustMarshal(t, map[string]interface{}{
			"apiVersion": "apps/v1",
			"kind":       "Deployment",
			"metadata": map[string]interface{}{
				"name":      "update-me",
				"namespace": "default",
				"labels":    map[string]interface{}{"env": "staging"},
			},
		}),
	}

	result, err := r.Update(context.Background(), cs, patternMeta, input)

	require.NoError(t, err)
	require.NotNil(t, result)

	m := mustUnmarshalMap(t, result.Result)
	meta := m["metadata"].(map[string]interface{})
	assert.Equal(t, "update-me", meta["name"])
	labels := meta["labels"].(map[string]interface{})
	assert.Equal(t, "staging", labels["env"])
}

func TestPattern_Update_NotFound(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	r := newPatternResourcer()

	input := resource.UpdateInput{
		ID:        "ghost",
		Namespace: "default",
		Input: mustMarshal(t, map[string]interface{}{
			"apiVersion": "apps/v1",
			"kind":       "Deployment",
			"metadata":   map[string]interface{}{"name": "ghost", "namespace": "default"},
		}),
	}

	result, err := r.Update(context.Background(), cs, patternMeta, input)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "not found")
}

// ===================== PatternResourcer Delete =====================

func TestPattern_Delete_Success(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	seedDeployment(t, cs, "doomed", "default")
	r := newPatternResourcer()

	input := resource.DeleteInput{
		ID:        "doomed",
		Namespace: "default",
	}

	result, err := r.Delete(context.Background(), cs, patternMeta, input)

	require.NoError(t, err)
	require.NotNil(t, result)
	m := mustUnmarshalMap(t, result.Result)
	assert.Equal(t, "doomed", m["metadata"].(map[string]interface{})["name"])

	// Verify it's gone
	_, err = cs.DynamicClient.Resource(patternGVR).Namespace("default").Get(
		context.Background(), "doomed", v1.GetOptions{},
	)
	require.Error(t, err)
}

func TestPattern_Delete_NotFound(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	r := newPatternResourcer()

	input := resource.DeleteInput{
		ID:        "phantom",
		Namespace: "default",
	}

	result, err := r.Delete(context.Background(), cs, patternMeta, input)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "not found")
}

// ===================== PatternResourcer Success field =====================

func TestPattern_Create_SetsSuccessTrue(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	r := newPatternResourcer()

	result, err := r.Create(context.Background(), cs, patternMeta, resource.CreateInput{
		Namespace: "default",
		Input: mustMarshal(t, map[string]interface{}{
			"apiVersion": "apps/v1", "kind": "Deployment",
			"metadata": map[string]interface{}{"name": "test", "namespace": "default"},
		}),
	})

	require.NoError(t, err)
	assert.True(t, result.Success)
}

func TestPattern_Update_SetsSuccessTrue(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	seedDeployment(t, cs, "target", "default")
	r := newPatternResourcer()

	result, err := r.Update(context.Background(), cs, patternMeta, resource.UpdateInput{
		ID: "target", Namespace: "default",
		Input: mustMarshal(t, map[string]interface{}{
			"apiVersion": "apps/v1", "kind": "Deployment",
			"metadata": map[string]interface{}{"name": "target", "namespace": "default"},
		}),
	})

	require.NoError(t, err)
	assert.True(t, result.Success)
}

func TestPattern_Delete_SetsSuccessTrue(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	seedDeployment(t, cs, "target", "default")
	r := newPatternResourcer()

	result, err := r.Delete(context.Background(), cs, patternMeta, resource.DeleteInput{
		ID: "target", Namespace: "default",
	})

	require.NoError(t, err)
	assert.True(t, result.Success)
}

// ===================== GVR consistency =====================

// TestPattern_CreateThenDelete_SameGVR verifies that Create and Delete operate
// on the same GVR so a resource written via Create can be deleted via Delete.
func TestPattern_CreateThenDelete_SameGVR(t *testing.T) {
	cs := newFakeClientSet(patternGVRListKinds())
	r := newPatternResourcer()

	// Create a deployment
	createResult, err := r.Create(context.Background(), cs, patternMeta, resource.CreateInput{
		Namespace: "default",
		Input: mustMarshal(t, map[string]interface{}{
			"apiVersion": "apps/v1", "kind": "Deployment",
			"metadata": map[string]interface{}{"name": "roundtrip", "namespace": "default"},
		}),
	})
	require.NoError(t, err)
	m := mustUnmarshalMap(t, createResult.Result)
	assert.Equal(t, "roundtrip", m["metadata"].(map[string]interface{})["name"])

	// Delete the same deployment — if GVR is consistent this succeeds
	deleteResult, err := r.Delete(context.Background(), cs, patternMeta, resource.DeleteInput{
		ID: "roundtrip", Namespace: "default",
	})
	require.NoError(t, err)
	assert.True(t, deleteResult.Success)
}

// ===================== Helper function tests =====================

func TestResourceNameV1(t *testing.T) {
	tests := []struct {
		kind     string
		expected string
	}{
		{"Deployment", "deployments"},
		{"Pod", "pods"},
		{"Service", "services"},
		{"Ingress", "ingresses"},
		{"Endpoints", "endpoints"},
	}
	for _, tt := range tests {
		t.Run(tt.kind, func(t *testing.T) {
			meta := resource.ResourceMeta{Kind: tt.kind}
			assert.Equal(t, tt.expected, resourceNameV1(meta))
		})
	}
}

func TestGvrFromMetaV1(t *testing.T) {
	meta := resource.ResourceMeta{Group: "apps", Version: "v1", Kind: "Deployment"}
	gvr := gvrFromMetaV1(meta)
	assert.Equal(t, "apps", gvr.Group)
	assert.Equal(t, "v1", gvr.Version)
	assert.Equal(t, "deployments", gvr.Resource)
}

func TestApiBasePathV1(t *testing.T) {
	t.Run("core group uses /api/", func(t *testing.T) {
		assert.Equal(t, "/api/v1", apiBasePathV1("", "v1"))
	})
	t.Run("named group uses /apis/", func(t *testing.T) {
		assert.Equal(t, "/apis/apps/v1", apiBasePathV1("apps", "v1"))
	})
	t.Run("extensions group", func(t *testing.T) {
		assert.Equal(t, "/apis/networking.k8s.io/v1", apiBasePathV1("networking.k8s.io", "v1"))
	})
}
