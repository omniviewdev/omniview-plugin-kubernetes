package resource

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func schemaDemandRequest(t *testing.T, p *kubernetesProvider, route resourcev2.AccessRoute, token string) resourcev2.SchemaRequest {
	t.Helper()
	catalog, err := p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route})
	require.NoError(t, err)
	for _, descriptor := range catalog.Types {
		if descriptor.Type == token {
			for _, representation := range descriptor.Representations {
				if representation.ID == descriptor.DefaultRepresentation {
					return resourcev2.SchemaRequest{Route: route, Type: token, Target: resourcev2.SchemaTarget{Representation: &representation}}
				}
			}
		}
	}
	t.Fatalf("missing schema target %s", token)
	return resourcev2.SchemaRequest{}
}

func expireDemandedSchema(p *kubernetesProvider, route resourcev2.AccessRoute) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, entry := range p.catalogs[route.Connection].schemas.entries {
		entry.nextRefresh = time.Time{}
	}
}

func awaitSchemaEvent(t *testing.T, event <-chan struct{}) {
	t.Helper()
	select {
	case <-event:
	case <-time.After(5 * time.Second):
		t.Fatal("schema operation did not reach its synchronization event")
	}
}

func TestNativeSchemaDemandCachesRootsAndExactReferences(t *testing.T) {
	f, p, route := newSchemaReadinessProvider(t)
	f.mu.Lock()
	f.documents["/api/v1"] = `{"groupVersion":"v1","resources":[{"name":"pods","kind":"Pod","namespaced":true,"verbs":["get","list"]},{"name":"nodes","kind":"Node","verbs":["get","list"]}]}`
	f.documents["/openapi/v3/api/v1"] = `{"openapi":"3.0.0","components":{"schemas":{"native.Pod":{"type":"object","x-kubernetes-group-version-kind":[{"group":"","version":"v1","kind":"Pod"}]},"native.Node":{"type":"object","x-kubernetes-group-version-kind":[{"group":"","version":"v1","kind":"Node"}]}}}}`
	f.mu.Unlock()
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	require.Zero(t, schemaReadinessOpenAPIRequests(f))
	podRequest := schemaDemandRequest(t, p, route, "k8s:/pods")
	pod, err := p.ResolveSchema(context.Background(), podRequest)
	require.NoError(t, err)
	require.Equal(t, "available", pod.State)
	require.Equal(t, "#/components/schemas/native.Pod", pod.Root)
	node, err := p.ResolveSchema(context.Background(), schemaDemandRequest(t, p, route, "k8s:/nodes"))
	require.NoError(t, err)
	require.Equal(t, "#/components/schemas/native.Node", node.Root)
	require.Equal(t, pod.DocumentRef, node.DocumentRef)
	repeated, err := p.ResolveSchema(context.Background(), podRequest)
	require.NoError(t, err)
	require.Equal(t, pod, repeated)
	require.Equal(t, 1, schemaReadinessOpenAPIRequests(f), "sequential roots and fresh repeat must share one demanded GV document")
	document, err := p.GetSchemaDocument(context.Background(), route, *pod.DocumentRef)
	require.NoError(t, err)
	require.Equal(t, *pod.DocumentRef, document.Reference)
	wrong := *pod.DocumentRef
	wrong.Revision = "not-the-held-revision"
	_, err = p.GetSchemaDocument(context.Background(), route, wrong)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	bad := *podRequest.Target.Representation
	bad.Revision = "not-the-current-format"
	_, err = p.ResolveSchema(context.Background(), resourcev2.SchemaRequest{Route: route, Type: podRequest.Type, Target: resourcev2.SchemaTarget{Representation: &bad}})
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	require.Equal(t, 1, schemaReadinessOpenAPIRequests(f), "invalid format must not fetch")
}

