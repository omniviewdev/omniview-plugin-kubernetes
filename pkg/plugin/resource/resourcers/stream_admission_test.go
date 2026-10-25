package resourcers

import (
	"context"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	appsv1 "k8s.io/api/apps/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func TestRestartReadyRequiresNativePatchAndWatchAcceptance(t *testing.T) {
	cases := []struct {
		name   string
		object runtime.Object
		stream func(context.Context, *clients.ClientSet, resource.ResourceMeta, string, resource.ActionInput, chan<- resource.ActionEvent) error
	}{
		{"deployments", &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "target", Namespace: "default"}}, newTestDeploymentResourcer().StreamAction},
		{"daemonsets", &appsv1.DaemonSet{ObjectMeta: metav1.ObjectMeta{Name: "target", Namespace: "default"}}, newTestDaemonSetResourcer().StreamAction},
		{"statefulsets", &appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: "target", Namespace: "default"}}, newTestStatefulSetResourcer().StreamAction},
	}
	for _, tc := range cases {
		for _, denied := range []bool{true, false} {
			t.Run(tc.name+map[bool]string{true: "/denied", false: "/accepted"}[denied], func(t *testing.T) {
				client := fake.NewSimpleClientset(tc.object)
				watcher := watch.NewFake()
				client.PrependWatchReactor(tc.name, func(ktesting.Action) (bool, watch.Interface, error) {
					if denied {
						return true, nil, apierrors.NewForbidden(schema.GroupResource{Group: "apps", Resource: tc.name}, "target", nil)
					}
					return true, watcher, nil
				})
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				events := make(chan resource.ActionEvent, 16)
				done := make(chan error, 1)
				go func() {
					done <- tc.stream(ctx, &clients.ClientSet{KubeClient: client}, resource.ResourceMeta{}, "restart", resource.ActionInput{ID: "target", Namespace: "default"}, events)
				}()
				if denied {
					select {
					case err := <-done:
						if !apierrors.IsForbidden(err) {
							t.Fatalf("native denial lost: %v", err)
						}
					case <-time.After(time.Second):
						t.Fatal("denied establishment did not finish")
					}
					for event := range events {
						t.Fatalf("denied establishment emitted public event: %+v", event)
					}
					return
				}
				select {
				case event := <-events:
					if event.Type != "ready" {
						t.Fatalf("first event was not concrete ready: %+v", event)
					}
				case <-time.After(time.Second):
					t.Fatal("native acceptance did not become ready")
				}
				cancel()
				select {
				case err := <-done:
					if err != context.Canceled {
						t.Fatalf("cancellation lost: %v", err)
					}
				case <-time.After(time.Second):
					t.Fatal("accepted native stream did not cancel")
				}
			})
		}
	}
}
