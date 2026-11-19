package resourcers

import (
	"fmt"
	"sync"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	fakedynamic "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"
)

// nativeTraffic is what an emulated API server was asked for and what it answered. It is the evidence that a
// narrowed source asks the server for one object, instead of asking for a namespace and discarding what it does not want.
type nativeTraffic struct {
	mu       sync.Mutex
	lists    []string
	watches  []string
	listed   int
	streamed int
}

// asked returns the field selector of every LIST and WATCH the server received, in the order it received them.
func (n *nativeTraffic) asked() (lists, watches []string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return append([]string(nil), n.lists...), append([]string(nil), n.watches...)
}

// answered counts the objects the server put on the wire: the items of its LIST answers, and the events of its watch streams.
func (n *nativeTraffic) answered() (listed, streamed int) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.listed, n.streamed
}

// serveFieldSelectors makes the fake dynamic client answer LIST and WATCH of one resource the way kube-apiserver does for the
// field selector of an object: only the objects whose metadata.name (and namespace) match are listed, and only their events
// are streamed. The stock fake ignores field selectors, so without this a test could not tell a narrowed request from a namespace.
func serveFieldSelectors(t testing.TB, client *clients.ClientSet, gvr schema.GroupVersionResource, kind string) *nativeTraffic {
	t.Helper()
	native, ok := client.DynamicClient.(*fakedynamic.FakeDynamicClient)
	require.True(t, ok)
	traffic := &nativeTraffic{}
	matches := func(selector fields.Selector, object metav1.Object) bool {
		return selector.Matches(fields.Set{"metadata.name": object.GetName(), "metadata.namespace": object.GetNamespace()})
	}
	native.PrependReactor("list", gvr.Resource, func(action k8stesting.Action) (bool, runtime.Object, error) {
		selector := action.(k8stesting.ListAction).GetListRestrictions().Fields
		everything, err := native.Tracker().List(gvr, schema.GroupVersionKind{Group: gvr.Group, Version: gvr.Version, Kind: kind}, action.GetNamespace())
		if err != nil {
			return true, nil, err
		}
		list, ok := everything.(*unstructured.UnstructuredList)
		if !ok {
			return true, nil, fmt.Errorf("the fake answered a list of %T", everything)
		}
		kept := list.Items[:0]
		for i := range list.Items {
			if matches(selector, &list.Items[i]) {
				kept = append(kept, list.Items[i])
			}
		}
		list.Items = kept
		traffic.mu.Lock()
		traffic.lists = append(traffic.lists, selector.String())
		traffic.listed += len(kept)
		traffic.mu.Unlock()
		return true, list, nil
	})
	native.PrependWatchReactor(gvr.Resource, func(action k8stesting.Action) (bool, watch.Interface, error) {
		selector := action.(k8stesting.WatchAction).GetWatchRestrictions().Fields
		upstream, err := native.Tracker().Watch(gvr, action.GetNamespace())
		if err != nil {
			return true, nil, err
		}
		traffic.mu.Lock()
		traffic.watches = append(traffic.watches, selector.String())
		traffic.mu.Unlock()
		return true, watch.Filter(upstream, func(event watch.Event) (watch.Event, bool) {
			object, ok := event.Object.(metav1.Object)
			if !ok || !matches(selector, object) {
				return event, false
			}
			traffic.mu.Lock()
			traffic.streamed++
			traffic.mu.Unlock()
			return event, true
		}), nil
	})
	return traffic
}
