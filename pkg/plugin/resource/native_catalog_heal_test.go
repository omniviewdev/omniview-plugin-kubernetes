package resource

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

// healRecorder stands in for the clock of the attempts: it records what is
// scheduled and runs an attempt when the test says so.
type healRecorder struct {
	mu      sync.Mutex
	pending []*recordedHeal
	delays  []time.Duration
}

type recordedHeal struct {
	run     func()
	stopped bool
}

func recordHeals(t *testing.T) *healRecorder {
	t.Helper()
	r := &healRecorder{}
	previous := nativeHealAfter
	nativeHealAfter = func(d time.Duration, f func()) func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		heal := &recordedHeal{run: f}
		r.pending = append(r.pending, heal)
		r.delays = append(r.delays, d)
		return func() bool {
			r.mu.Lock()
			defer r.mu.Unlock()
			was := !heal.stopped
			heal.stopped = true
			return was
		}
	}
	t.Cleanup(func() { nativeHealAfter = previous })
	return r
}

// armed is how many attempts are waiting.
func (r *healRecorder) armed() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, heal := range r.pending {
		if !heal.stopped {
			n++
		}
	}
	return n
}

func (r *healRecorder) scheduled() []time.Duration {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]time.Duration(nil), r.delays...)
}

// fire runs the latest attempt the way the clock would: it is no longer waiting once it runs.
func (r *healRecorder) fire(t *testing.T) {
	t.Helper()
	r.mu.Lock()
	var heal *recordedHeal
	for i := len(r.pending) - 1; i >= 0; i-- {
		if !r.pending[i].stopped {
			heal = r.pending[i]
			heal.stopped = true // a timer that has fired is not waiting any more
			break
		}
	}
	r.mu.Unlock()
	require.NotNil(t, heal, "no attempt is waiting")
	heal.run()
}

