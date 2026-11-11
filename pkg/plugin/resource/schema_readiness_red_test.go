package resource

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
)

// Reuse the native discovery HTTP fixture and real SDK lifecycle/admission.
// Only the native API responses and client construction belong to this fixture.
func newSchemaReadinessProvider(t *testing.T) (*refreshHTTPFixture, *kubernetesProvider, resourcev2.AccessRoute) {
	t.Helper()
	fixture, client := newRefreshHTTPFixture(t)
	fixture.mu.Lock()
	fixture.documents["/api/v1/namespaces/selected/pods"] = `{"apiVersion":"v1","kind":"PodList","metadata":{"resourceVersion":"collection:1"},"items":[{"apiVersion":"v1","kind":"Pod","metadata":{"name":"browse-me","namespace":"selected","uid":"pod-uid","resourceVersion":"pod:1"},"spec":{"containers":[{"name":"app","image":"fixture:v1"}]}}]}`
	fixture.mu.Unlock()

	endpoint := client.DiscoveryClient.RESTClient().Get().AbsPath("/").URL()
	var err error
	client.DynamicClient, err = dynamic.NewForConfig(&rest.Config{Host: endpoint.String()})
	require.NoError(t, err)

	provider := refreshTestProvider()
	connection := sdktypes.Connection{ID: "schema-readiness", Name: "Schema readiness fixture"}
	controller, err := resourcev2.NewController(resourcev2.Config[clients.ClientSet]{
		DynamicSources:      true,
		Catalog:             provider.catalog,
		ResolveRegistration: provider.registration,
		Lifecycle: &resourcev2.Lifecycle[clients.ClientSet]{
			LoadConnections: func(context.Context) ([]sdktypes.Connection, error) {
				return []sdktypes.Connection{connection}, nil
			},
			CreateClient: func(context.Context, sdktypes.Connection) (*clients.ClientSet, error) {
				return client, nil
			},
			DestroyClient: provider.connections.DestroyClient,
			OnStart:       provider.startNativeConnection,
			OnStop: func(_ context.Context, connection sdktypes.Connection, _ *clients.ClientSet) error {
				provider.retireNativeCatalog(connection.ID)
				return nil
			},
		},
	})
	require.NoError(t, err)
	provider.Controller = controller
	t.Cleanup(func() { require.NoError(t, controller.Close()) })
	_, err = controller.LoadConnections(context.Background())
	require.NoError(t, err)
	return fixture, provider, resourcev2.AccessRoute{Connection: connection.ID}
}

func schemaReadinessBrowse(ctx context.Context, provider *kubernetesProvider, route resourcev2.AccessRoute) (resourcev2.SourcePage, error) {
	status, err := provider.StartConnection(ctx, route.Connection)
	if err != nil {
		return resourcev2.SourcePage{}, err
	}
	if status.Status != sdktypes.ConnectionStatusConnected {
		return resourcev2.SourcePage{}, fmt.Errorf("connection returned %q instead of connected", status.Status)
	}
	catalog, err := provider.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
	if err != nil {
		return resourcev2.SourcePage{}, err
	}
	return provider.Enumerate(resourcev2.WithCatalogRevision(ctx, catalog.Revision), resourcev2.EnumerateRequest{
		Target: resourcev2.ReadTarget{
			Route: route, Provider: catalog.Provider, Authority: "fixture-host-authority",
			Type: "k8s:/pods", Scope: nativeTestOneOf("selected"), Representation: "kubernetes.object.v1/v1",
		},
		PageSize: 2,
	})
}

func schemaReadinessAssertPod(t *testing.T, fixture *refreshHTTPFixture, page resourcev2.SourcePage) {
	t.Helper()
	require.Len(t, page.Records, 1)
	require.Nil(t, page.NextCursor)
	require.Equal(t, "complete", page.Coverage.Kind)
	record := page.Records[0]
	require.Equal(t, "browse-me", record.Reference.Address.ID)
	require.Equal(t, []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "selected"}}, record.Reference.Address.Scope)
	require.NotNil(t, record.Reference.Incarnation)
	require.Equal(t, "pod-uid", *record.Reference.Incarnation)
	require.NotNil(t, record.SourceRevision)
	require.Equal(t, "pod:1", *record.SourceRevision)
	require.Len(t, record.Body.Map["spec"].Map["containers"].List, 1)
	require.Equal(t, "fixture:v1", record.Body.Map["spec"].Map["containers"].List[0].Map["image"].String)
	require.Equal(t, 1, fixture.count("/api/v1/namespaces/selected/pods"), "browsing must acquire the selected native collection")
}

func schemaReadinessOpenAPIRequests(fixture *refreshHTTPFixture) int {
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	total := 0
	for path, count := range fixture.requests {
		if strings.HasPrefix(path, "/openapi/") {
			total += count
		}
	}
	return total
}

func TestSchemaReadinessConnectAndBrowseIssueNoOpenAPI(t *testing.T) {
	for _, test := range []struct {
		name   string
		status int
		body   string
	}{
		{name: "forbidden", status: http.StatusForbidden, body: `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","code":403}`},
		{name: "not_found", status: http.StatusNotFound, body: `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"NotFound","code":404}`},
		{name: "invalid_document", status: http.StatusOK, body: `not an OpenAPI document`},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture, provider, route := newSchemaReadinessProvider(t)
			fixture.mu.Lock()
			fixture.hook = func(w http.ResponseWriter, r *http.Request) bool {
				if !strings.HasPrefix(r.URL.Path, "/openapi/") {
					return false
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
				return true
			}
			fixture.mu.Unlock()

			page, err := schemaReadinessBrowse(context.Background(), provider, route)
			require.NoError(t, err, "unavailable optional schema must not prevent connection or native browsing")
			schemaReadinessAssertPod(t, fixture, page)
			require.Zero(t, schemaReadinessOpenAPIRequests(fixture), "connection and raw browsing must not request unconsumed OpenAPI documents")
		})
	}
}

func TestSchemaReadinessBrowseDoesNotWaitForSlowOpenAPI(t *testing.T) {
	fixture, provider, route := newSchemaReadinessProvider(t)
	entered := make(chan struct{}, 1)
	fixture.mu.Lock()
	fixture.hook = func(_ http.ResponseWriter, r *http.Request) bool {
		if !strings.HasPrefix(r.URL.Path, "/openapi/") {
			return false
		}
		select {
		case entered <- struct{}{}:
		default:
		}
		<-r.Context().Done()
		return true
	}
	fixture.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	type result struct {
		page resourcev2.SourcePage
		err  error
	}
	done := make(chan result, 1)
	go func() {
		page, err := schemaReadinessBrowse(ctx, provider, route)
		done <- result{page: page, err: err}
	}()

	// RED is forbidden schema work before browsing, not a latency threshold.
	// Timeouts only guard deadlocks; the OpenAPI handler never releases data.
	select {
	case out := <-done:
		require.NoError(t, out.err)
		schemaReadinessAssertPod(t, fixture, out.page)
		require.Zero(t, schemaReadinessOpenAPIRequests(fixture))
	case <-entered:
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("native startup did not stop after cancellation")
		}
		t.Fatal("native connection requested undemanded OpenAPI before raw browsing could complete")
	case <-time.After(5 * time.Second):
		t.Fatal("native connection and browsing did not complete")
	}
}
