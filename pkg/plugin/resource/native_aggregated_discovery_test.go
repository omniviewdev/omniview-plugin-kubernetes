package resource

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	apidiscoveryv2 "k8s.io/api/apidiscovery/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const aggregatedAcceptPart = "as=APIGroupDiscoveryList"

type acceptLog struct {
	mu     sync.Mutex
	byPath map[string]string
}

func (a *acceptLog) record(path, accept string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.byPath == nil {
		a.byPath = map[string]string{}
	}
	a.byPath[path] = accept
}

func (a *acceptLog) get(path string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.byPath[path]
}

func aggregatedList(t *testing.T, groups ...apidiscoveryv2.APIGroupDiscovery) string {
	t.Helper()
	data, err := json.Marshal(apidiscoveryv2.APIGroupDiscoveryList{
		TypeMeta: metav1.TypeMeta{Kind: "APIGroupDiscoveryList", APIVersion: "apidiscovery.k8s.io/v2"},
		Items:    groups,
	})
	require.NoError(t, err)
	return string(data)
}

func aggregatedCore(t *testing.T, name string) string {
	pods := apidiscoveryv2.APIResourceDiscovery{
		Resource: "pods", SingularResource: "pod", Scope: apidiscoveryv2.ScopeNamespace,
		ResponseKind: &metav1.GroupVersionKind{Version: "v1", Kind: "Pod"}, Verbs: []string{"get", "list"},
		Subresources: []apidiscoveryv2.APISubresourceDiscovery{{
			Subresource: "log", ResponseKind: &metav1.GroupVersionKind{Version: "v1", Kind: "Pod"}, Verbs: []string{"get"},
		}},
	}
	return aggregatedList(t, apidiscoveryv2.APIGroupDiscovery{
		ObjectMeta: metav1.ObjectMeta{Name: name},
		Versions:   []apidiscoveryv2.APIVersionDiscovery{{Version: "v1", Freshness: apidiscoveryv2.DiscoveryFreshnessCurrent, Resources: []apidiscoveryv2.APIResourceDiscovery{pods}}},
	})
}

func aggregatedGroup(t *testing.T, stale map[string]bool, versions ...string) string {
	group := apidiscoveryv2.APIGroupDiscovery{ObjectMeta: metav1.ObjectMeta{Name: "refresh.example"}}
	for _, version := range versions {
		freshness := apidiscoveryv2.DiscoveryFreshnessCurrent
		if stale[version] {
			freshness = apidiscoveryv2.DiscoveryFreshnessStale
		}
		group.Versions = append(group.Versions, apidiscoveryv2.APIVersionDiscovery{
			Version: version, Freshness: freshness,
			Resources: []apidiscoveryv2.APIResourceDiscovery{{
				Resource: "widgets", SingularResource: "widget", Scope: apidiscoveryv2.ScopeNamespace,
				ResponseKind: &metav1.GroupVersionKind{Group: "refresh.example", Version: version, Kind: "Widget"}, Verbs: []string{"get", "list"},
			}},
		})
	}
	return aggregatedList(t, group)
}

// serveAggregated answers the given paths with aggregated discovery when the
// request asks for it, and records the Accept header of every request.
func serveAggregated(f *refreshHTTPFixture, accepted *acceptLog, documents map[string]string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hook = func(w http.ResponseWriter, r *http.Request) bool {
		accept := r.Header.Get("Accept")
		accepted.record(r.URL.Path, accept)
		document, ok := documents[r.URL.Path]
		if !ok || !strings.Contains(accept, aggregatedAcceptPart) {
			return false
		}
		w.Header().Set("Content-Type", "application/json;g=apidiscovery.k8s.io;v=v2;as=APIGroupDiscoveryList")
		_, _ = io.WriteString(w, document)
		return true
	}
}

func TestNativeStartUsesAggregatedDiscovery(t *testing.T) {
	f, client := newRefreshHTTPFixture(t)
	accepted := &acceptLog{}
	serveAggregated(f, accepted, map[string]string{"/api": aggregatedCore(t, ""), "/apis": aggregatedGroup(t, nil, "v1", "v2")})
	p, err := startFixtureProvider(t, client, "aggregated")
	require.NoError(t, err)
	require.Equal(t, 1, f.count("/api"))
	require.Equal(t, 1, f.count("/apis"))
	require.Equal(t, 2, f.count(""), "no per-version request is made")
	for _, accept := range []string{accepted.get("/api"), accepted.get("/apis")} {
		require.Contains(t, accept, "application/json;g=apidiscovery.k8s.io;v=v2;as=APIGroupDiscoveryList", "asks for aggregated discovery")
		require.True(t, strings.HasSuffix(accept, ",application/json"), "and accepts the legacy format: %q", accept)
	}
	snapshot := p.catalogs["aggregated"]
	require.Equal(t, "complete", snapshot.catalog.Coverage.Kind)
	pods := snapshot.bindings["k8s:/pods"]
	require.True(t, pods.API.Namespaced)
	require.Equal(t, "Pod", pods.API.Kind)
	require.Contains(t, pods.Subresources, "log", "subresources survive the conversion")
	widgets := snapshot.bindings["k8s:refresh.example/widgets"]
	require.Len(t, widgets.Served, 2)
	require.Equal(t, "refresh.example", widgets.GVR.Group)
	require.Equal(t, "v1", widgets.GVR.Version, "the first listed version is preferred")
	require.NotContains(t, snapshot.bindings, "k8s:/pods/log")
}

