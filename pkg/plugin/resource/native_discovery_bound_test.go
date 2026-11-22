package resource

import (
	"context"
	"fmt"
	"runtime"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/stretchr/testify/require"
)

// A group version whose read hangs (on a server without aggregated discovery the API server proxies the read to a backend that a network policy black-holes, or that sits on a
// dead node) is one API group that does not answer, not a cluster that cannot be read: it must never keep a user out of a working cluster. These tests use real HTTP: the
// fixture's handler waits, as the API server does, until the client gives up.

// unavailableWithReasons is what the installed catalog names as not answering, with the reasons.
func unavailableWithReasons(p *kubernetesProvider, connectionID string) []nativeUnavailable {
	p.mu.RLock()
	defer p.mu.RUnlock()
	snapshot := p.catalogs[connectionID]
	if snapshot == nil {
		return nil
	}
	return append([]nativeUnavailable(nil), snapshot.unavailable...)
}

// startOn starts the connection on the fixture's client with an acquisition deadline of the given length, the way the SDK does (a deadline the caller already has stands), and says
// how long the start took.
func startOn(t *testing.T, p *kubernetesProvider, id string, client *clients.ClientSet, within time.Duration) (time.Duration, error) {
	t.Helper()
	ctx, connection := refreshTestContext(id)
	ctx, cancel := context.WithTimeout(ctx, within)
	defer cancel()
	began := time.Now()
	err := p.startNativeConnection(ctx, connection, client)
	return time.Since(began), err
}

// One extension group whose read hangs: the start proceeds, names it (reason timeout), serves everything else and reads it again. The bound here is the real one, half of what is
// left of the acquisition deadline: 2 s stands for the 10 s default, and the start takes about a second.
func TestNativeStartNamesAnExtensionGroupThatDoesNotAnswerWithinTheBoundAndProceeds(t *testing.T) {
	recordRetries(t, 3)
	heals := recordHeals(t)
	f, client := newRefreshHTTPFixture(t)
	f.setSlow("/apis/refresh.example/v2", 0)
	p := refreshTestProvider()
	took, err := startOn(t, p, "hung", client, 2*time.Second)
	require.NoError(t, err, "only this extension group hangs; the cluster is readable")
	require.Equal(t, []nativeUnavailable{{GroupVersion: "refresh.example/v2", Reason: "timeout"}}, unavailableWithReasons(p, "hung"))
	require.Contains(t, p.catalogs["hung"].bindings, "k8s:/pods")
	require.Contains(t, p.catalogs["hung"].bindings, "k8s:refresh.example/widgets", "the version of the group that answers is served")
	require.Equal(t, 1, heals.armed(), "the group is read again")
	require.GreaterOrEqual(t, took, 800*time.Millisecond, "the group had its bound, half of the acquisition deadline")
	require.Less(t, took, 1800*time.Millisecond, "and the start did not wait for the deadline")
}

// The index and a built-in group version have no bound of their own: a read of them that does not answer is the cluster not answering, and fails the start at the acquisition
// deadline, nothing published, as it always did.
func TestNativeStartFailsWhenTheIndexOrABuiltInGroupVersionDoesNotAnswerBeforeTheDeadline(t *testing.T) {
	for _, tc := range []struct {
		name, path string
		builtin    bool
	}{
		{"built-in apps/v1", "/apis/apps/v1", true},
		{"core v1", "/api/v1", false},
		{"the /apis index", "/apis", false},
		{"the /api index", "/api", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recordRetries(t, 3)
			heals := recordHeals(t)
			f, client := newRefreshHTTPFixture(t)
			if tc.builtin {
				f.addBuiltinApps(t)
			}
			f.setSlow(tc.path, 0)
			p := refreshTestProvider()
			took, err := startOn(t, p, "hung", client, 800*time.Millisecond)
			require.ErrorIs(t, err, context.DeadlineExceeded)
			require.GreaterOrEqual(t, took, 700*time.Millisecond, "it failed at the acquisition deadline, not at the bound of an extension group (400 ms here)")
			require.NotContains(t, p.catalogs, "hung", "nothing is published for a cluster that did not answer in time")
			require.Zero(t, heals.armed())
		})
	}
}

