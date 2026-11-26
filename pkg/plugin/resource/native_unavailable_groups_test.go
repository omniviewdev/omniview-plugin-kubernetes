package resource

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	apidiscoveryv2 "k8s.io/api/apidiscovery/v2"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
)

// appendGroups adds extension or built-in groups, each with one version, to the fixture's /apis document.
func (f *refreshHTTPFixture) appendGroups(t *testing.T, groups ...metav1.APIGroup) {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	var list metav1.APIGroupList
	require.NoError(t, json.Unmarshal([]byte(f.documents["/apis"]), &list))
	list.Groups = append(list.Groups, groups...)
	data, err := json.Marshal(list)
	require.NoError(t, err)
	f.documents["/apis"] = string(data)
}

func singleVersionGroup(name string) metav1.APIGroup {
	version := metav1.GroupVersionForDiscovery{GroupVersion: name + "/v1", Version: "v1"}
	return metav1.APIGroup{Name: name, Versions: []metav1.GroupVersionForDiscovery{version}, PreferredVersion: version}
}

// addBuiltinApps serves the built-in apps/v1 group beside the fixture's extension group.
func (f *refreshHTTPFixture) addBuiltinApps(t *testing.T) {
	t.Helper()
	f.appendGroups(t, singleVersionGroup("apps"))
	data, err := json.Marshal(metav1.APIResourceList{GroupVersion: "apps/v1", APIResources: []metav1.APIResource{{Name: "deployments", Kind: "Deployment", Namespaced: true, Verbs: metav1.Verbs{"get", "list"}}}})
	require.NoError(t, err)
	f.mu.Lock()
	f.documents["/apis/apps/v1"] = string(data)
	f.mu.Unlock()
}

// addUnavailableExtensions serves n extension groups whose version documents all answer 503.
func (f *refreshHTTPFixture) addUnavailableExtensions(t *testing.T, n int) {
	t.Helper()
	groups := make([]metav1.APIGroup, 0, n)
	for i := range n {
		groups = append(groups, singleVersionGroup(fmt.Sprintf("many%d.example", i)))
	}
	f.appendGroups(t, groups...)
	f.mu.Lock()
	f.hook = func(w http.ResponseWriter, r *http.Request) bool {
		if strings.HasPrefix(r.URL.Path, "/apis/many") {
			respondUnavailable(w, r)
			return true
		}
		return false
	}
	f.mu.Unlock()
}

