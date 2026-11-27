package exec

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

func shellTargetFixture() *corev1.Pod {
	pod := attachPodFixture()
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{Name: "app", ContainerID: "runtime://original", RestartCount: 1, State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}}}
	return pod
}

func TestPodShellTargetRequiresCurrentRegularContainer(t *testing.T) {
	handler := podExecHandler(nil)
	require.Equal(t, []string{"$.status.containerStatuses[*]"}, handler.TargetBuilder.Paths)
	require.Equal(t, map[string]string{"container": "$.name", "containerID": "$.containerID", "containerRestart": "$.restartCount"}, handler.TargetBuilder.Selectors)
	for _, tc := range []struct {
		name   string
		change func(*corev1.Pod)
		code   string
	}{
		{"same running container", func(*corev1.Pod) {}, ""},
		{"Pod replaced", func(p *corev1.Pod) { p.UID = "another" }, "RESET_REQUIRED"},
		{"Pod deleting", func(p *corev1.Pod) { now := metav1.Now(); p.DeletionTimestamp = &now }, "RESET_REQUIRED"},
		{"Pod stopped", func(p *corev1.Pod) { p.Status.Phase = corev1.PodSucceeded }, "UNAVAILABLE"},
		{"not a regular container", func(p *corev1.Pod) { p.Spec.Containers[0].Name = "other" }, "UNAVAILABLE"},
		{"runtime incarnation changed", func(p *corev1.Pod) { p.Status.ContainerStatuses[0].ContainerID = "runtime://new" }, "RESET_REQUIRED"},
		{"restart changed", func(p *corev1.Pod) { p.Status.ContainerStatuses[0].RestartCount++ }, "RESET_REQUIRED"},
		{"no longer running", func(p *corev1.Pod) {
			p.Status.ContainerStatuses[0].State = corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{}}
		}, "RESET_REQUIRED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := shellTargetFixture()
			tc.change(p)
			err := verifyPodShellTarget(t.Context(), fake.NewSimpleClientset(p), "debug-test", "app", "original-uid", "app", "runtime://original", "1")
			require.Equal(t, tc.code, resourcev2.ErrorCode(err))
		})
	}
	client := fake.NewSimpleClientset(shellTargetFixture())
	err := verifyPodShellTarget(t.Context(), client, "debug-test", "app", "original-uid", "app", "", "0")
	require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
	require.Empty(t, client.Actions())
}

func TestPodShellReplacementPreventsExecUpgrade(t *testing.T) {
	// Fail through the actual handler, not just its identity predicate. If a
	// replacement wins the preflight there must be no request to pods/exec.
	p := shellTargetFixture()
	p.UID = "replacement"
	requests := make(chan string, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.Method + " " + r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(p); err != nil {
			t.Errorf("write Pod: %v", err)
		}
	}))
	t.Cleanup(srv.Close)
	cfg := &rest.Config{Host: srv.URL}
	client, err := kubernetes.NewForConfig(cfg)
	require.NoError(t, err)
	borrow := func(ctx context.Context, route resourcev2.AccessRoute, use func(context.Context, *clients.ClientSet) error) error {
		if route.Connection != "test" {
			t.Errorf("borrowed route %q", route.Connection)
		}
		return use(ctx, &clients.ClientSet{Clientset: client, StreamingClientset: client, RESTConfig: cfg})
	}
	terminal, err := os.OpenFile(os.DevNull, os.O_RDWR, 0)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, terminal.Close()) })
	// The profile points at a nonexistent kubeconfig. Verification must reach
	// the active generation above, never rebuild a client from that profile.
	err = podExecHandler(borrow).TTYHandler(testPluginContext(), podShellOptionsFixture(), terminal, nil, nil)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	require.Len(t, requests, 1)
	require.Equal(t, "GET /api/v1/namespaces/debug-test/pods/app", <-requests)
}

func podShellOptionsFixture() sdkexec.SessionOptions {
	uid := "original-uid"
	return sdkexec.SessionOptions{
		ResourcePlugin: "kubernetes", ResourceKey: "k8s:/pods", TTY: true, Command: podExecHandler(nil).DefaultCommand,
		Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
			Provider: "kubernetes", Type: "k8s:/pods", Authority: "pod-identity", ID: "app", Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "debug-test"}},
		}, Incarnation: &uid}, Route: &resourcev2.AccessRoute{Connection: "test"},
		Params: map[string]string{"container": "app", "containerID": "runtime://original", "containerRestart": "1"},
	}
}