// Hung groups cost one bound in total, not one each: every extension group version is read at once, as client-go reads them, so that five that hang are all waiting together.
// (A pool of four would hold the fifth back for a whole bound, and a hundred for twenty-five.)
func TestNativeHungExtensionGroupsCostOneBoundInTotal(t *testing.T) {
	recordRetries(t, 3)
	heals := recordHeals(t)
	const bound = time.Second
	setGroupReadBound(t, bound)
	f, client := newRefreshHTTPFixture(t)
	hung := []string{"refresh.example/v2"}
	for i := range 4 {
		group := fmt.Sprintf("hung%d.example", i)
		f.serveGroup(t, group, "things")
		hung = append(hung, group+"/v1")
	}
	for _, gv := range hung {
		f.setSlow("/apis/"+gv, 0)
	}
	p := refreshTestProvider()
	took, err := startOn(t, p, "five", client, 5*time.Second)
	require.NoError(t, err, "the cluster is readable")
	_, peak := f.waitingNow()
	require.Equal(t, 5, peak, "all five reads waited together")
	require.GreaterOrEqual(t, took, bound, "they had their bound")
	require.Less(t, took, 18*bound/10, "one bound in total: a pool of four needs two for five groups")
	want := []nativeUnavailable{{"hung0.example/v1", "timeout"}, {"hung1.example/v1", "timeout"}, {"hung2.example/v1", "timeout"}, {"hung3.example/v1", "timeout"}, {"refresh.example/v2", "timeout"}}
	require.Equal(t, want, unavailableWithReasons(p, "five"))
	require.Contains(t, p.catalogs["five"].bindings, "k8s:/pods")
	require.Contains(t, p.catalogs["five"].bindings, "k8s:refresh.example/widgets")
	require.Equal(t, 1, heals.armed(), "one wait, whatever the number of groups")
}

// A group that answers inside the bound is not named, however close to it; one that answers after it is.
func TestNativeExtensionGroupThatAnswersInsideTheBoundIsNotNamed(t *testing.T) {
	recordRetries(t, 3)
	recordHeals(t)
	setGroupReadBound(t, 2*time.Second)
	f, client := newRefreshHTTPFixture(t)
	f.serveGroup(t, "close.example", "gizmos")
	f.serveGroup(t, "late.example", "gadgets")
	f.setSlow("/apis/close.example/v1", 1600*time.Millisecond) // 80% of the bound
	f.setSlow("/apis/late.example/v1", 3*time.Second)          // the client gives up at 2 s
	p := refreshTestProvider()
	_, err := startOn(t, p, "bound", client, 8*time.Second)
	require.NoError(t, err)
	require.Equal(t, []nativeUnavailable{{GroupVersion: "late.example/v1", Reason: "timeout"}}, unavailableWithReasons(p, "bound"))
	require.Contains(t, p.catalogs["bound"].bindings, "k8s:close.example/gizmos", "it answered in time")
	require.NotContains(t, p.catalogs["bound"].bindings, "k8s:late.example/gadgets")
}

// The default bound is half of what is left of the acquisition deadline, so that the rest of the start has the other half, and at most five seconds.
func TestNativeGroupReadBoundIsHalfWhatIsLeftOfTheDeadlineAtMostFiveSeconds(t *testing.T) {
	within := func(deadline time.Duration) time.Duration {
		ctx, cancel := context.WithTimeout(context.Background(), deadline)
		defer cancel()
		return nativeGroupReadBound(ctx)
	}
	require.InDelta(t, float64(5*time.Second), float64(within(10*time.Second)), float64(200*time.Millisecond), "the default acquisition deadline: 5 s")
	require.InDelta(t, float64(2*time.Second), float64(within(4*time.Second)), float64(200*time.Millisecond))
	require.InDelta(t, float64(500*time.Millisecond), float64(within(time.Second)), float64(200*time.Millisecond), "the smallest acquisition deadline an operator can set")
	require.Equal(t, 5*time.Second, within(300*time.Second), "the longest one: the bound does not grow with it")
	require.Equal(t, 5*time.Second, nativeGroupReadBound(context.Background()), "no deadline: the cap")
}