func TestNativeSchemaDemandRevalidatesWithoutCatalogOrAuthorityChange(t *testing.T) {
	f, p, route := newSchemaReadinessProvider(t)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	request := schemaDemandRequest(t, p, route, "k8s:refresh.example/widgets")
	original := p.catalogs[route.Connection]
	missing, err := p.ResolveSchema(context.Background(), request)
	require.NoError(t, err)
	require.Equal(t, "unavailable", missing.State)
	f.mu.Lock()
	f.documents["/openapi/v3/apis/refresh.example/v1"] = `{"components":{"schemas":{"changed.Widget":{"type":"object","x-kubernetes-group-version-kind":[{"group":"refresh.example","version":"v1","kind":"Widget"}]}}}}`
	f.mu.Unlock()
	fresh, err := p.ResolveSchema(context.Background(), request)
	require.NoError(t, err)
	require.Equal(t, missing, fresh, "negative freshness must also coalesce repeated demand")
	expireDemandedSchema(p, route)
	available, err := p.ResolveSchema(context.Background(), request)
	require.NoError(t, err)
	require.Equal(t, "available", available.State)
	require.Equal(t, "#/components/schemas/changed.Widget", available.Root)
	require.Same(t, original, p.catalogs[route.Connection])
	expireRefresh(p, route.Connection)
	_, err = p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route, Refresh: true})
	require.NoError(t, err)
	require.Same(t, original, p.catalogs[route.Connection], "schema never enters support revision")
	retained := p.schemaBudget.used
	expireDemandedSchema(p, route)
	_, err = p.ResolveSchema(context.Background(), request)
	require.NoError(t, err)
	require.Equal(t, retained, p.schemaBudget.used, "identical revalidation must release its superseded lease")
	f.mu.Lock()
	delete(f.documents, "/openapi/v3/apis/refresh.example/v1")
	f.mu.Unlock()
	expireDemandedSchema(p, route)
	unavailable, err := p.ResolveSchema(context.Background(), request)
	require.NoError(t, err)
	require.Equal(t, "unavailable", unavailable.State)
	_, err = p.GetSchemaDocument(context.Background(), route, *available.DocumentRef)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err), "failed revalidation cannot advertise old bytes as current")
	require.Zero(t, p.schemaBudget.used)
	require.Same(t, original, p.catalogs[route.Connection])
}

func TestNativeSchemaDemandIsolatesRouteAliasesAndReconnect(t *testing.T) {
	f, p, route := newSchemaReadinessProvider(t)
	f.mu.Lock()
	f.documents["/openapi/v3/api/v1"] = schemaBudgetFixture("")
	f.mu.Unlock()
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	request := schemaDemandRequest(t, p, route, "k8s:/pods")
	binding, err := p.ResolveSchema(context.Background(), request)
	require.NoError(t, err)
	alias := resourcev2.AccessRoute{Connection: "schema-alias"}
	require.NoError(t, p.ApplyConnections(context.Background(), []types.Connection{{ID: route.Connection, Name: "Schema readiness fixture"}, {ID: alias.Connection}}))
	_, err = p.StartConnection(context.Background(), alias.Connection)
	require.NoError(t, err)
	_, err = p.GetSchemaDocument(context.Background(), alias, *binding.DocumentRef)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err), "shared bytes are not a route grant")
	other, err := p.ResolveSchema(context.Background(), schemaDemandRequest(t, p, alias, "k8s:/pods"))
	require.NoError(t, err)
	require.Equal(t, binding.DocumentRef, other.DocumentRef)
	require.Equal(t, 2, schemaReadinessOpenAPIRequests(f), "aliases independently acquire native access")
	require.Equal(t, len(schemaBudgetFixture("")), p.schemaBudget.used, "independently admitted aliases may share immutable content accounting")
	_, err = p.StopConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	_, err = p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	_, err = p.GetSchemaDocument(context.Background(), route, *binding.DocumentRef)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err), "reconnect cannot inherit a prior-generation reference")
	_, err = p.ResolveSchema(context.Background(), request)
	require.NoError(t, err)
	require.Equal(t, 3, schemaReadinessOpenAPIRequests(f))
}

