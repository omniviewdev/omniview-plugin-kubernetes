package resourcers

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	appsv1 "k8s.io/api/apps/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func TestWorkloadActionDiagnostics(t *testing.T) {
	type runFunc func(context.Context, *clients.ClientSet, resource.ActionRequest) (resource.Value, error)
	for _, tc := range []struct{ kind, action string }{
		{"deployment", "rollout-restart"}, {"deployment", "scale"}, {"deployment", "pause"}, {"deployment", "resume"},
		{"statefulset", "rollout-restart"}, {"statefulset", "scale"}, {"daemonset", "rollout-restart"},
	} {
		t.Run(tc.kind+"/"+tc.action, func(t *testing.T) {
			core, logs := observer.New(zap.InfoLevel)
			logger := zap.New(core).Sugar()
			var run runFunc
			switch tc.kind {
			case "deployment":
				run = NewDeploymentResourcer(logger).ExecuteAction
			case "statefulset":
				run = NewStatefulSetResourcer(logger).ExecuteAction
			case "daemonset":
				run = NewDaemonSetResourcer(logger).ExecuteAction
			}
			kube := fake.NewSimpleClientset()
			kube.PrependReactor("patch", "*", func(ktesting.Action) (bool, runtime.Object, error) {
				return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "workloads"}, "private-name", errors.New("private-error"))
			})
			request := workloadActionRequest(tc.action, "private-name", "private-namespace", map[string]interface{}{"replicas": float64(3)})
			request.Route.Connection = "connection-a"
			_, err := run(context.Background(), &clients.ClientSet{KubeClient: kube}, request)
			require.Error(t, err)
			require.Equal(t, 1, logs.Len())
			fields := logs.All()[0].ContextMap()
			require.Equal(t, "k8s:apps/"+tc.kind+"s", fields["resource_type"])
			require.Equal(t, "connection-a", fields["connection"])
			require.Equal(t, "private-name", fields["resource_id"])
			require.Equal(t, "private-namespace", fields["resource_namespace"])
			require.Equal(t, "execution", fields["stage"])
			require.Equal(t, "patch", fields["operation"])
			require.Equal(t, "failure", fields["outcome"])
			require.Equal(t, "kubernetes", fields["error_class"])
			require.Equal(t, "Forbidden", fields["k8s_reason"])
			require.NotContains(t, fmt.Sprint(fields), "private-error")
		})
	}
}

func TestRolloutStreamDiagnosticsWatchAndCancellation(t *testing.T) {
	type streamFunc func(context.Context, *clients.ClientSet, resource.ActionRequest, chan<- resource.ActionEvent) error
	for _, kind := range []string{"deployment", "statefulset", "daemonset"} {
		for _, cancelStream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/cancel=%t", kind, cancelStream), func(t *testing.T) {
				core, logs := observer.New(zap.InfoLevel)
				logger := zap.New(core).Sugar()
				var run streamFunc
				var object runtime.Object
				switch kind {
				case "deployment":
					run, object = NewDeploymentResourcer(logger).streamRestart, &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "private-name", Namespace: "private-namespace"}}
				case "statefulset":
					run, object = NewStatefulSetResourcer(logger).streamRestart, &appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: "private-name", Namespace: "private-namespace"}}
				case "daemonset":
					run, object = NewDaemonSetResourcer(logger).streamRestart, &appsv1.DaemonSet{ObjectMeta: metav1.ObjectMeta{Name: "private-name", Namespace: "private-namespace"}}
				}
				kube := fake.NewSimpleClientset()
				kube.PrependReactor("patch", "*", func(ktesting.Action) (bool, runtime.Object, error) { return true, object, nil })
				watcher := watch.NewRaceFreeFake()
				kube.PrependWatchReactor("*", func(ktesting.Action) (bool, watch.Interface, error) {
					if !cancelStream {
						return true, nil, errors.New("private-watch-error")
					}
					return true, watcher, nil
				})
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				events := make(chan resource.ActionEvent, 1)
				done := make(chan error, 1)
				go func() {
					done <- run(ctx, &clients.ClientSet{KubeClient: kube}, workloadActionRequest("restart", "private-name", "private-namespace", nil), events)
				}()
				if cancelStream {
					require.Equal(t, "ready", (<-events).Type)
					cancel()
				}
				require.Error(t, <-done)
				require.Equal(t, 1, logs.Len())
				fields := logs.All()[0].ContextMap()
				require.Equal(t, "observation", fields["stage"])
				if cancelStream {
					require.Equal(t, "canceled", fields["outcome"])
					require.Equal(t, "canceled", fields["error_class"])
				} else {
					require.Equal(t, "watch", fields["operation"])
					require.Equal(t, "failure", fields["outcome"])
				}
				require.NotContains(t, fmt.Sprint(fields), "private-watch-error")
			})
		}
	}
}

func TestRolloutDiagnosticSpanIdentity(t *testing.T) {
	previous := otel.GetTracerProvider()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		_ = provider.Shutdown(context.Background())
	})
	core, _ := observer.New(zap.InfoLevel)
	request := workloadActionRequest("rollout-restart", "work", "namespace-a", nil)
	request.Route.Connection = "connection-a"
	kube := fake.NewSimpleClientset(testDeployment("work", "namespace-a", 1))
	_, err := NewDeploymentResourcer(zap.New(core).Sugar()).ExecuteAction(context.Background(), &clients.ClientSet{KubeClient: kube}, request)
	require.NoError(t, err)
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	attrs := map[string]string{}
	for _, attr := range spans[0].Attributes {
		attrs[string(attr.Key)] = attr.Value.AsString()
	}
	require.Equal(t, "connection-a", attrs["connection"])
	require.Equal(t, "k8s:apps/deployments", attrs["resource.type"])
	require.Equal(t, "work", attrs["resource.id"])
	require.Equal(t, "namespace-a", attrs["resource.namespace"])
	require.Equal(t, "success", attrs["outcome"])
}
