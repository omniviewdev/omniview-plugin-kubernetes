package logs

import (
	"context"
	"testing"

	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/watch"
)

// runProcessPodWatchEvents runs processPodWatchEvents in a goroutine and
// closes eventCh when it returns (mirroring watchPodsAsSourceEvents behavior).
func runProcessPodWatchEvents(ctx context.Context, watcher watch.Interface, target string, eventCh chan logs.SourceEvent) {
	go func() {
		defer close(eventCh)
		processPodWatchEvents(ctx, watcher, target, eventCh)
	}()
}

// collectEvents drains eventCh into a slice until the channel closes.
func collectEvents(eventCh <-chan logs.SourceEvent) []logs.SourceEvent {
	var events []logs.SourceEvent
	for e := range eventCh {
		events = append(events, e)
	}
	return events
}

func TestProcessPodWatchEvents_AddModifyDelete(t *testing.T) {
	fw := watch.NewFake()
	eventCh := make(chan logs.SourceEvent, 32)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	runProcessPodWatchEvents(ctx, fw, "", eventCh)

	// 1. ADDED — pod with containers [app, sidecar]
	fw.Add(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "app", Image: "nginx"},
				{Name: "sidecar", Image: "envoy"},
			},
		},
	})

	// 2. MODIFIED — same pod now has ephemeral container [debug] added
	fw.Modify(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "app", Image: "nginx"},
				{Name: "sidecar", Image: "envoy"},
			},
			EphemeralContainers: []corev1.EphemeralContainer{
				{EphemeralContainerCommon: corev1.EphemeralContainerCommon{
					Name: "debug", Image: "busybox",
				}},
			},
		},
	})

	// 3. DELETED
	fw.Delete(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "app", Image: "nginx"},
				{Name: "sidecar", Image: "envoy"},
			},
			EphemeralContainers: []corev1.EphemeralContainer{
				{EphemeralContainerCommon: corev1.EphemeralContainerCommon{
					Name: "debug", Image: "busybox",
				}},
			},
		},
	})

	// Stop the watcher so the goroutine exits and closes eventCh
	fw.Stop()
	events := collectEvents(eventCh)

	// Expected events:
	// ADDED:    SourceAdded(web/app), SourceAdded(web/sidecar)
	// MODIFIED: SourceAdded(web/debug) — app & sidecar already known
	// DELETED:  SourceRemoved(web/app), SourceRemoved(web/sidecar), SourceRemoved(web/debug)
	require.Len(t, events, 6, "expected 6 events: 2 added + 1 added (modified) + 3 removed")

	// ADDED events
	assert.Equal(t, logs.SourceAdded, events[0].Type)
	assert.Equal(t, "web/app", events[0].Source.ID)
	assert.Equal(t, logs.SourceAdded, events[1].Type)
	assert.Equal(t, "web/sidecar", events[1].Source.ID)

	// MODIFIED — only the new container
	assert.Equal(t, logs.SourceAdded, events[2].Type)
	assert.Equal(t, "web/debug", events[2].Source.ID)

	// DELETED — all 3 containers
	removedIDs := map[string]bool{
		events[3].Source.ID: true,
		events[4].Source.ID: true,
		events[5].Source.ID: true,
	}
	assert.Equal(t, logs.SourceRemoved, events[3].Type)
	assert.Equal(t, logs.SourceRemoved, events[4].Type)
	assert.Equal(t, logs.SourceRemoved, events[5].Type)
	assert.True(t, removedIDs["web/app"], "expected web/app in removed events")
	assert.True(t, removedIDs["web/sidecar"], "expected web/sidecar in removed events")
	assert.True(t, removedIDs["web/debug"], "expected web/debug in removed events")
}

func TestProcessPodWatchEvents_ModifiedRemovesContainer(t *testing.T) {
	fw := watch.NewFake()
	eventCh := make(chan logs.SourceEvent, 32)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	runProcessPodWatchEvents(ctx, fw, "", eventCh)

	// ADDED with [app, sidecar]
	fw.Add(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "app", Image: "nginx"},
				{Name: "sidecar", Image: "envoy"},
			},
		},
	})

	// MODIFIED — sidecar removed
	fw.Modify(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "app", Image: "nginx"},
			},
		},
	})

	fw.Stop()
	events := collectEvents(eventCh)

	// ADDED: web/app, web/sidecar
	// MODIFIED: SourceRemoved(web/sidecar)
	require.Len(t, events, 3)

	assert.Equal(t, logs.SourceAdded, events[0].Type)
	assert.Equal(t, "web/app", events[0].Source.ID)
	assert.Equal(t, logs.SourceAdded, events[1].Type)
	assert.Equal(t, "web/sidecar", events[1].Source.ID)

	assert.Equal(t, logs.SourceRemoved, events[2].Type)
	assert.Equal(t, "web/sidecar", events[2].Source.ID)
}

