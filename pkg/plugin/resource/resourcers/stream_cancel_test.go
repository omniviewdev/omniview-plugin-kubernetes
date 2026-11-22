package resourcers

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

// restartStreamCase is a restart stream of one workload kind, with a workload whose rollout is under way: its status is neither complete nor stale, so that a watch event for it is
// reported as progress and nothing else.
type restartStreamCase struct {
	name   string
	kind   string
	object runtime.Object
	stream func(context.Context, *clients.ClientSet, resource.ActionRequest, chan<- resource.ActionEvent) error
}

func restartStreamCases() []restartStreamCase {
	replicas := int32(3)
	template := corev1.PodTemplateSpec{ObjectMeta: metav1.ObjectMeta{Annotations: map[string]string{"kubectl.kubernetes.io/restartedAt": "requested"}}}
	return []restartStreamCase{
		{"deployments", "Deployment", &appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{Name: "work", Namespace: "default", UID: "workload", Generation: 2, ResourceVersion: "42"},
			Spec:       appsv1.DeploymentSpec{Replicas: &replicas, Template: template},
			Status:     appsv1.DeploymentStatus{ObservedGeneration: 2, UpdatedReplicas: 1, AvailableReplicas: 1, Replicas: 3},
		}, newTestDeploymentResourcer().streamRestart},
		{"statefulsets", "StatefulSet", &appsv1.StatefulSet{
			ObjectMeta: metav1.ObjectMeta{Name: "work", Namespace: "default", UID: "workload", Generation: 2, ResourceVersion: "42"},
			Spec:       appsv1.StatefulSetSpec{Replicas: &replicas, Template: template},
			Status:     appsv1.StatefulSetStatus{ObservedGeneration: 2, UpdatedReplicas: 1, ReadyReplicas: 1, Replicas: 3, CurrentRevision: "old", UpdateRevision: "new"},
		}, newTestStatefulSetResourcer().streamRestart},
		{"daemonsets", "DaemonSet", &appsv1.DaemonSet{
			ObjectMeta: metav1.ObjectMeta{Name: "work", Namespace: "default", UID: "workload", Generation: 2, ResourceVersion: "42"},
			Spec:       appsv1.DaemonSetSpec{Template: template},
			Status:     appsv1.DaemonSetStatus{ObservedGeneration: 2, DesiredNumberScheduled: 3, UpdatedNumberScheduled: 1, CurrentNumberScheduled: 3, NumberReady: 1, NumberAvailable: 1},
		}, newTestDaemonSetResourcer().streamRestart},
	}
}

// cluster is a fake cluster that holds the workload and its pods, as the real one does: the rollout asks it for the workload once a second (a refresh, for the case that pod
// changes leave the workload's own status as it was), and a cluster without the workload would answer NotFound and end the stream with that, if a round were slow enough for the
// refresh to come. The workload held is the incomplete one the patch returns, so that a refresh reports progress at most, never completion. refreshes counts the refreshes.
func (tc restartStreamCase) cluster() (client *fake.Clientset, refreshes *atomic.Int32) {
	client = fake.NewSimpleClientset(append(rolloutPodFixtures(tc.kind), tc.object.DeepCopyObject())...)
	refreshes = new(atomic.Int32)
	client.PrependReactor("get", "*", func(ktesting.Action) (bool, runtime.Object, error) {
		refreshes.Add(1) // the stream reads nothing else with a Get
		return false, nil, nil
	})
	return client, refreshes
}

// startRestart runs the stream of the case on the cluster, with a watch that the test drives, and returns that watch, the events and the stream's result. It has read the ready event.
func (tc restartStreamCase) startRestart(t *testing.T, ctx context.Context, client *fake.Clientset) (*watch.RaceFreeFakeWatcher, chan resource.ActionEvent, <-chan error) {
	t.Helper()
	client.PrependReactor("patch", "*", func(ktesting.Action) (bool, runtime.Object, error) { return true, tc.object.DeepCopyObject(), nil })
	watcher := watch.NewRaceFreeFake()
	client.PrependWatchReactor("*", func(ktesting.Action) (bool, watch.Interface, error) { return true, watcher, nil })
	events := make(chan resource.ActionEvent, 10)
	done := make(chan error, 1)
	go func() {
		done <- tc.stream(ctx, &clients.ClientSet{KubeClient: client}, workloadActionRequest("restart", "work", "default", nil), events)
	}()
	expectEvent(t, events, "ready")
	return watcher, events, done
}

func expectEvent(t *testing.T, events <-chan resource.ActionEvent, eventType string) {
	t.Helper()
	select {
	case event := <-events:
		require.Equal(t, eventType, event.Type)
	case <-time.After(5 * time.Second):
		t.Fatalf("no %s event", eventType)
	}
}

