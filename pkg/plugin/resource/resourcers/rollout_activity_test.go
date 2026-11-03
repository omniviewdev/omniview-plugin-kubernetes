package resourcers

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func TestRolloutWaitsForPatchedGeneration(t *testing.T) {
	type streamFunc func(context.Context, *clients.ClientSet, resource.ActionRequest, chan<- resource.ActionEvent) error
	replicas := int32(3)
	for _, tc := range []struct {
		name   string
		object runtime.Object
		run    streamFunc
	}{
		{"deployment", &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "work", Namespace: "default", Generation: 2, ResourceVersion: "42"}, Spec: appsv1.DeploymentSpec{Replicas: &replicas}, Status: appsv1.DeploymentStatus{ObservedGeneration: 1, UpdatedReplicas: 3, AvailableReplicas: 3, Replicas: 3}}, newTestDeploymentResourcer().streamRestart},
		{"statefulset", &appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: "work", Namespace: "default", Generation: 2, ResourceVersion: "42"}, Spec: appsv1.StatefulSetSpec{Replicas: &replicas}, Status: appsv1.StatefulSetStatus{ObservedGeneration: 1, UpdatedReplicas: 3, ReadyReplicas: 3, Replicas: 3, CurrentRevision: "old", UpdateRevision: "old"}}, NewStatefulSetResourcer(zap.NewNop().Sugar()).streamRestart},
		{"daemonset", &appsv1.DaemonSet{ObjectMeta: metav1.ObjectMeta{Name: "work", Namespace: "default", Generation: 2, ResourceVersion: "42"}, Status: appsv1.DaemonSetStatus{ObservedGeneration: 1, DesiredNumberScheduled: 3, UpdatedNumberScheduled: 3, CurrentNumberScheduled: 3, NumberReady: 3, NumberAvailable: 3}}, NewDaemonSetResourcer(zap.NewNop().Sugar()).streamRestart},
	} {
		t.Run(tc.name, func(t *testing.T) {
			workload := tc.object.(metav1.Object)
			workload.SetUID("workload")
			template := corev1.PodTemplateSpec{ObjectMeta: metav1.ObjectMeta{Annotations: map[string]string{"kubectl.kubernetes.io/restartedAt": "requested"}}}
			kind := ""
			switch object := tc.object.(type) {
			case *appsv1.Deployment:
				object.Spec.Template = template
				kind = "Deployment"
			case *appsv1.StatefulSet:
				object.Spec.Template = template
				kind = "StatefulSet"
			case *appsv1.DaemonSet:
				object.Spec.Template = template
				kind = "DaemonSet"
			}
			client := fake.NewSimpleClientset(rolloutPodFixtures(kind)...)
			client.PrependReactor("patch", "*", func(ktesting.Action) (bool, runtime.Object, error) { return true, tc.object.DeepCopyObject(), nil })
			watcher := watch.NewRaceFreeFake()
			client.PrependWatchReactor("*", func(action ktesting.Action) (bool, watch.Interface, error) {
				require.Equal(t, "42", action.(ktesting.WatchAction).GetWatchRestrictions().ResourceVersion)
				return true, watcher, nil
			})
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			events := make(chan resource.ActionEvent, 10)
			done := make(chan error, 1)
			go func() {
				done <- tc.run(ctx, &clients.ClientSet{KubeClient: client}, workloadActionRequest("restart", "work", "default", nil), events)
			}()
			select {
			case event := <-events:
				require.Equal(t, "ready", event.Type)
			case <-ctx.Done():
				t.Fatal("restart never became ready")
			}
			// Old status looks fully ready, but has not observed the patched generation.
			watcher.Modify(tc.object.DeepCopyObject())
			current := tc.object.DeepCopyObject()
			switch object := current.(type) {
			case *appsv1.Deployment:
				object.Status.ObservedGeneration = 2
			case *appsv1.StatefulSet:
				object.Status.ObservedGeneration = 2
				object.Status.CurrentRevision = "new"
				object.Status.UpdateRevision = "new"
			case *appsv1.DaemonSet:
				object.Status.ObservedGeneration = 2
			}
			watcher.Modify(current)
			require.NoError(t, <-done)
			require.Len(t, events, 2, "stale status must not produce progress or success")
			progress := <-events
			require.Equal(t, "progress", progress.Type)
			require.NotNil(t, progress.Activity)
			require.Equal(t, "units", progress.Activity.Progress.Kind)
			require.Equal(t, "3", progress.Activity.Progress.Current)
			require.Equal(t, "3", progress.Activity.Progress.Total)
			complete := <-events
			require.Equal(t, "complete", complete.Type)
			require.NotNil(t, complete.Activity)
		})
	}
}

func TestRolloutPresentationZeroAndSurge(t *testing.T) {
	zero := rolloutActivity("Deployment", "work", 0, 0, 0, 0, 0, "replicas", true)
	require.NoError(t, resource.ValidateActivityPresentation(*zero))
	require.Equal(t, "indeterminate", zero.Progress.Kind)
	require.Empty(t, zero.Progress.Total)
	surge := rolloutActivity("Deployment", "work", 2, 3, 5, 3, 0, "replicas", false)
	require.Equal(t, "0", surge.Progress.Current, "old ready pods cannot advance progress")
	require.NoError(t, resource.ValidateActivityPresentation(*surge))
	require.Equal(t, "3", surge.Progress.Total)
	require.Equal(t, "3", surge.Metrics[2].Value)
	require.Equal(t, "pods", surge.Progress.Unit)
}

