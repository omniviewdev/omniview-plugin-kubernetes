package resourcers

import (
	"context"
	"fmt"
	"io"
	"maps"
	"net/http"
	"strings"
	"sync"
	"syscall"
	"testing"
	"testing/synctest"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/watch"
	fakedynamic "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/rest"
	k8stesting "k8s.io/client-go/testing"
)

// probeStep is how the fake API server answers one /version request.
type probeStep struct {
	status int           // HTTP status; ignored when err is set
	err    error         // transport failure: no HTTP response
	after  time.Duration // time the server takes to answer, in fake time
}

// probeTransport is a fake API server transport. The nth request is answered
// by steps[n]; the last step repeats once the script runs out.
type probeTransport struct {
	mu       sync.Mutex
	steps    []probeStep
	requests int
	urls     []string
	waited   []time.Duration // how long each request waited before its context ended
	finished chan struct{}   // one token per finished request
}

func newProbeTransport(steps ...probeStep) *probeTransport {
	return &probeTransport{steps: steps, finished: make(chan struct{}, 1024)}
}

func (p *probeTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	p.mu.Lock()
	step := p.steps[min(p.requests, len(p.steps)-1)]
	p.requests++
	p.urls = append(p.urls, req.URL.String())
	p.mu.Unlock()
	defer func() {
		select {
		case p.finished <- struct{}{}:
		default:
		}
	}()
	if step.after > 0 {
		start := time.Now()
		timer := time.NewTimer(step.after)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-req.Context().Done():
			p.mu.Lock()
			p.waited = append(p.waited, time.Since(start))
			p.mu.Unlock()
			return nil, req.Context().Err()
		}
	}
	if step.err != nil {
		return nil, step.err
	}
	return &http.Response{StatusCode: step.status, Status: http.StatusText(step.status), Header: make(http.Header), Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
}

func (p *probeTransport) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.requests
}

// awaitProbes blocks until n more requests have finished, letting the fake clock
// advance to each one, then lets the monitor act on the last answer. A monitor
// that stopped probing, because it reset the sessions, fails the test instead of
// deadlocking the bubble.
func (p *probeTransport) awaitProbes(t *testing.T, n int) {
	t.Helper()
	for range n {
		select {
		case <-p.finished:
		case <-time.After(time.Minute):
			t.Fatal("no probe within a minute of fake time: the monitor stopped probing")
		}
	}
	synctest.Wait()
}

func transportFailures(n int) []probeStep {
	steps := make([]probeStep, n)
	for i := range steps {
		steps[i] = probeStep{err: connectError(syscall.ECONNREFUSED)}
	}
	return steps
}

type liveSession struct {
	emitter *sourceTestEmitter
	done    chan error
}

// startLiveSessions opens count pod sources on cs and returns once each has
// delivered its snapshot. All sessions share the informer and the liveness
// monitor of cs.
func startLiveSessions(t *testing.T, cs *clients.ClientSet, count int) []*liveSession {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	sessions := make([]*liveSession, count)
	for i := range sessions {
		session := &liveSession{emitter: &sourceTestEmitter{events: make(chan sourceTestEvent, 256)}, done: make(chan error, 1)}
		sessions[i] = session
		go func() {
			session.done <- newBaseResourcer().Source(ctx, cs, resource.SourceRequest{Target: testWatchTarget(), Representation: testWatchRepresentation(), Limits: resource.SourceLimits{MaxBatchItems: resource.MaxSourceBatchItems}}, session.emitter)
		}()
	}
	t.Cleanup(func() {
		cancel()
		for _, session := range sessions {
			select {
			case <-session.done:
			case <-time.After(10 * time.Second):
				t.Error("source did not stop")
			}
		}
		synctest.Wait()
		sourceHealthMonitors.Lock()
		defer sourceHealthMonitors.Unlock()
		_, running := sourceHealthMonitors.clients[cs]
		require.False(t, running, "liveness monitor must stop with its last session")
	})
	for _, session := range sessions {
		for !nextSourceTestEvent(t, session.emitter).boundary {
		}
	}
	return sessions
}

