package resource

import (
	"context"
	"encoding/json"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// The helpers below change what the discovery fixture serves between two discoveries: a group that answers, one that is not listed any more, a document that
// lacks a kind, a path that answers 503. They edit the documents the fixture already serves, so a test starts from newRefreshHTTPFixture and says only what differs.

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	require.NoError(t, err)
	return string(data)
}

// kindOf is the Kind a test gives a resource name: "gadgets" is a Gadget.
func kindOf(name string) string {
	name = strings.TrimSuffix(name, "s")
	return strings.ToUpper(name[:1]) + name[1:]
}

func resourcesNamed(names []string) []metav1.APIResource {
	resources := make([]metav1.APIResource, 0, len(names))
	for _, name := range names {
		resources = append(resources, metav1.APIResource{Name: name, Kind: kindOf(name), Namespaced: true, Verbs: metav1.Verbs{"get", "list"}})
	}
	return resources
}

// serveGroupVersion lists the version of the group in the /apis index (the group too, when it is not listed) and serves the document of that group version with the named resources.
func (f *refreshHTTPFixture) serveGroupVersion(t *testing.T, group, version string, resources ...string) {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	var list metav1.APIGroupList
	require.NoError(t, json.Unmarshal([]byte(f.documents["/apis"]), &list))
	gv := group + "/" + version
	entry := metav1.GroupVersionForDiscovery{GroupVersion: gv, Version: version}
	index := slices.IndexFunc(list.Groups, func(g metav1.APIGroup) bool { return g.Name == group })
	switch {
	case index < 0:
		list.Groups = append(list.Groups, metav1.APIGroup{Name: group, Versions: []metav1.GroupVersionForDiscovery{entry}, PreferredVersion: entry})
	case !slices.ContainsFunc(list.Groups[index].Versions, func(v metav1.GroupVersionForDiscovery) bool { return v.Version == version }):
		list.Groups[index].Versions = append(list.Groups[index].Versions, entry)
	}
	f.documents["/apis"] = mustJSON(t, list)
	f.documents["/apis/"+gv] = mustJSON(t, metav1.APIResourceList{GroupVersion: gv, APIResources: resourcesNamed(resources)})
}

// serveGroup serves the group's version v1.
func (f *refreshHTTPFixture) serveGroup(t *testing.T, group string, resources ...string) {
	t.Helper()
	f.serveGroupVersion(t, group, "v1", resources...)
}

// removeGroup takes the group out of the /apis index and drops its documents: the server does not know it any more.
func (f *refreshHTTPFixture) removeGroup(t *testing.T, group string) {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	var list metav1.APIGroupList
	require.NoError(t, json.Unmarshal([]byte(f.documents["/apis"]), &list))
	list.Groups = slices.DeleteFunc(list.Groups, func(g metav1.APIGroup) bool { return g.Name == group })
	f.documents["/apis"] = mustJSON(t, list)
	for path := range f.documents {
		if strings.HasPrefix(path, "/apis/"+group+"/") {
			delete(f.documents, path)
		}
	}
}

// setCore serves the core v1 document with the named resources.
func (f *refreshHTTPFixture) setCore(t *testing.T, resources ...string) {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	f.documents["/api/v1"] = mustJSON(t, metav1.APIResourceList{GroupVersion: "v1", APIResources: resourcesNamed(resources)})
}

// setDocuments replaces the documents at the given paths.
func (f *refreshHTTPFixture) setDocuments(documents map[string]string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for path, document := range documents {
		f.documents[path] = document
	}
}

// setDown makes the path answer 503 while down is true.
func (f *refreshHTTPFixture) setDown(path string, down bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.down == nil {
		f.down = map[string]bool{}
	}
	f.down[path] = down
}

// setSlow makes the path answer after the delay, or never when the delay is zero: a backend that is slow, or that a network policy black-holes. The request waits until it is
// answered, until its client gives up, or until the test ends. clearSlow ends that for the requests that come next.
func (f *refreshHTTPFixture) setSlow(path string, delay time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.slow == nil {
		f.slow = map[string]time.Duration{}
	}
	f.slow[path] = delay
}

func (f *refreshHTTPFixture) clearSlow(path string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.slow, path)
}

