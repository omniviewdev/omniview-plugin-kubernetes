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
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/kubernetes/fake"
)

func newTestClientSet(objs ...runtime.Object) *clients.ClientSet {
	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)

	fakeKube := fake.NewSimpleClientset(objs...)
	fakeDynamic := dynamicfake.NewSimpleDynamicClient(scheme, objs...)
	factory := dynamicinformer.NewDynamicSharedInformerFactory(fakeDynamic, 0)

	return &clients.ClientSet{
		KubeClient:             fakeKube,
		DynamicClient:          fakeDynamic,
		DynamicInformerFactory: factory,
	}
}

func podMeta() resource.ResourceMeta {
	return resource.ResourceMeta{
		Group:   "core",
		Version: "v1",
		Kind:    "Pod",
	}
}

func TestPodResourcer_ResolveRelationships(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-pod",
			Namespace: "default",
		},
		Spec: corev1.PodSpec{
			NodeName:           "node-1",
			ServiceAccountName: "my-sa",
			Containers:         []corev1.Container{{Name: "app", Image: "nginx"}},
			Volumes: []corev1.Volume{
				{Name: "pvc-vol", VolumeSource: corev1.VolumeSource{
					PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "data-pvc"},
				}},
				{Name: "cm-vol", VolumeSource: corev1.VolumeSource{
					ConfigMap: &corev1.ConfigMapVolumeSource{
						LocalObjectReference: corev1.LocalObjectReference{Name: "app-config"},
					},
				}},
				{Name: "sec-vol", VolumeSource: corev1.VolumeSource{
					Secret: &corev1.SecretVolumeSource{SecretName: "app-secret"},
				}},
			},
		},
	}

	cs := newTestClientSet(pod)

	// Start the informer factory and wait for cache sync.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gvr := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}
	cs.DynamicInformerFactory.ForResource(gvr).Informer()
	cs.DynamicInformerFactory.Start(ctx.Done())
	cs.DynamicInformerFactory.WaitForCacheSync(ctx.Done())

	logger := zap.NewNop().Sugar()
	resourcer := NewPodResourcer(logger)

	rels, err := resourcer.ResolveRelationships(ctx, cs, podMeta(), "test-pod", "default")
	require.NoError(t, err)
	require.Len(t, rels, 5)

	// Node
	assert.Equal(t, "core::v1::Node", rels[0].Descriptor.TargetResourceKey)
	require.Len(t, rels[0].Targets, 1)
	assert.Equal(t, "node-1", rels[0].Targets[0].ID)

	// PVC
	assert.Equal(t, "core::v1::PersistentVolumeClaim", rels[1].Descriptor.TargetResourceKey)
	require.Len(t, rels[1].Targets, 1)
	assert.Equal(t, "data-pvc", rels[1].Targets[0].ID)

	// ConfigMap
	assert.Equal(t, "core::v1::ConfigMap", rels[2].Descriptor.TargetResourceKey)
	require.Len(t, rels[2].Targets, 1)
	assert.Equal(t, "app-config", rels[2].Targets[0].ID)

	// Secret
	assert.Equal(t, "core::v1::Secret", rels[3].Descriptor.TargetResourceKey)
	require.Len(t, rels[3].Targets, 1)
	assert.Equal(t, "app-secret", rels[3].Targets[0].ID)

	// ServiceAccount
	assert.Equal(t, "core::v1::ServiceAccount", rels[4].Descriptor.TargetResourceKey)
	require.Len(t, rels[4].Targets, 1)
	assert.Equal(t, "my-sa", rels[4].Targets[0].ID)
}

func TestPodResourcer_ResolveRelationships_NoVolumes(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "bare-pod",
			Namespace: "default",
		},
		Spec: corev1.PodSpec{
			NodeName:   "node-1",
			Containers: []corev1.Container{{Name: "app", Image: "nginx"}},
		},
	}

	cs := newTestClientSet(pod)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gvr := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}
	cs.DynamicInformerFactory.ForResource(gvr).Informer()
	cs.DynamicInformerFactory.Start(ctx.Done())
	cs.DynamicInformerFactory.WaitForCacheSync(ctx.Done())

	logger := zap.NewNop().Sugar()
	resourcer := NewPodResourcer(logger)

	rels, err := resourcer.ResolveRelationships(ctx, cs, podMeta(), "bare-pod", "default")
	require.NoError(t, err)

	// ServiceAccount name "default" is treated as the implicit default and skipped,
	// so only the Node relationship is expected.
	require.Len(t, rels, 1)
	assert.Equal(t, "core::v1::Node", rels[0].Descriptor.TargetResourceKey)
}

func TestPodResourcer_ResolveRelationships_NotFound(t *testing.T) {
	cs := newTestClientSet() // no pods
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gvr := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}
	cs.DynamicInformerFactory.ForResource(gvr).Informer()
	cs.DynamicInformerFactory.Start(ctx.Done())
	cs.DynamicInformerFactory.WaitForCacheSync(ctx.Done())

	logger := zap.NewNop().Sugar()
	resourcer := NewPodResourcer(logger)

	_, err := resourcer.ResolveRelationships(ctx, cs, podMeta(), "nonexistent", "default")
	require.Error(t, err)
}
