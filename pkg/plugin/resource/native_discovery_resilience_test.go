package resource

import (
	"context"
	"encoding/json"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/stretchr/testify/require"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/rest"
)

func respondUnavailable(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "unavailable", http.StatusServiceUnavailable)
}

func respondTooManyRequests(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "slow down", http.StatusTooManyRequests)
}

func respondServerError(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "internal", http.StatusInternalServerError)
}

// dropConnection closes the connection without answering, which the client
// reports as EOF.
func dropConnection(w http.ResponseWriter, _ *http.Request) {
	if conn, _, err := w.(http.Hijacker).Hijack(); err == nil {
		_ = conn.Close()
	}
}

func respondStatus(code int, reason metav1.StatusReason) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(metav1.Status{
			TypeMeta: metav1.TypeMeta{Kind: "Status", APIVersion: "v1"},
			Status:   metav1.StatusFailure, Reason: reason, Code: int32(code), Message: string(reason),
		})
	}
}

// failFirst makes the first n requests for path fail with fail. Later requests
// and every other path are served normally.
func (f *refreshHTTPFixture) failFirst(path string, n int, fail func(http.ResponseWriter, *http.Request)) {
	var seen atomic.Int64
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hook = func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path != path || seen.Add(1) > int64(n) {
			return false
		}
		fail(w, r)
		return true
	}
}

func (f *refreshHTTPFixture) failAlways(path string, fail func(http.ResponseWriter, *http.Request)) {
	f.failFirst(path, math.MaxInt32, fail)
}

func startFixtureProvider(t *testing.T, client *clients.ClientSet, id string) (*kubernetesProvider, error) {
	t.Helper()
	p := refreshTestProvider()
	ctx, connection := refreshTestContext(id)
	t.Cleanup(func() { p.retireNativeCatalog(id) })
	return p, p.startNativeConnection(ctx, connection, client)
}

func TestNativeStartSurvivesTransientDiscoveryFailures(t *testing.T) {
	for _, tc := range []struct {
		name string
		path string
		fail func(http.ResponseWriter, *http.Request)
	}{
		{"/api 503", "/api", respondUnavailable},
		{"/api closed connection", "/api", dropConnection},
		{"/apis 429", "/apis", respondTooManyRequests},
		{"core group version 500", "/api/v1", respondServerError},
		{"group version 503", "/apis/refresh.example/v1", respondUnavailable},
		{"group version 429", "/apis/refresh.example/v2", respondTooManyRequests},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := recordRetries(t, 3)
			f, client := newRefreshHTTPFixture(t)
			f.failFirst(tc.path, 1, tc.fail)
			p, err := startFixtureProvider(t, client, "retry")
			require.NoError(t, err)
			require.Equal(t, 2, f.count(tc.path), "one failed request and its retry")
			require.Equal(t, 1, recorder.count())
			snapshot := p.catalogs["retry"]
			require.Equal(t, "complete", snapshot.catalog.Coverage.Kind, "a recovered request is not partial coverage")
			require.Contains(t, snapshot.bindings, "k8s:/pods")
			require.Len(t, snapshot.bindings["k8s:refresh.example/widgets"].Served, 2)
		})
	}
}

// faultTransport fails requests before they reach the server, so a test can
// exercise failures that depend on the connection rather than the response.
type faultTransport struct {
	base http.RoundTripper
	fail func(*http.Request) error
}

func (t faultTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if err := t.fail(r); err != nil {
		return nil, err
	}
	return t.base.RoundTrip(r)
}

func faultyDiscovery(t *testing.T, f *refreshHTTPFixture, fail func(*http.Request) error) discovery.DiscoveryInterface {
	t.Helper()
	d, err := discovery.NewDiscoveryClientForConfig(&rest.Config{
		Host: f.url,
		WrapTransport: func(base http.RoundTripper) http.RoundTripper {
			return faultTransport{base: base, fail: fail}
		},
	})
	require.NoError(t, err)
	return d
}

