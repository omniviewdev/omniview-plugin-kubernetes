package resource

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/tools/cache"
)

// The count of a page: how many objects the selection of a read has, said as precisely as the API server lets the plugin know it and no more precisely. The wire's Count has three kinds: exact (the page, or a live
// source, holds them all), estimate (the API server's remainingItemCount, which its own documentation calls an estimate) and unknown (the server said nothing and the plugin does not guess).
// The tests run the plugin's reads against an API server that answers a List as kube-apiserver does, and look at what the plugin asked it as well as at what the plugin said.

func widgetsEnumerate(scope resourcev2.QueryScope, pageSize uint32) resourcev2.EnumerateRequest {
	request := nativeTestEnumerate(scope)
	request.PageSize = pageSize
	return request
}

func widgetsAPI(t *testing.T, populations ...nativeChunkPopulation) (*countAPI, func(request resourcev2.EnumerateRequest) (resourcev2.SourcePage, error)) {
	t.Helper()
	api := newCountAPI(t, aCustomKind)
	for _, population := range populations {
		api.with(aCustomKind, aCustomKind.many(population.namespace, population.count)...)
	}
	client := api.client()
	return api, func(request resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
		return NativeEnumerate(context.Background(), client, nativeTestGVR, true, request, nativeTestRepresentation())
	}
}

func TestTheCountOfAChunkedListIsTheServersRemainingItemCountPlusTheItemsRead(t *testing.T) {
	t.Run("every namespace", func(t *testing.T) {
		_, enumerate := widgetsAPI(t, nativeChunkPopulation{"shop", 25}, nativeChunkPopulation{"billing", 10})
		page, err := enumerate(widgetsEnumerate(nativeTestAny(), 1))
		require.NoError(t, err)
		require.Len(t, page.Records, 1)
		requireCount(t, page, "estimate", 35)
		require.NotNil(t, page.NextCursor, "the read has more to give")
	})
	t.Run("one namespace", func(t *testing.T) {
		api, enumerate := widgetsAPI(t, nativeChunkPopulation{"shop", 25}, nativeChunkPopulation{"billing", 10})
		page, err := enumerate(widgetsEnumerate(nativeTestSelection(values("billing"), nil), 1))
		require.NoError(t, err)
		requireCount(t, page, "estimate", 10)
		page, err = enumerate(widgetsEnumerate(nativeTestSelection(values("shop"), nil), 1))
		require.NoError(t, err)
		requireCount(t, page, "estimate", 25)
		require.Len(t, api.lists("widgets"), 2, "one List for each namespace asked")
	})
	t.Run("a page of many", func(t *testing.T) {
		_, enumerate := widgetsAPI(t, nativeChunkPopulation{"shop", 25})
		page, err := enumerate(widgetsEnumerate(nativeTestAny(), 10))
		require.NoError(t, err)
		require.Len(t, page.Records, 10)
		requireCount(t, page, "estimate", 25)
	})
}

func TestTheCountOfAListThatEndsInThePageIsExactAndSoIsTheCountOfNothing(t *testing.T) {
	t.Run("one object, read by a page of one", func(t *testing.T) {
		_, enumerate := widgetsAPI(t, nativeChunkPopulation{"shop", 1})
		page, err := enumerate(widgetsEnumerate(nativeTestAny(), 1))
		require.NoError(t, err)
		require.Len(t, page.Records, 1)
		requireCount(t, page, "exact", 1)
		require.Nil(t, page.NextCursor)
	})
	t.Run("a collection that fits the page", func(t *testing.T) {
		_, enumerate := widgetsAPI(t, nativeChunkPopulation{"shop", 25})
		page, err := enumerate(widgetsEnumerate(nativeTestAny(), 256))
		require.NoError(t, err)
		require.Len(t, page.Records, 25)
		requireCount(t, page, "exact", 25)
	})
	t.Run("an empty collection is zero, exactly, not unknown", func(t *testing.T) {
		api, enumerate := widgetsAPI(t)
		page, err := enumerate(widgetsEnumerate(nativeTestAny(), 1))
		require.NoError(t, err)
		require.Empty(t, page.Records)
		requireCount(t, page, "exact", 0)
		require.Len(t, api.lists("widgets"), 1, "zero is read, not assumed")
	})
	t.Run("an empty namespace", func(t *testing.T) {
		_, enumerate := widgetsAPI(t, nativeChunkPopulation{"shop", 5})
		page, err := enumerate(widgetsEnumerate(nativeTestSelection(values("billing"), nil), 1))
		require.NoError(t, err)
		requireCount(t, page, "exact", 0)
	})
	t.Run("a selection of no namespace has no member, and costs no request", func(t *testing.T) {
		api, enumerate := widgetsAPI(t, nativeChunkPopulation{"shop", 5})
		page, err := enumerate(widgetsEnumerate(nativeTestSelection(values(), nil), 1))
		require.NoError(t, err)
		require.Empty(t, page.Records)
		requireCount(t, page, "exact", 0)
		require.Empty(t, api.served())
	})
}

