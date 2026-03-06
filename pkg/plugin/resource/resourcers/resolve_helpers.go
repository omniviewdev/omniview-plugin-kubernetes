package resourcers

import (
	"context"
	"fmt"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// extractVolumeConfigMaps returns ConfigMap names referenced by PodSpec volumes.
func extractVolumeConfigMaps(spec corev1.PodSpec) []string {
	var names []string
	for _, v := range spec.Volumes {
		if v.ConfigMap != nil && v.ConfigMap.Name != "" {
			names = append(names, v.ConfigMap.Name)
		}
	}
	return names
}

// extractVolumeSecrets returns Secret names referenced by PodSpec volumes.
func extractVolumeSecrets(spec corev1.PodSpec) []string {
	var names []string
	for _, v := range spec.Volumes {
		if v.Secret != nil && v.Secret.SecretName != "" {
			names = append(names, v.Secret.SecretName)
		}
	}
	return names
}

// extractVolumePVCs returns PersistentVolumeClaim names referenced by PodSpec volumes.
func extractVolumePVCs(spec corev1.PodSpec) []string {
	var names []string
	for _, v := range spec.Volumes {
		if v.PersistentVolumeClaim != nil && v.PersistentVolumeClaim.ClaimName != "" {
			names = append(names, v.PersistentVolumeClaim.ClaimName)
		}
	}
	return names
}

// listPodsByOwner lists pods owned by a controller via ownerReferences.
func listPodsByOwner(
	ctx context.Context,
	client *clients.ClientSet,
	namespace, ownerKind, ownerName, ownerUID string,
) ([]corev1.Pod, error) {
	podList, err := client.KubeClient.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}
	var result []corev1.Pod
	for _, pod := range podList.Items {
		for _, ref := range pod.OwnerReferences {
			if ref.Kind == ownerKind && ref.Name == ownerName && string(ref.UID) == ownerUID {
				result = append(result, pod)
				break
			}
		}
	}
	return result, nil
}

// makeRef creates a ResourceRef with standard fields.
func makeRef(resourceKey, id, namespace string) resource.ResourceRef {
	return resource.ResourceRef{
		ResourceKey: resourceKey,
		ID:          id,
		Namespace:   namespace,
	}
}