// holdRequest is the wait of a slow path; it reports whether the request is to be answered after it.
func (f *refreshHTTPFixture) holdRequest(ctx context.Context, delay time.Duration) bool {
	f.mu.Lock()
	f.waiting++
	f.peakWaiting = max(f.peakWaiting, f.waiting)
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		f.waiting--
		f.mu.Unlock()
	}()
	var late <-chan time.Time
	if delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		late = timer.C
	}
	select {
	case <-late: // a nil channel for a request that is never answered
		return true
	case <-ctx.Done():
		return false
	case <-f.released:
		return false
	}
}

// waitingNow is how many requests wait on a slow path now, and the most there were at once.
func (f *refreshHTTPFixture) waitingNow() (now, peak int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.waiting, f.peakWaiting
}

// awaitWaiting returns once n requests wait on slow paths at the same time, and fails the test if they do not within the time.
func (f *refreshHTTPFixture) awaitWaiting(t *testing.T, n int, within time.Duration) {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if now, _ := f.waitingNow(); now >= n {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	now, peak := f.waitingNow()
	t.Fatalf("%d requests did not wait together within %v: %d wait now, at most %d did", n, within, now, peak)
}

// setGroupReadBound replaces the bound of an extension group version's read for the test (nativeGroupReadBound).
func setGroupReadBound(t *testing.T, bound time.Duration) {
	t.Helper()
	previous := nativeGroupReadBound
	nativeGroupReadBound = func(context.Context) time.Duration { return bound }
	t.Cleanup(func() { nativeGroupReadBound = previous })
}

// catalogTokens is the sorted list of the types the connection's catalog declares, read the way the host reads it.
func catalogTokens(t *testing.T, p *kubernetesProvider, route resourcev2.AccessRoute) []string {
	t.Helper()
	catalog, err := p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route})
	require.NoError(t, err)
	tokens := make([]string, 0, len(catalog.Types))
	for _, descriptor := range catalog.Types {
		tokens = append(tokens, descriptor.Type)
	}
	sort.Strings(tokens)
	return tokens
}

// unavailableNames is what the installed catalog names as not answering.
func unavailableNames(p *kubernetesProvider, route resourcev2.AccessRoute) []string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	snapshot := p.catalogs[route.Connection]
	if snapshot == nil {
		return nil
	}
	names := make([]string, 0, len(snapshot.unavailable))
	for _, group := range snapshot.unavailable {
		names = append(names, group.GroupVersion)
	}
	return names
}

// servedVersions is how many versions of the kind the installed catalog serves.
func servedVersions(p *kubernetesProvider, route resourcev2.AccessRoute, token string) int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return len(p.catalogs[route.Connection].bindings[token].Served)
}

// healCase is a connection whose first discovery could not read two extension versions (b.example/v1, refresh.example/v2), beside core v1 (pods), a built-in group (apps: deployments)
// and two extension groups that answer (crd.example: gadgets, other.example: things). Its heal attempts are run by hand (healRecorder).
type healCase struct {
	t     *testing.T
	f     *refreshHTTPFixture
	p     *kubernetesProvider
	route resourcev2.AccessRoute
	heals *healRecorder
}

func newHealCase(t *testing.T) *healCase {
	t.Helper()
	recordRetries(t, 3)
	heals := recordHeals(t)
	f, p, route := newHealProvider(t)
	f.addBuiltinApps(t)
	f.serveGroup(t, "crd.example", "gadgets")
	f.serveGroup(t, "other.example", "things")
	f.serveGroup(t, "b.example", "bees")
	f.setDown("/apis/b.example/v1", true)
	f.setDown("/apis/refresh.example/v2", true)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	c := &healCase{t: t, f: f, p: p, route: route, heals: heals}
	require.Equal(t, []string{"b.example/v1", "refresh.example/v2"}, c.unavailable())
	require.Equal(t, 1, heals.armed())
	return c
}

// attempt runs one heal attempt now, as the timer would.
func (c *healCase) attempt() {
	c.t.Helper()
	expireRefresh(c.p, c.route.Connection)
	c.heals.fire(c.t)
}

func (c *healCase) tokens() []string { return catalogTokens(c.t, c.p, c.route) }

func (c *healCase) unavailable() []string { return unavailableNames(c.p, c.route) }
