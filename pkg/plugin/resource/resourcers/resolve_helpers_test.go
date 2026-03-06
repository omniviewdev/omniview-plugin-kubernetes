package resourcers

import (
	"context"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
)

func TestExtractVolumeConfigMaps(t *testing.T) {
	tests := []struct {
		name     string
		spec     corev1.PodSpec
		expected []string
	}{
		{
			name:     "no volumes",
			spec:     corev1.PodSpec{},
			expected: nil,
		},
		{
			name: "no configmap volumes",
			spec: corev1.PodSpec{
				Volumes: []corev1.Volume{
					{Name: "vol", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}},
				},
			},
			expected: nil,
		},
		{
			name: "single configmap",
			spec: corev1.PodSpec{
				Volumes: []corev1.Volume{
					{Name: "cfg", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: "my-config"}}}},
				},
			},
			expected: []string{"my-config"},
		},
		{
			name: "multiple configmaps",
			spec: corev1.PodSpec{
				Volumes: []corev1.Volume{
					{Name: "cfg1", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: "config-a"}}}},
					{Name: "other", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}},
					{Name: "cfg2", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: "config-b"}}}},
				},
			},
			expected: []string{"config-a", "config-b"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractVolumeConfigMaps(tt.spec)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestExtractVolumeSecrets(t *testing.T) {
	tests := []struct {
		name     string
		spec     corev1.PodSpec
		expected []string
	}{
		{
			name:     "no volumes",
			spec:     corev1.PodSpec{},
			expected: nil,
		},
		{
			name: "single secret",
			spec: corev1.PodSpec{
				Volumes: []corev1.Volume{
					{Name: "sec", VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: "my-secret"}}},
				},
			},
			expected: []string{"my-secret"},
		},
		{
			name: "mixed volumes",
			spec: corev1.PodSpec{
				Volumes: []corev1.Volume{
					{Name: "sec1", VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: "secret-a"}}},
					{Name: "empty", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}},
					{Name: "sec2", VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: "secret-b"}}},
				},
			},
			expected: []string{"secret-a", "secret-b"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractVolumeSecrets(tt.spec)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestExtractVolumePVCs(t *testing.T) {
	tests := []struct {
		name     string
		spec     corev1.PodSpec
		expected []string
	}{
		{
			name:     "no volumes",
			spec:     corev1.PodSpec{},
			expected: nil,
		},
		{
			name: "single PVC",
			spec: corev1.PodSpec{
				Volumes: []corev1.Volume{
					{Name: "data", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "my-pvc"}}},
				},
			},
			expected: []string{"my-pvc"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractVolumePVCs(tt.spec)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestListPodsByOwner(t *testing.T) {
	ownerUID := "test-uid-123"

	ownedPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "owned-pod",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "Deployment", Name: "my-deploy", UID: types.UID(ownerUID)},
			},
		},
	}

	unownedPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "unowned-pod",
			Namespace: "default",
		},
	}

	differentOwnerPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "other-pod",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "ReplicaSet", Name: "some-rs", UID: "other-uid"},
			},
		},
	}

	fakeClient := fake.NewSimpleClientset(ownedPod, unownedPod, differentOwnerPod)
	cs := &clients.ClientSet{KubeClient: fakeClient}

	pods, err := listPodsByOwner(context.Background(), cs, "default", "Deployment", "my-deploy", ownerUID)
	require.NoError(t, err)
	require.Len(t, pods, 1)
	assert.Equal(t, "owned-pod", pods[0].Name)
}

func TestListPodsByOwner_Empty(t *testing.T) {
	fakeClient := fake.NewSimpleClientset()
	cs := &clients.ClientSet{KubeClient: fakeClient}

	pods, err := listPodsByOwner(context.Background(), cs, "default", "StatefulSet", "my-sts", "uid")
	require.NoError(t, err)
	assert.Empty(t, pods)
}

func TestMakeRef(t *testing.T) {
	ref := makeRef("core::v1::Pod", "my-pod", "default")
	assert.Equal(t, "core::v1::Pod", ref.ResourceKey)
	assert.Equal(t, "my-pod", ref.ID)
	assert.Equal(t, "default", ref.Namespace)
}
