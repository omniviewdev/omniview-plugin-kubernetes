package resource

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
	clienttesting "k8s.io/client-go/testing"
)

// countKind is a kind the cluster of the count tests serves.
type countKind struct {
	token      string
	gvr        schema.GroupVersionResource
	kind       string
	namespaced bool
}

func countKindOf(group, version, resource, kind string, namespaced bool) countKind {
	return countKind{token: "k8s:" + group + "/" + resource, gvr: schema.GroupVersionResource{Group: group, Version: version, Resource: resource}, kind: kind, namespaced: namespaced}
}

// theThirteenKinds are the kinds the plugin's sidebar lists.
var theThirteenKinds = []countKind{
	countKindOf("", "v1", "nodes", "Node", false),
	countKindOf("", "v1", "namespaces", "Namespace", false),
	countKindOf("", "v1", "pods", "Pod", true),
	countKindOf("apps", "v1", "deployments", "Deployment", true),
	countKindOf("apps", "v1", "statefulsets", "StatefulSet", true),
	countKindOf("apps", "v1", "daemonsets", "DaemonSet", true),
	countKindOf("apps", "v1", "replicasets", "ReplicaSet", true),
	countKindOf("batch", "v1", "jobs", "Job", true),
	countKindOf("batch", "v1", "cronjobs", "CronJob", true),
	countKindOf("", "v1", "configmaps", "ConfigMap", true),
	countKindOf("", "v1", "secrets", "Secret", true),
	countKindOf("", "v1", "services", "Service", true),
	countKindOf("networking.k8s.io", "v1", "ingresses", "Ingress", true),
}

// aCustomKind is a kind a CRD serves.
var aCustomKind = countKindOf("sample.example", "v1", "widgets", "Widget", true)

func (k countKind) apiVersion() string { return k.gvr.GroupVersion().String() }

// object is an object of the kind. A cluster-scoped kind has no namespace.
func (k countKind) object(namespace, name string) *unstructured.Unstructured {
	object := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": k.apiVersion(), "kind": k.kind,
		"metadata": map[string]any{"name": name, "uid": "uid-" + namespace + "-" + name, "resourceVersion": "7"},
	}}
	if k.namespaced {
		object.SetNamespace(namespace)
	}
	return object
}

// many is n objects of the kind in the namespace.
func (k countKind) many(namespace string, n int) []*unstructured.Unstructured {
	objects := make([]*unstructured.Unstructured, n)
	for i := range objects {
		objects[i] = k.object(namespace, fmt.Sprintf("%s-%04d", strings.ToLower(k.kind), i))
	}
	return objects
}

// countRequest is one request the cluster received.
type countRequest struct {
	Method    string
	Path      string
	Query     url.Values
	Accept    string
	Resource  string
	Namespace string
	Watch     bool
	// Returned is the number of objects the answer held.
	Returned int
}

func (r countRequest) limit() string { return r.Query.Get("limit") }

// countEvent is one change a watch delivers.
type countEvent struct {
	Type   string                     `json:"type"`
	Object *unstructured.Unstructured `json:"object"`
}

