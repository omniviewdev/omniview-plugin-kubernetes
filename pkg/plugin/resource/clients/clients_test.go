package clients

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/dynamic"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/rest"
	k8stesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"
)

var podsGVR = schema.GroupVersionResource{Version: "v1", Resource: "pods"}
var nodesGVR = schema.GroupVersionResource{Version: "v1", Resource: "nodes"}
var servicesGVR = schema.GroupVersionResource{Version: "v1", Resource: "services"}

type ownedNativeWatch struct {
	*watch.RaceFreeFakeWatcher
	key     informerKey
	stopped chan struct{}
	once    sync.Once
}

func (w *ownedNativeWatch) Stop() {
	w.once.Do(func() {
		w.RaceFreeFakeWatcher.Stop()
		close(w.stopped)
	})
}

func nativeLeaseClient(t *testing.T) (*ClientSet, <-chan *ownedNativeWatch) {
	t.Helper()
	dynamicClient := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{
		podsGVR: "PodList", nodesGVR: "NodeList", servicesGVR: "ServiceList",
	})
	started := make(chan *ownedNativeWatch, 128)
	dynamicClient.PrependWatchReactor("*", func(action k8stesting.Action) (bool, watch.Interface, error) {
		w := &ownedNativeWatch{RaceFreeFakeWatcher: watch.NewRaceFreeFake(), key: informerKey{namespace: action.GetNamespace(), resource: action.GetResource()}, stopped: make(chan struct{})}
		started <- w
		return true, w, nil
	})
	client := &ClientSet{DynamicClient: dynamicClient}
	t.Cleanup(client.ShutdownInformers)
	return client, started
}

func receiveNativeWatch(t *testing.T, started <-chan *ownedNativeWatch) *ownedNativeWatch {
	t.Helper()
	select {
	case w := <-started:
		return w
	case <-time.After(5 * time.Second):
		t.Fatal("native watch did not start")
		return nil
	}
}

func waitNativeStop(t *testing.T, w *ownedNativeWatch) {
	t.Helper()
	select {
	case <-w.stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("native watch did not stop")
	}
}

func syncLease(t *testing.T, lease *InformerLease) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	require.True(t, cache.WaitForCacheSync(ctx.Done(), lease.HasSynced))
}

func TestInformerLeaseFinalConsumerStopsNativeSourceAndReacquires(t *testing.T) {
	for _, tc := range []struct {
		name      string
		namespace string
		gvr       schema.GroupVersionResource
		kind      string
	}{
		{name: "namespace", namespace: "team-a", gvr: podsGVR, kind: "Pod"},
		{name: "all-namespaces", gvr: podsGVR, kind: "Pod"},
		{name: "cluster", gvr: nodesGVR, kind: "Node"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client, started := nativeLeaseClient(t)
			ctx := context.Background()
			first, err := client.AcquireInformer(ctx, tc.namespace, tc.gvr, cache.ResourceEventHandlerFuncs{})
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, first.Close()) })
			w := receiveNativeWatch(t, started)
			require.Equal(t, informerKey{namespace: tc.namespace, resource: tc.gvr}, w.key)
			syncLease(t, first)

			adds := make(chan string, 4)
			second, err := client.AcquireInformer(ctx, tc.namespace, tc.gvr, cache.ResourceEventHandlerFuncs{AddFunc: func(obj interface{}) { adds <- obj.(*unstructured.Unstructured).GetName() }})
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, second.Close()) })
			require.Same(t, first.Informer, second.Informer)
			syncLease(t, second)
			require.NoError(t, first.Close())
			select {
			case <-w.stopped:
				t.Fatal("first consumer stopped a source still in use")
			default:
			}
			stale := &unstructured.Unstructured{Object: map[string]interface{}{"apiVersion": "v1", "kind": tc.kind, "metadata": map[string]interface{}{"name": "old", "namespace": tc.namespace}}}
			w.Add(stale)
			select {
			case name := <-adds:
				require.Equal(t, "old", name)
			case <-time.After(5 * time.Second):
				t.Fatal("remaining consumer lost native events")
			}
			require.NoError(t, second.Close())
			waitNativeStop(t, w)
			require.Empty(t, client.informers, "final release must evict the cache owner")
			select {
			case <-started:
				t.Fatal("shared interests opened more than one native watch")
			default:
			}

			fresh := stale.DeepCopy()
			fresh.SetName("fresh")
			_, err = client.DynamicClient.Resource(tc.gvr).Namespace(tc.namespace).Create(ctx, fresh, metav1.CreateOptions{})
			require.NoError(t, err)
			third, err := client.AcquireInformer(ctx, tc.namespace, tc.gvr, cache.ResourceEventHandlerFuncs{})
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, third.Close()) })
			freshWatch := receiveNativeWatch(t, started)
			require.NotSame(t, first.Informer, third.Informer)
			syncLease(t, third)
			objects := third.Informer.GetStore().List()
			require.Len(t, objects, 1)
			require.Equal(t, "fresh", objects[0].(*unstructured.Unstructured).GetName())
			require.NoError(t, third.Close())
			waitNativeStop(t, freshWatch)
			require.Empty(t, client.informers)
		})
	}
}