// A cluster-scoped kind has no namespace to narrow by and its collection is read whole.
func TestTheCountOfAClusterScopedKind(t *testing.T) {
	nodes := theThirteenKinds[0]
	api := newCountAPI(t, nodes).with(nodes, nodes.many("", 7)...)
	client := api.client()
	enumerate := func(pageSize uint32) (resourcev2.SourcePage, error) {
		request := resourcev2.EnumerateRequest{Target: countTarget(nodes), PageSize: pageSize}
		return NativeEnumerate(context.Background(), client, nodes.gvr, false, request, resourcev2.Representation{ID: request.Target.Representation, Revision: request.Target.Representation})
	}
	page, err := enumerate(1)
	require.NoError(t, err)
	requireCount(t, page, "estimate", 7)
	page, err = enumerate(256)
	require.NoError(t, err)
	requireCount(t, page, "exact", 7)
}

// remainingItemCount is absent on some servers (an aggregated API may not set it): then the count is unknown, and the plugin neither guesses nor reads the collection to count it.
func TestTheCountIsUnknownWhenTheServerDoesNotSayAndTheCollectionIsNotReadToFindOut(t *testing.T) {
	api, enumerate := widgetsAPI(t, nativeChunkPopulation{"shop", 25})
	api.omitRemaining = true
	page, err := enumerate(widgetsEnumerate(nativeTestAny(), 1))
	require.NoError(t, err)
	require.Len(t, page.Records, 1)
	requireCount(t, page, "unknown", 0)
	require.NotNil(t, page.NextCursor)
	lists := api.lists("widgets")
	require.Len(t, lists, 1, "no second read to count with")
	assert.Equal(t, "1", lists[0].limit())
}

func TestTheCountOfALabelQueryIsExactOnlyWhenTheQueryEndsInThePage(t *testing.T) {
	query := func(selector string, pageSize uint32) resourcev2.NativeQueryRequest {
		return resourcev2.NativeQueryRequest{
			Target: widgetsEnumerate(nativeTestAny(), pageSize).Target, Language: nativeLabelSelectorLanguage, PageSize: pageSize,
			Query: resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"labelSelector": {Kind: "string", String: selector}}},
		}
	}
	// every third widget carries app=api: 4 of the 10
	t.Run("more matches than the page: unknown, though the server says a number", func(t *testing.T) {
		api, _ := widgetsAPI(t, nativeChunkPopulation{"shop", 10})
		collection := api.collection(aCustomKind)
		for i, object := range collection.objects {
			object.SetLabels(map[string]string{"app": map[bool]string{true: "api", false: "other"}[i%3 == 0]})
		}
		// a server that counts what remains under a selector would count something else than the matches: whatever it says is not the count
		api.remainingUnderSelector = 999
		page, err := NativeQuery(context.Background(), api.client(), nativeTestGVR, true, query("app=api", 2), nativeTestRepresentation())
		require.NoError(t, err)
		require.Len(t, page.Records, 2)
		require.NotNil(t, page.NextCursor)
		requireCount(t, page, "unknown", 0)
	})
	t.Run("all the matches in the page: exact", func(t *testing.T) {
		api, _ := widgetsAPI(t, nativeChunkPopulation{"shop", 10})
		for i, object := range api.collection(aCustomKind).objects {
			object.SetLabels(map[string]string{"app": map[bool]string{true: "api", false: "other"}[i%3 == 0]})
		}
		page, err := NativeQuery(context.Background(), api.client(), nativeTestGVR, true, query("app=api", 50), nativeTestRepresentation())
		require.NoError(t, err)
		require.Len(t, page.Records, 4)
		requireCount(t, page, "exact", 4)
	})
	t.Run("no match: exact zero", func(t *testing.T) {
		api, _ := widgetsAPI(t, nativeChunkPopulation{"shop", 10})
		page, err := NativeQuery(context.Background(), api.client(), nativeTestGVR, true, query("app=none", 50), nativeTestRepresentation())
		require.NoError(t, err)
		requireCount(t, page, "exact", 0)
	})
}

