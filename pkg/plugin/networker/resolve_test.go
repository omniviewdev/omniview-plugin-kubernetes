package networker

import (
	"context"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// ---------------------------------------------------------------------------
// extractPodSelector
// ---------------------------------------------------------------------------

func TestExtractPodSelector_Service(t *testing.T) {
	data := map[string]any{
		"spec": map[string]any{
			"selector": map[string]any{
				"app": "frontend",
			},
		},
	}
	sel, err := extractPodSelector("core::v1::Service", data)
	if err != nil {
		t.Fatal(err)
	}
	if sel["app"] != "frontend" {
		t.Fatalf("got %v, want app=frontend", sel)
	}
}

func TestExtractPodSelector_ReplicationController(t *testing.T) {
	data := map[string]any{
		"spec": map[string]any{
			"selector": map[string]any{
				"tier": "backend",
			},
		},
	}
	sel, err := extractPodSelector("core::v1::ReplicationController", data)
	if err != nil {
		t.Fatal(err)
	}
	if sel["tier"] != "backend" {
		t.Fatalf("got %v, want tier=backend", sel)
	}
}

func TestExtractPodSelector_Deployment(t *testing.T) {
	data := map[string]any{
		"spec": map[string]any{
			"selector": map[string]any{
				"matchLabels": map[string]any{
					"app": "api",
					"env": "prod",
				},
			},
		},
	}
	sel, err := extractPodSelector("apps::v1::Deployment", data)
	if err != nil {
		t.Fatal(err)
	}
	if sel["app"] != "api" || sel["env"] != "prod" {
		t.Fatalf("got %v, want app=api,env=prod", sel)
	}
}

func TestExtractPodSelector_AllMatchLabelsTypes(t *testing.T) {
	for _, key := range []string{
		"apps::v1::ReplicaSet",
		"apps::v1::StatefulSet",
		"apps::v1::DaemonSet",
		"batch::v1::Job",
	} {
		data := map[string]any{
			"spec": map[string]any{
				"selector": map[string]any{
					"matchLabels": map[string]any{"app": "x"},
				},
			},
		}
		sel, err := extractPodSelector(key, data)
		if err != nil {
			t.Fatalf("%s: %v", key, err)
		}
		if sel["app"] != "x" {
			t.Fatalf("%s: got %v", key, sel)
		}
	}
}

func TestExtractPodSelector_UnsupportedType(t *testing.T) {
	_, err := extractPodSelector("core::v1::ConfigMap", map[string]any{
		"spec": map[string]any{},
	})
	if err == nil {
		t.Fatal("expected error for unsupported type")
	}
}

func TestExtractPodSelector_NoSpec(t *testing.T) {
	_, err := extractPodSelector("core::v1::Service", map[string]any{})
	if err == nil {
		t.Fatal("expected error for missing spec")
	}
}

func TestExtractPodSelector_NoSelector(t *testing.T) {
	_, err := extractPodSelector("core::v1::Service", map[string]any{
		"spec": map[string]any{},
	})
	if err == nil {
		t.Fatal("expected error for missing selector")
	}
}

func TestExtractPodSelector_NoMatchLabels(t *testing.T) {
	_, err := extractPodSelector("apps::v1::Deployment", map[string]any{
		"spec": map[string]any{
			"selector": map[string]any{},
		},
	})
	if err == nil {
		t.Fatal("expected error for missing matchLabels")
	}
}

// ---------------------------------------------------------------------------
// resolveBackingPod
// ---------------------------------------------------------------------------

func makePod(name, namespace string, phase corev1.PodPhase, ready bool, created time.Time) *corev1.Pod {
	conditions := []corev1.PodCondition{}
	if ready {
		conditions = append(conditions, corev1.PodCondition{
			Type:   corev1.PodReady,
			Status: corev1.ConditionTrue,
		})
	}
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              name,
			Namespace:         namespace,
			Labels:            map[string]string{"app": "test"},
			CreationTimestamp: metav1.NewTime(created),
		},
		Status: corev1.PodStatus{
			Phase:      phase,
			Conditions: conditions,
		},
	}
}

func TestResolveBackingPod_PrefersReadyPod(t *testing.T) {
	now := time.Now()
	cs := fake.NewSimpleClientset(
		makePod("not-ready", "default", corev1.PodRunning, false, now),
		makePod("ready-pod", "default", corev1.PodRunning, true, now.Add(-time.Minute)),
	)

	name, err := resolveBackingPod(context.Background(), cs, "default", map[string]string{"app": "test"})
	if err != nil {
		t.Fatal(err)
	}
	if name != "ready-pod" {
		t.Fatalf("got %q, want ready-pod", name)
	}
}

func TestResolveBackingPod_PrefersNewestAmongReady(t *testing.T) {
	now := time.Now()
	cs := fake.NewSimpleClientset(
		makePod("old-ready", "default", corev1.PodRunning, true, now.Add(-10*time.Minute)),
		makePod("new-ready", "default", corev1.PodRunning, true, now),
	)

	name, err := resolveBackingPod(context.Background(), cs, "default", map[string]string{"app": "test"})
	if err != nil {
		t.Fatal(err)
	}
	if name != "new-ready" {
		t.Fatalf("got %q, want new-ready", name)
	}
}

func TestResolveBackingPod_SkipsPendingAndFailed(t *testing.T) {
	now := time.Now()
	cs := fake.NewSimpleClientset(
		makePod("pending", "default", corev1.PodPending, false, now),
		makePod("failed", "default", corev1.PodFailed, false, now),
		makePod("running", "default", corev1.PodRunning, true, now),
	)

	name, err := resolveBackingPod(context.Background(), cs, "default", map[string]string{"app": "test"})
	if err != nil {
		t.Fatal(err)
	}
	if name != "running" {
		t.Fatalf("got %q, want running", name)
	}
}