func TestShutdownInformersStopsEveryNativeSource(t *testing.T) {
	client, started := nativeLeaseClient(t)
	keys := []informerKey{{namespace: "team-a", resource: podsGVR}, {namespace: "team-b", resource: podsGVR}, {namespace: "team-a", resource: servicesGVR}, {resource: nodesGVR}}
	leases := make([]*InformerLease, 0, len(keys)+1)
	watches := make([]*ownedNativeWatch, 0, len(keys))
	for _, key := range keys {
		lease, err := client.AcquireInformer(context.Background(), key.namespace, key.resource, cache.ResourceEventHandlerFuncs{})
		require.NoError(t, err)
		leases = append(leases, lease)
		watches = append(watches, receiveNativeWatch(t, started))
		syncLease(t, lease)
	}
	shared, err := client.AcquireInformer(context.Background(), "team-a", podsGVR, cache.ResourceEventHandlerFuncs{})
	require.NoError(t, err)
	leases = append(leases, shared)
	// Namespace and GVR sources retire independently, even within one namespace.
	for _, index := range []int{1, 2} {
		require.NoError(t, leases[index].Close())
		waitNativeStop(t, watches[index])
	}
	require.False(t, watches[0].IsStopped())
	require.False(t, watches[3].IsStopped())
	shutdown := client.InformerShutdown()
	client.ShutdownInformers()
	select {
	case <-shutdown:
	default:
		t.Fatal("shutdown must notify consumers")
	}
	for _, w := range watches {
		waitNativeStop(t, w)
	}
	require.Empty(t, client.informers)
	_, err = client.AcquireInformer(context.Background(), "team-a", podsGVR, cache.ResourceEventHandlerFuncs{})
	require.Error(t, err)
	for _, lease := range leases {
		require.NoError(t, lease.Close())
		require.NoError(t, lease.Close())
	}
	client.ShutdownInformers()
}

func TestInformerLeaseConcurrentRetirement(t *testing.T) {
	client, started := nativeLeaseClient(t)
	errors := make(chan error, 32)
	var workers sync.WaitGroup
	for range 4 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for range 8 {
				lease, err := client.AcquireInformer(context.Background(), "team-a", podsGVR, cache.ResourceEventHandlerFuncs{})
				if err == nil {
					err = lease.Close()
				}
				errors <- err
			}
		}()
	}
	workers.Wait()
	close(errors)
	for err := range errors {
		require.NoError(t, err)
	}
	client.ShutdownInformers()
	for {
		select {
		case w := <-started:
			waitNativeStop(t, w)
		default:
			require.Empty(t, client.informers)
			return
		}
	}
}