// THE LINE: an extension group that does not answer is an unavailable group (the connection is served); a built-in group, the discovery index, or nothing read is a cluster that cannot be read.
func TestNativeStartDrawsTheLineBetweenAnUnavailableGroupAndAClusterThatCannotBeRead(t *testing.T) {
	staleApps := `{"kind":"APIGroupDiscoveryList","apiVersion":"apidiscovery.k8s.io/v2","items":[{"metadata":{"name":"apps"},"versions":[{"version":"v1","freshness":"Stale"}]}]}`
	for _, tc := range []struct {
		name  string
		setup func(*testing.T, *refreshHTTPFixture)
		// unavailable is what the served connection names; empty means the start must fail.
		unavailable []nativeUnavailable
	}{
		{"extension group version answers 503: unavailable", func(t *testing.T, f *refreshHTTPFixture) {
			f.failAlways("/apis/refresh.example/v2", respondUnavailable)
		},
			[]nativeUnavailable{{GroupVersion: "refresh.example/v2", Reason: "unavailable"}}},
		{"extension group version drops the connection: unavailable", func(t *testing.T, f *refreshHTTPFixture) { f.failAlways("/apis/refresh.example/v2", dropConnection) },
			[]nativeUnavailable{{GroupVersion: "refresh.example/v2", Reason: "unavailable"}}},
		{"built-in apps/v1 answers 503: the cluster cannot be read", func(t *testing.T, f *refreshHTTPFixture) {
			f.addBuiltinApps(t)
			f.failAlways("/apis/apps/v1", respondUnavailable)
		}, nil},
		{"core v1 answers 503: the cluster cannot be read", func(t *testing.T, f *refreshHTTPFixture) { f.failAlways("/api/v1", respondUnavailable) }, nil},
		{"built-in apps/v1 is stale in aggregated discovery: the cluster cannot be read", func(t *testing.T, f *refreshHTTPFixture) {
			serveAggregated(f, &acceptLog{}, map[string]string{"/api": aggregatedCore(t, ""), "/apis": staleApps})
		}, nil},
		{"discovery index /apis answers 503: the cluster cannot be read", func(t *testing.T, f *refreshHTTPFixture) { f.failAlways("/apis", respondUnavailable) }, nil},
		{"discovery index /api answers 503: the cluster cannot be read", func(t *testing.T, f *refreshHTTPFixture) { f.failAlways("/api", respondUnavailable) }, nil},
		{"discovery lists no API resource: the cluster cannot be read", func(t *testing.T, f *refreshHTTPFixture) {
			f.setDocuments(map[string]string{"/api": `{"kind":"APIVersions","versions":[]}`, "/apis": `{"kind":"APIGroupList","apiVersion":"v1","groups":[]}`})
		}, nil},
		{"the discovery index answers empty objects: the cluster cannot be read", func(t *testing.T, f *refreshHTTPFixture) {
			f.setDocuments(map[string]string{"/api": `{}`, "/apis": `{}`})
		}, nil},
		{"aggregated discovery lists nothing: the cluster cannot be read", func(t *testing.T, f *refreshHTTPFixture) {
			serveAggregated(f, &acceptLog{}, map[string]string{"/api": aggregatedList(t), "/apis": aggregatedList(t)})
		}, nil},
		{"a group version answers as another one: the cluster cannot be read", func(t *testing.T, f *refreshHTTPFixture) {
			f.setDocuments(map[string]string{"/apis/refresh.example/v2": mustJSON(t, metav1.APIResourceList{GroupVersion: "refresh.example/v3"})})
		}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recordRetries(t, 3)
			heals := recordHeals(t)
			f, p, route := newHealProvider(t)
			tc.setup(t, f)
			status, err := p.StartConnection(context.Background(), route.Connection)
			if len(tc.unavailable) == 0 {
				require.Error(t, err, "a cluster that cannot be read is never CONNECTED")
				require.NotEqual(t, "CONNECTED", string(status.Status))
				require.NotContains(t, p.catalogs, route.Connection, "no catalog is published for it, complete or partial")
				require.Zero(t, heals.armed(), "nothing is read again for a connection that did not start")
				_, err = p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route})
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			catalog, err := p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route})
			require.NoError(t, err)
			require.Equal(t, "complete", catalog.Coverage.Kind)
			require.Equal(t, tc.unavailable, p.catalogs[route.Connection].unavailable)
			require.Equal(t, 1, heals.armed(), "an unavailable group is read again")
		})
	}
}

// The built-in failure keeps its cause, so the host classes it as what it was: the API server not answering.
func TestNativeBuiltinGroupFailureKeepsItsCause(t *testing.T) {
	recordRetries(t, 3)
	recordHeals(t)
	f, client := newRefreshHTTPFixture(t)
	f.addBuiltinApps(t)
	f.failAlways("/apis/apps/v1", respondUnavailable)
	_, err := startFixtureProvider(t, client, "builtin")
	require.Error(t, err)
	require.True(t, k8serrors.IsServiceUnavailable(err), "the API server answered 503: %v", err)
	require.ErrorContains(t, err, "apps/v1")
}

// RBAC is not "unavailable": a group version that answers 401 or 403 is a cluster that refuses this user, and the start fails as it did before.
func TestNativeForbiddenGroupVersionIsARefusedClusterNotAnUnavailableGroup(t *testing.T) {
	for _, tc := range []struct {
		name  string
		fail  func(http.ResponseWriter, *http.Request)
		check func(error) bool
	}{
		{"403", respondStatus(http.StatusForbidden, metav1.StatusReasonForbidden), k8serrors.IsForbidden},
		{"401", respondStatus(http.StatusUnauthorized, metav1.StatusReasonUnauthorized), k8serrors.IsUnauthorized},
	} {
		t.Run(tc.name, func(t *testing.T) {
			heals := recordHeals(t)
			f, p, route := newHealProvider(t)
			f.failAlways("/apis/refresh.example/v2", tc.fail) // an extension group: the version that could be "unavailable"
			_, err := p.StartConnection(context.Background(), route.Connection)
			require.Error(t, err)
			require.True(t, tc.check(err), "got %v", err)
			require.NotContains(t, p.catalogs, route.Connection)
			require.Zero(t, heals.armed(), "a refusal is not read again in the background")
			require.Equal(t, 1, f.count("/apis/refresh.example/v2"), "a refused request is made once")
		})
	}
}

