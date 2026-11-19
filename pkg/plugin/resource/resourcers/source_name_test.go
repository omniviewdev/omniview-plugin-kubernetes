package resourcers

import (
	"context"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

// The detail page of one object opens a live source narrowed to its name: scope {namespace oneOf [ns], name oneOf [name]}. The tests
// below pin what that source does: it asks the API server for that one object (a metadata.name field selector on the LIST and on the
// WATCH, so the server sends one object and one object's events), it holds exactly that object, and it follows it until it is deleted.

var testNodesGVR = schema.GroupVersionResource{Version: "v1", Resource: "nodes"}

func oneOf(values ...string) *[]string {
	if values == nil {
		values = []string{}
	}
	return &values
}

// selection is the scope of a source: namespaces and names are the values of a oneOf, or nil for any.
func selection(namespaces, names *[]string) resource.QueryScope {
	scope := resource.QueryScope{}
	for _, entry := range []struct {
		dimension string
		values    *[]string
	}{{"namespace", namespaces}, {"name", names}} {
		if entry.values == nil {
			scope = append(scope, resource.ScopeConstraint{Dimension: entry.dimension, Match: resource.ScopeAny})
		} else {
			scope = append(scope, resource.ScopeConstraint{Dimension: entry.dimension, Match: resource.ScopeOneOf, Values: entry.values})
		}
	}
	return scope
}

func newTestNode(name string) *unstructured.Unstructured {
	node := &unstructured.Unstructured{}
	node.SetGroupVersionKind(schema.GroupVersionKind{Version: "v1", Kind: "Node"})
	node.SetName(name)
	return node
}

func withRevision(object *unstructured.Unstructured, uid, revision string) *unstructured.Unstructured {
	object.SetUID(types.UID(uid))
	object.SetResourceVersion(revision)
	return object
}

// the namespace the detail page asks about: three Pods, one of them with a namesake in another namespace
func checkoutPods() []*unstructured.Unstructured {
	return []*unstructured.Unstructured{
		withRevision(newTestPod("cart-api", "checkout"), "cart-api-uid", "1"),
		withRevision(newTestPod("cart-cache", "checkout"), "cart-cache-uid", "1"),
		withRevision(newTestPod("payment", "checkout"), "payment-uid", "1"),
		withRevision(newTestPod("cart-api", "staging"), "staging-cart-api-uid", "1"),
	}
}

func podsClient(t *testing.T, objects ...*unstructured.Unstructured) (*clients.ClientSet, *nativeTraffic) {
	t.Helper()
	runtimeObjects := make([]runtime.Object, 0, len(objects))
	for _, object := range objects {
		runtimeObjects = append(runtimeObjects, object)
	}
	cs := newFakeClientSet(defaultGVRListKinds(), runtimeObjects...)
	return cs, serveFieldSelectors(t, cs, testGVR, "Pod")
}

type openedSource struct {
	snapshot []resource.SourceObservation
	emitter  *sourceTestEmitter
}

func (s openedSource) names() []string {
	names := make([]string, 0, len(s.snapshot))
	for _, observation := range s.snapshot {
		address := observation.Record.Reference.Address
		namespace := ""
		if len(address.Scope) != 0 {
			namespace = address.Scope[0].Value
		}
		names = append(names, namespace+"/"+address.ID)
	}
	return names
}

// openSource runs the source of base over scope until its snapshot is complete and returns the snapshot.
func openSource(t *testing.T, base *KubernetesResourcerBase[MetaAccessor], cs *clients.ClientSet, scope resource.QueryScope) openedSource {
	t.Helper()
	emitter := &sourceTestEmitter{events: make(chan sourceTestEvent, 64)}
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan struct{})
	var sourceErr error
	target := testWatchTarget()
	target.Scope = scope
	go func() {
		defer close(finished)
		sourceErr = base.Source(ctx, cs, resource.SourceRequest{Target: target, Representation: testWatchRepresentation(), Limits: resource.SourceLimits{MaxBatchItems: resource.MaxSourceBatchItems}}, emitter)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-finished:
		case <-time.After(10 * time.Second):
			t.Error("source did not stop")
		}
	})
	opened := openedSource{emitter: emitter}
	for {
		select {
		case event := <-emitter.events:
			require.Nil(t, event.reset)
			opened.snapshot = append(opened.snapshot, event.observations...)
			if event.boundary {
				require.Equal(t, resource.EnumerationExhausted, event.coverage.Enumeration)
				return opened
			}
		case <-finished:
			t.Fatalf("the source ended before its snapshot was complete: %v", sourceErr)
		case <-time.After(10 * time.Second):
			t.Fatal("timed out waiting for the snapshot")
		}
	}
}