func newLivenessClientSet(transport http.RoundTripper) *clients.ClientSet {
	cs := newFakeClientSet(defaultGVRListKinds())
	cs.RESTConfig = &rest.Config{Host: "https://api.test"}
	cs.HTTPClient = &http.Client{Transport: transport}
	return cs
}

// requireNoReset fails if any session was reset. Other events are discarded.
func requireNoReset(t *testing.T, sessions []*liveSession) {
	t.Helper()
	synctest.Wait()
	for _, session := range sessions {
		for len(session.emitter.events) > 0 {
			event := <-session.emitter.events
			require.Nil(t, event.reset, "sessions must not be reset while the API server is reachable")
		}
	}
}

// requireReset waits up to within of fake time for every session to be reset
// for lost continuity.
func requireReset(t *testing.T, sessions []*liveSession, within time.Duration) {
	t.Helper()
	deadline := time.After(within)
	for _, session := range sessions {
		for {
			select {
			case event := <-session.emitter.events:
				if event.reset == nil {
					continue
				}
				require.Equal(t, resource.SourceResetContinuityLost, event.reset.Reason)
				require.Equal(t, "Kubernetes API is unreachable; informer events are not being delivered", event.reset.Message)
			case <-deadline:
				t.Fatalf("session was not reset within %s", within)
			}
			break
		}
	}
}

// Throttling and server errors are answers: the API server is alive and the
// informers have no reason to relist against it.
func TestSourceLivenessHTTPStatusesAreNotOutages(t *testing.T) {
	for _, status := range []int{
		http.StatusTooManyRequests, http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound,
		http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout,
	} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				transport := newProbeTransport(probeStep{status: status})
				sessions := startLiveSessions(t, newLivenessClientSet(transport), 2)
				// Ten times the failure limit in probes: a count that was never
				// cleared would have fired long before.
				transport.awaitProbes(t, 10*sourceLivenessFailures)
				requireNoReset(t, sessions)
			})
		})
	}
}

// Transport failures only count when consecutive, and a probe that gets an
// answer clears the count. Two failures in a row reset every source during the
// overload that motivated this policy, so they must never be enough.
func TestSourceLivenessResetsAfterConsecutiveTransportFailures(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var steps []probeStep
		for range 2 {
			steps = append(steps, transportFailures(2)...)
			steps = append(steps, probeStep{status: http.StatusOK})
		}
		steps = append(steps, transportFailures(sourceLivenessFailures)...)
		transport := newProbeTransport(steps...)
		sessions := startLiveSessions(t, newLivenessClientSet(transport), 2)

		transport.awaitProbes(t, 6)
		requireNoReset(t, sessions)
		// The limit-th failure in a row resets every session of the connection.
		transport.awaitProbes(t, sourceLivenessFailures-1)
		requireNoReset(t, sessions)
		transport.awaitProbes(t, 1)
		requireReset(t, sessions, time.Second)
		require.Equal(t, len(steps), transport.count(), "probing stops once the sources are reset")
	})
}

// A slow answer is still an answer; only silence for the whole probe timeout
// is a failure.
func TestSourceLivenessProbeTimeout(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		// An overloaded control plane answers after more than 10 s.
		steps := []probeStep{{status: http.StatusOK, after: 14 * time.Second}}
		for range sourceLivenessFailures {
			steps = append(steps, probeStep{status: http.StatusOK, after: time.Hour})
		}
		transport := newProbeTransport(steps...)
		sessions := startLiveSessions(t, newLivenessClientSet(transport), 1)

		// The slow answer is not a failure, so the silent probes after it have
		// not yet reached the limit.
		transport.awaitProbes(t, sourceLivenessFailures)
		requireNoReset(t, sessions)
		transport.awaitProbes(t, 1)
		requireReset(t, sessions, time.Second)
		transport.mu.Lock()
		defer transport.mu.Unlock()
		require.Len(t, transport.waited, sourceLivenessFailures)
		for _, waited := range transport.waited {
			require.Equal(t, sourceLivenessTimeout, waited)
		}
	})
}

