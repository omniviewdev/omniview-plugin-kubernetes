package networker

import (
	"cmp"
	"context"
	"fmt"
	"github.com/omniview/kubernetes/pkg/utils"
	"github.com/omniview/kubernetes/pkg/utils/remoteerr"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"maps"
	"slices"
	"strconv"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// extractPodSelector reads the label selector from the resource data based on
// the resource type key. Service and ReplicationController use spec.selector
// directly; all other workload types use spec.selector.matchLabels.
func extractPodSelector(resourceKey string, resourceData *resourcev2.Value) (map[string]string, error) {
	spec, ok := utils.TaggedField(resourceData, "spec")
	if !ok || spec.Kind != "map" {
		return nil, resourcev2.NewError("INVALID_REQUEST", fmt.Sprintf("resource %q has no spec", resourceKey))
	}

	switch resourceKey {
	case "k8s:/services", "k8s:/replicationcontrollers":
		raw, ok := spec.Map["selector"]
		if !ok || raw.Kind != "map" {
			return nil, resourcev2.NewError("INVALID_REQUEST", fmt.Sprintf("resource %q has no spec.selector", resourceKey))
		}
		return toStringMap(raw.Map), nil

	case "k8s:apps/deployments",
		"k8s:apps/replicasets",
		"k8s:apps/statefulsets",
		"k8s:apps/daemonsets",
		"k8s:batch/jobs":
		sel, ok := spec.Map["selector"]
		if !ok || sel.Kind != "map" {
			return nil, resourcev2.NewError("INVALID_REQUEST", fmt.Sprintf("resource %q has no spec.selector", resourceKey))
		}
		ml, ok := sel.Map["matchLabels"]
		if !ok || ml.Kind != "map" {
			return nil, resourcev2.NewError("INVALID_REQUEST", fmt.Sprintf("resource %q has no spec.selector.matchLabels", resourceKey))
		}
		return toStringMap(ml.Map), nil

	default:
		return nil, resourcev2.NewError("INVALID_REQUEST", fmt.Sprintf("unsupported resource type for pod resolution: %q", resourceKey))
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
		return "", remoteerr.Sanitize(fmt.Sprintf("list pods with selector %q", labelSelector), err)
	}

	type candidate struct {
		name    string
		created metav1.Time
		ready   bool
	}

	var candidates []candidate
	for _, p := range pods.Items {
		if p.Status.Phase != "Running" {
			continue // expected: only Running pods can back a tunnel
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
		trace.SpanFromContext(ctx).AddEvent("backing_pod_none_running", trace.WithAttributes(
			attribute.Int("pods_listed", len(pods.Items)),
		))
		return "", resourcev2.NewError("UNAVAILABLE", fmt.Sprintf("no running pods found matching selector %q", labelSelector))
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

	trace.SpanFromContext(ctx).AddEvent("backing_pod_resolved", trace.WithAttributes(
		attribute.Int("pods_listed", len(pods.Items)),
		attribute.Int("candidates", len(candidates)),
		attribute.Bool("selected_ready", candidates[0].ready),
	))
	return candidates[0].name, nil
}

// resolveServiceTargetPort maps a service port to the container targetPort
// using the service's spec.ports array. If no matching port is found or
// targetPort is absent, the original port is returned.
func resolveServiceTargetPort(servicePorts []resourcev2.Value, remotePort int32) int32 {
	for _, entry := range servicePorts {
		if entry.Kind != "map" {
			continue
		}
		port, ok := nativePort(entry.Map["port"])
		if !ok || port != remotePort {
			continue
		}
		if target, ok := nativePort(entry.Map["targetPort"]); ok {
			return target
		}
		// Named target ports still require pod spec resolution.
		return remotePort
	}
	return remotePort
}

func nativePort(value resourcev2.Value) (int32, bool) {
	var text string
	switch value.Kind {
	case "int64":
		text = value.Int
	case "uint64":
		text = value.Uint
	default:
		return 0, false
	}
	port, err := strconv.ParseInt(text, 10, 32)
	return int32(port), err == nil && port > 0 && port <= 65535
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

// toStringMap extracts only tagged strings from a label selector.
func toStringMap(m map[string]resourcev2.Value) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		if v.Kind == "string" {
			out[k] = v.String
		}
	}
	return out
}