func TestRolloutWatchErrorDoesNotSucceed(t *testing.T) {
	dep := testDeployment("work", "default", 3)
	dep.Generation = 2
	client := fake.NewSimpleClientset(dep)
	watcher := watch.NewRaceFreeFake()
	client.PrependWatchReactor("*", func(ktesting.Action) (bool, watch.Interface, error) {
		return true, watcher, nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	events := make(chan resource.ActionEvent, 10)
	done := make(chan error, 1)
	go func() {
		done <- newTestDeploymentResourcer().streamRestart(ctx, &clients.ClientSet{KubeClient: client}, workloadActionRequest("restart", "work", "default", nil), events)
	}()
	select {
	case event := <-events:
		require.Equal(t, "ready", event.Type)
	case <-ctx.Done():
		t.Fatal("restart never became ready")
	}
	watcher.Error(&metav1.Status{Status: metav1.StatusFailure, Reason: metav1.StatusReasonExpired})
	require.ErrorContains(t, <-done, "observation lost")
	require.Empty(t, events, "watch failure must not emit completion")
}

func rolloutPodFixtures(kind string) []runtime.Object {
	controller := true
	ownerKind, ownerUID := kind, types.UID("workload")
	var objects []runtime.Object
	if kind == "Deployment" {
		objects = append(objects, &appsv1.ReplicaSet{ObjectMeta: metav1.ObjectMeta{
			Name: "new", Namespace: "default", UID: "replicaset",
			OwnerReferences: []metav1.OwnerReference{{Kind: kind, UID: ownerUID, Controller: &controller}},
		}})
		ownerKind, ownerUID = "ReplicaSet", "replicaset"
	}
	for i := range 3 {
		objects = append(objects, &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name: fmt.Sprintf("new-%d", i), Namespace: "default",
				Annotations:     map[string]string{"kubectl.kubernetes.io/restartedAt": "requested"},
				OwnerReferences: []metav1.OwnerReference{{Kind: ownerKind, UID: ownerUID, Controller: &controller}},
			},
			Status: corev1.PodStatus{Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}}},
		})
	}
	return objects
}

func TestRolloutReadyPodsCountsOnlyRequestedReadyPods(t *testing.T) {
	for _, kind := range []string{"Deployment", "StatefulSet", "DaemonSet"} {
		t.Run(kind, func(t *testing.T) {
			objects := rolloutPodFixtures(kind)
			base := objects[len(objects)-1].(*corev1.Pod)
			for i, change := range []func(*corev1.Pod){
				func(pod *corev1.Pod) { pod.Annotations["kubectl.kubernetes.io/restartedAt"] = "old" },
				func(pod *corev1.Pod) { pod.Status.Conditions[0].Status = corev1.ConditionFalse },
				func(pod *corev1.Pod) { now := metav1.Now(); pod.DeletionTimestamp = &now },
				func(pod *corev1.Pod) { pod.OwnerReferences[0].UID = "unrelated" },
				func(pod *corev1.Pod) { pod.OwnerReferences[0].Controller = nil },
			} {
				pod := base.DeepCopy()
				pod.Name = fmt.Sprintf("excluded-%d", i)
				change(pod)
				objects = append(objects, pod)
			}
			client := fake.NewSimpleClientset(objects...)
			workload := &metav1.ObjectMeta{UID: "workload", Namespace: "default"}
			ready, err := rolloutReadyPods(context.Background(), client, kind, workload, "requested")
			require.NoError(t, err)
			require.EqualValues(t, 3, ready)
			ready, err = rolloutReadyPods(context.Background(), client, kind, workload, "another-restart")
			require.NoError(t, err)
			require.Zero(t, ready)
			workload.UID = "replacement"
			ready, err = rolloutReadyPods(context.Background(), client, kind, workload, "requested")
			require.NoError(t, err)
			require.Zero(t, ready)
		})
	}
}