// A name narrows the read with a field selector, under which the server counts nothing.
func TestTheCountOfAReadNarrowedToNamesIsExactWhenTheReadEndsInThePage(t *testing.T) {
	api, enumerate := widgetsAPI(t, nativeChunkPopulation{"shop", 5}, nativeChunkPopulation{"billing", 5})
	api.remainingUnderSelector = 999
	page, err := enumerate(widgetsEnumerate(nativeTestSelection(values("shop", "billing"), values("widget-0001", "widget-0003")), 50))
	require.NoError(t, err)
	require.Len(t, page.Records, 4)
	requireCount(t, page, "exact", 4)
	page, err = enumerate(widgetsEnumerate(nativeTestSelection(values("shop"), values("widget-0001")), 1))
	require.NoError(t, err)
	requireCount(t, page, "exact", 1)
	page, err = enumerate(widgetsEnumerate(nativeTestSelection(values("shop"), values("no-such")), 1))
	require.NoError(t, err)
	requireCount(t, page, "exact", 0)
	// several names, a page of one: the page does not end the read
	page, err = enumerate(widgetsEnumerate(nativeTestSelection(values("shop", "billing"), values("widget-0001", "widget-0003")), 1))
	require.NoError(t, err)
	require.NotNil(t, page.NextCursor)
	requireCount(t, page, "unknown", 0)
}

func TestTheCountOfSeveralNamespacesIsKnownWhenThePageHoldsThemAll(t *testing.T) {
	_, enumerate := widgetsAPI(t, nativeChunkPopulation{"a", 3}, nativeChunkPopulation{"b", 0}, nativeChunkPopulation{"c", 4})
	scope := nativeTestSelection(values("a", "b", "c"), nil)
	page, err := enumerate(widgetsEnumerate(scope, 50))
	require.NoError(t, err)
	require.Len(t, page.Records, 7)
	requireCount(t, page, "exact", 7)
	// a page of one reads the first namespace that has an object, and says nothing of the others: unknown, not the first namespace's count
	page, err = enumerate(widgetsEnumerate(scope, 1))
	require.NoError(t, err)
	require.NotNil(t, page.NextCursor)
	requireCount(t, page, "unknown", 0)
}

// The pages that follow the first know only what they hold.
func TestTheCountOfAContinuedPageIsUnknown(t *testing.T) {
	_, enumerate := widgetsAPI(t, nativeChunkPopulation{"shop", 25})
	first, err := enumerate(widgetsEnumerate(nativeTestAny(), 10))
	require.NoError(t, err)
	requireCount(t, first, "estimate", 25)
	request := widgetsEnumerate(nativeTestAny(), 10)
	request.Cursor = first.NextCursor
	second, err := enumerate(request)
	require.NoError(t, err)
	require.Len(t, second.Records, 10)
	requireCount(t, second, "unknown", 0)
	request.Cursor = second.NextCursor
	last, err := enumerate(request)
	require.NoError(t, err)
	require.Len(t, last.Records, 5)
	requireCount(t, last, "unknown", 0)
}

// A server that cannot chunk answers with the collection. The plugin does not hand a page the whole of it to count it: that is an error, as it was, never a count made by reading everything.
func TestAServerThatIgnoresLimitIsNotReadToTheEndToCount(t *testing.T) {
	api, enumerate := widgetsAPI(t, nativeChunkPopulation{"shop", 25})
	api.ignoreLimit = true
	_, err := enumerate(widgetsEnumerate(nativeTestAny(), 1))
	require.Error(t, err)
	assert.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	require.Len(t, api.lists("widgets"), 1)
}