func TestNativeSchemaDemandCoalescesWaitersAndCancelsLastOwner(t *testing.T) {
	f, p, route := newSchemaReadinessProvider(t)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	request := schemaDemandRequest(t, p, route, "k8s:/pods")
	entered, canceled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var once sync.Once
	f.mu.Lock()
	f.hook = func(w http.ResponseWriter, r *http.Request) bool {
		if !strings.HasPrefix(r.URL.Path, "/openapi/") {
			return false
		}
		once.Do(func() { close(entered) })
		select {
		case <-release:
			fmt.Fprint(w, schemaBudgetFixture(""))
		case <-r.Context().Done():
			close(canceled)
		}
		return true
	}
	f.mu.Unlock()
	firstCtx, cancelFirst := context.WithCancel(context.Background())
	defer cancelFirst()
	first, second := make(chan error, 1), make(chan error, 1)
	go func() { _, err := p.ResolveSchema(firstCtx, request); first <- err }()
	awaitSchemaEvent(t, entered)
	go func() {
		binding, err := p.ResolveSchema(context.Background(), request)
		if err == nil && binding.State != "available" {
			err = fmt.Errorf("binding state %q", binding.State)
		}
		second <- err
	}()
	require.Eventually(t, func() bool {
		p.mu.RLock()
		defer p.mu.RUnlock()
		entry := p.catalogs[route.Connection].schemas.entries[schema.GroupVersion{Version: "v1"}]
		return entry != nil && entry.fetch != nil && entry.fetch.waiters == 2
	}, 5*time.Second, time.Millisecond)
	cancelFirst()
	require.ErrorIs(t, <-first, context.Canceled)
	select {
	case <-canceled:
		t.Fatal("one canceled waiter canceled another owner's native acquisition")
	default:
	}
	close(release)
	require.NoError(t, <-second)
	require.Equal(t, 1, schemaReadinessOpenAPIRequests(f))

	expireDemandedSchema(p, route)
	entered, canceled = make(chan struct{}), make(chan struct{})
	once = sync.Once{}
	release = make(chan struct{})
	lastCtx, cancelLast := context.WithCancel(context.Background())
	go func() { _, err := p.ResolveSchema(lastCtx, request); first <- err }()
	awaitSchemaEvent(t, entered)
	cancelLast()
	require.ErrorIs(t, <-first, context.Canceled)
	awaitSchemaEvent(t, canceled)
	f.mu.Lock()
	f.hook = nil
	f.documents["/openapi/v3/api/v1"] = schemaBudgetFixture("")
	f.mu.Unlock()
	recovered, err := p.ResolveSchema(context.Background(), request)
	require.NoError(t, err, "caller cancellation must not become cached unavailable enrichment")
	require.Equal(t, "available", recovered.State)
}

func TestNativeDemandedSlowSchemaDoesNotBlockBrowseAndRetirement(t *testing.T) {
	f, p, route := newSchemaReadinessProvider(t)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	request := schemaDemandRequest(t, p, route, "k8s:/pods")
	entered, canceled := make(chan struct{}), make(chan struct{})
	f.mu.Lock()
	f.hook = func(_ http.ResponseWriter, r *http.Request) bool {
		if !strings.HasPrefix(r.URL.Path, "/openapi/") {
			return false
		}
		close(entered)
		<-r.Context().Done()
		close(canceled)
		return true
	}
	f.mu.Unlock()
	done := make(chan error, 1)
	go func() { _, err := p.ResolveSchema(context.Background(), request); done <- err }()
	awaitSchemaEvent(t, entered)
	browse := make(chan error, 1)
	go func() {
		page, err := schemaReadinessBrowse(context.Background(), p, route)
		if err == nil && (len(page.Records) != 1 || page.Records[0].Body.Map["spec"].Map["containers"].List[0].Map["image"].String != "fixture:v1") {
			err = fmt.Errorf("selected complete Pod body missing")
		}
		browse <- err
	}()
	select {
	case err := <-browse:
		require.NoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("demanded slow schema blocked independent raw browsing")
	}
	_, err = p.StopConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	awaitSchemaEvent(t, canceled)
	require.Error(t, <-done)
	require.Zero(t, p.schemaBudget.used)
}

func TestNativeSchemaDemandStagingBoundsAndCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered, canceled := make(chan struct{}, 8), make(chan struct{}, 8)
	var active, peak atomic.Int32
	client := nativeSchemaRESTClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/z/") {
			fmt.Fprint(w, schemaBudgetFixture("z"))
			return
		}
		current := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); current > old; old = peak.Load() {
			if peak.CompareAndSwap(old, current) {
				break
			}
		}
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		entered <- struct{}{}
		<-r.Context().Done()
		canceled <- struct{}{}
	}))
	budget := &nativeSchemaBudget{}
	done := make(chan error, 8)
	for _, group := range []string{"a", "b", "c", "d", "e", "f", "g", "h"} {
		go func(group string) {
			_, lease, err := fetchNativeSchema(ctx, client, schema.GroupVersion{Group: group, Version: "v1"}, budget)
			lease.Release()
			done <- err
		}(group)
	}
	for range nativeCatalogRequestConcurrency {
		awaitSchemaEvent(t, entered)
	}
	require.Equal(t, int32(nativeCatalogRequestConcurrency), peak.Load())
	cancel()
	for range 8 {
		require.ErrorIs(t, <-done, context.Canceled)
	}
	for range nativeCatalogRequestConcurrency {
		awaitSchemaEvent(t, canceled)
	}
	require.Empty(t, entered, "cancellation must not dispatch queued documents")
	require.Zero(t, budget.used)
	recovery, finish := context.WithTimeout(context.Background(), 5*time.Second)
	defer finish()
	_, lease, err := fetchNativeSchema(recovery, client, schema.GroupVersion{Group: "z", Version: "v1"}, budget)
	require.NoError(t, err)
	lease.Release()
	require.Zero(t, budget.used)
}