func TestNativeStartSurvivesTransportFaults(t *testing.T) {
	for _, tc := range []struct {
		name  string
		path  string
		fault error
	}{
		{"connection reset", "/apis/refresh.example/v1", &net.OpError{Op: "read", Net: "tcp", Err: os.NewSyscallError("read", syscall.ECONNRESET)}},
		{"tls handshake timeout", "/api/v1", fakeTimeoutError{"net/http: TLS handshake timeout"}},
		{"dial timeout", "/apis", &net.OpError{Op: "dial", Net: "tcp", Err: fakeTimeoutError{"i/o timeout"}}},
		{"unexpected EOF", "/api", io.ErrUnexpectedEOF},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := recordRetries(t, 3)
			f, client := newRefreshHTTPFixture(t)
			var faults atomic.Int64
			client.DiscoveryClient = faultyDiscovery(t, f, func(r *http.Request) error {
				if r.URL.Path == tc.path && faults.Add(1) == 1 {
					return tc.fault
				}
				return nil
			})
			p, err := startFixtureProvider(t, client, "fault")
			require.NoError(t, err)
			require.EqualValues(t, 2, faults.Load(), "the failed request was repeated once")
			require.Equal(t, 1, f.count(tc.path), "only the retry reached the server")
			require.Equal(t, 1, recorder.count())
			require.Equal(t, "complete", p.catalogs["fault"].catalog.Coverage.Kind)
		})
	}
}

func TestNativeStartGivesUpAfterBoundedAttempts(t *testing.T) {
	for _, path := range []string{"/api", "/apis"} {
		t.Run(path, func(t *testing.T) {
			recorder := recordRetries(t, 3)
			f, client := newRefreshHTTPFixture(t)
			f.failAlways(path, respondUnavailable)
			p, err := startFixtureProvider(t, client, "down")
			require.Error(t, err)
			require.True(t, k8serrors.IsServiceUnavailable(err), "the last transport answer is returned, got %v", err)
			require.Equal(t, 3, f.count(path), "attempts are capped")
			require.Equal(t, 2, recorder.count())
			require.NotContains(t, p.catalogs, "down")
		})
	}
	t.Run("group version becomes partial coverage", func(t *testing.T) {
		recorder := recordRetries(t, 3)
		f, client := newRefreshHTTPFixture(t)
		f.failAlways("/apis/refresh.example/v2", respondUnavailable)
		p, err := startFixtureProvider(t, client, "partial")
		require.NoError(t, err)
		require.Equal(t, 3, f.count("/apis/refresh.example/v2"))
		require.Equal(t, 2, recorder.count())
		require.Equal(t, "partial", p.catalogs["partial"].catalog.Coverage.Kind)
	})
}

func TestNativeStartDoesNotRetryAuthenticationOrAuthorization(t *testing.T) {
	unauthorized := respondStatus(http.StatusUnauthorized, metav1.StatusReasonUnauthorized)
	forbidden := respondStatus(http.StatusForbidden, metav1.StatusReasonForbidden)
	for _, tc := range []struct {
		name  string
		path  string
		fail  func(http.ResponseWriter, *http.Request)
		check func(error) bool
	}{
		{"/api 401", "/api", unauthorized, k8serrors.IsUnauthorized},
		{"/api 403", "/api", forbidden, k8serrors.IsForbidden},
		{"/apis 401", "/apis", unauthorized, k8serrors.IsUnauthorized},
		{"group version 401", "/apis/refresh.example/v1", unauthorized, k8serrors.IsUnauthorized},
		{"group version 403", "/apis/refresh.example/v1", forbidden, k8serrors.IsForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := recordRetries(t, 3)
			f, client := newRefreshHTTPFixture(t)
			f.failAlways(tc.path, tc.fail)
			p, err := startFixtureProvider(t, client, "denied")
			require.Error(t, err)
			require.True(t, tc.check(err), "got %v", err)
			require.Equal(t, 1, f.count(tc.path), "a denied request is made once")
			require.Zero(t, recorder.count())
			require.NotContains(t, p.catalogs, "denied")
		})
	}
}

func TestNativeStartStopsRetryingWhenCanceled(t *testing.T) {
	recordRetries(t, 3)
	f, client := newRefreshHTTPFixture(t)
	f.failAlways("/apis", respondUnavailable)
	p := refreshTestProvider()
	ctx, connection := refreshTestContext("canceled")
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	nativeRetry.pause = func(ctx context.Context, _ time.Duration) error { cancel(); return ctx.Err() }
	err := p.startNativeConnection(ctx, connection, client)
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, 1, f.count("/apis"), "cancellation ends the retries")
}