// A heal attempt reads discovery again, and a group that hangs there costs one bound, not the acquisition deadline: it is named with the reason timeout, the loop goes on, nothing is
// left waiting on the group after the attempt (CI runs this with -race), and its kinds appear when it answers.
func TestNativeHealOfAGroupThatHangsCostsOneBoundAndKeepsTheLoop(t *testing.T) {
	c := newHealCase(t) // b.example/v1 and refresh.example/v2 answer 503
	setGroupReadBound(t, 400*time.Millisecond)
	c.attempt() // one cycle first, so that what a connection keeps open (idle HTTP connections) is part of the baseline
	base := stableGoroutines(t)

	c.f.setDown("/apis/b.example/v1", false)
	c.f.setSlow("/apis/b.example/v1", 0) // it black-holes the read instead of answering 503
	for range 3 {
		began := time.Now()
		c.attempt()
		took := time.Since(began)
		require.GreaterOrEqual(t, took, 400*time.Millisecond, "the group had its bound")
		require.Less(t, took, 1500*time.Millisecond, "an attempt costs one bound, not the acquisition deadline (10 s)")
		require.Equal(t, 1, c.heals.armed(), "the loop goes on")
		require.Equal(t, []nativeUnavailable{{"b.example/v1", "timeout"}, {"refresh.example/v2", "unavailable"}}, unavailableWithReasons(c.p, c.route.Connection))
	}
	require.LessOrEqual(t, stableGoroutines(t), base, "three attempts with a group that hangs leave no goroutine behind")

	snapshot, err := c.p.RefreshConnectionMetadata(context.Background(), c.route.Connection)
	require.NoError(t, err)
	fact, ok := snapshot.Entries[unavailableGroupsKey].Value.(map[string]any)
	require.True(t, ok, "the fact names the groups that do not answer")
	require.Contains(t, fact["groups"], map[string]any{"groupVersion": "b.example/v1", "reason": "timeout"})

	c.f.clearSlow("/apis/b.example/v1") // it answers
	c.attempt()
	require.Contains(t, c.tokens(), "k8s:b.example/bees", "its kinds appear without a reconnect")
	require.Equal(t, []string{"refresh.example/v2"}, c.unavailable())
	require.Equal(t, 1, c.heals.armed())
}

// Stopping the connection ends an attempt that is waiting on a hung group, long before its bound, and leaves nothing behind.
func TestNativeStoppingTheConnectionEndsAHealAttemptWaitingOnAHungGroup(t *testing.T) {
	c := newHealCase(t)
	setGroupReadBound(t, time.Minute) // only the stop can end the wait (the acquisition deadline is 10 s)
	c.attempt()
	base := stableGoroutines(t)
	c.f.setDown("/apis/b.example/v1", false)
	c.f.setSlow("/apis/b.example/v1", 0)
	expireRefresh(c.p, c.route.Connection)
	attempt := make(chan struct{})
	go func() {
		defer close(attempt)
		c.heals.fire(c.t)
	}()
	c.f.awaitWaiting(t, 1, 5*time.Second)
	began := time.Now()
	_, err := c.p.StopConnection(context.Background(), c.route.Connection)
	require.NoError(t, err)
	select {
	case <-attempt:
	case <-time.After(5 * time.Second):
		t.Fatal("the attempt kept waiting for a hung group after the connection stopped")
	}
	require.Less(t, time.Since(began), 3*time.Second, "the stop did not wait for the group")
	require.Zero(t, c.heals.armed(), "no attempt outlives the connection")
	for deadline := time.Now().Add(5 * time.Second); runtime.NumGoroutine() > base && time.Now().Before(deadline); {
		time.Sleep(20 * time.Millisecond)
	}
	require.LessOrEqual(t, runtime.NumGoroutine(), base, "a stopped connection keeps nothing")
}

// A group the catalog knows that now hangs is "listed and does not answer" like any other: its kinds stay, it is named with the reason timeout, and what answers is added.
func TestNativeHealKeepsTheKindsOfAGroupThatNowHangs(t *testing.T) {
	c := newHealCase(t) // other.example answers (things); b.example/v1 and refresh.example/v2 answer 503
	setGroupReadBound(t, 300*time.Millisecond)
	require.Contains(t, c.tokens(), "k8s:other.example/things")
	c.f.setSlow("/apis/other.example/v1", 0)
	c.f.serveGroup(t, "new.example", "gizmos") // and a group appears meanwhile
	c.attempt()
	require.Contains(t, c.tokens(), "k8s:other.example/things", "a group that hangs keeps the kinds it had")
	require.Contains(t, c.tokens(), "k8s:new.example/gizmos", "what answers is added in the same attempt")
	require.Equal(t, []nativeUnavailable{{"b.example/v1", "unavailable"}, {"other.example/v1", "timeout"}, {"refresh.example/v2", "unavailable"}}, unavailableWithReasons(c.p, c.route.Connection))
}