func TestNativeSchemaMissingRootDoesNotPoisonSharedGroupVersion(t *testing.T) {
	f, p, route := newSchemaReadinessProvider(t)
	f.mu.Lock()
	f.documents["/api/v1"] = `{"groupVersion":"v1","resources":[{"name":"pods","kind":"Pod","namespaced":true,"verbs":["get","list"]},{"name":"nodes","kind":"Node","verbs":["get","list"]}]}`
	f.documents["/openapi/v3/api/v1"] = `{"components":{"schemas":{"native.Node":{"type":"object","x-kubernetes-group-version-kind":[{"group":"","version":"v1","kind":"Node"}]}}}}`
	f.mu.Unlock()
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	pod, err := p.ResolveSchema(context.Background(), schemaDemandRequest(t, p, route, "k8s:/pods"))
	require.NoError(t, err)
	require.Equal(t, "unavailable", pod.State)
	node, err := p.ResolveSchema(context.Background(), schemaDemandRequest(t, p, route, "k8s:/nodes"))
	require.NoError(t, err)
	require.Equal(t, "available", node.State)
	require.Equal(t, "#/components/schemas/native.Node", node.Root)
	require.Equal(t, 1, schemaReadinessOpenAPIRequests(f), "a missing kind is not a failed shared document")
}

func TestNativeSchemaRetentionPressureIsRetryableNotCached(t *testing.T) {
	f, p, route := newSchemaReadinessProvider(t)
	document := schemaBudgetFixture("")
	p.schemaBudget.limit = len(document)
	f.mu.Lock()
	f.documents["/openapi/v3/api/v1"] = document
	f.mu.Unlock()
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	request := schemaDemandRequest(t, p, route, "k8s:/pods")
	first, err := p.ResolveSchema(context.Background(), request)
	require.NoError(t, err)
	require.Equal(t, "available", first.State)
	f.mu.Lock()
	f.documents["/openapi/v3/api/v1"] = strings.ReplaceAll(document, "native.Spec", "native.Xpec")
	f.mu.Unlock()
	expireDemandedSchema(p, route)
	pressured, err := p.ResolveSchema(context.Background(), request)
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	require.Empty(t, pressured.State, "capacity pressure must not become cached unavailable content")
	recovered, err := p.ResolveSchema(context.Background(), request)
	require.NoError(t, err)
	require.Equal(t, "available", recovered.State)
	require.NotEqual(t, first.Revision, recovered.Revision)
	require.Equal(t, 3, schemaReadinessOpenAPIRequests(f), "retry must not wait through negative schema freshness")
	require.Equal(t, len(document), p.schemaBudget.used)
}