func TestNativeAggregatedDiscoveryMatchesPerVersionDiscovery(t *testing.T) {
	_, legacyClient := newRefreshHTTPFixture(t)
	legacy, err := startFixtureProvider(t, legacyClient, "legacy")
	require.NoError(t, err)
	f, client := newRefreshHTTPFixture(t)
	serveAggregated(f, &acceptLog{}, map[string]string{"/api": aggregatedCore(t, ""), "/apis": aggregatedGroup(t, nil, "v1", "v2")})
	aggregated, err := startFixtureProvider(t, client, "aggregated")
	require.NoError(t, err)
	require.Equal(t, legacy.catalogs["legacy"].catalog, aggregated.catalogs["aggregated"].catalog)
}

func TestNativeStartFallsBackToPerVersionDiscovery(t *testing.T) {
	f, client := newRefreshHTTPFixture(t)
	accepted := &acceptLog{}
	serveAggregated(f, accepted, nil) // the server ignores the aggregated Accept and answers with legacy lists
	p, err := startFixtureProvider(t, client, "legacy")
	require.NoError(t, err)
	require.Contains(t, accepted.get("/api"), aggregatedAcceptPart, "aggregated discovery is requested first")
	require.Equal(t, 1, f.count("/api"), "the negotiation costs no extra request")
	require.Equal(t, 1, f.count("/apis"))
	for _, path := range []string{"/api/v1", "/apis/refresh.example/v1", "/apis/refresh.example/v2"} {
		require.Equal(t, 1, f.count(path), path)
	}
	require.Equal(t, "complete", p.catalogs["legacy"].catalog.Coverage.Kind)
	require.Contains(t, p.catalogs["legacy"].bindings, "k8s:refresh.example/widgets")
}

func TestNativeDiscoveryMergesMixedFormats(t *testing.T) {
	for _, tc := range []struct {
		name        string
		documents   func(*testing.T) map[string]string
		wantFetched []string
		wantSkipped []string
	}{
		{
			"aggregated core, legacy groups",
			func(t *testing.T) map[string]string { return map[string]string{"/api": aggregatedCore(t, "")} },
			[]string{"/apis/refresh.example/v1", "/apis/refresh.example/v2"}, []string{"/api/v1"},
		},
		{
			"legacy core, aggregated groups",
			func(t *testing.T) map[string]string {
				return map[string]string{"/apis": aggregatedGroup(t, nil, "v1", "v2")}
			},
			[]string{"/api/v1"}, []string{"/apis/refresh.example/v1", "/apis/refresh.example/v2"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f, client := newRefreshHTTPFixture(t)
			serveAggregated(f, &acceptLog{}, tc.documents(t))
			p, err := startFixtureProvider(t, client, "mixed")
			require.NoError(t, err)
			for _, path := range tc.wantFetched {
				require.Equal(t, 1, f.count(path), path)
			}
			for _, path := range tc.wantSkipped {
				require.Zero(t, f.count(path), path)
			}
			snapshot := p.catalogs["mixed"]
			require.Equal(t, "complete", snapshot.catalog.Coverage.Kind)
			require.Contains(t, snapshot.bindings, "k8s:/pods")
			require.Len(t, snapshot.bindings["k8s:refresh.example/widgets"].Served, 2)
		})
	}
}

func TestNativeAggregatedStaleVersionIsPartialCoverage(t *testing.T) {
	f, client := newRefreshHTTPFixture(t)
	serveAggregated(f, &acceptLog{}, map[string]string{"/api": aggregatedCore(t, ""), "/apis": aggregatedGroup(t, map[string]bool{"v2": true}, "v1", "v2")})
	p, err := startFixtureProvider(t, client, "stale")
	require.NoError(t, err)
	snapshot := p.catalogs["stale"]
	require.Equal(t, "partial", snapshot.catalog.Coverage.Kind, "a stale version was not observed")
	require.Contains(t, snapshot.bindings, "k8s:/pods")
	require.Len(t, snapshot.bindings["k8s:refresh.example/widgets"].Served, 1)
	require.Zero(t, f.count("/apis/refresh.example/v2"))
}

func TestNativeAggregatedDiscoveryKeepsBudgets(t *testing.T) {
	t.Run("served versions", func(t *testing.T) {
		f, client := newRefreshHTTPFixture(t)
		versions := make([]string, maxNativeDiscoveryVersions)
		for i := range versions {
			versions[i] = fmt.Sprintf("v%d", i+1)
		}
		serveAggregated(f, &acceptLog{}, map[string]string{"/api": aggregatedCore(t, ""), "/apis": aggregatedGroup(t, nil, versions...)})
		_, err := startFixtureProvider(t, client, "versions")
		require.ErrorContains(t, err, "served-version budget")
	})
	t.Run("document bytes", func(t *testing.T) {
		f, client := newRefreshHTTPFixture(t)
		serveAggregated(f, &acceptLog{}, map[string]string{"/api": aggregatedCore(t, ""), "/apis": aggregatedGroup(t, nil, "v1") + strings.Repeat(" ", maxNativeDiscoveryDocumentBytes)})
		_, err := startFixtureProvider(t, client, "bytes")
		require.ErrorContains(t, err, "byte budget")
	})
	t.Run("named core group", func(t *testing.T) {
		f, client := newRefreshHTTPFixture(t)
		serveAggregated(f, &acceptLog{}, map[string]string{"/api": aggregatedCore(t, "named.example"), "/apis": aggregatedGroup(t, nil, "v1")})
		_, err := startFixtureProvider(t, client, "named")
		require.ErrorContains(t, err, "invalid Kubernetes discovery group version")
	})
}
