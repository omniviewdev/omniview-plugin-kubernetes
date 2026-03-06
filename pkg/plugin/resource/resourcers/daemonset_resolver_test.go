package resourcers

import (
	"context"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
)

func dsMeta() resource.ResourceMeta {
	return resource.ResourceMeta{
		Group:   "apps",
		Version: "v1",
		Kind:    "DaemonSet",
	}
}

func TestDaemonSetResourcer_ResolveRelationships(t *testing.T) {
	ds := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-ds",
			Namespace: "kube-system",
			UID:       "ds-uid-456",
		},
		Spec: appsv1.DaemonSetSpec{
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{"app": "agent"},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "agent"}},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{Name: "agent", Image: "agent:v1"}},
					Volumes: []corev1.Volume{
						{Name: "config", VolumeSource: corev1.VolumeSource{
							ConfigMap: &corev1.ConfigMapVolumeSource{
								LocalObjectReference: corev1.LocalObjectReference{Name: "agent-config"},
							},
						}},
						{Name: "certs", VolumeSource: corev1.VolumeSource{
							Secret: &corev1.SecretVolumeSource{SecretName: "agent-certs"},
						}},
					},
				},
			},
		},
	}

	pod1 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-ds-node1",
			Namespace: "kube-system",
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "DaemonSet", Name: "my-ds", UID: types.UID("ds-uid-456")},
			},
		},
	}
	pod2 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-ds-node2",
			Namespace: "kube-system",
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "DaemonSet", Name: "my-ds", UID: types.UID("ds-uid-456")},
			},
		},
	}

	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)
	_ = appsv1.AddToScheme(scheme)

	fakeKube := fake.NewSimpleClientset(ds, pod1, pod2)
	fakeDynamic := dynamicfake.NewSimpleDynamicClient(scheme, ds)
	factory := dynamicinformer.NewDynamicSharedInformerFactory(fakeDynamic, 0)

	cs := &clients.ClientSet{
		KubeClient:             fakeKube,
		DynamicClient:          fakeDynamic,
		DynamicInformerFactory: factory,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gvr := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "daemonsets"}
	factory.ForResource(gvr).Informer()
	factory.Start(ctx.Done())
	factory.WaitForCacheSync(ctx.Done())

	logger := zap.NewNop().Sugar()
	resourcer := NewDaemonSetResourcer(logger)

	rels, err := resourcer.ResolveRelationships(ctx, cs, dsMeta(), "my-ds", "kube-system")
	require.NoError(t, err)
	require.Len(t, rels, 3) // Pods, ConfigMap, Secret

	// Pods
	assert.Equal(t, "core::v1::Pod", rels[0].Descriptor.TargetResourceKey)
	require.Len(t, rels[0].Targets, 2)

	// ConfigMap
	assert.Equal(t, "core::v1::ConfigMap", rels[1].Descriptor.TargetResourceKey)
	require.Len(t, rels[1].Targets, 1)
	assert.Equal(t, "agent-config", rels[1].Targets[0].ID)

	// Secret
	assert.Equal(t, "core::v1::Secret", rels[2].Descriptor.TargetResourceKey)
	require.Len(t, rels[2].Targets, 1)
	assert.Equal(t, "agent-certs", rels[2].Targets[0].ID)
}

func TestDaemonSetResourcer_ResolveRelationships_NoPods(t *testing.T) {
	ds := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "empty-ds",
			Namespace: "default",
			UID:       "empty-uid",
		},
		Spec: appsv1.DaemonSetSpec{
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{"app": "empty"},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "empty"}},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{Name: "app", Image: "nginx"}},
				},
			},
		},
	}

	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)
	_ = appsv1.AddToScheme(scheme)

	fakeKube := fake.NewSimpleClientset(ds)
	fakeDynamic := dynamicfake.NewSimpleDynamicClient(scheme, ds)
	factory := dynamicinformer.NewDynamicSharedInformerFactory(fakeDynamic, 0)

	cs := &clients.ClientSet{
		KubeClient:             fakeKube,
		DynamicClient:          fakeDynamic,
		DynamicInformerFactory: factory,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gvr := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "daemonsets"}
	factory.ForResource(gvr).Informer()
	factory.Start(ctx.Done())
	factory.WaitForCacheSync(ctx.Done())

	logger := zap.NewNop().Sugar()
	resourcer := NewDaemonSetResourcer(logger)

	rels, err := resourcer.ResolveRelationships(ctx, cs, dsMeta(), "empty-ds", "default")
	require.NoError(t, err)
	assert.Empty(t, rels)
}
