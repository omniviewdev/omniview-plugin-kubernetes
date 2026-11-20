package resourcers

import (
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"testing"
)

func newBaseResourcer() *KubernetesResourcerBase[MetaAccessor] {
	return NewKubernetesResourcerBase[MetaAccessor](zap.NewNop().Sugar(), testGVR)
}

// Finite CRUD lives in native_read/native_mutation tests, not the optional base.
func TestExtractMetadata(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]interface{}{"metadata": map[string]interface{}{
		"uid": "abc-123", "creationTimestamp": "2026-01-15T10:30:00Z", "labels": map[string]interface{}{"app": "web", "env": "prod"},
	}}}
	meta := extractMetadata(obj)
	assert.Equal(t, "web", meta.Labels["app"])
	assert.Equal(t, "prod", meta.Labels["env"])
	require.NotNil(t, meta.CreatedAt)
	assert.Equal(t, 2026, meta.CreatedAt.Year())
}
func TestExtractMetadata_NoTimestamp(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]interface{}{"metadata": map[string]interface{}{"uid": "xyz-456"}}}
	assert.Nil(t, extractMetadata(obj).CreatedAt)
}
func TestNativeRequestNamespace(t *testing.T) {
	for _, tt := range []struct {
		name      string
		scope     []resource.ScopeEntry
		namespace string
		invalid   bool
	}{
		{name: "cluster"},
		{name: "namespace", scope: []resource.ScopeEntry{{Dimension: "namespace", Value: "team-a"}}, namespace: "team-a"},
		{name: "unknown", scope: []resource.ScopeEntry{{Dimension: "region", Value: "team-a"}}, invalid: true},
		{name: "empty", scope: []resource.ScopeEntry{{Dimension: "namespace"}}, invalid: true},
		{name: "duplicate", scope: []resource.ScopeEntry{{Dimension: "namespace", Value: "a"}, {Dimension: "namespace", Value: "b"}}, invalid: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			namespace, err := nativeRequestNamespace(tt.scope)
			if tt.invalid {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.namespace, namespace)
			}
		})
	}
}
func TestWatchRecordPreservesCanonicalIdentity(t *testing.T) {
	target := testWatchTarget()
	target.Type = "opaque/type::not-a-gvk"
	obj := newTestPod("native-name", "team-a")
	obj.SetUID("native-uid")
	obj.SetResourceVersion("opaque/revision")
	record, err := watchRecord(testGVR, target, testWatchRepresentation(), obj)
	require.NoError(t, err)
	assert.Equal(t, target.Provider, record.Reference.Address.Provider)
	assert.Equal(t, target.Authority, record.Reference.Address.Authority)
	assert.Equal(t, target.Type, record.Reference.Address.Type)
	assert.Equal(t, "native-name", record.Reference.Address.ID)
	assert.Equal(t, []resource.ScopeEntry{{Dimension: "namespace", Value: "team-a"}}, record.Reference.Address.Scope)
	require.NotNil(t, record.Reference.Incarnation)
	assert.Equal(t, "native-uid", *record.Reference.Incarnation)
	require.NotNil(t, record.SourceRevision)
	assert.Equal(t, "opaque/revision", *record.SourceRevision)
	assert.Equal(t, testWatchRepresentation(), record.Representation)
	assert.Equal(t, "map", record.Body.Kind)
}
func TestWatchRecordAbsentIncarnationAndRevision(t *testing.T) {
	record, err := watchRecord(testGVR, testWatchTarget(), testWatchRepresentation(), newTestPod("cluster-name", ""))
	require.NoError(t, err)
	assert.Empty(t, record.Reference.Address.Scope)
	assert.Nil(t, record.Reference.Incarnation)
	assert.Nil(t, record.SourceRevision)
}

func TestPresentationRetainsNativeColumnsAndTypedLinks(t *testing.T) {
	pod := ResourceDefs["k8s:/pods"]
	columns := make(map[string]resource.ColumnDefinition, len(pod.ColumnDefs))
	for _, column := range pod.ColumnDefs {
		columns[column.ID] = column
	}
	assert.Equal(t, "SUM", columns["restarts"].Formatter)
	assert.Equal(t, "$.status.containerStatuses[*].restartCount", columns["restarts"].Accessors)
	assert.Equal(t, "FIRST", columns["phase"].AccessorPriority)
	assert.Equal(t, "AGE", columns["age"].Formatter)
	owner := columns["controlledBy"].ResourceLink
	require.NotNil(t, owner)
	assert.Equal(t, "kind", owner.TypeAccessor)
	assert.Equal(t, "k8s:apps/replicasets", owner.TypeMap["ReplicaSet"])
	assert.Empty(t, owner.Type)
	assert.Equal(t, []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "$.metadata.namespace"}}, owner.ScopeAccessors)
	node := columns["node"].ResourceLink
	require.NotNil(t, node)
	assert.Equal(t, "k8s:/nodes", node.Type)
	assert.Empty(t, node.ScopeAccessors)
	claimDef := ResourceDefs["k8s:/persistentvolumes"]
	for _, column := range claimDef.ColumnDefs {
		if column.ID == "claimRef" {
			require.NotNil(t, column.ResourceLink)
			assert.Equal(t, "k8s:/persistentvolumeclaims", column.ResourceLink.Type)
			assert.Equal(t, []resource.ScopeExtractor{{Dimension: "namespace", FieldPath: "namespace"}}, column.ResourceLink.ScopeAccessors)
		}
	}
}