func TestNativeUnavailableReasonIsAClosedVocabulary(t *testing.T) {
	for _, tc := range []struct {
		cause error
		want  string
	}{
		{discovery.StaleGroupVersionError{}, "stale"},
		{errNativeDiscoveryBytes(), "too_large"},
		{context.DeadlineExceeded, "timeout"},
		{k8serrors.NewTimeoutError("slow", 1), "timeout"},
		{k8serrors.NewServiceUnavailable("down"), "unavailable"},
		{k8serrors.NewInternalError(errors.New("boom")), "unavailable"},
		{k8serrors.NewTooManyRequests("slow down", 1), "unavailable"},
		{io.ErrUnexpectedEOF, "unavailable"},
		{k8serrors.NewNotFound(schema.GroupResource{Group: "refresh.example", Resource: "widgets"}, "x"), "failed"},
		{fmt.Errorf("%w: a resource without a kind", errNativeDocumentInvalid), "invalid"},
		{errors.New("something else"), "failed"},
	} {
		require.Equal(t, tc.want, nativeUnavailableReason(tc.cause), "%T %v", tc.cause, tc.cause)
	}
}

// A group that never heals costs one discovery per attempt, an attempt every five minutes once the wait has doubled up, and at most one wait is pending.
func TestNativeHealOfAGroupThatNeverAnswersCostsOneDiscoveryPerFiveMinutes(t *testing.T) {
	heals := recordHeals(t)
	f, p, route := newHealProvider(t)
	serveAggregated(f, &acceptLog{}, map[string]string{"/api": aggregatedCore(t, ""), "/apis": aggregatedGroup(t, map[string]bool{"v2": true}, "v1", "v2")})
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	perDiscovery := discoveryReads(f)
	require.Equal(t, 2, perDiscovery, "aggregated discovery is two requests, whatever the number of groups")

	const attempts = 12
	for i := 1; i <= attempts; i++ {
		expireRefresh(p, route.Connection)
		heals.fire(t)
		require.Equal(t, 1, heals.armed(), "one wait pending, never more")
		require.Equal(t, (i+1)*perDiscovery, discoveryReads(f), "one discovery per attempt")
	}
	want := []time.Duration{30 * time.Second, time.Minute, 2 * time.Minute, 4 * time.Minute}
	for len(want) < attempts+1 {
		want = append(want, 5*time.Minute)
	}
	require.Equal(t, want, heals.scheduled())
	p.mu.RLock()
	defer p.mu.RUnlock()
	require.Len(t, p.catalogHeals, 1)
}

// The attempts keep no goroutine of their own: not one per group, not one per attempt, and none once the connection stops. (CI runs this with -race.)
// The discovery client's burst (300 requests) bounds the size of the fixture: ten groups at three tries each, six discoveries.
func TestNativeHealLeavesNoGoroutineBehind(t *testing.T) {
	recordRetries(t, 3)
	heals := recordHeals(t)
	f, p, route := newHealProvider(t)
	f.addUnavailableExtensions(t, 10) // many unavailable groups: still no goroutine kept per group
	ctx := context.Background()
	// One cycle first, so that what a connection keeps open (idle HTTP connections) is part of the baseline.
	_, err := p.StartConnection(ctx, route.Connection)
	require.NoError(t, err)
	require.Len(t, p.catalogs[route.Connection].unavailable, 10)
	_, err = p.StopConnection(ctx, route.Connection)
	require.NoError(t, err)
	base := stableGoroutines(t)

	_, err = p.StartConnection(ctx, route.Connection)
	require.NoError(t, err)
	started := stableGoroutines(t)
	for range 5 {
		expireRefresh(p, route.Connection)
		heals.fire(t)
	}
	require.LessOrEqual(t, stableGoroutines(t), started, "five attempts leave no goroutine behind")

	_, err = p.StopConnection(ctx, route.Connection)
	require.NoError(t, err)
	require.Zero(t, heals.armed())
	// Counted from this goroutine, like the baseline: a poller of testify's would count itself.
	for deadline := time.Now().Add(5 * time.Second); runtime.NumGoroutine() > base && time.Now().Before(deadline); {
		time.Sleep(20 * time.Millisecond)
	}
	require.LessOrEqual(t, runtime.NumGoroutine(), base, "a stopped connection keeps nothing")
}

func TestNativeHealStopsWhenThePluginStops(t *testing.T) {
	heals := recordHeals(t)
	f, p, route := newHealProvider(t)
	f.failAlways("/apis/refresh.example/v2", respondUnavailable)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	require.Equal(t, 1, heals.armed())
	require.NoError(t, p.Close(), "the plugin stops")
	require.Zero(t, heals.armed(), "no attempt outlives the plugin")
	p.mu.RLock()
	defer p.mu.RUnlock()
	require.Empty(t, p.catalogHeals)
}