// The restart streams answer a cancelled context with its error. Their observations channel is closed when the context ends too (the goroutine that fills it stops with the
// context), so a stream that reaches its select after that has two ready cases, the context's and the closed channel, and Go takes either: about half the time it reported "watch
// channel closed" for a restart that had been cancelled. That was the rare failure of TestRestartReadyRequiresNativePatchAndWatchAcceptance (13 in 4000 runs with -race on four
// CPUs). This test makes the state certain instead of waiting for it: once the first observation has been reported, the context is cancelled while the stream handles the next one,
// and the stream is held there until the goroutine has closed the channel, so that both cases are ready when it comes back to its select. A stream that takes the wrong case fails a
// round with probability one half, so 64 rounds without a failure are a chance of one in 2^64. Which observation that is, the next watch event or a refresh, does not matter.
func TestRestartStreamsReportTheContextErrorWhenTheContextEndsWithTheirObservations(t *testing.T) {
	for _, tc := range restartStreamCases() {
		t.Run(tc.name, func(t *testing.T) {
			for round := range 64 {
				client, _ := tc.cluster()
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				var armed atomic.Bool
				client.PrependReactor("list", "pods", func(ktesting.Action) (bool, runtime.Object, error) {
					if armed.CompareAndSwap(true, false) {
						// The next observation: end the context, and stay here until the goroutine that fills the observations, which stops with it, has closed their channel.
						cancel()
						time.Sleep(10 * time.Millisecond)
					}
					return false, nil, nil
				})
				watcher, events, done := tc.startRestart(t, ctx, client)
				watcher.Modify(tc.object.DeepCopyObject()) // the first observation is reported as progress
				expectEvent(t, events, "progress")
				armed.Store(true)
				watcher.Modify(tc.object.DeepCopyObject()) // the next has nothing new to report: the stream goes back to its select
				select {
				case err := <-done:
					require.ErrorIs(t, err, context.Canceled, "round %d: a cancelled restart must report its context's error, not that its watch closed; it reported %v", round, err)
				case <-time.After(5 * time.Second):
					t.Fatalf("round %d: the stream did not end", round)
				}
				cancel()
			}
		})
	}
}

// The other side of the same select: a watch that really ends, with the context alive, is still reported as a watch that closed, not hidden behind the context.
func TestRestartStreamsStillReportAWatchThatEndsWhileTheContextLives(t *testing.T) {
	for _, tc := range restartStreamCases() {
		t.Run(tc.name, func(t *testing.T) {
			client, _ := tc.cluster()
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			watcher, _, done := tc.startRestart(t, ctx, client)
			watcher.Stop()
			select {
			case err := <-done:
				require.ErrorContains(t, err, "watch channel closed")
				require.NoError(t, ctx.Err(), "the context is alive: the watch is what ended")
			case <-time.After(5 * time.Second):
				t.Fatal("the stream did not end when its watch did")
			}
		})
	}
}

// The tests above must not depend on whether the one-second refresh comes. This one makes it come: it holds each stream past the refresh (it waits until the cluster has been asked
// for the workload), checks that the stream is still running, and then ends it as the tests above do. With a cluster that did not hold the workload the refresh answered NotFound and
// ended the stream with that, so that a slow round failed on the wrong error.
func TestRestartStreamsGoOnThroughTheRefreshOfTheirObservations(t *testing.T) {
	for _, tc := range restartStreamCases() {
		for _, ending := range []string{"the context ends", "the watch ends"} {
			t.Run(tc.name+"/"+ending, func(t *testing.T) {
				t.Parallel()
				client, refreshes := tc.cluster()
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				defer cancel()
				watcher, events, done := tc.startRestart(t, ctx, client)
				watcher.Modify(tc.object.DeepCopyObject())
				expectEvent(t, events, "progress")
				require.Eventually(t, func() bool { return refreshes.Load() > 0 }, 5*time.Second, 10*time.Millisecond, "the refresh did not come")
				select {
				case err := <-done:
					t.Fatalf("the refresh ended the stream: %v", err)
				case <-time.After(100 * time.Millisecond): // it was handled, and the stream goes on
				}
				if ending == "the context ends" {
					cancel()
				} else {
					watcher.Stop()
				}
				select {
				case err := <-done:
					if ending == "the context ends" {
						require.ErrorIs(t, err, context.Canceled)
					} else {
						require.ErrorContains(t, err, "watch channel closed")
					}
				case <-time.After(5 * time.Second):
					t.Fatal("the stream did not end")
				}
			})
		}
	}
}
