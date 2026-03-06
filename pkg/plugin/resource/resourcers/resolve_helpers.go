package resourcers

import (
	"context"
	"fmt"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// extractVolumeConfigMaps returns ConfigMap names referenced by PodSpec volumes,
// env, envFrom across all containers and init containers.
func extractVolumeConfigMaps(spec corev1.PodSpec) []string {
	seen := make(map[string]struct{})
	var names []string
	add := func(name string) {
		if name == "" {
			return
		}
		if _, ok := seen[name]; !ok {
			seen[name] = struct{}{}
			names = append(names, name)
		}
	}

	for _, v := range spec.Volumes {
		if v.ConfigMap != nil {
			add(v.ConfigMap.Name)
		}
	}
	for _, c := range append(spec.InitContainers, spec.Containers...) {
		for _, e := range c.Env {
			if e.ValueFrom != nil && e.ValueFrom.ConfigMapKeyRef != nil {
				add(e.ValueFrom.ConfigMapKeyRef.Name)
			}
		}
		for _, ef := range c.EnvFrom {
			if ef.ConfigMapRef != nil {
				add(ef.ConfigMapRef.Name)
			}
		}
	}
	return names
}

// extractVolumeSecrets returns Secret names referenced by PodSpec volumes,
// env, envFrom, imagePullSecrets across all containers and init containers.
func extractVolumeSecrets(spec corev1.PodSpec) []string {
	seen := make(map[string]struct{})
	var names []string
	add := func(name string) {
		if name == "" {
			return
		}
		if _, ok := seen[name]; !ok {
			seen[name] = struct{}{}
			names = append(names, name)
		}
	}

	for _, v := range spec.Volumes {
		if v.Secret != nil {
			add(v.Secret.SecretName)
		}
	}
	for _, c := range append(spec.InitContainers, spec.Containers...) {
		for _, e := range c.Env {
			if e.ValueFrom != nil && e.ValueFrom.SecretKeyRef != nil {
				add(e.ValueFrom.SecretKeyRef.Name)
			}
		}
		for _, ef := range c.EnvFrom {
			if ef.SecretRef != nil {
				add(ef.SecretRef.Name)
			}
		}
	}
	for _, ips := range spec.ImagePullSecrets {
		add(ips.Name)
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

// descriptorByTarget builds a lookup map from TargetResourceKey to descriptor.
func descriptorByTarget(descriptors []resource.RelationshipDescriptor) map[string]resource.RelationshipDescriptor {
	m := make(map[string]resource.RelationshipDescriptor, len(descriptors))
	for _, d := range descriptors {
		m[d.TargetResourceKey] = d
	}
	return m
}

// makeRef creates a ResourceRef with standard fields.
func makeRef(resourceKey, id, namespace string) resource.ResourceRef {
	return resource.ResourceRef{
		ResourceKey: resourceKey,
		ID:          id,
		Namespace:   namespace,
	}
}
