package clients

import (
	"context"
	"sync"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"
)

func TestNameSelectorIsOneEscapedTermAndRefusesANameNoObjectHas(t *testing.T) {
	for _, tc := range []struct {
		name     string
		selector string
	}{
		{"cart-api-86bf766589-ct9b5", "metadata.name=cart-api-86bf766589-ct9b5"},
		{"system:node-proxier", "metadata.name=system:node-proxier"},
		{"v1.widgets.example.com", "metadata.name=v1.widgets.example.com"},
		// RBAC and custom resources may carry characters the selector language reads: they are part of the value, never a second term.
		{"a,metadata.namespace=other", `metadata.name=a\,metadata.namespace\=other`},
		{`a\b`, `metadata.name=a\\b`},
		{"a!=b", `metadata.name=a!\=b`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			selector, err := NameSelector(tc.name)
			require.NoError(t, err)
			require.Equal(t, tc.selector, selector)
		})
	}
	for _, name := range []string{"", ".", "..", "a/b", "a%2Fb", "\xff"} {
		t.Run("refuses "+name, func(t *testing.T) {
			_, err := NameSelector(name)
			require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
		})
	}
}

// nativeRequests records what the fake API server was asked for.
type nativeRequests struct {
	mu    sync.Mutex
	lists []string
}

func recordLists(client *ClientSet) *nativeRequests {
	requests := &nativeRequests{}
	client.DynamicClient.(*dynamicfake.FakeDynamicClient).PrependReactor("list", "*", func(action k8stesting.Action) (bool, runtime.Object, error) {
		requests.mu.Lock()
		defer requests.mu.Unlock()
		requests.lists = append(requests.lists, action.(k8stesting.ListAction).GetListRestrictions().Fields.String())
		return false, nil, nil
	})
	return requests
}

func (r *nativeRequests) selectors() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.lists...)
}

func TestObjectNameNarrowsTheNativeListAndWatch(t *testing.T) {
	client, started := nativeLeaseClient(t)
	lists := recordLists(client)

	lease, err := client.AcquireInformer(context.Background(), "team-a", podsGVR, cache.ResourceEventHandlerFuncs{}, ObjectName("cart-api"))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, lease.Close()) })
	w := receiveNativeWatch(t, started)
	syncLease(t, lease)

	require.Equal(t, "metadata.name=cart-api", w.selector, "the WATCH is narrowed by the server")
	require.Equal(t, "team-a", w.key.namespace)
	require.Equal(t, []string{"metadata.name=cart-api"}, lists.selectors(), "so is the LIST")
}

func TestWithoutAnObjectNameTheNativeListAndWatchTakeTheWholeNamespace(t *testing.T) {
	client, started := nativeLeaseClient(t)
	lists := recordLists(client)

	lease, err := client.AcquireInformer(context.Background(), "team-a", podsGVR, cache.ResourceEventHandlerFuncs{})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, lease.Close()) })
	w := receiveNativeWatch(t, started)
	syncLease(t, lease)

	require.Empty(t, w.selector)
	require.Equal(t, []string{""}, lists.selectors())
}

func TestInformersAreSharedPerObjectAndRetireWithTheirLastLease(t *testing.T) {
	client, started := nativeLeaseClient(t)
	ctx := context.Background()
	acquire := func(options ...InformerOption) *InformerLease {
		lease, err := client.AcquireInformer(ctx, "team-a", podsGVR, cache.ResourceEventHandlerFuncs{}, options...)
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, lease.Close()) })
		return lease
	}

	first := acquire(ObjectName("cart-api"))
	firstWatch := receiveNativeWatch(t, started)
	second := acquire(ObjectName("cart-api"))
	require.Same(t, first.Informer, second.Informer, "two interests in one object are one source")

	other := acquire(ObjectName("payment"))
	otherWatch := receiveNativeWatch(t, started)
	require.NotSame(t, first.Informer, other.Informer, "another object is another narrowed source")
	require.Equal(t, "metadata.name=payment", otherWatch.selector)

	namespace := acquire()
	namespaceWatch := receiveNativeWatch(t, started)
	require.NotSame(t, first.Informer, namespace.Informer, "the namespace is not an object's source: it does not hold the object's watch")
	require.Empty(t, namespaceWatch.selector)

	select {
	case <-started:
		t.Fatal("a shared interest opened a second native watch")
	default:
	}

	require.NoError(t, first.Close())
	select {
	case <-firstWatch.stopped:
		t.Fatal("the object's source stopped while a lease still held it")
	default:
	}
	require.NoError(t, second.Close())
	waitNativeStop(t, firstWatch)
	for _, w := range []*ownedNativeWatch{otherWatch, namespaceWatch} {
		select {
		case <-w.stopped:
			t.Fatal("the last lease of one object stopped another source")
		default:
		}
	}
}

func TestAnObjectNameNoObjectCanHaveOpensNoSource(t *testing.T) {
	client, started := nativeLeaseClient(t)
	lists := recordLists(client)

	_, err := client.AcquireInformer(context.Background(), "team-a", podsGVR, cache.ResourceEventHandlerFuncs{}, ObjectName("a/b"))
	require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
	require.Empty(t, lists.selectors())
	require.Empty(t, client.informers)
	select {
	case <-started:
		t.Fatal("a refused name opened a native watch")
	default:
	}
}
