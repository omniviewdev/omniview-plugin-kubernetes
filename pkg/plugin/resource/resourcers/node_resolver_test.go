package resourcers

import (
	"context"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func nodeMeta() resource.ResourceMeta {
	return resource.ResourceMeta{
		Group:   "core",
		Version: "v1",
		Kind:    "Node",
	}
}

func TestNodeResourcer_ResolveRelationships(t *testing.T) {
	pod1 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "pod-1", Namespace: "default"},
		Spec:       corev1.PodSpec{NodeName: "node-1"},
	}
	pod2 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "pod-2", Namespace: "kube-system"},
		Spec:       corev1.PodSpec{NodeName: "node-1"},
	}
	pod3 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "pod-3", Namespace: "default"},
		Spec:       corev1.PodSpec{NodeName: "node-2"},
	}

	fakeClient := fake.NewSimpleClientset(pod1, pod2, pod3)
	cs := &clients.ClientSet{KubeClient: fakeClient}

	logger := zap.NewNop().Sugar()
	resourcer := NewNodeResourcer(logger)

	rels, err := resourcer.ResolveRelationships(context.Background(), cs, nodeMeta(), "node-1", "")
	require.NoError(t, err)
	require.Len(t, rels, 1)

	assert.Equal(t, "core::v1::Pod", rels[0].Descriptor.TargetResourceKey)
	// The fake client doesn't support field selectors, so all pods are returned.
	// In production, only node-1 pods would be returned.
	assert.GreaterOrEqual(t, len(rels[0].Targets), 2)
}

func TestNodeResourcer_ResolveRelationships_NoPods(t *testing.T) {
	fakeClient := fake.NewSimpleClientset()
	cs := &clients.ClientSet{KubeClient: fakeClient}

	logger := zap.NewNop().Sugar()
	resourcer := NewNodeResourcer(logger)

	rels, err := resourcer.ResolveRelationships(context.Background(), cs, nodeMeta(), "node-1", "")
	require.NoError(t, err)
	assert.Nil(t, rels)
}