func updatePod(t *testing.T, cs *clients.ClientSet, namespace string, pod *unstructured.Unstructured, revision string) *unstructured.Unstructured {
	t.Helper()
	changed := pod.DeepCopy()
	changed.SetResourceVersion(revision)
	_, err := cs.DynamicClient.Resource(testGVR).Namespace(namespace).Update(context.Background(), changed, metav1.UpdateOptions{})
	require.NoError(t, err)
	return changed
}

func TestSourceNarrowedToAnObjectAsksTheServerForOnlyThatObject(t *testing.T) {
	cs, traffic := podsClient(t, checkoutPods()...)
	opened := openSource(t, newBaseResourcer(), cs, selection(oneOf("checkout"), oneOf("cart-api")))

	require.Equal(t, []string{"checkout/cart-api"}, opened.names(), "the snapshot holds exactly the named object, not its namesake of another namespace and not the namespace")
	require.Equal(t, "cart-api-uid", *opened.snapshot[0].Record.Reference.Incarnation)

	lists, watches := traffic.asked()
	require.NotEmpty(t, lists)
	require.NotEmpty(t, watches)
	for _, selector := range append(lists, watches...) {
		require.Equal(t, "metadata.name=cart-api", selector, "every LIST and every WATCH is narrowed by the server, none asks for the namespace")
	}
	listed, _ := traffic.answered()
	require.Equal(t, len(lists), listed, "each LIST answered with the one object: the namespace's other Pods never reached the plugin")
}

func TestSourceNarrowedToAnObjectFollowsItAndNoOtherObject(t *testing.T) {
	pods := checkoutPods()
	cs, traffic := podsClient(t, pods...)
	opened := openSource(t, newBaseResourcer(), cs, selection(oneOf("checkout"), oneOf("cart-api")))
	require.Equal(t, []string{"checkout/cart-api"}, opened.names())

	// What happens to the namespace's other Pods, and to the namesake of another namespace, is not this source's business.
	updatePod(t, cs, "checkout", pods[1], "2")
	updatePod(t, cs, "checkout", pods[2], "2")
	updatePod(t, cs, "staging", pods[3], "2")
	_, err := cs.DynamicClient.Resource(testGVR).Namespace("checkout").Create(context.Background(), withRevision(newTestPod("cart-api-2", "checkout"), "cart-api-2-uid", "1"), metav1.CreateOptions{})
	require.NoError(t, err)

	// modify: the next event of the source is the object's own change, so none of the above was delivered
	modified := updatePod(t, cs, "checkout", pods[0], "2")
	event := nextSourceTestEvent(t, opened.emitter)
	require.Len(t, event.changes, 1)
	require.Equal(t, resource.SourceChangeUpsert, event.changes[0].Kind)
	require.Equal(t, "cart-api", event.changes[0].Observation.Record.Reference.Address.ID)
	require.Equal(t, "2", *event.changes[0].Observation.Record.SourceRevision)

	// delete: the removal is signalled, with the identity the page holds it by
	require.NoError(t, cs.DynamicClient.Resource(testGVR).Namespace("checkout").Delete(context.Background(), modified.GetName(), metav1.DeleteOptions{}))
	event = nextSourceTestEvent(t, opened.emitter)
	require.Len(t, event.changes, 1)
	require.Equal(t, resource.SourceChangeRemove, event.changes[0].Kind)
	reference := event.changes[0].Reference
	require.Equal(t, "cart-api", reference.Address.ID)
	require.Equal(t, []resource.ScopeEntry{{Dimension: "namespace", Value: "checkout"}}, reference.Address.Scope)
	require.Equal(t, "cart-api-uid", *reference.Incarnation)

	// add: the object comes back (a controller recreated it) and the page has it again, under its new incarnation
	_, err = cs.DynamicClient.Resource(testGVR).Namespace("checkout").Create(context.Background(), withRevision(newTestPod("cart-api", "checkout"), "cart-api-uid-2", "3"), metav1.CreateOptions{})
	require.NoError(t, err)
	event = nextSourceTestEvent(t, opened.emitter)
	require.Len(t, event.changes, 1)
	require.Equal(t, resource.SourceChangeUpsert, event.changes[0].Kind)
	require.Equal(t, "cart-api-uid-2", *event.changes[0].Observation.Record.Reference.Incarnation)

	_, streamed := traffic.answered()
	require.Equal(t, 3, streamed, "the server streamed the object's modification, deletion and re-creation: nothing of any other object")
}

