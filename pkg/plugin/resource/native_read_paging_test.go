package resource

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	resourcepb "github.com/omniviewdev/plugin-sdk/proto/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
)

// nativeChunkAPI serves widgets the way kube-apiserver serves a chunked List.
// Objects sort by namespace, then name. A List without a continue token reads
// a new snapshot; a continue token pins that snapshot's revision and names the
// last key already returned, so it resumes after the last item of the List
// that produced it, whatever limit the next request chooses.
type nativeChunkAPI struct {
	t *testing.T

	mu        sync.Mutex
	objects   []*unstructured.Unstructured
	requests  []nativeChunkRequest
	snapshots int

	// perResponse caps the items of one response below the requested limit, as
	// a server does that filters after reading a chunk. Zero means no cap.
	perResponse int
	// ignoreLimit answers every List with the complete result and no token.
	ignoreLimit bool
	// driftRevision reports a new snapshot revision on every continued List.
	driftRevision bool
	// after runs under the server lock once request n has been answered; it may
	// change objects for the Lists that follow.
	after func(n int)
}

type nativeChunkRequest struct {
	Path     string
	Limit    int
	Continue string
	Returned int
}

func newNativeChunkAPI(t *testing.T, objects ...*unstructured.Unstructured) *nativeChunkAPI {
	t.Helper()
	api := &nativeChunkAPI{t: t, objects: objects}
	sort.Slice(api.objects, func(i, j int) bool { return nativeChunkKey(api.objects[i]) < nativeChunkKey(api.objects[j]) })
	return api
}

func nativeChunkKey(object *unstructured.Unstructured) string {
	return object.GetNamespace() + "/" + object.GetName()
}

func nativeChunkNamespace(path string) (string, bool) {
	const prefix = "/apis/sample.example/v1/"
	remainder, ok := strings.CutPrefix(path, prefix)
	if !ok {
		return "", false
	}
	if remainder == "widgets" {
		return "", true
	}
	namespace, ok := strings.CutPrefix(remainder, "namespaces/")
	if !ok {
		return "", false
	}
	namespace, ok = strings.CutSuffix(namespace, "/widgets")
	return namespace, ok && namespace != ""
}