func TestInformerLeaseCanceledAcquisitionAndRefresh(t *testing.T) {
	client, started := nativeLeaseClient(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := client.AcquireInformer(ctx, "team-a", podsGVR, cache.ResourceEventHandlerFuncs{})
	require.ErrorIs(t, err, context.Canceled)
	require.Empty(t, client.informers)
	previousShutdown := client.InformerShutdown()
	client.ShutdownInformers()
	client.ResetInformerLifecycle()
	require.NotEqual(t, previousShutdown, client.InformerShutdown())
	lease, err := client.AcquireInformer(context.Background(), "team-a", podsGVR, cache.ResourceEventHandlerFuncs{})
	require.NoError(t, err)
	w := receiveNativeWatch(t, started)
	syncLease(t, lease)
	require.NoError(t, lease.Close())
	waitNativeStop(t, w)
}

func TestInformerLeaseStopsOwnedServerAcquisition(t *testing.T) {
	for _, operation := range []string{"list", "watch"} {
		t.Run(operation, func(t *testing.T) {
			entered := make(chan struct{})
			stopped := make(chan struct{})
			var enterOnce, stopOnce sync.Once
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				isWatch := r.URL.Query().Get("watch") == "true"
				if operation == "watch" && !isWatch {
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`{"apiVersion":"v1","kind":"PodList","metadata":{"resourceVersion":"1"},"items":[]}`))
					return
				}
				w.Header().Set("Content-Type", "application/json")
				if isWatch {
					w.WriteHeader(http.StatusOK)
					w.(http.Flusher).Flush()
				}
				enterOnce.Do(func() { close(entered) })
				<-r.Context().Done()
				stopOnce.Do(func() { close(stopped) })
			}))
			defer server.Close()
			dynamicClient, err := dynamic.NewForConfig(&rest.Config{Host: server.URL})
			require.NoError(t, err)
			client := &ClientSet{DynamicClient: dynamicClient}
			defer func() {
				server.CloseClientConnections()
				client.ShutdownInformers()
			}()
			first, err := client.AcquireInformer(context.Background(), "team-a", podsGVR, cache.ResourceEventHandlerFuncs{})
			require.NoError(t, err)
			second, err := client.AcquireInformer(context.Background(), "team-a", podsGVR, cache.ResourceEventHandlerFuncs{})
			require.NoError(t, err)
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("owned server did not receive native acquisition")
			}
			require.NoError(t, first.Close())
			select {
			case <-stopped:
				t.Fatal("first lease canceled a shared native request")
			default:
			}
			closed := make(chan error, 1)
			go func() { closed <- second.Close() }()
			select {
			case err := <-closed:
				require.NoError(t, err)
			case <-time.After(5 * time.Second):
				t.Fatal("final lease did not cancel native acquisition")
			}
			select {
			case <-stopped:
			case <-time.After(5 * time.Second):
				t.Fatal("native request survived final lease")
			}
			require.Empty(t, client.informers)
		})
	}
}

func TestShutdownInformersRacesWithConsumerRetirement(t *testing.T) {
	client, started := nativeLeaseClient(t)
	first, err := client.AcquireInformer(context.Background(), "team-a", podsGVR, cache.ResourceEventHandlerFuncs{})
	require.NoError(t, err)
	second, err := client.AcquireInformer(context.Background(), "team-a", podsGVR, cache.ResourceEventHandlerFuncs{})
	require.NoError(t, err)
	w := receiveNativeWatch(t, started)
	syncLease(t, second)
	var workers sync.WaitGroup
	errors := make(chan error, 2)
	for _, lease := range []*InformerLease{first, second} {
		workers.Add(1)
		go func() { defer workers.Done(); errors <- lease.Close() }()
	}
	for range 2 {
		workers.Add(1)
		go func() { defer workers.Done(); client.ShutdownInformers() }()
	}
	workers.Wait()
	close(errors)
	for err := range errors {
		require.NoError(t, err)
	}
	waitNativeStop(t, w)
	require.Empty(t, client.informers)
}

func TestLastLeaseCloseEmitsRetireSpan(t *testing.T) {
	previous := otel.GetTracerProvider()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		require.NoError(t, provider.Shutdown(context.Background()))
	})
	client, started := nativeLeaseClient(t)
	lease, err := client.AcquireInformer(context.Background(), "team-a", podsGVR, cache.ResourceEventHandlerFuncs{})
	require.NoError(t, err)
	receiveNativeWatch(t, started)
	require.NoError(t, lease.Close())
	var found bool
	for _, span := range exporter.GetSpans() {
		if span.Name != "kubernetes.informer.retire" {
			continue
		}
		found = true
		attributes := map[string]string{}
		for _, attr := range span.Attributes {
			attributes[string(attr.Key)] = attr.Value.Emit()
		}
		require.Equal(t, "last_lease", attributes["trigger"])
		require.Equal(t, "pods", attributes["resource.type"])
		require.Equal(t, "success", attributes["outcome"])
	}
	require.True(t, found, "last lease close must emit kubernetes.informer.retire")
}