// countAPI is the API server of the count tests. It holds the objects of each resource and answers a List as kube-apiserver does: it honours limit and continue, tells a chunked List
// how many objects remain (remainingItemCount) unless the request carries a label or a field selector, and serves a WATCH (with the initial events of a streaming list) to an informer.
// A test says what it refuses (forbidden), what it leaves out (omitRemaining) and what it holds back (gate); every request is logged.
type countAPI struct {
	t *testing.T

	mu          sync.Mutex
	collections map[string]*countCollection
	requests    []countRequest
	revision    int
	watchers    map[*countWatcher]struct{}

	// omitRemaining answers a chunked List with no remainingItemCount, as an aggregated API does.
	omitRemaining bool
	// ignoreLimit answers every List with the whole collection, as a server does that cannot chunk.
	ignoreLimit bool
	// remainingReported, when it is not zero, is the remainingItemCount the server reports for an unfiltered chunked List instead of the true one: an aggregated API that counts something else.
	remainingReported int64
	// expireContinue answers every List that carries a continue token with 410 Gone, as kube-apiserver does once the snapshot a token names is compacted away.
	expireContinue bool
	// remainingUnderSelector, when it is not zero, is the remainingItemCount the server gives a chunked List that has a selector: a server that counts what the selector then discards.
	remainingUnderSelector int64
	// forbidden holds the resources (by `group/version/resource`) every List of which is refused with 403, as RBAC does for a user who may not list them.
	forbidden map[string]bool
	// gate is called with a List before it is answered, outside the lock; it may block, and returns when the client has gone.
	gate func(context.Context, countRequest)

	inflight, peak int
}

type countCollection struct {
	kind    countKind
	objects []*unstructured.Unstructured
}

type countWatcher struct {
	resource string
	events   chan countEvent
}

func newCountAPI(t *testing.T, kinds ...countKind) *countAPI {
	t.Helper()
	api := &countAPI{t: t, collections: map[string]*countCollection{}, forbidden: map[string]bool{}, watchers: map[*countWatcher]struct{}{}}
	for _, kind := range kinds {
		api.collections[kind.apiVersion()+"/"+kind.gvr.Resource] = &countCollection{kind: kind}
	}
	return api
}

func (api *countAPI) collection(kind countKind) *countCollection {
	collection := api.collections[kind.apiVersion()+"/"+kind.gvr.Resource]
	require.NotNil(api.t, collection, "the cluster does not serve %s", kind.gvr.Resource)
	return collection
}

// with puts objects in the cluster.
func (api *countAPI) with(kind countKind, objects ...*unstructured.Unstructured) *countAPI {
	api.mu.Lock()
	defer api.mu.Unlock()
	collection := api.collection(kind)
	collection.objects = append(collection.objects, objects...)
	return api
}

// add makes an object, and tells the watches of its kind.
func (api *countAPI) add(kind countKind, object *unstructured.Unstructured) {
	api.mu.Lock()
	defer api.mu.Unlock()
	collection := api.collection(kind)
	collection.objects = append(collection.objects, object)
	api.broadcast(kind, "ADDED", object)
}

// remove deletes an object, and tells the watches of its kind.
func (api *countAPI) remove(kind countKind, namespace, name string) {
	api.mu.Lock()
	defer api.mu.Unlock()
	collection := api.collection(kind)
	for i, object := range collection.objects {
		if object.GetNamespace() == namespace && object.GetName() == name {
			collection.objects = append(collection.objects[:i], collection.objects[i+1:]...)
			api.broadcast(kind, "DELETED", object)
			return
		}
	}
	api.t.Fatalf("no %s %s/%s to remove", kind.gvr.Resource, namespace, name)
}

func (api *countAPI) broadcast(kind countKind, eventType string, object *unstructured.Unstructured) {
	api.revision++
	object = object.DeepCopy()
	object.SetResourceVersion(strconv.Itoa(1000 + api.revision))
	for watcher := range api.watchers {
		if watcher.resource == kind.apiVersion()+"/"+kind.gvr.Resource {
			watcher.events <- countEvent{Type: eventType, Object: object}
		}
	}
}

// served is a copy of the requests received so far.
func (api *countAPI) served() []countRequest {
	api.mu.Lock()
	defer api.mu.Unlock()
	return append([]countRequest(nil), api.requests...)
}

// lists are the Lists received so far (the WATCHes are not Lists), of one resource when it is named.
func (api *countAPI) lists(resource string) []countRequest {
	var lists []countRequest
	for _, request := range api.served() {
		if !request.Watch && (resource == "" || strings.HasSuffix(request.Resource, "/"+resource)) {
			lists = append(lists, request)
		}
	}
	return lists
}