func (api *nativeChunkAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	api.mu.Lock()
	defer api.mu.Unlock()
	assert.Equal(api.t, http.MethodGet, r.Method)
	namespace, ok := nativeChunkNamespace(r.URL.Path)
	if !ok {
		api.t.Errorf("unexpected request path %q", r.URL.Path)
		http.NotFound(w, r)
		return
	}
	query := r.URL.Query()
	limit, _ := strconv.Atoi(query.Get("limit"))
	selector, err := labels.Parse(query.Get("labelSelector"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var candidates []*unstructured.Unstructured
	for _, object := range api.objects {
		if (namespace == "" || object.GetNamespace() == namespace) && selector.Matches(labels.Set(object.GetLabels())) {
			candidates = append(candidates, object)
		}
	}
	var pinned, reported string
	if token := query.Get("continue"); token != "" {
		raw, err := base64.RawURLEncoding.DecodeString(token)
		revision, last, found := strings.Cut(string(raw), "|")
		if err != nil || !found {
			http.Error(w, "invalid continue token", http.StatusBadRequest)
			return
		}
		pinned, reported = revision, revision
		if api.driftRevision {
			reported = fmt.Sprintf("%s-drift-%d", revision, len(api.requests))
		}
		start := sort.Search(len(candidates), func(i int) bool { return nativeChunkKey(candidates[i]) > last })
		candidates = candidates[start:]
	} else {
		api.snapshots++
		pinned = fmt.Sprintf("rv-%d", api.snapshots)
		reported = pinned
	}
	count := len(candidates)
	if !api.ignoreLimit {
		if limit > 0 && limit < count {
			count = limit
		}
		if api.perResponse > 0 && api.perResponse < count {
			count = api.perResponse
		}
	}
	list := nativeTestList(candidates[:count]...)
	list.SetResourceVersion(reported)
	if count < len(candidates) {
		list.SetContinue(base64.RawURLEncoding.EncodeToString([]byte(pinned + "|" + nativeChunkKey(candidates[count-1]))))
	}
	api.requests = append(api.requests, nativeChunkRequest{Path: r.URL.Path, Limit: limit, Continue: query.Get("continue"), Returned: count})
	if api.after != nil {
		api.after(len(api.requests))
	}
	w.Header().Set("Content-Type", "application/json")
	assert.NoError(api.t, json.NewEncoder(w).Encode(list))
}

// served returns a copy of the Lists answered so far.
func (api *nativeChunkAPI) served() []nativeChunkRequest {
	api.mu.Lock()
	defer api.mu.Unlock()
	return append([]nativeChunkRequest(nil), api.requests...)
}

func nativeChunkClient(t *testing.T, api *nativeChunkAPI, wrap func(http.RoundTripper) http.RoundTripper) dynamic.Interface {
	t.Helper()
	server := httptest.NewServer(api)
	t.Cleanup(server.Close)
	client, err := dynamic.NewForConfig(&rest.Config{Host: server.URL, QPS: -1, WrapTransport: wrap})
	require.NoError(t, err)
	return client
}

type nativeChunkPopulation struct {
	namespace string
	count     int
}

// nativeChunkObjects returns count widgets per namespace named widget-0000...;
// every third carries app=api and the rest app=other.
func nativeChunkObjects(populations ...nativeChunkPopulation) []*unstructured.Unstructured {
	var objects []*unstructured.Unstructured
	for _, population := range populations {
		for i := range population.count {
			object := nativeTestObject(fmt.Sprintf("widget-%04d", i), population.namespace)
			app := "other"
			if i%3 == 0 {
				app = "api"
			}
			object.SetLabels(map[string]string{"app": app})
			objects = append(objects, object)
		}
	}
	return objects
}

func nativeChunkNamespaces(count int) []string {
	names := make([]string, count)
	for i := range names {
		names[i] = fmt.Sprintf("team-%02d", i)
	}
	return names
}

// nativeChunkEvenly spreads total widgets over the namespaces, earlier ones first.
func nativeChunkEvenly(namespaces []string, total int) []nativeChunkPopulation {
	populations := make([]nativeChunkPopulation, len(namespaces))
	for i, namespace := range namespaces {
		populations[i] = nativeChunkPopulation{namespace, total / len(namespaces)}
		if i < total%len(namespaces) {
			populations[i].count++
		}
	}
	return populations
}

func nativeChunkRecordKeys(records []resourcev2.Record) []string {
	keys := make([]string, 0, len(records))
	for _, record := range records {
		address := record.Reference.Address
		namespace := ""
		if len(address.Scope) != 0 {
			namespace = address.Scope[0].Value
		}
		keys = append(keys, namespace+"/"+address.ID)
	}
	return keys
}

type nativeChunkRun struct {
	pages        [][]string
	pagesCursors []*string
	// calls holds the Lists answered during each Enumerate call.
	calls [][]nativeChunkRequest
}

// nativeChunkFollow drives enumerate to the end the way the SDK source loop
// does: each call gets the previous call's cursor, and a repeated cursor fails.
func nativeChunkFollow(t *testing.T, api *nativeChunkAPI, enumerate func(cursor *string) (resourcev2.SourcePage, error)) nativeChunkRun {
	t.Helper()
	var run nativeChunkRun
	var cursor *string
	seen := map[string]struct{}{}
	for {
		before := len(api.served())
		page, err := enumerate(cursor)
		require.NoError(t, err)
		run.pages = append(run.pages, nativeChunkRecordKeys(page.Records))
		run.pagesCursors = append(run.pagesCursors, page.NextCursor)
		run.calls = append(run.calls, api.served()[before:])
		if page.NextCursor == nil {
			return run
		}
		_, repeated := seen[*page.NextCursor]
		require.False(t, repeated, "a source must not repeat a cursor")
		seen[*page.NextCursor] = struct{}{}
		cursor = page.NextCursor
		require.Less(t, len(run.pages), 5000, "enumeration does not terminate")
	}
}

func (run nativeChunkRun) lists() int {
	total := 0
	for _, calls := range run.calls {
		total += len(calls)
	}
	return total
}

func (run nativeChunkRun) flatten() []string {
	var keys []string
	for _, page := range run.pages {
		keys = append(keys, page...)
	}
	return keys
}

// requireNativeChunkPages checks what the consumers of a source rely on, and
// what the one-item-per-List loop also guaranteed: the pages together hold
// exactly the expected objects in order, every page but the last is full, and
// a cursor is present exactly until the last page. It also checks the sizing
// rule: each List asks for exactly the room the page has left.
func requireNativeChunkPages(t *testing.T, run nativeChunkRun, expected []string, pageSize int) {
	t.Helper()
	assert.Equal(t, expected, run.flatten())
	for i, page := range run.pages {
		if i < len(run.pages)-1 {
			assert.Len(t, page, pageSize, "page %d is not full", i)
		} else {
			assert.LessOrEqual(t, len(page), pageSize)
		}
		assert.Equal(t, i < len(run.pages)-1, run.pagesCursors[i] != nil, "cursor presence of page %d", i)
	}
	for i, calls := range run.calls {
		remaining := pageSize
		for _, list := range calls {
			assert.Equal(t, remaining, list.Limit, "call %d asked for %d with %d slots left", i, list.Limit, remaining)
			remaining -= list.Returned
		}
	}
}

func nativeChunkExpected(objects []*unstructured.Unstructured, keep func(*unstructured.Unstructured) bool) []string {
	var keys []string
	for _, object := range objects {
		if keep == nil || keep(object) {
			keys = append(keys, nativeChunkKey(object))
		}
	}
	sort.Strings(keys)
	return keys
}

func nativeChunkCeilDiv(total, size int) int { return (total + size - 1) / size }

func TestNativeEnumerateSizesEachListToTheRoomLeftInThePage(t *testing.T) {
	namespaces20 := nativeChunkNamespaces(20)
	uneven := []nativeChunkPopulation{{"team-a", 3}, {"team-b", 0}, {"team-c", 17}, {"team-d", 1}, {"team-e", 0}, {"team-f", 40}, {"team-g", 2}}
	unevenNamespaces := []string{"team-a", "team-b", "team-c", "team-d", "team-e", "team-f", "team-g"}
	scopeOf := func(namespaces []string) resourcev2.QueryScope { return nativeTestOneOf(namespaces...) }
	type scenario struct {
		name        string
		namespaced  bool
		populations []nativeChunkPopulation
		scope       resourcev2.QueryScope
		selector    string
		chains      int
		sizes       []int
	}
	small := []int{1, 2, 3, 7, 16, 256}
	large := []int{7, 16, 256}
	scenarios := []scenario{
		{"cluster scoped", false, []nativeChunkPopulation{{"", 1000}}, resourcev2.QueryScope{}, "", 1, large},
		{"all namespaces", true, nativeChunkEvenly(namespaces20, 1000), nativeTestAny(), "", 1, large},
		{"selected namespaces", true, nativeChunkEvenly(namespaces20, 1000), scopeOf(namespaces20), "", 20, large},
		{"uneven and empty namespaces", true, uneven, scopeOf(unevenNamespaces), "", 7, small},
		{"selected namespaces with empty ones last", true, []nativeChunkPopulation{{"team-a", 8}, {"team-b", 0}, {"team-c", 0}}, scopeOf([]string{"team-a", "team-b", "team-c"}), "", 3, small},
		{"label selector", true, nativeChunkEvenly(namespaces20[:5], 300), scopeOf(namespaces20[:5]), "app=api", 5, small},
		{"label selector across all namespaces", true, nativeChunkEvenly(namespaces20[:5], 300), nativeTestAny(), "app=api", 1, small},
		{"empty collection", true, nil, nativeTestAny(), "", 1, small},
	}
	for _, test := range scenarios {
		for _, pageSize := range test.sizes {
			t.Run(fmt.Sprintf("%s/page size %d", test.name, pageSize), func(t *testing.T) {
				objects := nativeChunkObjects(test.populations...)
				var keep func(*unstructured.Unstructured) bool
				if test.selector != "" {
					keep = func(object *unstructured.Unstructured) bool { return object.GetLabels()["app"] == "api" }
				}
				expected := nativeChunkExpected(objects, keep)
				api := newNativeChunkAPI(t, objects...)
				client := nativeChunkClient(t, api, nil)
				target := nativeTestEnumerate(test.scope).Target
				run := nativeChunkFollow(t, api, func(cursor *string) (resourcev2.SourcePage, error) {
					if test.selector == "" {
						return NativeEnumerate(context.Background(), client, nativeTestGVR, test.namespaced, resourcev2.EnumerateRequest{Target: target, PageSize: uint32(pageSize), Cursor: cursor}, nativeTestRepresentation())
					}
					query := parityQuery(test.selector)
					query.Target, query.PageSize, query.Cursor = target, uint32(pageSize), cursor
					return NativeQuery(context.Background(), client, nativeTestGVR, test.namespaced, query, nativeTestRepresentation())
				})
				requireNativeChunkPages(t, run, expected, pageSize)
				// One List fills a page and one List ends each namespace chain.
				assert.LessOrEqual(t, run.lists(), nativeChunkCeilDiv(len(expected), pageSize)+test.chains)
			})
		}
	}
}

func TestNativeEnumerateOneThousandObjectsNeedsFewLists(t *testing.T) {
	t.Run("one chain with the maximum page size", func(t *testing.T) {
		objects := nativeChunkObjects(nativeChunkPopulation{"", 1000})
		api := newNativeChunkAPI(t, objects...)
		client := nativeChunkClient(t, api, nil)
		request := nativeTestEnumerate(resourcev2.QueryScope{})
		request.PageSize = 256
		run := nativeChunkFollow(t, api, func(cursor *string) (resourcev2.SourcePage, error) {
			request.Cursor = cursor
			return NativeEnumerate(context.Background(), client, nativeTestGVR, false, request, nativeTestRepresentation())
		})
		sizes := make([]int, len(run.pages))
		for i, page := range run.pages {
			sizes[i] = len(page)
		}
		assert.Equal(t, []int{256, 256, 256, 232}, sizes)
		// The previous loop issued one List per object, 1,000 here.
		assert.Equal(t, 4, run.lists())
		for _, list := range api.served() {
			assert.Equal(t, 256, list.Limit)
		}
	})
	t.Run("one chain with the host page size", func(t *testing.T) {
		objects := nativeChunkObjects(nativeChunkPopulation{"", 1000})
		api := newNativeChunkAPI(t, objects...)
		client := nativeChunkClient(t, api, nil)
		request := nativeTestEnumerate(resourcev2.QueryScope{})
		request.PageSize = 16
		run := nativeChunkFollow(t, api, func(cursor *string) (resourcev2.SourcePage, error) {
			request.Cursor = cursor
			return NativeEnumerate(context.Background(), client, nativeTestGVR, false, request, nativeTestRepresentation())
		})
		assert.Len(t, run.flatten(), 1000)
		assert.Equal(t, 63, run.lists())
	})
	t.Run("selected namespaces", func(t *testing.T) {
		namespaces := nativeChunkNamespaces(8)
		objects := nativeChunkObjects(nativeChunkEvenly(namespaces, 1000)...)
		api := newNativeChunkAPI(t, objects...)
		client := nativeChunkClient(t, api, nil)
		request := nativeTestEnumerate(nativeTestOneOf(namespaces...))
		request.PageSize = 256
		run := nativeChunkFollow(t, api, func(cursor *string) (resourcev2.SourcePage, error) {
			request.Cursor = cursor
			return NativeEnumerate(context.Background(), client, nativeTestGVR, true, request, nativeTestRepresentation())
		})
		requireNativeChunkPages(t, run, nativeChunkExpected(objects, nil), 256)
		assert.LessOrEqual(t, run.lists(), 4+len(namespaces))
	})
}

func TestNativeEnumerateFillsPagesAcrossNamespacesWithExactLimits(t *testing.T) {
	objects := nativeChunkObjects(nativeChunkPopulation{"a", 3}, nativeChunkPopulation{"b", 10}, nativeChunkPopulation{"c", 0}, nativeChunkPopulation{"d", 5})
	api := newNativeChunkAPI(t, objects...)
	client := nativeChunkClient(t, api, nil)
	request := nativeTestEnumerate(nativeTestOneOf("a", "b", "c", "d"))
	request.PageSize = 8
	run := nativeChunkFollow(t, api, func(cursor *string) (resourcev2.SourcePage, error) {
		request.Cursor = cursor
		return NativeEnumerate(context.Background(), client, nativeTestGVR, true, request, nativeTestRepresentation())
	})
	requireNativeChunkPages(t, run, nativeChunkExpected(objects, nil), 8)
	var observed [][]string
	for _, calls := range run.calls {
		var steps []string
		for _, list := range calls {
			namespace, _ := nativeChunkNamespace(list.Path)
			steps = append(steps, fmt.Sprintf("%s limit=%d continued=%t", namespace, list.Limit, list.Continue != ""))
		}
		observed = append(observed, steps)
	}
	assert.Equal(t, [][]string{
		// a ends inside the page, so b asks for the five slots left and is continued.
		{"a limit=8 continued=false", "b limit=5 continued=false"},
		// b ends, the empty c costs one List, d is continued by the next page.
		{"b limit=8 continued=true", "c limit=3 continued=false", "d limit=3 continued=false"},
		{"d limit=8 continued=true"},
	}, observed)
}

func TestNativeEnumerateKeepsFillingPageFromShortServerResponses(t *testing.T) {
	objects := nativeChunkObjects(nativeChunkPopulation{"", 20})
	api := newNativeChunkAPI(t, objects...)
	api.perResponse = 3
	client := nativeChunkClient(t, api, nil)
	request := nativeTestEnumerate(resourcev2.QueryScope{})
	request.PageSize = 8
	run := nativeChunkFollow(t, api, func(cursor *string) (resourcev2.SourcePage, error) {
		request.Cursor = cursor
		return NativeEnumerate(context.Background(), client, nativeTestGVR, false, request, nativeTestRepresentation())
	})
	requireNativeChunkPages(t, run, nativeChunkExpected(objects, nil), 8)
	var limits []int
	for _, list := range api.served() {
		limits = append(limits, list.Limit)
	}
	assert.Equal(t, []int{8, 5, 2, 8, 5, 2, 8, 5}, limits)
}

func TestNativeEnumerateSourceRevisionStaysOneSnapshotWithinAnEnumeration(t *testing.T) {
	objects := nativeChunkObjects(nativeChunkPopulation{"", 20})
	t.Run("continuation pins the revision", func(t *testing.T) {
		api := newNativeChunkAPI(t, objects...)
		api.perResponse = 3
		client := nativeChunkClient(t, api, nil)
		request := nativeTestEnumerate(resourcev2.QueryScope{})
		request.PageSize = 8
		var revisions []string
		nativeChunkFollow(t, api, func(cursor *string) (resourcev2.SourcePage, error) {
			request.Cursor = cursor
			page, err := NativeEnumerate(context.Background(), client, nativeTestGVR, false, request, nativeTestRepresentation())
			if err == nil {
				require.NotNil(t, page.SourceRevision)
				revisions = append(revisions, *page.SourceRevision)
			}
			return page, err
		})
		assert.Equal(t, []string{"rv-1", "rv-1", "rv-1"}, revisions)
	})
	t.Run("a revision that changes inside a page resets", func(t *testing.T) {
		api := newNativeChunkAPI(t, objects...)
		api.perResponse = 3
		api.driftRevision = true
		client := nativeChunkClient(t, api, nil)
		request := nativeTestEnumerate(resourcev2.QueryScope{})
		request.PageSize = 8
		_, err := NativeEnumerate(context.Background(), client, nativeTestGVR, false, request, nativeTestRepresentation())
		assert.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	})
}

func TestNativeEnumerateFailsClosedWhenContinuedListIgnoresLimit(t *testing.T) {
	objects := nativeChunkObjects(nativeChunkPopulation{"", 10})
	api := newNativeChunkAPI(t, objects...)
	client := nativeChunkClient(t, api, nil)
	request := nativeTestEnumerate(resourcev2.QueryScope{})
	request.PageSize = 4
	first, err := NativeEnumerate(context.Background(), client, nativeTestGVR, false, request, nativeTestRepresentation())
	require.NoError(t, err)
	require.NotNil(t, first.NextCursor)
	// The continued request gets the complete remainder: more than it asked for.
	api.mu.Lock()
	api.ignoreLimit = true
	api.mu.Unlock()
	request.Cursor = first.NextCursor
	_, err = NativeEnumerate(context.Background(), client, nativeTestGVR, false, request, nativeTestRepresentation())
	assert.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
}

// nativeChunkBig returns a widget whose body spends two of the 262,144 nodes a
// response may hold on every element; 40,000 elements let three widgets share a
// page and 70,000 let one.
func nativeChunkBig(namespace, name string, elements int) *unstructured.Unstructured {
	object := nativeTestObject(name, namespace)
	object.Object["data"] = make([]any, elements)
	return object
}

func requireNativeChunkWire(t *testing.T, page resourcev2.SourcePage) {
	t.Helper()
	wirePage, err := resourcev2.ToProtoSourcePage(page)
	require.NoError(t, err)
	response := &resourcepb.Response{Version: resourcev2.WireVersion, Result: &resourcepb.Response_Page{Page: wirePage}}
	wire, err := proto.Marshal(response)
	require.NoError(t, err)
	require.NoError(t, resourceplugin.ValidateWire(wire, response.ProtoReflect().Descriptor()))
}

func TestNativeEnumerateWireBudgetEndsPageWithoutLosingObjects(t *testing.T) {
	t.Run("one chain", func(t *testing.T) {
		var objects []*unstructured.Unstructured
		for i := range 7 {
			objects = append(objects, nativeChunkBig("", fmt.Sprintf("big-%d", i), 40000))
		}
		api := newNativeChunkAPI(t, objects...)
		client := nativeChunkClient(t, api, nil)
		request := nativeTestEnumerate(resourcev2.QueryScope{})
		request.PageSize = 16
		run := nativeChunkFollow(t, api, func(cursor *string) (resourcev2.SourcePage, error) {
			request.Cursor = cursor
			page, err := NativeEnumerate(context.Background(), client, nativeTestGVR, false, request, nativeTestRepresentation())
			if err == nil {
				requireNativeChunkWire(t, page)
			}
			return page, err
		})
		assert.Equal(t, nativeChunkExpected(objects, nil), run.flatten())
		sizes := make([]int, len(run.pages))
		for i, page := range run.pages {
			sizes[i] = len(page)
		}
		assert.Equal(t, []int{3, 3, 1}, sizes)
		// Each full page asks for 16, learns that only three fit, and asks once
		// more for exactly those three to obtain a token that resumes after them.
		var limits []int
		for _, list := range api.served() {
			limits = append(limits, list.Limit)
		}
		assert.Equal(t, []int{16, 3, 16, 3, 16}, limits)
	})
	t.Run("page that already holds records", func(t *testing.T) {
		var objects []*unstructured.Unstructured
		for i := range 2 {
			objects = append(objects, nativeChunkBig("a", fmt.Sprintf("big-%d", i), 40000))
		}
		for i := range 5 {
			objects = append(objects, nativeChunkBig("b", fmt.Sprintf("big-%d", i), 40000))
		}
		api := newNativeChunkAPI(t, objects...)
		client := nativeChunkClient(t, api, nil)
		request := nativeTestEnumerate(nativeTestOneOf("a", "b"))
		request.PageSize = 16
		run := nativeChunkFollow(t, api, func(cursor *string) (resourcev2.SourcePage, error) {
			request.Cursor = cursor
			page, err := NativeEnumerate(context.Background(), client, nativeTestGVR, true, request, nativeTestRepresentation())
			if err == nil {
				requireNativeChunkWire(t, page)
			}
			return page, err
		})
		assert.Equal(t, nativeChunkExpected(objects, nil), run.flatten())
		sizes := make([]int, len(run.pages))
		for i, page := range run.pages {
			sizes[i] = len(page)
		}
		assert.Equal(t, []int{3, 3, 1}, sizes)
	})
	t.Run("one object per page", func(t *testing.T) {
		var objects []*unstructured.Unstructured
		for _, name := range []string{"a", "b", "c"} {
			objects = append(objects, nativeChunkBig("", name, 70000))
		}
		api := newNativeChunkAPI(t, objects...)
		client := nativeChunkClient(t, api, nil)
		request := nativeTestEnumerate(resourcev2.QueryScope{})
		request.PageSize = 256
		run := nativeChunkFollow(t, api, func(cursor *string) (resourcev2.SourcePage, error) {
			request.Cursor = cursor
			return NativeEnumerate(context.Background(), client, nativeTestGVR, false, request, nativeTestRepresentation())
		})
		assert.Equal(t, [][]string{{"/a"}, {"/b"}, {"/c"}}, run.pages)
	})
}

func TestNativeEnumerateRepeatedListReplacesTheOneItCouldNotUse(t *testing.T) {
	var objects []*unstructured.Unstructured
	for _, name := range []string{"a", "b", "c"} {
		objects = append(objects, nativeChunkBig("", name, 70000))
	}
	api := newNativeChunkAPI(t, objects...)
	client := nativeChunkClient(t, api, nil)
	// The first answer holds a, b and c, of which only a fits. Before the List is
	// repeated for a alone, a is deleted: the repeated answer holds only b, and
	// its token resumes after b. Nothing of the first answer may be kept, or the
	// page would hold a while the token skipped b.
	api.after = func(n int) {
		if n == 1 {
			api.objects = api.objects[1:]
		}
	}
	request := nativeTestEnumerate(resourcev2.QueryScope{})
	request.PageSize = 256
	run := nativeChunkFollow(t, api, func(cursor *string) (resourcev2.SourcePage, error) {
		request.Cursor = cursor
		return NativeEnumerate(context.Background(), client, nativeTestGVR, false, request, nativeTestRepresentation())
	})
	assert.Equal(t, []string{"/b", "/c"}, run.flatten())
}

func TestNativeEnumerateIndividuallyOversizedObject(t *testing.T) {
	objects := []*unstructured.Unstructured{
		nativeChunkBig("", "a", 100), nativeChunkBig("", "b", 100),
		nativeChunkBig("", "huge", 140000), nativeChunkBig("", "z", 100),
	}
	api := newNativeChunkAPI(t, objects...)
	client := nativeChunkClient(t, api, nil)
	request := nativeTestEnumerate(resourcev2.QueryScope{})
	request.PageSize = 16
	first, err := NativeEnumerate(context.Background(), client, nativeTestGVR, false, request, nativeTestRepresentation())
	require.NoError(t, err)
	assert.Equal(t, []string{"/a", "/b"}, nativeChunkRecordKeys(first.Records))
	require.NotNil(t, first.NextCursor)
	request.Cursor = first.NextCursor
	_, err = NativeEnumerate(context.Background(), client, nativeTestGVR, false, request, nativeTestRepresentation())
	assert.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
}

// nativeChunkSizeCap returns a transport that refuses, as the resource response
// transport does at 32 MiB, any List of more than maxItems items.
func nativeChunkSizeCap(maxItems func(path string) int, refused *[]int) func(http.RoundTripper) http.RoundTripper {
	var mu sync.Mutex
	return func(next http.RoundTripper) http.RoundTripper {
		return nativeChunkRoundTripper(func(request *http.Request) (*http.Response, error) {
			limit, _ := strconv.Atoi(request.URL.Query().Get("limit"))
			if limit > maxItems(request.URL.Path) {
				mu.Lock()
				*refused = append(*refused, limit)
				mu.Unlock()
				return nil, resourcev2.NewError("RESOURCE_LIMIT", "The decoded native resource HTTP response exceeded 32 MiB")
			}
			return next.RoundTrip(request)
		})
	}
}

type nativeChunkRoundTripper func(*http.Request) (*http.Response, error)

func (f nativeChunkRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestNativeEnumerateHalvesListsThatExceedTheResponseBudget(t *testing.T) {
	t.Run("pages are still exact", func(t *testing.T) {
		objects := nativeChunkObjects(nativeChunkPopulation{"", 40})
		api := newNativeChunkAPI(t, objects...)
		var refused []int
		client := nativeChunkClient(t, api, nativeChunkSizeCap(func(string) int { return 4 }, &refused))
		request := nativeTestEnumerate(resourcev2.QueryScope{})
		request.PageSize = 16
		run := nativeChunkFollow(t, api, func(cursor *string) (resourcev2.SourcePage, error) {
			request.Cursor = cursor
			return NativeEnumerate(context.Background(), client, nativeTestGVR, false, request, nativeTestRepresentation())
		})
		assert.Equal(t, nativeChunkExpected(objects, nil), run.flatten())
		sizes := make([]int, len(run.pages))
		for i, page := range run.pages {
			sizes[i] = len(page)
		}
		assert.Equal(t, []int{16, 16, 8}, sizes)
		// Each call is refused at 16 and at 8, then fills its page with Lists of 4,
		// the size that proved to fit, until the room left is smaller.
		assert.Equal(t, []int{16, 8, 16, 8, 16, 8}, refused)
		var limits []int
		for _, list := range api.served() {
			limits = append(limits, list.Limit)
		}
		assert.Equal(t, []int{4, 4, 4, 4, 4, 4, 4, 4, 4, 4}, limits)
	})
	t.Run("a single object that is refused fails once the page is empty", func(t *testing.T) {
		objects := nativeChunkObjects(nativeChunkPopulation{"a", 3}, nativeChunkPopulation{"b", 5})
		api := newNativeChunkAPI(t, objects...)
		var refused []int
		maxItems := func(path string) int {
			if strings.Contains(path, "/namespaces/b/") {
				return 0
			}
			return 1000
		}
		client := nativeChunkClient(t, api, nativeChunkSizeCap(maxItems, &refused))
		request := nativeTestEnumerate(nativeTestOneOf("a", "b"))
		request.PageSize = 16
		first, err := NativeEnumerate(context.Background(), client, nativeTestGVR, true, request, nativeTestRepresentation())
		require.NoError(t, err)
		assert.Equal(t, []string{"a/widget-0000", "a/widget-0001", "a/widget-0002"}, nativeChunkRecordKeys(first.Records))
		require.NotNil(t, first.NextCursor)
		// 13 slots are left for b: the refused sizes halve down to one item.
		assert.Equal(t, []int{13, 6, 3, 1}, refused)
		refused = nil
		request.Cursor = first.NextCursor
		_, err = NativeEnumerate(context.Background(), client, nativeTestGVR, true, request, nativeTestRepresentation())
		assert.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
		assert.Equal(t, []int{16, 8, 4, 2, 1}, refused)
	})
}

// TestNativeEnumerateRandomLayoutsLoseNoObjects mixes everything that shapes a
// page: namespace layout and scope, a label selector, the page size, servers
// that answer fewer items than asked, a transport that refuses large Lists, and
// a run of objects too big to share a page. Whatever the mix, the pages must
// hold exactly the expected objects, once each and in order. The seeds are
// fixed and only the PCG stream is used, so every run is the same.
func TestNativeEnumerateRandomLayoutsLoseNoObjects(t *testing.T) {
	narrowedSeeds := 0
	for seed := range 48 {
		t.Run(fmt.Sprintf("seed %d", seed), func(t *testing.T) {
			rng := rand.New(rand.NewPCG(uint64(seed), 1))
			draw := func(n int) int { return int(rng.Uint64() % uint64(n)) }
			names := nativeChunkNamespaces(1 + draw(6))
			populations := make([]nativeChunkPopulation, len(names))
			for i, namespace := range names {
				populations[i] = nativeChunkPopulation{namespace: namespace}
				if draw(5) != 0 {
					populations[i].count = draw(21)
				}
			}
			objects := nativeChunkObjects(populations...)
			scope, selected := nativeTestAny(), map[string]bool{}
			if draw(2) == 0 {
				for _, namespace := range names {
					selected[namespace] = true
				}
			} else {
				var picked []string
				for _, namespace := range names {
					if draw(3) != 0 {
						picked = append(picked, namespace)
					}
				}
				if len(picked) == 0 {
					picked = names[:1]
				}
				for _, namespace := range picked {
					selected[namespace] = true
				}
				scope = nativeTestOneOf(picked...)
			}
			// Heavy seeds put three neighbours that cannot share a page in the scope:
			// each body spends about 90,000 of the 262,144 nodes a page may hold.
			heavy := draw(4) == 0
			selector := ""
			if !heavy && draw(4) == 0 {
				selector = "app=api"
			}
			expected := nativeChunkExpected(objects, func(object *unstructured.Unstructured) bool {
				return selected[object.GetNamespace()] && (selector == "" || object.GetLabels()["app"] == "api")
			})
			pageSizes := []int{1, 2, 3, 5, 8, 16, 64, 256}
			if heavy {
				pageSizes = pageSizes[2:]
				var inScope []*unstructured.Unstructured
				for _, object := range objects {
					if selected[object.GetNamespace()] {
						inScope = append(inScope, object)
					}
				}
				if len(inScope) >= 3 {
					first := draw(len(inScope) - 2)
					for _, object := range inScope[first : first+3] {
						object.Object["data"] = make([]any, 44000+draw(2000))
					}
				}
			}
			pageSize := pageSizes[draw(len(pageSizes))]
			api := newNativeChunkAPI(t, objects...)
			api.perResponse = []int{0, 0, 1, 2, 5}[draw(5)]
			var wrap func(http.RoundTripper) http.RoundTripper
			if draw(3) == 0 {
				largest := 1 + draw(8)
				wrap = nativeChunkSizeCap(func(string) int { return largest }, new([]int))
			}
			client := nativeChunkClient(t, api, wrap)
			target := nativeTestEnumerate(scope).Target
			run := nativeChunkFollow(t, api, func(cursor *string) (resourcev2.SourcePage, error) {
				if selector == "" {
					return NativeEnumerate(context.Background(), client, nativeTestGVR, true, resourcev2.EnumerateRequest{Target: target, PageSize: uint32(pageSize), Cursor: cursor}, nativeTestRepresentation())
				}
				query := parityQuery(selector)
				query.Target, query.PageSize, query.Cursor = target, uint32(pageSize), cursor
				return NativeQuery(context.Background(), client, nativeTestGVR, true, query, nativeTestRepresentation())
			})
			assert.Equal(t, expected, run.flatten(), "page size %d, server cap %d, transport cap %t, selector %q", pageSize, api.perResponse, wrap != nil, selector)
			for i, page := range run.pages {
				assert.LessOrEqual(t, len(page), pageSize, "page %d", i)
			}
			// A List asked again for the same position with a smaller limit is the
			// wire budget at work; count the seeds that reach it.
			for _, calls := range run.calls {
				for i := 1; i < len(calls); i++ {
					if calls[i].Path == calls[i-1].Path && calls[i].Continue == calls[i-1].Continue && calls[i].Limit < calls[i-1].Limit {
						narrowedSeeds++
						return
					}
				}
			}
		})
	}
	t.Logf("%d of 48 seeds ended a page on the wire budget", narrowedSeeds)
	assert.GreaterOrEqual(t, narrowedSeeds, 4, "too few seeds end a page on the wire budget")
}
