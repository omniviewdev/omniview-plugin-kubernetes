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

func stsMeta() resource.ResourceMeta {
	return resource.ResourceMeta{
		Group:   "apps",
		Version: "v1",
		Kind:    "StatefulSet",
	}
}

func TestStatefulSetResourcer_ResolveRelationships(t *testing.T) {
	replicas := int32(2)
	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-sts",
			Namespace: "default",
			UID:       "sts-uid-123",
		},
		Spec: appsv1.StatefulSetSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{"app": "db"},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "db"}},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{Name: "db", Image: "postgres"}},
					Volumes: []corev1.Volume{
						{Name: "config", VolumeSource: corev1.VolumeSource{
							ConfigMap: &corev1.ConfigMapVolumeSource{
								LocalObjectReference: corev1.LocalObjectReference{Name: "db-config"},
							},
						}},
					},
				},
			},
			VolumeClaimTemplates: []corev1.PersistentVolumeClaim{
				{ObjectMeta: metav1.ObjectMeta{Name: "data"}},
			},
		},
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-sts-0",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "StatefulSet", Name: "my-sts", UID: types.UID("sts-uid-123")},
			},
		},
	}

	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)
	_ = appsv1.AddToScheme(scheme)

	fakeKube := fake.NewSimpleClientset(sts, pod)
	fakeDynamic := dynamicfake.NewSimpleDynamicClient(scheme, sts)
	factory := dynamicinformer.NewDynamicSharedInformerFactory(fakeDynamic, 0)

	cs := &clients.ClientSet{
		KubeClient:             fakeKube,
		DynamicClient:          fakeDynamic,
		DynamicInformerFactory: factory,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gvr := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "statefulsets"}
	factory.ForResource(gvr).Informer()
	factory.Start(ctx.Done())
	factory.WaitForCacheSync(ctx.Done())

	logger := zap.NewNop().Sugar()
	resourcer := NewStatefulSetResourcer(logger)

	rels, err := resourcer.ResolveRelationships(ctx, cs, stsMeta(), "my-sts", "default")
	require.NoError(t, err)
	require.Len(t, rels, 3) // Pod, PVC, ConfigMap

	// Pod
	assert.Equal(t, "core::v1::Pod", rels[0].Descriptor.TargetResourceKey)
	require.Len(t, rels[0].Targets, 1)
	assert.Equal(t, "my-sts-0", rels[0].Targets[0].ID)

	// PVC — names follow <template>-<sts>-<ordinal> pattern
	assert.Equal(t, "core::v1::PersistentVolumeClaim", rels[1].Descriptor.TargetResourceKey)
	require.Len(t, rels[1].Targets, 2)
	assert.Equal(t, "data-my-sts-0", rels[1].Targets[0].ID)
	assert.Equal(t, "data-my-sts-1", rels[1].Targets[1].ID)

	// ConfigMap
	assert.Equal(t, "core::v1::ConfigMap", rels[2].Descriptor.TargetResourceKey)
	require.Len(t, rels[2].Targets, 1)
	assert.Equal(t, "db-config", rels[2].Targets[0].ID)
}

func TestStatefulSetResourcer_ResolveRelationships_Empty(t *testing.T) {
	replicas := int32(1)
	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "bare-sts",
			Namespace: "default",
			UID:       "bare-uid",
		},
		Spec: appsv1.StatefulSetSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{"app": "bare"},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "bare"}},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{Name: "app", Image: "nginx"}},
				},
			},
		},
	}

	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)
	_ = appsv1.AddToScheme(scheme)

	fakeKube := fake.NewSimpleClientset(sts)
	fakeDynamic := dynamicfake.NewSimpleDynamicClient(scheme, sts)
	factory := dynamicinformer.NewDynamicSharedInformerFactory(fakeDynamic, 0)

	cs := &clients.ClientSet{
		KubeClient:             fakeKube,
		DynamicClient:          fakeDynamic,
		DynamicInformerFactory: factory,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gvr := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "statefulsets"}
	factory.ForResource(gvr).Informer()
	factory.Start(ctx.Done())
	factory.WaitForCacheSync(ctx.Done())

	logger := zap.NewNop().Sugar()
	resourcer := NewStatefulSetResourcer(logger)

	rels, err := resourcer.ResolveRelationships(ctx, cs, stsMeta(), "bare-sts", "default")
	require.NoError(t, err)
	assert.Empty(t, rels)
}