// peakInflight is the most Lists the server had begun and not answered at one moment.
func (api *countAPI) peakInflight() int {
	api.mu.Lock()
	defer api.mu.Unlock()
	return api.peak
}

// countPath reads the path of a List: `/api/v1/pods`, `/apis/apps/v1/namespaces/shop/deployments`.
func countPath(path string) (groupVersion, namespace, resource string, ok bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	switch {
	case len(parts) >= 3 && parts[0] == "api":
		groupVersion, parts = parts[1], parts[2:]
	case len(parts) >= 4 && parts[0] == "apis":
		groupVersion, parts = parts[1]+"/"+parts[2], parts[3:]
	default:
		return "", "", "", false
	}
	switch {
	case len(parts) == 1:
		return groupVersion, "", parts[0], true
	case len(parts) == 3 && parts[0] == "namespaces":
		return groupVersion, parts[1], parts[2], true
	}
	return "", "", "", false
}

func (api *countAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	groupVersion, namespace, resource, ok := countPath(r.URL.Path)
	if !ok || r.Method != http.MethodGet {
		api.t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		http.NotFound(w, r)
		return
	}
	query := r.URL.Query()
	request := countRequest{Method: r.Method, Path: r.URL.Path, Query: query, Accept: r.Header.Get("Accept"), Resource: groupVersion + "/" + resource, Namespace: namespace, Watch: query.Get("watch") == "true"}
	if request.Watch {
		api.watch(w, r, request)
		return
	}
	if api.expireContinue && query.Get("continue") != "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGone)
		_ = json.NewEncoder(w).Encode(metav1.Status{TypeMeta: metav1.TypeMeta{Kind: "Status", APIVersion: "v1"}, Status: metav1.StatusFailure, Code: http.StatusGone, Reason: metav1.StatusReasonExpired, Message: "The provided continue parameter is too old"})
		return
	}
	api.mu.Lock()
	api.requests = append(api.requests, request)
	logged := len(api.requests) - 1
	api.inflight++
	api.peak = max(api.peak, api.inflight)
	gate, forbidden := api.gate, api.forbidden[request.Resource]
	api.mu.Unlock()
	defer func() {
		api.mu.Lock()
		api.inflight--
		api.mu.Unlock()
	}()
	if gate != nil {
		gate(r.Context(), request)
	}
	if r.Context().Err() != nil {
		return
	}
	if forbidden {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(metav1.Status{
			TypeMeta: metav1.TypeMeta{Kind: "Status", APIVersion: "v1"}, Status: metav1.StatusFailure, Code: http.StatusForbidden, Reason: metav1.StatusReasonForbidden,
			Message: fmt.Sprintf("%s is forbidden: User \"limited\" cannot list resource \"%s\" in API group \"\" at the cluster scope", resource, resource),
		})
		return
	}
	api.mu.Lock()
	list, err := api.list(request)
	if err == nil {
		api.requests[logged].Returned = len(list.Items)
	}
	api.mu.Unlock()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	assert.NoError(api.t, json.NewEncoder(w).Encode(list))
}

func countKey(object *unstructured.Unstructured) string {
	return object.GetNamespace() + "/" + object.GetName()
}