func TestSourceNarrowedToAnObjectThatIsNotThereYetStartsEmptyAndFollowsItsCreation(t *testing.T) {
	cs, _ := podsClient(t, checkoutPods()...)
	opened := openSource(t, newBaseResourcer(), cs, selection(oneOf("checkout"), oneOf("ghost")))
	require.Empty(t, opened.snapshot, "a complete, empty snapshot is how the page learns the object is not there")

	_, err := cs.DynamicClient.Resource(testGVR).Namespace("checkout").Create(context.Background(), withRevision(newTestPod("ghost", "checkout"), "ghost-uid", "1"), metav1.CreateOptions{})
	require.NoError(t, err)
	event := nextSourceTestEvent(t, opened.emitter)
	require.Len(t, event.changes, 1)
	require.Equal(t, "ghost", event.changes[0].Observation.Record.Reference.Address.ID)
}

func TestSourceNarrowedByNameAloneReadsEveryNamespaceThatHoldsIt(t *testing.T) {
	cs, traffic := podsClient(t, checkoutPods()...)
	opened := openSource(t, newBaseResourcer(), cs, selection(nil, oneOf("cart-api")))
	require.ElementsMatch(t, []string{"checkout/cart-api", "staging/cart-api"}, opened.names())
	lists, watches := traffic.asked()
	for _, selector := range append(lists, watches...) {
		require.Equal(t, "metadata.name=cart-api", selector)
	}
}

func TestSourceNarrowedToSeveralNamesWatchesEachOfThem(t *testing.T) {
	pods := checkoutPods()
	cs, traffic := podsClient(t, pods...)
	opened := openSource(t, newBaseResourcer(), cs, selection(oneOf("checkout"), oneOf("cart-api", "payment")))
	require.ElementsMatch(t, []string{"checkout/cart-api", "checkout/payment"}, opened.names())
	_, watches := traffic.asked()
	require.ElementsMatch(t, []string{"metadata.name=cart-api", "metadata.name=payment"}, watches, "one narrowed watch for each name")

	updatePod(t, cs, "checkout", pods[1], "2")
	updatePod(t, cs, "checkout", pods[2], "2")
	event := nextSourceTestEvent(t, opened.emitter)
	require.Len(t, event.changes, 1)
	require.Equal(t, "payment", event.changes[0].Observation.Record.Reference.Address.ID, "the other name's change is delivered; cart-cache's is not")
}