func TestNativeSchemaCrossGroupPressurePreservesReferenceUntilWithdrawal(t *testing.T) {
	f, p, route := newSchemaReadinessProvider(t)
	f.setVersions(t, "v1")
	widgetDocument := `{"components":{"schemas":{"native.Widget":{"type":"object","x-kubernetes-group-version-kind":[{"group":"refresh.example","version":"v1","kind":"Widget"}]}}}}`
	podDocument := schemaBudgetFixture("")
	p.schemaBudget.limit = max(len(widgetDocument), len(podDocument))
	f.mu.Lock()
	f.documents["/openapi/v3/apis/refresh.example/v1"] = widgetDocument
	f.documents["/openapi/v3/api/v1"] = podDocument
	f.mu.Unlock()
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	require.Zero(t, schemaReadinessOpenAPIRequests(f))
	widgetRequest := schemaDemandRequest(t, p, route, "k8s:refresh.example/widgets")
	podRequest := schemaDemandRequest(t, p, route, "k8s:/pods")
	widget, err := p.ResolveSchema(context.Background(), widgetRequest)
	require.NoError(t, err)
	require.Equal(t, "available", widget.State)
	require.NotNil(t, widget.DocumentRef)

	// Expired freshness does not prove that a published reference is unused.
	expireDemandedSchema(p, route)
	pressured, err := p.ResolveSchema(context.Background(), podRequest)
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	require.Empty(t, pressured.State)
	held, err := p.GetSchemaDocument(context.Background(), route, *widget.DocumentRef)
	require.NoError(t, err, "cross-group pressure must preserve the outstanding exact reference")
	require.Equal(t, *widget.DocumentRef, held.Reference)
	require.Equal(t, widgetDocument, string(held.Document))
	digest := sha256.Sum256(held.Document)
	require.Equal(t, widget.DocumentRef.Revision, hex.EncodeToString(digest[:]))
	require.Equal(t, len(widgetDocument), p.schemaBudget.used)
	require.Equal(t, 2, schemaReadinessOpenAPIRequests(f), "held reference lookup must not refetch an expired document")

	// Complete discovery can prove withdrawal without guessing editor lifetime.
	f.setVersions(t, "v2")
	f.mu.Lock()
	f.documents["/openapi/v3/api/v1"] = podDocument
	f.mu.Unlock()
	expireRefresh(p, route.Connection)
	_, err = p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route, Refresh: true})
	require.NoError(t, err)
	require.Zero(t, p.schemaBudget.used, "withdrawal must release the removed group's retained bytes")
	require.Equal(t, 2, schemaReadinessOpenAPIRequests(f), "support refresh must not acquire schemas")
	_, err = p.GetSchemaDocument(context.Background(), route, *widget.DocumentRef)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	require.Equal(t, widgetDocument, string(held.Document), "retirement must not mutate an already returned document")

	pod, err := p.ResolveSchema(context.Background(), podRequest)
	require.NoError(t, err, "released capacity must admit another group without a negative-cache delay")
	require.Equal(t, "available", pod.State)
	require.NotNil(t, pod.DocumentRef)
	recovered, err := p.GetSchemaDocument(context.Background(), route, *pod.DocumentRef)
	require.NoError(t, err)
	require.Equal(t, *pod.DocumentRef, recovered.Reference)
	require.Equal(t, podDocument, string(recovered.Document))
	digest = sha256.Sum256(recovered.Document)
	require.Equal(t, pod.DocumentRef.Revision, hex.EncodeToString(digest[:]))
	require.Equal(t, len(podDocument), p.schemaBudget.used)
	require.Equal(t, 3, schemaReadinessOpenAPIRequests(f))
}

func TestNativeSchemaSupportRefreshPreservesAndRetiresExactDemand(t *testing.T) {
	f, p, route := newSchemaReadinessProvider(t)
	f.mu.Lock()
	f.documents["/openapi/v3/apis/refresh.example/v1"] = `{"components":{"schemas":{"native.Widget":{"type":"object","x-kubernetes-group-version-kind":[{"group":"refresh.example","version":"v1","kind":"Widget"}]}}}}`
	f.mu.Unlock()
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	request := schemaDemandRequest(t, p, route, "k8s:refresh.example/widgets")
	binding, err := p.ResolveSchema(context.Background(), request)
	require.NoError(t, err)
	f.setVersions(t, "v1", "v2", "v3")
	expireRefresh(p, route.Connection)
	_, err = p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route, Refresh: true})
	require.NoError(t, err)
	fresh, err := p.ResolveSchema(context.Background(), request)
	require.NoError(t, err)
	require.Equal(t, binding, fresh)
	require.Equal(t, 1, schemaReadinessOpenAPIRequests(f), "unrelated support additions must retain fresh document ownership")
	installed := p.catalogs[route.Connection]
	f.mu.Lock()
	f.fail = "/apis/refresh.example/v1"
	f.mu.Unlock()
	expireRefresh(p, route.Connection)
	_, err = p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route, Refresh: true})
	require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(err))
	require.Same(t, installed, p.catalogs[route.Connection], "partial discovery cannot prove removal or replace support")
	f.setVersions(t, "v2", "v3")
	f.mu.Lock()
	f.fail = ""
	f.mu.Unlock()
	expireRefresh(p, route.Connection)
	_, err = p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route, Refresh: true})
	require.NoError(t, err)
	_, err = p.ResolveSchema(context.Background(), request)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	_, err = p.GetSchemaDocument(context.Background(), route, *binding.DocumentRef)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	require.Zero(t, p.schemaBudget.used, "complete served-version withdrawal releases demanded bytes")
}

func TestNativeStaticSchemaFormatsNeedNoNativeSchemaOrHelmInventory(t *testing.T) {
	f, p, route := newSchemaReadinessProvider(t)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	before := f.count("")
	for _, token := range []string{auditType, editorQueryType, "helm:releases", "helm:repositories", "helm:charts"} {
		binding, err := p.ResolveSchema(context.Background(), schemaDemandRequest(t, p, route, token))
		require.NoError(t, err)
		require.Equal(t, "absent", binding.State)
	}
	require.Equal(t, before, f.count(""), "static body formats have no declared resource schema")
}