// list answers a List as kube-apiserver does. The caller holds the lock.
func (api *countAPI) list(request countRequest) (*unstructured.UnstructuredList, error) {
	collection, ok := api.collections[request.Resource]
	if !ok {
		return nil, fmt.Errorf("the cluster does not serve %s", request.Resource)
	}
	labelSelector, err := labels.Parse(request.Query.Get("labelSelector"))
	if err != nil {
		return nil, err
	}
	fieldSelector, err := fields.ParseSelector(request.Query.Get("fieldSelector"))
	if err != nil {
		return nil, err
	}
	filtered := labelSelector.String() != "" || fieldSelector.String() != ""
	var candidates []*unstructured.Unstructured
	for _, object := range collection.objects {
		if (request.Namespace == "" || object.GetNamespace() == request.Namespace) && labelSelector.Matches(labels.Set(object.GetLabels())) &&
			fieldSelector.Matches(fields.Set{"metadata.name": object.GetName(), "metadata.namespace": object.GetNamespace()}) {
			candidates = append(candidates, object)
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return countKey(candidates[i]) < countKey(candidates[j]) })
	if token := request.Query.Get("continue"); token != "" {
		raw, err := base64.RawURLEncoding.DecodeString(token)
		if err != nil {
			return nil, fmt.Errorf("invalid continue token")
		}
		start := sort.Search(len(candidates), func(i int) bool { return countKey(candidates[i]) > string(raw) })
		candidates = candidates[start:]
	}
	count := len(candidates)
	if limit, _ := strconv.Atoi(request.Query.Get("limit")); limit > 0 && limit < count && !api.ignoreLimit {
		count = limit
	}
	list := &unstructured.UnstructuredList{Items: []unstructured.Unstructured{}}
	list.SetAPIVersion(collection.kind.apiVersion())
	list.SetKind(collection.kind.kind + "List")
	list.SetResourceVersion(strconv.Itoa(1000 + api.revision))
	for _, object := range candidates[:count] {
		list.Items = append(list.Items, *object.DeepCopy())
	}
	if count < len(candidates) {
		list.SetContinue(base64.RawURLEncoding.EncodeToString([]byte(countKey(candidates[count-1]))))
		// kube-apiserver counts what remains only when it has no selector to apply to the objects it counts.
		switch {
		case api.omitRemaining:
		case !filtered:
			remaining := int64(len(candidates) - count)
			if api.remainingReported != 0 {
				remaining = api.remainingReported
			}
			list.SetRemainingItemCount(&remaining)
		case api.remainingUnderSelector != 0:
			remaining := api.remainingUnderSelector
			list.SetRemainingItemCount(&remaining)
		}
	}
	return list, nil
}

// watch serves a WATCH as kube-apiserver does: with sendInitialEvents the objects as they are, then a bookmark that ends them, then each change.
func (api *countAPI) watch(w http.ResponseWriter, r *http.Request, request countRequest) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "no flush", http.StatusInternalServerError)
		return
	}
	api.mu.Lock()
	api.requests = append(api.requests, request)
	collection, served := api.collections[request.Resource]
	if !served {
		api.mu.Unlock()
		http.NotFound(w, r)
		return
	}
	watcher := &countWatcher{resource: request.Resource, events: make(chan countEvent, 64)}
	api.watchers[watcher] = struct{}{}
	var initial []*unstructured.Unstructured
	if request.Query.Get("sendInitialEvents") == "true" {
		for _, object := range collection.objects {
			if request.Namespace == "" || object.GetNamespace() == request.Namespace {
				initial = append(initial, object.DeepCopy())
			}
		}
	}
	revision := strconv.Itoa(1000 + api.revision)
	api.mu.Unlock()
	defer func() {
		api.mu.Lock()
		delete(api.watchers, watcher)
		api.mu.Unlock()
	}()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	encoder := json.NewEncoder(w)
	for _, object := range initial {
		if encoder.Encode(countEvent{Type: "ADDED", Object: object}) != nil {
			return
		}
	}
	if request.Query.Get("sendInitialEvents") == "true" {
		end := &unstructured.Unstructured{Object: map[string]any{"apiVersion": collection.kind.apiVersion(), "kind": collection.kind.kind, "metadata": map[string]any{
			"resourceVersion": revision, "annotations": map[string]any{"k8s.io/initial-events-end": "true"},
		}}}
		if encoder.Encode(countEvent{Type: "BOOKMARK", Object: end}) != nil {
			return
		}
	}
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-watcher.events:
			if request.Namespace != "" && event.Object.GetNamespace() != request.Namespace {
				continue
			}
			if encoder.Encode(event) != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// client is a dynamic client of the cluster, as the plugin makes one but with no client-side rate limit, so that a request count never costs wall time.