func stableGoroutines(t *testing.T) int {
	t.Helper()
	last, stable := -1, 0
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		runtime.Gosched()
		time.Sleep(25 * time.Millisecond)
		if n := runtime.NumGoroutine(); n == last {
			if stable++; stable >= 4 {
				return n
			}
		} else {
			last, stable = n, 0
		}
	}
	return last
}

// staleGroups is the aggregated discovery of n extension groups, every one of them stale: aggregated APIs whose backends are down.
func staleGroups(n int, name func(int) string, version string) []apidiscoveryv2.APIGroupDiscovery {
	items := make([]apidiscoveryv2.APIGroupDiscovery, 0, n)
	for i := range n {
		items = append(items, apidiscoveryv2.APIGroupDiscovery{
			ObjectMeta: metav1.ObjectMeta{Name: name(i)},
			Versions:   []apidiscoveryv2.APIVersionDiscovery{{Version: version, Freshness: apidiscoveryv2.DiscoveryFreshnessStale}},
		})
	}
	return items
}

// factOf starts a connection whose discovery lists the groups and reads the connection's facts the way the host does.
func factOf(t *testing.T, groups []apidiscoveryv2.APIGroupDiscovery) (resourcev2.ConnectionMetadataSnapshot, map[string]any) {
	t.Helper()
	recordHeals(t)
	f, p, route := newHealProvider(t)
	serveAggregated(f, &acceptLog{}, map[string]string{"/api": aggregatedCore(t, ""), "/apis": aggregatedList(t, groups...)})
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	snapshot, err := p.RefreshConnectionMetadata(context.Background(), route.Connection)
	require.NoError(t, err, "the observation of the facts must not fail as a whole: the server url, the version and the environment would be lost with the groups")
	entry, present := snapshot.Entries[FactUnavailableAPIGroups]
	states := make(map[string]string, len(snapshot.Entries))
	for key, other := range snapshot.Entries {
		states[key] = other.State
	}
	require.True(t, present, "the fact is observed: the snapshot holds %v", states)
	value, ok := entry.Value.(map[string]any)
	require.True(t, ok, "the fact is an object: how many groups, and the first of them: %T", entry.Value)
	return snapshot, value
}

// The fact names at most 32 group versions and counts the rest. The SDK refuses a metadata value over 16 KiB (MaxConnectionMetadataEntryBytes) and fails the whole observation when one is
// over it, which loses every other fact of the connection with it; 32 names of the longest legal length (a group of 253 characters, a version of 63) are about 12 KiB.
func TestNativeConnectionFactNamesAtMostThirtyTwoGroupsAndCountsTheRest(t *testing.T) {
	snapshot, value := factOf(t, staleGroups(200, func(i int) string { return fmt.Sprintf("tenant-%03d.metrics.internal.example.com", i) }, "v1beta1"))
	require.Contains(t, snapshot.Entries, FactServer, "the other facts survive")
	require.EqualValues(t, 200, value["count"], "the count is of every group that does not answer")
	groups, ok := value["groups"].([]any)
	require.True(t, ok)
	require.Len(t, groups, 32, "the names are the first 32, in order")
	require.Equal(t, map[string]any{"groupVersion": "tenant-000.metrics.internal.example.com/v1beta1", "reason": "stale"}, groups[0])
	require.Equal(t, "tenant-031.metrics.internal.example.com/v1beta1", groups[31].(map[string]any)["groupVersion"])
}

func TestNativeConnectionFactFitsTheSDKLimitWithNamesOfTheLongestLegalLength(t *testing.T) {
	longest := func(i int) string { // 253 characters: a DNS subdomain of the longest legal length
		return fmt.Sprintf("g%03d.%s.%s.%s.%s", i, strings.Repeat("a", 63), strings.Repeat("a", 63), strings.Repeat("a", 63), strings.Repeat("a", 56))
	}
	require.Len(t, longest(0), 253)
	snapshot, value := factOf(t, staleGroups(40, longest, "v"+strings.Repeat("1", 62)))
	require.Contains(t, snapshot.Entries, FactServer)
	require.EqualValues(t, 40, value["count"])
	require.Len(t, value["groups"], 32)
}

