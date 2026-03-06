package resourcers

import (
	"context"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakedynamic "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/dynamic/dynamicinformer"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource/resourcetest"
)

// newWatchableClientSet creates a fake ClientSet where the informer for testGVR
// is pre-registered so that Watch's EnsureFactoryStarted will start it.
// Unlike newSyncedClientSet, the factory is NOT started yet — Watch will start it.
func newWatchableClientSet(gvr schema.GroupVersionResource, gvrToListKind map[schema.GroupVersionResource]string, objects ...runtime.Object) *clients.ClientSet {
	scheme := runtime.NewScheme()
	dynamicClient := fakedynamic.NewSimpleDynamicClientWithCustomListKinds(scheme, gvrToListKind, objects...)
	factory := dynamicinformer.NewDynamicSharedInformerFactory(dynamicClient, 0)

	// Pre-register the informer so that Start() will pick it up.
	factory.ForResource(gvr).Informer()

	return &clients.ClientSet{
		DynamicClient:          dynamicClient,
		DynamicInformerFactory: factory,
	}
}

func TestWatch_EmitsAddEvents(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cs := newWatchableClientSet(testGVR, defaultGVRListKinds(),
		newTestPod("pod-a", "default"),
		newTestPod("pod-b", "default"),
	)
	r := newBaseResourcer()
	sink := resourcetest.NewRecordingSink()
	meta := resource.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}

	done := make(chan error, 1)
	go func() {
		done <- r.Watch(ctx, cs, meta, sink)
	}()

	sink.WaitForState(t, meta.Key(), resource.WatchStateSynced, 5*time.Second)

	// The two pre-existing pods should be burst as ADDs after sync.
	sink.WaitForAdds(t, 2, 5*time.Second)

	cancel()
	err := <-done
	assert.NoError(t, err)
}

func TestWatch_EmitsDeleteEvents(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cs := newWatchableClientSet(testGVR, defaultGVRListKinds(),
		newTestPod("doomed", "default"),
	)
	r := newBaseResourcer()
	sink := resourcetest.NewRecordingSink()
	meta := resource.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}

	done := make(chan error, 1)
	go func() {
		done <- r.Watch(ctx, cs, meta, sink)
	}()

	sink.WaitForState(t, meta.Key(), resource.WatchStateSynced, 5*time.Second)

	// Delete the pod via the dynamic client.
	err := cs.DynamicClient.Resource(testGVR).Namespace("default").Delete(ctx, "doomed", metav1.DeleteOptions{})
	require.NoError(t, err)

	sink.WaitForDeletes(t, 1, 5*time.Second)

	cancel()
	<-done
}

func TestWatch_EmitsStateChanges(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cs := newWatchableClientSet(testGVR, defaultGVRListKinds())
	r := newBaseResourcer()
	sink := resourcetest.NewRecordingSink()
	meta := resource.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}

	done := make(chan error, 1)
	go func() {
		done <- r.Watch(ctx, cs, meta, sink)
	}()

	// Should see Syncing → Synced state transitions.
	sink.WaitForState(t, meta.Key(), resource.WatchStateSyncing, 5*time.Second)
	sink.WaitForState(t, meta.Key(), resource.WatchStateSynced, 5*time.Second)

	cancel()
	<-done
}

func TestWatch_CancelContextStops(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	cs := newWatchableClientSet(testGVR, defaultGVRListKinds())
	r := newBaseResourcer()
	sink := resourcetest.NewRecordingSink()
	meta := resource.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}

	done := make(chan error, 1)
	go func() {
		done <- r.Watch(ctx, cs, meta, sink)
	}()

	sink.WaitForState(t, meta.Key(), resource.WatchStateSynced, 5*time.Second)

	// Cancel → Watch should return.
	cancel()

	select {
	case err := <-done:
		assert.NoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("Watch did not return after context cancellation")
	}
}

func TestWatch_NewObjectAfterSync(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cs := newWatchableClientSet(testGVR, defaultGVRListKinds())
	r := newBaseResourcer()
	sink := resourcetest.NewRecordingSink()
	meta := resource.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}

	done := make(chan error, 1)
	go func() {
		done <- r.Watch(ctx, cs, meta, sink)
	}()

	sink.WaitForState(t, meta.Key(), resource.WatchStateSynced, 5*time.Second)

	// Create a new object after sync — should produce an ADD event.
	newPod := &unstructured.Unstructured{}
	newPod.SetGroupVersionKind(schema.GroupVersionKind{Group: "", Version: "v1", Kind: "Pod"})
	newPod.SetName("new-pod")
	newPod.SetNamespace("default")
	_, err := cs.DynamicClient.Resource(testGVR).Namespace("default").Create(ctx, newPod, metav1.CreateOptions{})
	require.NoError(t, err)

	sink.WaitForAdds(t, 1, 5*time.Second)

	cancel()
	<-done
}

func TestWatch_SyncedStateHasResourceCount(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cs := newWatchableClientSet(testGVR, defaultGVRListKinds(),
		newTestPod("a", "default"),
		newTestPod("b", "default"),
		newTestPod("c", "default"),
	)
	r := NewKubernetesResourcerBase[MetaAccessor](zap.NewNop().Sugar(), testGVR)
	sink := resourcetest.NewRecordingSink()
	meta := resource.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}

	done := make(chan error, 1)
	go func() {
		done <- r.Watch(ctx, cs, meta, sink)
	}()

	sink.WaitForState(t, meta.Key(), resource.WatchStateSynced, 5*time.Second)

	// After synced, the 3 pre-existing pods should be burst as ADDs.
	sink.WaitForAdds(t, 3, 5*time.Second)
	assert.GreaterOrEqual(t, sink.StateCount(), 2, "should have at least Syncing + Synced states")

	cancel()
	<-done
}