// While an informer still receives watch events or bookmarks the API server is
// reachable whatever the probe says; once the watches go quiet the failures
// count again.
func TestSourceLivenessInformerProgressSuppressesReset(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		watcher := watch.NewRaceFreeFake()
		transport := newProbeTransport(transportFailures(1)...)
		cs := newLivenessClientSet(transport)
		cs.DynamicClient.(*fakedynamic.FakeDynamicClient).PrependWatchReactor("pods", func(k8stesting.Action) (bool, watch.Interface, error) {
			return true, watcher, nil
		})
		sessions := startLiveSessions(t, cs, 2)

		// An idle cluster only delivers bookmarks, which carry the resource version.
		bookmark := func(version string) {
			pod := newTestPod("", "")
			pod.SetResourceVersion(version)
			watcher.Action(watch.Bookmark, pod)
		}
		for i := 1; i <= 10*sourceLivenessFailures; i++ {
			bookmark(fmt.Sprint(i))
			time.Sleep(sourceLivenessInterval / 2)
		}
		requireNoReset(t, sessions)
		require.Greater(t, transport.count(), 2*sourceLivenessFailures, "the probe kept failing meanwhile")

		requireReset(t, sessions, 5*sourceLivenessInterval*sourceLivenessFailures)
	})
}

// A probe that cannot be built says nothing about the API server and must not
// reset healthy sources.
func TestSourceLivenessUnavailableProbeNeverResets(t *testing.T) {
	for name, config := range map[string]*rest.Config{
		"no REST config": nil,
		"invalid host":   {Host: "http://[::1"},
	} {
		t.Run(name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				cs := newFakeClientSet(defaultGVRListKinds())
				cs.RESTConfig = config
				sessions := startLiveSessions(t, cs, 1)
				time.Sleep(time.Hour)
				requireNoReset(t, sessions)
			})
		})
	}
}

// One prober serves every session of a connection, however many are open.
func TestSourceLivenessSharesOneProbePerConnection(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		transport := newProbeTransport(probeStep{status: http.StatusOK})
		startLiveSessions(t, newLivenessClientSet(transport), 3)
		time.Sleep(100 * time.Second)
		synctest.Wait()
		// Waits are 8-12 s, so one prober makes 8-12 requests in 100 s and
		// three independent ones would make at least 24.
		require.GreaterOrEqual(t, transport.count(), 8)
		require.LessOrEqual(t, transport.count(), 12)
	})
}

func TestSourceHealthProbeURL(t *testing.T) {
	for _, tc := range []struct {
		name   string
		config rest.Config
		url    string
	}{
		{"url", rest.Config{Host: "https://api.test:6443"}, "https://api.test:6443/version"},
		{"trailing slash", rest.Config{Host: "https://api.test:6443/"}, "https://api.test:6443/version"},
		{"host and port", rest.Config{Host: "127.0.0.1:6443"}, "http://127.0.0.1:6443/version"},
		{"host and port with TLS", rest.Config{Host: "api.test:6443", TLSClientConfig: rest.TLSClientConfig{CAData: []byte("ca")}}, "https://api.test:6443/version"},
		{"proxy path prefix", rest.Config{Host: "https://proxy.test/k8s/clusters/c-1"}, "https://proxy.test/k8s/clusters/c-1/version"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			transport := newProbeTransport(probeStep{status: http.StatusOK})
			cs := &clients.ClientSet{RESTConfig: &tc.config, HTTPClient: &http.Client{Transport: transport}}
			probe, err := newSourceHealthProbe(cs)
			require.NoError(t, err)
			require.NoError(t, probe(context.Background()))
			require.Equal(t, []string{tc.url}, transport.urls)
		})
	}
}