// A group name a server sends that no Kubernetes name could be is clipped to the longest legal one, so that it cannot take the other facts down.
func TestNativeConnectionFactClipsAGroupNameNoServerCouldLegallySend(t *testing.T) {
	long := strings.Repeat("a", 20_000)
	snapshot, value := factOf(t, staleGroups(1, func(int) string { return long }, "v1"))
	require.Contains(t, snapshot.Entries, FactServer)
	groups := value["groups"].([]any)
	require.Len(t, groups, 1)
	name := groups[0].(map[string]any)["groupVersion"].(string)
	require.LessOrEqual(t, len(name), 253+1+63)
	require.True(t, strings.HasPrefix(long+"/v1", name), "what is left is a prefix of the name")
}

// What counts against the SDK's limit is the JSON a name becomes, not its length: a control character is six bytes of it, so 32 names of 249 of them, which pass a limit on
// length (253 and the version are under 317), are about 48 KiB and take every other fact of the connection down with them.
func TestNativeConnectionFactBoundsTheJSONOfGroupNamesNotTheirLength(t *testing.T) {
	name := func(i int) string { return strings.Repeat("\x01", 249) + fmt.Sprintf("%04d", i) }
	snapshot, value := factOf(t, staleGroups(40, name, "v1"))
	require.Contains(t, snapshot.Entries, FactServer, "the other facts survive")
	require.EqualValues(t, 40, value["count"], "the count is of every group that does not answer, whatever is clipped")
	groups := value["groups"].([]any)
	require.Len(t, groups, 32)
	for i, group := range groups {
		clipped := group.(map[string]any)["groupVersion"].(string)
		encoded, err := json.Marshal(clipped)
		require.NoError(t, err)
		require.LessOrEqual(t, len(encoded)-2, 253+1+63, "name %d takes more than the longest legal name does once it is JSON", i)
		require.True(t, strings.HasPrefix(name(i)+"/v1", clipped), "what is left of name %d is a prefix of it", i)
	}
}

// clipGroupVersion leaves every legal name as it is and cuts any other at the last character whose JSON still fits the longest legal name: a character the encoder
// escapes (a quote, a backslash, a control character, <, >, &, U+2028 and U+2029) takes more bytes as JSON than it has.
func TestNativeClipGroupVersionBoundsTheJSONAndNeverCutsACharacter(t *testing.T) {
	longest := strings.Repeat("a", 253) + "/" + strings.Repeat("v", 63)
	cases := []struct {
		name, in  string
		unchanged bool
	}{
		{"an ordinary name", "metrics.k8s.io/v1beta1", true},
		{"the longest legal name", longest, true},
		{"control characters", strings.Repeat("\x01", 400), false},
		{"NUL", strings.Repeat("\x00", 400), false},
		{"quotes", strings.Repeat(`"`, 400), false},
		{"backslashes", strings.Repeat(`\`, 400), false},
		{"newlines", strings.Repeat("\n", 400), false},
		{"html characters", strings.Repeat("<>&", 200), false},
		{"line separators", strings.Repeat("\u2028\u2029", 200), false},
		{"three-byte characters", strings.Repeat("語", 200), false},
		{"four-byte characters", strings.Repeat("😀", 200), false},
		{"a mixture", strings.Repeat("a\x01\"é<語", 100), false},
		{"a long name of a legal alphabet", strings.Repeat("a", 20_000), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clipped := clipGroupVersion(tc.in)
			require.True(t, utf8.ValidString(clipped), "a character is never cut in two")
			require.True(t, strings.HasPrefix(tc.in, clipped), "what is left is a prefix of the name")
			encoded, err := json.Marshal(clipped)
			require.NoError(t, err)
			require.LessOrEqual(t, len(encoded)-2, 253+1+63, "the JSON of the name must fit the longest legal name")
			if tc.unchanged {
				require.Equal(t, tc.in, clipped, "a legal name is kept as it is")
				return
			}
			next, _ := utf8.DecodeRuneInString(tc.in[len(clipped):])
			more, err := json.Marshal(clipped + string(next))
			require.NoError(t, err)
			require.Greater(t, len(more)-2, 253+1+63, "the cut is at the last character that fits")
		})
	}
}

// The SDK refuses a metadata value that is not valid UTF-8 and with it every fact of the connection. JSON decoding replaces such bytes, so no discovery document gives a name that
// has them; a name that does is cut before the first of them.
func TestNativeClipGroupVersionCutsBeforeABytePastUTF8(t *testing.T) {
	require.Equal(t, "metrics.k8s.io", clipGroupVersion("metrics.k8s.io\xff/v1beta1"))
	require.Equal(t, "", clipGroupVersion("\xc3"))
}