// newHealProvider is a provider on the real SDK lifecycle, so that an attempt takes the same client lease a request does, with the discovery HTTP fixture behind it.
func newHealProvider(t *testing.T) (*refreshHTTPFixture, *kubernetesProvider, resourcev2.AccessRoute) {
	t.Helper()
	fixture, client := newRefreshHTTPFixture(t)
	provider := refreshTestProvider()
	connection := sdktypes.Connection{ID: "heal", Name: "Heal fixture"}
	controller, err := resourcev2.NewController(resourcev2.Config[clients.ClientSet]{
		DynamicSources:      true,
		Catalog:             provider.catalog,
		ResolveRegistration: provider.registration,
		ConnectionMetadata:  provider.connectionMetadataFacts,
		Lifecycle: &resourcev2.Lifecycle[clients.ClientSet]{
			LoadConnections: func(context.Context) ([]sdktypes.Connection, error) { return []sdktypes.Connection{connection}, nil },
			CreateClient:    func(context.Context, sdktypes.Connection) (*clients.ClientSet, error) { return client, nil },
			DestroyClient:   provider.connections.DestroyClient,
			OnStart:         provider.startNativeConnection,
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

func (f *refreshHTTPFixture) answerAgain() {
	f.mu.Lock()
	f.hook = nil
	f.mu.Unlock()
}

// discoveryReads counts the requests that read discovery, not the ones that read something else (the server version a connection's facts ask for).
func discoveryReads(f *refreshHTTPFixture) int {
	n := 0
	for _, path := range []string{"/api", "/api/v1", "/apis", "/apis/refresh.example/v1", "/apis/refresh.example/v2", "/apis/refresh.example/v3"} {
		n += f.count(path)
	}
	return n
}

func TestNativeHealIntervalsDoubleFromTheRefreshThrottleToACap(t *testing.T) {
	var got []time.Duration
	for attempt := range 7 {
		got = append(got, nativeHealInterval(attempt))
	}
	require.Equal(t, []time.Duration{30 * time.Second, time.Minute, 2 * time.Minute, 4 * time.Minute, 5 * time.Minute, 5 * time.Minute, 5 * time.Minute}, got)
}

// The host's connection admission refuses a catalog that is not complete, so what the SDK controller serves after a start is what decides whether the user gets in.
func TestNativeConnectionWithAnUnavailableGroupIsServedAsACompleteCatalog(t *testing.T) {
	recordHeals(t)
	f, p, route := newHealProvider(t)
	f.failAlways("/apis/refresh.example/v2", respondUnavailable)
	status, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	require.Equal(t, sdktypes.ConnectionStatusConnected, status.Status)
	catalog, err := p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route})
	require.NoError(t, err)
	require.Equal(t, resourcev2.Coverage{Kind: "complete", Paths: []string{}}, catalog.Coverage)
	require.NoError(t, resourcev2.ValidateCatalog(catalog))
	var tokens []string
	for _, descriptor := range catalog.Types {
		tokens = append(tokens, descriptor.Type)
	}
	require.Contains(t, tokens, "k8s:/pods")
	require.Contains(t, tokens, "k8s:refresh.example/widgets")
}

func TestNativeHealIsNotArmedWhenEveryGroupAnswers(t *testing.T) {
	heals := recordHeals(t)
	_, p, route := newHealProvider(t)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	require.Zero(t, heals.armed())
	require.Empty(t, heals.scheduled())
}

func TestNativeHealReadsAnUnavailableGroupAgainUntilItAnswers(t *testing.T) {
	heals := recordHeals(t)
	f, p, route := newHealProvider(t)
	f.failAlways("/apis/refresh.example/v2", respondUnavailable)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	before, err := p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route})
	require.NoError(t, err)
	require.Equal(t, 1, heals.armed(), "the start that lacks a group waits for the first attempt")
	require.Equal(t, []time.Duration{30 * time.Second}, heals.scheduled())

	// The group is still down: the attempt reads discovery, changes nothing and waits longer.
	expireRefresh(p, route.Connection)
	requestsBefore := f.count("/apis/refresh.example/v2")
	heals.fire(t)
	require.Greater(t, f.count("/apis/refresh.example/v2"), requestsBefore, "the attempt read the group again")
	require.Equal(t, 1, heals.armed())
	require.Equal(t, []time.Duration{30 * time.Second, time.Minute}, heals.scheduled())
	still, err := p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route})
	require.NoError(t, err)
	require.Equal(t, before.Revision, still.Revision, "a group that stays down changes nothing the host sees")

	// The group answers: its kinds are added without a reconnect and the attempts end.
	f.answerAgain()
	expireRefresh(p, route.Connection)
	heals.fire(t)
	require.Zero(t, heals.armed(), "every group answers: nothing more to wait for")
	after, err := p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route})
	require.NoError(t, err)
	require.NotEqual(t, before.Revision, after.Revision, "the catalog gained the group's kinds")
	require.Empty(t, p.catalogs[route.Connection].unavailable)
	require.Len(t, p.catalogs[route.Connection].bindings["k8s:refresh.example/widgets"].Served, 2)
	// Same client binding: what the host has open is not retired by the new kinds.
	beforeEpoch, err := resourcev2.CatalogBindingEpoch(before.Revision)
	require.NoError(t, err)
	afterEpoch, err := resourcev2.CatalogBindingEpoch(after.Revision)
	require.NoError(t, err)
	require.Equal(t, beforeEpoch, afterEpoch)
}

func TestNativeHealEndsWithTheConnection(t *testing.T) {
	heals := recordHeals(t)
	f, p, route := newHealProvider(t)
	f.failAlways("/apis/refresh.example/v2", respondUnavailable)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	require.Equal(t, 1, heals.armed())
	requests := discoveryReads(f)
	heals.mu.Lock()
	stale := heals.pending[0].run
	heals.mu.Unlock()

	_, err = p.StopConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	require.Zero(t, heals.armed(), "a stopped connection waits for nothing")
	stale() // a timer that was already running when the connection stopped
	require.Equal(t, requests, discoveryReads(f), "an attempt of a stopped connection reads nothing")
	require.Zero(t, heals.armed())
}