func TestSourcesOfOneObjectShareOneNativeWatch(t *testing.T) {
	cs, traffic := podsClient(t, checkoutPods()...)
	first := openSource(t, newBaseResourcer(), cs, selection(oneOf("checkout"), oneOf("cart-api")))
	second := openSource(t, newBaseResourcer(), cs, selection(oneOf("checkout"), oneOf("cart-api")))
	require.Equal(t, []string{"checkout/cart-api"}, second.names())
	_, watches := traffic.asked()
	require.Len(t, watches, 1, "two tabs on one Pod are one watch on the API server")

	other := openSource(t, newBaseResourcer(), cs, selection(oneOf("checkout"), oneOf("payment")))
	require.Equal(t, []string{"checkout/payment"}, other.names())
	_, watches = traffic.asked()
	require.Len(t, watches, 2, "another Pod is another narrowed watch")

	pods := checkoutPods()
	updatePod(t, cs, "checkout", pods[0], "2")
	for _, source := range []openedSource{first, second} {
		event := nextSourceTestEvent(t, source.emitter)
		require.Equal(t, "cart-api", event.changes[0].Observation.Record.Reference.Address.ID)
	}
}

// A server that does not honour the field selector (an aggregated API that ignores it) sends the whole namespace. The source holds its scope
// whatever the server does: the object it was asked for, and nothing else.
func TestSourceNarrowedToAnObjectHoldsOnlyThatObjectWhateverTheServerSends(t *testing.T) {
	pods := checkoutPods()
	runtimeObjects := make([]runtime.Object, 0, len(pods))
	for _, pod := range pods {
		runtimeObjects = append(runtimeObjects, pod)
	}
	cs := newFakeClientSet(defaultGVRListKinds(), runtimeObjects...)
	opened := openSource(t, newBaseResourcer(), cs, selection(oneOf("checkout"), oneOf("cart-api")))
	require.Equal(t, []string{"checkout/cart-api"}, opened.names())

	updatePod(t, cs, "checkout", pods[1], "2")
	updatePod(t, cs, "checkout", pods[0], "2")
	event := nextSourceTestEvent(t, opened.emitter)
	require.Len(t, event.changes, 1)
	require.Equal(t, "cart-api", event.changes[0].Observation.Record.Reference.Address.ID)
}

func TestSourceNarrowedToAClusterScopedObjectNeedsNoNamespace(t *testing.T) {
	nodes := []*unstructured.Unstructured{withRevision(newTestNode("worker-1"), "worker-1-uid", "1"), withRevision(newTestNode("worker-2"), "worker-2-uid", "1")}
	runtimeObjects := []runtime.Object{nodes[0], nodes[1]}
	cs := newFakeClientSet(map[schema.GroupVersionResource]string{testNodesGVR: "NodeList"}, runtimeObjects...)
	traffic := serveFieldSelectors(t, cs, testNodesGVR, "Node")
	base := NewKubernetesResourcerBase[MetaAccessor](zap.NewNop().Sugar(), testNodesGVR)

	opened := openSource(t, base, cs, resource.QueryScope{{Dimension: "name", Match: resource.ScopeOneOf, Values: oneOf("worker-2")}})
	require.Equal(t, []string{"/worker-2"}, opened.names())
	lists, watches := traffic.asked()
	for _, selector := range append(lists, watches...) {
		require.Equal(t, "metadata.name=worker-2", selector)
	}

	_, err := cs.DynamicClient.Resource(testNodesGVR).Update(context.Background(), withRevision(nodes[0].DeepCopy(), "worker-1-uid", "2"), metav1.UpdateOptions{})
	require.NoError(t, err)
	changed := withRevision(nodes[1].DeepCopy(), "worker-2-uid", "2")
	_, err = cs.DynamicClient.Resource(testNodesGVR).Update(context.Background(), changed, metav1.UpdateOptions{})
	require.NoError(t, err)
	event := nextSourceTestEvent(t, opened.emitter)
	require.Equal(t, "worker-2", event.changes[0].Observation.Record.Reference.Address.ID)

	// the whole kind, as the list reads it: any name, and no scope at all
	for _, scope := range []resource.QueryScope{{{Dimension: "name", Match: resource.ScopeAny}}, {}} {
		all := openSource(t, base, cs, scope)
		require.ElementsMatch(t, []string{"/worker-1", "/worker-2"}, all.names())
	}
}