func (api *countAPI) client() dynamic.Interface {
	api.t.Helper()
	server := httptest.NewServer(api)
	api.t.Cleanup(server.Close)
	client, err := dynamic.NewForConfig(&rest.Config{Host: server.URL, QPS: -1})
	require.NoError(api.t, err)
	return client
}

// connection is the plugin's client set for a connection to the cluster, and the registrations the plugin builds for its kinds from discovery.
func (api *countAPI) connection(kinds ...countKind) (*clients.ClientSet, map[string]resourcev2.Registration[clients.ClientSet]) {
	api.t.Helper()
	byGroup := map[string]*metav1.APIResourceList{}
	var groups []string
	for _, kind := range kinds {
		list, ok := byGroup[kind.apiVersion()]
		if !ok {
			list = &metav1.APIResourceList{GroupVersion: kind.apiVersion()}
			byGroup[kind.apiVersion()] = list
			groups = append(groups, kind.apiVersion())
		}
		list.APIResources = append(list.APIResources, metav1.APIResource{Name: kind.gvr.Resource, Kind: kind.kind, Namespaced: kind.namespaced, Verbs: metav1.Verbs{"create", "delete", "get", "list", "update", "watch"}})
	}
	discovery := &fake.FakeDiscovery{Fake: &clienttesting.Fake{}}
	for _, group := range groups {
		discovery.Resources = append(discovery.Resources, byGroup[group])
	}
	bindings, coverage, err := discoverNativeTypes(context.Background(), discovery)
	require.NoError(api.t, err)
	provider := &kubernetesProvider{logger: zap.NewNop().Sugar()}
	snapshot, err := provider.assembleNativeCatalog(context.Background(), "route", &clients.ClientSet{}, bindings, coverage, nil, nativeTestAny())
	require.NoError(api.t, err)
	client := &clients.ClientSet{DynamicClient: api.client()}
	api.t.Cleanup(client.ShutdownInformers)
	return client, snapshot.registrations
}

// countTarget is the target of a read of a kind: every namespace of it, or the namespaces named.
func countTarget(kind countKind, namespaces ...string) resourcev2.ReadTarget {
	var selected *[]string
	if len(namespaces) != 0 {
		selected = values(namespaces...)
	}
	scope := nativeTestSelection(selected, nil)
	if !kind.namespaced {
		scope = resourcev2.QueryScope{{Dimension: "name", Match: resourcev2.ScopeAny}}
	}
	return resourcev2.ReadTarget{
		Route:    resourcev2.AccessRoute{Connection: "route"},
		Provider: "kubernetes", Authority: "authority", Type: kind.token, Scope: scope, Representation: nativeRepresentationVersion + "/" + kind.apiVersion(),
	}
}

// countRead asks the registration of a kind how many objects there are in the namespaces (every namespace when none is named): the page of one, as the sidebar will ask.
func countRead(ctx context.Context, registrations map[string]resourcev2.Registration[clients.ClientSet], client *clients.ClientSet, kind countKind, namespaces ...string) (resourcev2.SourcePage, error) {
	return registrations[kind.token].Enumerate(ctx, client, resourcev2.EnumerateRequest{Target: countTarget(kind, namespaces...), PageSize: 1})
}

// requireCount checks a page's count: its kind and its value.
func requireCount(t *testing.T, page resourcev2.SourcePage, kind string, value int) {
	t.Helper()
	require.Equal(t, kind, page.Count.Kind)
	if kind == "unknown" {
		assert.Nil(t, page.Count.Value, "an unknown count has no value")
		return
	}
	require.NotNil(t, page.Count.Value, "%s count has a value", kind)
	assert.Equal(t, strconv.Itoa(value), *page.Count.Value)
}
