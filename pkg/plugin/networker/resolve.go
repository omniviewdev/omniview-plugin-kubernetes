package networker

import (
	"cmp"
	"context"
	"fmt"
	"maps"
	"slices"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// extractPodSelector reads the label selector from the resource data based on
// the resource type key. Service and ReplicationController use spec.selector
// directly; all other workload types use spec.selector.matchLabels.
func extractPodSelector(resourceKey string, resourceData map[string]any) (map[string]string, error) {
	spec, ok := resourceData["spec"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("resource %q has no spec", resourceKey)
	}

	switch resourceKey {
	case "core::v1::Service", "core::v1::ReplicationController":
		raw, ok := spec["selector"].(map[string]any)
		if !ok {
			return nil, fmt.Errorf("resource %q has no spec.selector", resourceKey)
		}
		return toStringMap(raw), nil

	case "apps::v1::Deployment",
		"apps::v1::ReplicaSet",
		"apps::v1::StatefulSet",
		"apps::v1::DaemonSet",
		"batch::v1::Job":
		sel, ok := spec["selector"].(map[string]any)
		if !ok {
			return nil, fmt.Errorf("resource %q has no spec.selector", resourceKey)
		}
		ml, ok := sel["matchLabels"].(map[string]any)
		if !ok {
			return nil, fmt.Errorf("resource %q has no spec.selector.matchLabels", resourceKey)
		}
		return toStringMap(ml), nil

	default:
		return nil, fmt.Errorf("unsupported resource type for pod resolution: %q", resourceKey)
	}
}

// resolveBackingPod lists pods matching the label selector and returns the name
// of the first Running pod. Pods are sorted by readiness (ready first), then by
// creation time (newest first) to prefer fresh pods during rollouts.
func resolveBackingPod(ctx context.Context, clientset kubernetes.Interface, namespace string, selector map[string]string) (string, error) {
	labelSelector := selectorToString(selector)
	pods, err := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labelSelector,
	})
	if err != nil {
		return "", fmt.Errorf("listing pods with selector %q: %w", labelSelector, err)
	}

	type candidate struct {
		name    string
		created metav1.Time
		ready   bool
	}

	var candidates []candidate
	for _, p := range pods.Items {
		if p.Status.Phase != "Running" {
			continue
		}
		var ready bool
		for _, c := range p.Status.Conditions {
			if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
				ready = true
				break
			}
		}
		candidates = append(candidates, candidate{
			name:    p.Name,
			created: p.CreationTimestamp,
			ready:   ready,
		})
	}

	if len(candidates) == 0 {
		return "", fmt.Errorf("no running pods found matching selector %q", labelSelector)
	}

	slices.SortFunc(candidates, func(a, b candidate) int {
		// Ready pods first.
		if a.ready != b.ready {
			if a.ready {
				return -1
			}
			return 1
		}
		// Newest first.
		return cmp.Compare(b.created.UnixNano(), a.created.UnixNano())
	})

	return candidates[0].name, nil
}

// resolveServiceTargetPort maps a service port to the container targetPort
// using the service's spec.ports array. If no matching port is found or
// targetPort is absent, the original port is returned.
func resolveServiceTargetPort(servicePorts []any, remotePort int32) int32 {
	for _, raw := range servicePorts {
		portEntry, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		var portNum float64
		switch v := portEntry["port"].(type) {
		case float64:
			portNum = v
		case int:
			portNum = float64(v)
		default:
			continue
		}
		if int32(portNum) != remotePort {
			continue
		}
		switch tp := portEntry["targetPort"].(type) {
		case float64:
			return int32(tp)
		case int:
			return int32(tp)
		default:
			// Named port string — can't resolve without pod spec.
			return remotePort
		}
	}
	return remotePort
}

// selectorToString converts a label map to a comma-separated key=value string
// suitable for the Kubernetes list API's labelSelector parameter.
func selectorToString(selector map[string]string) string {
	keys := slices.Sorted(maps.Keys(selector))
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = k + "=" + selector[k]
	}
	return strings.Join(parts, ",")
}

// toStringMap converts map[string]any to map[string]string, keeping only
// entries whose values are strings.
func toStringMap(m map[string]any) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		if s, ok := v.(string); ok {
			out[k] = s
		}
	}
	return out
}