// Only a missing response is a probe error.
func TestSourceHealthProbeReportsOnlyMissingResponses(t *testing.T) {
	for _, tc := range []struct {
		name    string
		step    probeStep
		wantErr bool
	}{
		{"ok", probeStep{status: http.StatusOK}, false},
		{"throttled", probeStep{status: http.StatusTooManyRequests}, false},
		{"unauthorized", probeStep{status: http.StatusUnauthorized}, false},
		{"server error", probeStep{status: http.StatusInternalServerError}, false},
		{"unreachable", probeStep{err: connectError(syscall.ECONNREFUSED)}, true},
		{"eof", probeStep{err: io.EOF}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cs := &clients.ClientSet{RESTConfig: &rest.Config{Host: "https://api.test"}, HTTPClient: &http.Client{Transport: newProbeTransport(tc.step)}}
			probe, err := newSourceHealthProbe(cs)
			require.NoError(t, err)
			require.Equal(t, tc.wantErr, probe(context.Background()) != nil)
		})
	}
}

// fakeWatch is an informer whose resource version the test moves.
type fakeWatch struct {
	mu      sync.Mutex
	version string
}

func (w *fakeWatch) LastSyncResourceVersion() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.version
}

func (w *fakeWatch) set(version string) {
	w.mu.Lock()
	w.version = version
	w.mu.Unlock()
}

// An informer seen for the first time only sets a baseline, and one that
// disappears is forgotten: neither counts as progress.
func TestSourceHealthMonitorObserveWatches(t *testing.T) {
	first, second := &fakeWatch{version: "1"}, &fakeWatch{version: "9"}
	monitor := &sourceHealthMonitor{watched: map[watchProgress]int{first: 1}}

	seen, progressed := monitor.observeWatches(nil)
	require.False(t, progressed, "the first observation is a baseline")
	seen, progressed = monitor.observeWatches(seen)
	require.False(t, progressed, "an unchanged version is not progress")
	first.set("2")
	seen, progressed = monitor.observeWatches(seen)
	require.True(t, progressed)
	monitor.watched[second] = 1
	seen, progressed = monitor.observeWatches(seen)
	require.False(t, progressed, "a new informer is not progress")
	second.set("10")
	seen, progressed = monitor.observeWatches(seen)
	require.True(t, progressed)
	delete(monitor.watched, first)
	seen, progressed = monitor.observeWatches(seen)
	require.False(t, progressed, "a removed informer is not progress")
	require.Equal(t, map[watchProgress]string{second: "10"}, seen)
}

// Sessions that hold the same informer share one entry, and the monitor keeps
// it until the last of them releases.
func TestSourceHealthMonitorTracksInformersPerSession(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		cs := newLivenessClientSet(newProbeTransport(probeStep{status: http.StatusOK}))
		shared, own := &fakeWatch{}, &fakeWatch{}
		watched := func() map[watchProgress]int {
			sourceHealthMonitors.Lock()
			defer sourceHealthMonitors.Unlock()
			return maps.Clone(sourceHealthMonitors.clients[cs].watched)
		}
		ctx := context.Background()
		_, releaseFirst, err := acquireSourceHealth(ctx, cs, []watchProgress{shared, own})
		require.NoError(t, err)
		_, releaseSecond, err := acquireSourceHealth(ctx, cs, []watchProgress{shared})
		require.NoError(t, err)
		require.Equal(t, map[watchProgress]int{shared: 2, own: 1}, watched())
		releaseFirst()
		require.Equal(t, map[watchProgress]int{shared: 1}, watched())
		releaseSecond()
		synctest.Wait()
		sourceHealthMonitors.Lock()
		defer sourceHealthMonitors.Unlock()
		_, running := sourceHealthMonitors.clients[cs]
		require.False(t, running, "the last release stops the monitor")
	})
}