// What a count read is: one List with limit 1 and nothing else, that decodes one object, however many there are.
func TestACountReadIsOneListOfOneWhateverTheSizeOfTheKind(t *testing.T) {
	for _, size := range []int{1, 2, 300} {
		t.Run(fmt.Sprintf("%d objects", size), func(t *testing.T) {
			api, enumerate := widgetsAPI(t, nativeChunkPopulation{"shop", size})
			page, err := enumerate(widgetsEnumerate(nativeTestAny(), 1))
			require.NoError(t, err)
			require.Len(t, page.Records, 1)
			lists := api.lists("")
			require.Len(t, lists, 1, "exactly one request")
			assert.Equal(t, "1", lists[0].limit())
			assert.Empty(t, lists[0].Query.Get("continue"))
			assert.Empty(t, lists[0].Query.Get("labelSelector"))
			assert.Empty(t, lists[0].Query.Get("fieldSelector"))
			assert.Empty(t, lists[0].Query.Get("resourceVersion"), "a read that sets no resourceVersion is served by the storage, which counts; the watch cache ignores limit")
			assert.Equal(t, 1, lists[0].Returned, "one object decoded")
		})
	}
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Through the registration the plugin hands the host: what the host asks of the thirteen kinds the sidebar lists.

func thirteenAPI(t *testing.T) *countAPI {
	t.Helper()
	api := newCountAPI(t, theThirteenKinds...)
	for _, kind := range theThirteenKinds {
		if !kind.namespaced {
			api.with(kind, kind.many("", 3)...)
			continue
		}
		api.with(kind, kind.many("shop", 6)...)
		api.with(kind, kind.many("billing", 2)...)
	}
	return api
}

func TestEachOfTheThirteenKindsCountsItsObjectsInEveryNamespaceAndInOne(t *testing.T) {
	api := thirteenAPI(t)
	client, registrations := api.connection(theThirteenKinds...)
	for _, kind := range theThirteenKinds {
		t.Run(kind.gvr.Resource, func(t *testing.T) {
			page, err := countRead(context.Background(), registrations, client, kind)
			require.NoError(t, err)
			require.Len(t, page.Records, 1)
			if kind.namespaced {
				requireCount(t, page, "estimate", 8)
				for namespace, want := range map[string]int{"shop": 6, "billing": 2} {
					page, err := countRead(context.Background(), registrations, client, kind, namespace)
					require.NoError(t, err)
					requireCount(t, page, "estimate", want)
				}
				page, err = countRead(context.Background(), registrations, client, kind, "empty-kinds")
				require.NoError(t, err)
				requireCount(t, page, "exact", 0)
			} else {
				requireCount(t, page, "estimate", 3)
			}
		})
	}
	// each of the 13 kinds was asked once for every namespace, once for each of two namespaces and once for an empty one; nothing was asked twice
	seen := map[string]int{}
	for _, request := range api.lists("") {
		assert.Equal(t, "1", request.limit(), request.Path)
		seen[request.Path]++
	}
	for path, n := range seen {
		assert.Equal(t, 1, n, "%s asked %d times", path, n)
	}
}

// The registration the host drives for Secrets: a count read decodes one Secret, and what leaves the plugin is the projection of it, not a value.
func TestACountReadOfSecretsSendsNoValue(t *testing.T) {
	secrets := theThirteenKinds[10]
	require.Equal(t, "secrets", secrets.gvr.Resource)
	api := newCountAPI(t, secrets)
	for _, secret := range secretFixtures() {
		api.with(secrets, secret.object())
	}
	client, registrations := api.connection(secrets)

	page, err := countRead(context.Background(), registrations, client, secrets)
	require.NoError(t, err)
	requireCount(t, page, "estimate", len(secretFixtures()))
	requireSecretPage(t, page, "billing/credentials")
	requireNoValue(t, "the page of a count read", pageOnTheWire(t, page))

	// one request, one Secret, as a count read of any kind is
	lists := api.lists("secrets")
	require.Len(t, lists, 1)
	assert.Equal(t, "1", lists[0].limit())
	assert.Equal(t, 1, lists[0].Returned)

	// the answer is kept for the next read, as the wire holds it: the page made again from it is the same projection, with no more in it
	again, err := countRead(context.Background(), registrations, client, secrets)
	require.NoError(t, err)
	require.Len(t, api.lists("secrets"), 1, "answered from the kept answer")
	requireCount(t, again, "estimate", len(secretFixtures()))
	requireSecretPage(t, again, "billing/credentials")
	requireNoValue(t, "the kept page of a count read", pageOnTheWire(t, again))

	// the same for the Secrets of one namespace, whose first Secret holds values and an annotation that carries them whole
	page, err = countRead(context.Background(), registrations, client, secrets, "shop")
	require.NoError(t, err)
	requireCount(t, page, "estimate", 6)
	requireSecretPage(t, page, "shop/blob")
	requireNoValue(t, "the page of a count read of one namespace", pageOnTheWire(t, page))
}

// A kind the user may not list answers FORBIDDEN, which the host maps, and never a zero; and the kinds beside it are counted.
func TestAKindTheUserMayNotListIsForbiddenNotZeroAndBreaksNoOtherCount(t *testing.T) {
	api := thirteenAPI(t)
	secrets := theThirteenKinds[10]
	api.forbidden[secrets.apiVersion()+"/secrets"] = true
	client, registrations := api.connection(theThirteenKinds...)

	type answer struct {
		page resourcev2.SourcePage
		err  error
	}
	answers := make([]answer, len(theThirteenKinds))
	var wg sync.WaitGroup
	for i, kind := range theThirteenKinds {
		wg.Add(1)
		go func() {
			defer wg.Done()
			answers[i].page, answers[i].err = countRead(context.Background(), registrations, client, kind)
		}()
	}
	wg.Wait()
	for i, kind := range theThirteenKinds {
		if kind.gvr.Resource != "secrets" {
			require.NoError(t, answers[i].err, kind.gvr.Resource)
			assert.Contains(t, []string{"estimate", "exact"}, answers[i].page.Count.Kind, kind.gvr.Resource)
			continue
		}
		require.Error(t, answers[i].err)
		assert.True(t, apierrors.IsForbidden(answers[i].err), "the cause is the server's 403")
		classified := (&kubeErrorClassifier{}).ClassifyError(answers[i].err)
		assert.Equal(t, "FORBIDDEN", resourcev2.ErrorCode(classified), "the code the host maps; the page has no count to read")
		assert.Empty(t, answers[i].page.Records)
		assert.Nil(t, answers[i].page.Count.Value, "the answer to a kind that cannot be listed is never a number")
	}
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Many kinds at once: a few at a time, and no waiting once the caller has gone.

// held is a gate for the Lists of an API server: every List waits until released.
type held struct {
	arrived chan countRequest
	release chan struct{}
	once    sync.Once
}

// holdLists makes the Lists of the server wait. It is called once the server exists, so that the test lets them go before the server is closed, however the test ends.
func holdLists(t *testing.T, api *countAPI) *held {
	t.Helper()
	h := &held{arrived: make(chan countRequest, 64), release: make(chan struct{})}
	api.mu.Lock()
	api.gate = func(ctx context.Context, request countRequest) {
		h.arrived <- request
		select {
		case <-h.release:
		case <-ctx.Done():
		}
	}
	api.mu.Unlock()
	t.Cleanup(h.free)
	return h
}

// free lets every List go, now and later.
func (h *held) free() { h.once.Do(func() { close(h.release) }) }

func (h *held) waitFor(t *testing.T, n int) []countRequest {
	t.Helper()
	var got []countRequest
	deadline := time.After(10 * time.Second)
	for len(got) < n {
		select {
		case request := <-h.arrived:
			got = append(got, request)
		case <-deadline:
			t.Fatalf("%d of %d Lists reached the server", len(got), n)
		}
	}
	return got
}

// quiet asserts that no further List reaches the server for a while.
func (h *held) quiet(t *testing.T, d time.Duration) {
	t.Helper()
	select {
	case request := <-h.arrived:
		t.Fatalf("a List reached the server while its room was taken: %s", request.Path)
	case <-time.After(d):
	}
}

func TestThirteenCountReadsReachTheServerFourAtATime(t *testing.T) {
	api := thirteenAPI(t)
	client, registrations := api.connection(theThirteenKinds...)
	hold := holdLists(t, api)

	pages := make([]resourcev2.SourcePage, len(theThirteenKinds))
	errs := make([]error, len(theThirteenKinds))
	var wg sync.WaitGroup
	for i, kind := range theThirteenKinds {
		wg.Add(1)
		go func() {
			defer wg.Done()
			pages[i], errs[i] = countRead(context.Background(), registrations, client, kind)
		}()
	}
	hold.waitFor(t, clients.CountConcurrency)
	hold.quiet(t, 200*time.Millisecond)
	assert.Equal(t, clients.CountConcurrency, api.peakInflight())

	// the rest follow as rooms free, still four at most
	hold.free()
	wg.Wait()
	for i, kind := range theThirteenKinds {
		require.NoError(t, errs[i], kind.gvr.Resource)
		assert.NotEqual(t, "unknown", pages[i].Count.Kind, kind.gvr.Resource)
	}
	assert.Len(t, api.lists(""), len(theThirteenKinds))
	assert.LessOrEqual(t, api.peakInflight(), clients.CountConcurrency)
	assert.Equal(t, 4, clients.CountConcurrency, "the limit the plugin states")
}

func TestACountReadThatIsWaitingForARoomStopsWaitingWhenItsCallerGoesAndNeverAsks(t *testing.T) {
	api := thirteenAPI(t)
	client, registrations := api.connection(theThirteenKinds...)
	hold := holdLists(t, api)

	var holders sync.WaitGroup
	for _, kind := range theThirteenKinds[:clients.CountConcurrency] {
		holders.Add(1)
		go func() {
			defer holders.Done()
			_, _ = countRead(context.Background(), registrations, client, kind)
		}()
	}
	hold.waitFor(t, clients.CountConcurrency)

	waiting, cancel := context.WithCancel(context.Background())
	results := make(chan error, 9)
	for _, kind := range theThirteenKinds[clients.CountConcurrency:] {
		go func() {
			_, err := countRead(waiting, registrations, client, kind)
			results <- err
		}()
	}
	hold.quiet(t, 100*time.Millisecond)
	cancel()
	for range theThirteenKinds[clients.CountConcurrency:] {
		select {
		case err := <-results:
			require.Error(t, err)
			assert.True(t, errors.Is(err, context.Canceled), "the caller's own cancellation, got %v", err)
		case <-time.After(5 * time.Second):
			t.Fatal("a count read kept waiting after its caller was gone")
		}
	}
	hold.free()
	holders.Wait()
	assert.Len(t, api.lists(""), clients.CountConcurrency, "no cancelled read ever asked")
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// A sidebar that draws again does not ask again.

func TestACountReadRepeatedWithinTheStalenessIsNotAskedAgain(t *testing.T) {
	api := thirteenAPI(t)
	client, registrations := api.connection(theThirteenKinds...)
	pods, services := theThirteenKinds[2], theThirteenKinds[11]

	first, err := countRead(context.Background(), registrations, client, pods)
	require.NoError(t, err)
	for range 5 {
		again, err := countRead(context.Background(), registrations, client, pods)
		require.NoError(t, err)
		assert.Equal(t, first, again, "the answer the first read got: the same revision, the same count, the same record")
	}
	assert.Len(t, api.lists("pods"), 1, "one List for six reads")

	// another kind, another namespace and another page size are other questions
	_, err = countRead(context.Background(), registrations, client, services)
	require.NoError(t, err)
	_, err = countRead(context.Background(), registrations, client, pods, "shop")
	require.NoError(t, err)
	assert.Len(t, api.lists("pods"), 2)
	assert.Len(t, api.lists("services"), 1)
	_, err = registrations[pods.token].Enumerate(context.Background(), client, resourcev2.EnumerateRequest{Target: countTarget(pods), PageSize: 256})
	require.NoError(t, err)
	assert.Len(t, api.lists("pods"), 3, "a page of many is a read of the list, not a count")
	_, err = registrations[pods.token].Enumerate(context.Background(), client, resourcev2.EnumerateRequest{Target: countTarget(pods), PageSize: 256})
	require.NoError(t, err)
	assert.Len(t, api.lists("pods"), 4, "and is asked every time")
}

// The answer a read gets is its own: changing it does not change what the next read is given.
func TestTheAnswerOfACountReadIsNotSharedWithTheReadsThatFollow(t *testing.T) {
	api := thirteenAPI(t)
	client, registrations := api.connection(theThirteenKinds...)
	pods := theThirteenKinds[2]

	first, err := countRead(context.Background(), registrations, client, pods)
	require.NoError(t, err)
	want, err := countRead(context.Background(), registrations, client, pods)
	require.NoError(t, err)
	first.Records[0].Body.Map["kind"] = resourcev2.Value{Kind: "string", String: "Tampered"}
	first.Records[0].Reference.Address.Scope[0].Value = "tampered"
	require.NotNil(t, first.Count.Value, "a count read of a kind that has objects has a count")
	*first.Count.Value = "0"
	third, err := countRead(context.Background(), registrations, client, pods)
	require.NoError(t, err)
	assert.Equal(t, want, third)
	assert.Equal(t, "Pod", third.Records[0].Body.Map["kind"].String)
}

func TestIdenticalCountReadsAtTheSameTimeAskOnce(t *testing.T) {
	api := thirteenAPI(t)
	client, registrations := api.connection(theThirteenKinds...)
	hold := holdLists(t, api)
	pods := theThirteenKinds[2]

	var wg sync.WaitGroup
	pages := make([]resourcev2.SourcePage, 6)
	for i := range pages {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var err error
			pages[i], err = countRead(context.Background(), registrations, client, pods)
			assert.NoError(t, err)
		}()
	}
	hold.waitFor(t, 1)
	hold.quiet(t, 150*time.Millisecond)
	hold.free()
	wg.Wait()
	assert.Len(t, api.lists("pods"), 1)
	for _, page := range pages {
		assert.Equal(t, pages[0], page)
	}
}

// An answer that failed is not kept: the next read asks, and a reader who is let in after a refusal is not refused for what an earlier one was.
func TestAFailedCountReadIsNotKept(t *testing.T) {
	api := thirteenAPI(t)
	pods := theThirteenKinds[2]
	api.forbidden[pods.apiVersion()+"/pods"] = true
	client, registrations := api.connection(theThirteenKinds...)

	_, err := countRead(context.Background(), registrations, client, pods)
	require.Error(t, err)
	_, err = countRead(context.Background(), registrations, client, pods)
	require.Error(t, err)
	assert.Len(t, api.lists("pods"), 2, "a refusal is asked again, not remembered")

	api.mu.Lock()
	delete(api.forbidden, pods.apiVersion()+"/pods")
	api.mu.Unlock()
	page, err := countRead(context.Background(), registrations, client, pods)
	require.NoError(t, err)
	requireCount(t, page, "estimate", 8)
}

// The count read of a kind is a read of its list, with the credentials of the connection: a client replaced with new credentials never answers with what the old ones saw.
func TestTheCountsOfAClientThatWasReplacedAreNotServedToTheNewOne(t *testing.T) {
	api := thirteenAPI(t)
	client, registrations := api.connection(theThirteenKinds...)
	pods := theThirteenKinds[2]
	_, err := countRead(context.Background(), registrations, client, pods)
	require.NoError(t, err)

	client.ShutdownInformers() // what RefreshClient does before it replaces the clients
	client.DynamicClient = api.client()
	client.ResetInformerLifecycle()
	_, err = countRead(context.Background(), registrations, client, pods)
	require.NoError(t, err)
	assert.Len(t, api.lists("pods"), 2)
}

func TestALabelQueryAndAPageOfManyAreNeitherLimitedNorKept(t *testing.T) {
	api := thirteenAPI(t)
	client, registrations := api.connection(theThirteenKinds...)
	pods := theThirteenKinds[2]
	query := resourcev2.NativeQueryRequest{
		Target: countTarget(pods), Language: nativeLabelSelectorLanguage, PageSize: 1,
		Query: resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"labelSelector": {Kind: "string", String: "app=none"}}},
	}
	for range 3 {
		_, err := registrations[pods.token].NativeQuery(context.Background(), client, query)
		require.NoError(t, err)
	}
	assert.Len(t, api.lists("pods"), 3)
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// An open list counts itself: the plugin's source for a kind holds every object of it, and a read of its count is that, exactly and as of now.

func openSource(t *testing.T, client *clients.ClientSet, kind countKind, namespace string) *clients.InformerLease {
	t.Helper()
	lease, err := client.AcquireInformer(context.Background(), namespace, kind.gvr, cache.ResourceEventHandlerFuncs{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = lease.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	require.True(t, cache.WaitForCacheSync(ctx.Done(), lease.HasSynced), "the source did not sync")
	return lease
}

func eventually(t *testing.T, what string, condition func() bool) {
	t.Helper()
	require.Eventually(t, condition, 10*time.Second, 5*time.Millisecond, what)
}

func TestTheCountOfAKindWhoseSourceIsOpenIsExactAndLive(t *testing.T) {
	api := thirteenAPI(t)
	client, registrations := api.connection(theThirteenKinds...)
	pods := theThirteenKinds[2]

	// nobody has it open: the server's word
	page, err := countRead(context.Background(), registrations, client, pods)
	require.NoError(t, err)
	requireCount(t, page, "estimate", 8)
	require.Len(t, api.lists("pods"), 1)

	// the source opens. The read that follows gets the page the server gave a moment ago (kept for the staleness), with the count of the source on it: exact
	lease := openSource(t, client, pods, "")
	page, err = countRead(context.Background(), registrations, client, pods)
	require.NoError(t, err)
	requireCount(t, page, "exact", 8)

	// and the count follows the cluster as the source does: no poll and no List. The page is still the old one, and the count is not.
	api.add(pods, pods.object("shop", "late"))
	eventually(t, "the source sees the new Pod", func() bool { return len(lease.Informer.GetStore().List()) == 9 })
	page, err = countRead(context.Background(), registrations, client, pods)
	require.NoError(t, err)
	requireCount(t, page, "exact", 9)
	api.remove(pods, "shop", "late")
	api.remove(pods, "billing", "pod-0000")
	eventually(t, "the source sees both go", func() bool { return len(lease.Informer.GetStore().List()) == 7 })
	page, err = countRead(context.Background(), registrations, client, pods)
	require.NoError(t, err)
	requireCount(t, page, "exact", 7)
	assert.Len(t, api.lists("pods"), 1, "the count of an open kind is the source's: the only List is the first read's")

	// the count of one namespace is the count of its objects in the source
	for namespace, want := range map[string]int{"shop": 6, "billing": 1, "nowhere": 0} {
		page, err = countRead(context.Background(), registrations, client, pods, namespace)
		require.NoError(t, err)
		requireCount(t, page, "exact", want)
	}
	// and a page of many says it as well
	page, err = registrations[pods.token].Enumerate(context.Background(), client, resourcev2.EnumerateRequest{Target: countTarget(pods), PageSize: 3})
	require.NoError(t, err)
	require.Len(t, page.Records, 3)
	requireCount(t, page, "exact", 7)

	// the source closes: nothing holds the kind, and the count is the server's again
	require.NoError(t, lease.Close())
	page, err = registrations[pods.token].Enumerate(context.Background(), client, resourcev2.EnumerateRequest{Target: countTarget(pods), PageSize: 3})
	require.NoError(t, err)
	requireCount(t, page, "estimate", 7)
}

func TestTheCountOfAClusterScopedKindWhoseSourceIsOpenIsExact(t *testing.T) {
	api := thirteenAPI(t)
	client, registrations := api.connection(theThirteenKinds...)
	nodes := theThirteenKinds[0]
	openSource(t, client, nodes, "")
	page, err := countRead(context.Background(), registrations, client, nodes)
	require.NoError(t, err)
	requireCount(t, page, "exact", 3)
}

// A source that follows some namespaces counts those and no others: what it does not hold it does not say.
func TestAnOpenSourceCountsOnlyWhatItHolds(t *testing.T) {
	api := thirteenAPI(t)
	client, registrations := api.connection(theThirteenKinds...)
	pods := theThirteenKinds[2]
	openSource(t, client, pods, "shop")

	page, err := countRead(context.Background(), registrations, client, pods, "shop")
	require.NoError(t, err)
	requireCount(t, page, "exact", 6)
	// every namespace, and a namespace beside the one it holds, are not what it holds: the server's word
	page, err = countRead(context.Background(), registrations, client, pods)
	require.NoError(t, err)
	requireCount(t, page, "estimate", 8)
	page, err = countRead(context.Background(), registrations, client, pods, "billing")
	require.NoError(t, err)
	requireCount(t, page, "estimate", 2)
	page, err = countRead(context.Background(), registrations, client, pods, "billing", "shop")
	require.NoError(t, err)
	requireCount(t, page, "unknown", 0)

	openSource(t, client, pods, "billing")
	page, err = countRead(context.Background(), registrations, client, pods, "billing", "shop")
	require.NoError(t, err)
	requireCount(t, page, "exact", 8)
}

// A source that narrows to one name does not hold the collection, and a source that has not synced holds a part of it: neither says a count.
func TestASourceThatIsNotTheWholeCollectionIsNotItsCount(t *testing.T) {
	api := thirteenAPI(t)
	client, registrations := api.connection(theThirteenKinds...)
	pods := theThirteenKinds[2]
	lease, err := client.AcquireInformer(context.Background(), "shop", pods.gvr, cache.ResourceEventHandlerFuncs{}, clients.ObjectName("pod-0001"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = lease.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	require.True(t, cache.WaitForCacheSync(ctx.Done(), lease.HasSynced))
	page, err := countRead(context.Background(), registrations, client, pods, "shop")
	require.NoError(t, err)
	requireCount(t, page, "estimate", 6)
}

// The source may be a moment behind the server. A count it gives is never below the records of the page it is attached to, which the wire rejects.
func TestACountFromTheSourceNeverFallsBelowThePageItIsAttachedTo(t *testing.T) {
	services := theThirteenKinds[11]
	// the cluster holds nothing when the source opens...
	api := newCountAPI(t, services)
	client, registrations := api.connection(services)
	openSource(t, client, services, "")
	// ...and a Service appears that the source has not been told of yet
	api.with(services, services.object("shop", "new"))
	page, err := countRead(context.Background(), registrations, client, services)
	require.NoError(t, err, "a count below the page it came with is invalid on the wire")
	require.Len(t, page.Records, 1)
	requireCount(t, page, "exact", 1)
}

func TestTheStalenessOfACountIsStatedOnce(t *testing.T) {
	assert.Equal(t, 30*time.Second, clients.CountStaleness)
}