func TestRolloutRejectsReplacementAndSupersedingGeneration(t *testing.T) {
	type streamFunc func(context.Context, *clients.ClientSet, resource.ActionRequest, chan<- resource.ActionEvent) error
	for _, tc := range []struct {
		name   string
		object runtime.Object
		run    streamFunc
	}{
		{"deployment", &appsv1.Deployment{}, newTestDeploymentResourcer().streamRestart},
		{"statefulset", &appsv1.StatefulSet{}, NewStatefulSetResourcer(zap.NewNop().Sugar()).streamRestart},
		{"daemonset", &appsv1.DaemonSet{}, NewDaemonSetResourcer(zap.NewNop().Sugar()).streamRestart},
	} {
		for _, replacement := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/replacement=%t", tc.name, replacement), func(t *testing.T) {
				patched := tc.object.DeepCopyObject()
				meta := patched.(metav1.Object)
				meta.SetName("work")
				meta.SetNamespace("default")
				meta.SetUID("requested")
				meta.SetGeneration(2)
				client := fake.NewSimpleClientset()
				client.PrependReactor("patch", "*", func(ktesting.Action) (bool, runtime.Object, error) {
					return true, patched, nil
				})
				watcher := watch.NewRaceFreeFake()
				client.PrependWatchReactor("*", func(ktesting.Action) (bool, watch.Interface, error) {
					return true, watcher, nil
				})
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				events := make(chan resource.ActionEvent, 10)
				done := make(chan error, 1)
				go func() {
					done <- tc.run(ctx, &clients.ClientSet{KubeClient: client}, workloadActionRequest("restart", "work", "default", nil), events)
				}()
				select {
				case event := <-events:
					require.Equal(t, "ready", event.Type)
				case <-ctx.Done():
					t.Fatal("restart never became ready")
				}
				changed := patched.DeepCopyObject()
				if replacement {
					changed.(metav1.Object).SetUID("replacement")
				} else {
					changed.(metav1.Object).SetGeneration(3)
				}
				watcher.Modify(changed)
				require.ErrorContains(t, <-done, "replaced or superseded")
				require.Empty(t, events)
			})
		}
	}
}

func TestRolloutRefreshesReadyPodsWithoutWorkloadWatchEvents(t *testing.T) {
	objects := rolloutPodFixtures("DaemonSet")
	pod := objects[len(objects)-1].(*corev1.Pod)
	pod.Status.Conditions[0].Status = corev1.ConditionFalse
	workload := &appsv1.DaemonSet{ObjectMeta: metav1.ObjectMeta{
		Name: "work", Namespace: "default", UID: "workload", Generation: 2,
	}}
	client := fake.NewSimpleClientset(append(objects, workload)...)
	watcher := watch.NewRaceFreeFake()
	defer watcher.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	observations, stop := rolloutObservations(ctx, watcher, time.Millisecond, func(ctx context.Context) (*appsv1.DaemonSet, error) {
		return client.AppsV1().DaemonSets("default").Get(ctx, "work", metav1.GetOptions{})
	})
	defer stop()
	for _, expected := range []int32{2, 3} {
		select {
		case observation, ok := <-observations:
			require.True(t, ok)
			require.NoError(t, observation.err)
			require.Equal(t, watch.Modified, observation.event.Type)
			ready, err := rolloutReadyPods(ctx, client, "DaemonSet", observation.event.Object.(metav1.Object), "requested")
			require.NoError(t, err)
			require.Equal(t, expected, ready)
		case <-ctx.Done():
			t.Fatal("pod readiness did not refresh without a workload event")
		}
		if expected == 2 {
			pod = pod.DeepCopy()
			pod.Status.Conditions[0].Status = corev1.ConditionTrue
			_, err := client.CoreV1().Pods("default").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
			require.NoError(t, err)
		}
	}
}

func TestRolloutSuppressesUnchangedProgressButStillCompletes(t *testing.T) {
	workload := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{Name: "work", Namespace: "default", UID: "workload", Generation: 2},
		Spec: appsv1.DaemonSetSpec{Template: corev1.PodTemplateSpec{ObjectMeta: metav1.ObjectMeta{
			Annotations: map[string]string{"kubectl.kubernetes.io/restartedAt": "requested"},
		}}},
		Status: appsv1.DaemonSetStatus{
			ObservedGeneration: 2, DesiredNumberScheduled: 3, UpdatedNumberScheduled: 3,
			CurrentNumberScheduled: 3, NumberReady: 3, NumberAvailable: 2,
		},
	}
	client := fake.NewSimpleClientset(append(rolloutPodFixtures("DaemonSet"), workload)...)
	client.PrependReactor("patch", "*", func(ktesting.Action) (bool, runtime.Object, error) {
		return true, workload.DeepCopy(), nil
	})
	watcher := watch.NewRaceFreeFake()
	client.PrependWatchReactor("*", func(ktesting.Action) (bool, watch.Interface, error) {
		return true, watcher, nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	events := make(chan resource.ActionEvent, 10)
	done := make(chan error, 1)
	go func() {
		done <- NewDaemonSetResourcer(zap.NewNop().Sugar()).streamRestart(ctx, &clients.ClientSet{KubeClient: client}, workloadActionRequest("restart", "work", "default", nil), events)
	}()
	select {
	case event := <-events:
		require.Equal(t, "ready", event.Type)
	case <-ctx.Done():
		t.Fatal("restart never became ready")
	}
	watcher.Modify(workload.DeepCopy())
	select {
	case event := <-events:
		require.Equal(t, "progress", event.Type)
	case <-ctx.Done():
		t.Fatal("restart never emitted progress")
	}
	watcher.Modify(workload.DeepCopy())
	complete := workload.DeepCopy()
	complete.Status.NumberAvailable = 3
	watcher.Modify(complete)
	require.NoError(t, <-done)
	require.Len(t, events, 1, "unchanged counters must not emit duplicate progress")
	require.Equal(t, "complete", (<-events).Type, "completion must run even with unchanged progress counters")
}