func TestProcessPodWatchEvents_TargetFilter(t *testing.T) {
	fw := watch.NewFake()
	eventCh := make(chan logs.SourceEvent, 32)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	runProcessPodWatchEvents(ctx, fw, "app", eventCh)

	fw.Add(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "app", Image: "nginx"},
				{Name: "sidecar", Image: "envoy"},
			},
		},
	})

	fw.Stop()
	events := collectEvents(eventCh)

	// Only "app" matches the target
	require.Len(t, events, 1)
	assert.Equal(t, logs.SourceAdded, events[0].Type)
	assert.Equal(t, "web/app", events[0].Source.ID)
}

func TestProcessPodWatchEvents_ContextCancellation(t *testing.T) {
	fw := watch.NewFake()
	eventCh := make(chan logs.SourceEvent, 32)

	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		processPodWatchEvents(ctx, fw, "", eventCh)
		close(done)
	}()

	// Cancel context — goroutine should exit
	cancel()
	<-done // should not hang
}

func TestProcessPodWatchEvents_NonPodObjectIgnored(t *testing.T) {
	fw := watch.NewFake()
	eventCh := make(chan logs.SourceEvent, 32)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	runProcessPodWatchEvents(ctx, fw, "", eventCh)

	// Send a non-pod object
	fw.Action(watch.Added, &runtime.Unknown{Raw: []byte("not a pod")})

	// Then a real pod
	fw.Add(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "app", Image: "nginx"},
			},
		},
	})

	fw.Stop()
	events := collectEvents(eventCh)

	// Only the real pod event should come through
	require.Len(t, events, 1)
	assert.Equal(t, logs.SourceAdded, events[0].Type)
	assert.Equal(t, "web/app", events[0].Source.ID)
}

func TestProcessPodWatchEvents_ModifiedNoChange(t *testing.T) {
	fw := watch.NewFake()
	eventCh := make(chan logs.SourceEvent, 32)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	runProcessPodWatchEvents(ctx, fw, "", eventCh)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "app", Image: "nginx"},
			},
		},
	}

	fw.Add(pod)
	// MODIFIED with identical containers — should emit no new events
	fw.Modify(pod)

	fw.Stop()
	events := collectEvents(eventCh)

	// Only the initial ADDED event — MODIFIED with no diff is silent
	require.Len(t, events, 1)
	assert.Equal(t, logs.SourceAdded, events[0].Type)
	assert.Equal(t, "web/app", events[0].Source.ID)
}

func TestProcessPodWatchEvents_MultiplePods(t *testing.T) {
	fw := watch.NewFake()
	eventCh := make(chan logs.SourceEvent, 32)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	runProcessPodWatchEvents(ctx, fw, "", eventCh)

	// Add two different pods
	fw.Add(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-a", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "app", Image: "nginx"}},
		},
	})
	fw.Add(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-b", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "app", Image: "nginx"}},
		},
	})

	// Delete only pod-a — pod-b should be unaffected
	fw.Delete(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-a", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "app", Image: "nginx"}},
		},
	})

	fw.Stop()
	events := collectEvents(eventCh)

	// ADDED web-a/app, ADDED web-b/app, REMOVED web-a/app
	require.Len(t, events, 3)
	assert.Equal(t, logs.SourceAdded, events[0].Type)
	assert.Equal(t, "web-a/app", events[0].Source.ID)
	assert.Equal(t, logs.SourceAdded, events[1].Type)
	assert.Equal(t, "web-b/app", events[1].Source.ID)
	assert.Equal(t, logs.SourceRemoved, events[2].Type)
	assert.Equal(t, "web-a/app", events[2].Source.ID)
}

func TestProcessPodWatchEvents_ModifiedForUnknownPod(t *testing.T) {
	fw := watch.NewFake()
	eventCh := make(chan logs.SourceEvent, 32)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	runProcessPodWatchEvents(ctx, fw, "", eventCh)

	// MODIFIED without prior ADDED — treats all containers as new
	fw.Modify(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "app", Image: "nginx"},
			},
		},
	})

	fw.Stop()
	events := collectEvents(eventCh)

	// prev is nil map → all containers treated as new
	require.Len(t, events, 1)
	assert.Equal(t, logs.SourceAdded, events[0].Type)
	assert.Equal(t, "web/app", events[0].Source.ID)
}