func TestResolveBackingPod_SkipsSucceededPods(t *testing.T) {
	now := time.Now()
	cs := fake.NewSimpleClientset(
		makePod("completed", "default", corev1.PodSucceeded, false, now),
		makePod("alive", "default", corev1.PodRunning, true, now),
	)

	name, err := resolveBackingPod(context.Background(), cs, "default", map[string]string{"app": "test"})
	if err != nil {
		t.Fatal(err)
	}
	if name != "alive" {
		t.Fatalf("got %q, want alive", name)
	}
}

func TestResolveBackingPod_NoRunningPods(t *testing.T) {
	cs := fake.NewSimpleClientset(
		makePod("pending", "default", corev1.PodPending, false, time.Now()),
	)

	_, err := resolveBackingPod(context.Background(), cs, "default", map[string]string{"app": "test"})
	if err == nil {
		t.Fatal("expected error when no running pods exist")
	}
}

func TestResolveBackingPod_NoPods(t *testing.T) {
	cs := fake.NewSimpleClientset()

	_, err := resolveBackingPod(context.Background(), cs, "default", map[string]string{"app": "test"})
	if err == nil {
		t.Fatal("expected error when no pods exist")
	}
}

func TestResolveBackingPod_FallsBackToNotReady(t *testing.T) {
	now := time.Now()
	cs := fake.NewSimpleClientset(
		makePod("not-ready-1", "default", corev1.PodRunning, false, now.Add(-time.Minute)),
		makePod("not-ready-2", "default", corev1.PodRunning, false, now),
	)

	name, err := resolveBackingPod(context.Background(), cs, "default", map[string]string{"app": "test"})
	if err != nil {
		t.Fatal(err)
	}
	// Should pick newest not-ready pod.
	if name != "not-ready-2" {
		t.Fatalf("got %q, want not-ready-2", name)
	}
}

// ---------------------------------------------------------------------------
// resolveServiceTargetPort
// ---------------------------------------------------------------------------

func TestResolveServiceTargetPort_MapsToTargetPort(t *testing.T) {
	ports := []any{
		map[string]any{
			"port":       float64(80),
			"targetPort": float64(8080),
		},
	}
	got := resolveServiceTargetPort(ports, 80)
	if got != 8080 {
		t.Fatalf("got %d, want 8080", got)
	}
}

func TestResolveServiceTargetPort_NoMatchReturnsOriginal(t *testing.T) {
	ports := []any{
		map[string]any{
			"port":       float64(443),
			"targetPort": float64(8443),
		},
	}
	got := resolveServiceTargetPort(ports, 80)
	if got != 80 {
		t.Fatalf("got %d, want 80", got)
	}
}

func TestResolveServiceTargetPort_MissingTargetPortReturnsSamePort(t *testing.T) {
	ports := []any{
		map[string]any{
			"port": float64(80),
		},
	}
	got := resolveServiceTargetPort(ports, 80)
	if got != 80 {
		t.Fatalf("got %d, want 80", got)
	}
}

func TestResolveServiceTargetPort_NamedTargetPortReturnsSamePort(t *testing.T) {
	ports := []any{
		map[string]any{
			"port":       float64(80),
			"targetPort": "http",
		},
	}
	got := resolveServiceTargetPort(ports, 80)
	if got != 80 {
		t.Fatalf("got %d, want 80 (named port can't be resolved)", got)
	}
}

func TestResolveServiceTargetPort_MultiplePortEntries(t *testing.T) {
	ports := []any{
		map[string]any{
			"port":       float64(80),
			"targetPort": float64(8080),
		},
		map[string]any{
			"port":       float64(443),
			"targetPort": float64(8443),
		},
	}
	if got := resolveServiceTargetPort(ports, 443); got != 8443 {
		t.Fatalf("got %d, want 8443", got)
	}
	if got := resolveServiceTargetPort(ports, 80); got != 8080 {
		t.Fatalf("got %d, want 8080", got)
	}
}

func TestResolveServiceTargetPort_EmptyPorts(t *testing.T) {
	got := resolveServiceTargetPort(nil, 80)
	if got != 80 {
		t.Fatalf("got %d, want 80", got)
	}
}

func TestResolveServiceTargetPort_IntTargetPort(t *testing.T) {
	ports := []any{
		map[string]any{
			"port":       float64(80),
			"targetPort": int(9090),
		},
	}
	got := resolveServiceTargetPort(ports, 80)
	if got != 9090 {
		t.Fatalf("got %d, want 9090", got)
	}
}

// ---------------------------------------------------------------------------
// selectorToString
// ---------------------------------------------------------------------------

func TestSelectorToString(t *testing.T) {
	tests := []struct {
		name     string
		selector map[string]string
		want     string
	}{
		{"single", map[string]string{"app": "web"}, "app=web"},
		{"sorted", map[string]string{"z": "1", "a": "2"}, "a=2,z=1"},
		{"empty", map[string]string{}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := selectorToString(tt.selector)
			if got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// toStringMap
// ---------------------------------------------------------------------------

func TestToStringMap_FiltersNonStrings(t *testing.T) {
	m := map[string]any{
		"app":     "web",
		"version": "v1",
		"count":   42,
		"flag":    true,
	}
	got := toStringMap(m)
	if len(got) != 2 {
		t.Fatalf("got %d entries, want 2", len(got))
	}
	if got["app"] != "web" || got["version"] != "v1" {
		t.Fatalf("got %v", got)
	}
}