func TestSourceScopeOfNameAnyIsTheScopeOfNamespaceAlone(t *testing.T) {
	cs, traffic := podsClient(t, checkoutPods()...)
	opened := openSource(t, newBaseResourcer(), cs, selection(oneOf("checkout"), nil))
	require.ElementsMatch(t, []string{"checkout/cart-api", "checkout/cart-cache", "checkout/payment"}, opened.names())
	lists, watches := traffic.asked()
	for _, selector := range append(lists, watches...) {
		require.Empty(t, selector, "an omitted name selects every object: no field selector")
	}
}

func TestSourceCannotBeSteeredByANameThatLooksLikeAnotherSelectorTerm(t *testing.T) {
	cs, traffic := podsClient(t, checkoutPods()...)
	hostile := "cart-api,metadata.namespace=staging"
	opened := openSource(t, newBaseResourcer(), cs, selection(oneOf("checkout"), oneOf(hostile)))
	require.Empty(t, opened.snapshot)
	lists, watches := traffic.asked()
	for _, selector := range append(lists, watches...) {
		require.Equal(t, `metadata.name=cart-api\,metadata.namespace\=staging`, selector, "the name is one value of one term: it cannot add a term")
	}
}

func TestSourceRejectsAScopeItCannotNarrowByBeforeAskingTheServer(t *testing.T) {
	empty, anyWithValues := []string{""}, []string{"cart-api"}
	for _, tc := range []struct {
		name  string
		scope resource.QueryScope
	}{
		{"empty name", selection(oneOf("checkout"), oneOf(""))},
		{"no names", selection(oneOf("checkout"), oneOf())},
		{"names without values", resource.QueryScope{{Dimension: "name", Match: resource.ScopeOneOf}}},
		{"any name with values", resource.QueryScope{{Dimension: "name", Match: resource.ScopeAny, Values: &anyWithValues}}},
		{"unknown match", resource.QueryScope{{Dimension: "name", Match: "prefix", Values: &empty}}},
		{"duplicate name", selection(oneOf("checkout"), oneOf("cart-api", "cart-api"))},
		{"a path", selection(oneOf("checkout"), oneOf("cart-api/log"))},
		{"a dot", selection(oneOf("checkout"), oneOf("."))},
		{"two dots", selection(oneOf("checkout"), oneOf(".."))},
		{"a percent", selection(oneOf("checkout"), oneOf("cart%2Fapi"))},
		{"name twice", append(selection(oneOf("checkout"), oneOf("cart-api")), resource.ScopeConstraint{Dimension: "name", Match: resource.ScopeAny})},
		{"unknown dimension", resource.QueryScope{{Dimension: "region", Match: resource.ScopeAny}}},
		{"no namespaces", selection(oneOf(), oneOf("cart-api"))},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cs, traffic := podsClient(t, checkoutPods()...)
			target := testWatchTarget()
			target.Scope = tc.scope
			emitter := &sourceTestEmitter{events: make(chan sourceTestEvent, 1)}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			err := newBaseResourcer().Source(ctx, cs, resource.SourceRequest{Target: target, Representation: testWatchRepresentation()}, emitter)
			require.Equal(t, "INVALID_REQUEST", resource.ErrorCode(err), "%v", err)
			require.Empty(t, emitter.events)
			lists, watches := traffic.asked()
			require.Empty(t, lists, "a scope that is refused costs the API server nothing")
			require.Empty(t, watches)
		})
	}
}