func TestNativeHealOfAnEarlierStartCannotRunAfterARestart(t *testing.T) {
	heals := recordHeals(t)
	f, p, route := newHealProvider(t)
	f.failAlways("/apis/refresh.example/v2", respondUnavailable)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	heals.mu.Lock()
	first := heals.pending[0].run
	heals.mu.Unlock()
	_, err = p.StopConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	_, err = p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	require.Equal(t, 1, heals.armed(), "the new start has its own first attempt")
	requests := discoveryReads(f)
	expireRefresh(p, route.Connection) // the throttle of the new start would otherwise stop a stale attempt that the check under test did not
	first()
	require.Equal(t, requests, discoveryReads(f), "the attempt of the earlier start is no longer the pending one")
	require.Equal(t, 1, heals.armed())
}

func TestNativeConnectionFactNamesTheUnavailableGroupsAndFollowsTheirRecovery(t *testing.T) {
	heals := recordHeals(t)
	f, p, route := newHealProvider(t)
	f.failAlways("/apis/refresh.example/v2", respondUnavailable)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)

	snapshot, err := p.RefreshConnectionMetadata(context.Background(), route.Connection)
	require.NoError(t, err)
	entry, present := snapshot.Entries[unavailableGroupsKey]
	require.True(t, present, "the facts of a connection name the groups its catalog lacks")
	require.Equal(t, "current", entry.State)
	require.Equal(t, map[string]any{"count": 1, "groups": []any{map[string]any{"groupVersion": "refresh.example/v2", "reason": "unavailable"}}}, entry.Value, "how many groups, and the first of them with a closed reason")

	f.answerAgain()
	expireRefresh(p, route.Connection)
	heals.fire(t)
	require.Eventually(t, func() bool {
		current, err := p.GetConnectionMetadata(context.Background(), route.Connection)
		if err != nil {
			return false
		}
		_, present := current.Entries[unavailableGroupsKey]
		return !present
	}, 5*time.Second, 10*time.Millisecond, "the fact is gone once every group answers, without a refresh asked for")
}

func TestNativeConnectionFactIsAbsentWhenEveryGroupAnswers(t *testing.T) {
	recordHeals(t)
	_, p, route := newHealProvider(t)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	snapshot, err := p.RefreshConnectionMetadata(context.Background(), route.Connection)
	require.NoError(t, err)
	require.NotContains(t, snapshot.Entries, unavailableGroupsKey)
}

func TestNativeRefreshThatStillCannotReadAGroupMayAddSupport(t *testing.T) {
	f, client := newRefreshHTTPFixture(t)
	f.failAlways("/apis/refresh.example/v2", respondUnavailable)
	recordHeals(t)
	p := refreshTestProvider()
	ctx, connection := refreshTestContext("adds")
	require.NoError(t, p.startNativeConnection(ctx, connection, client))
	t.Cleanup(func() { p.retireNativeCatalog("adds") })
	original := p.catalogs["adds"]
	require.Len(t, original.bindings["k8s:refresh.example/widgets"].Served, 1)

	f.setVersions(t, "v1", "v2", "v3") // a new version is served while v2 is still down
	expireRefresh(p, "adds")
	require.NoError(t, p.refreshNativeCatalog(ctx, "adds", client))
	added := p.catalogs["adds"]
	require.NotSame(t, original, added)
	require.Len(t, added.bindings["k8s:refresh.example/widgets"].Served, 2, "v1 and v3 are served, v2 is still unavailable")
	require.Equal(t, []nativeUnavailable{{GroupVersion: "refresh.example/v2", Reason: "unavailable"}}, added.unavailable)
}
