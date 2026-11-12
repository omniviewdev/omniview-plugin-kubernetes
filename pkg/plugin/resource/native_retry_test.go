package resource

import (
	"context"
	"crypto/x509"
	"errors"
	"io"
	"net"
	"net/url"
	"os"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// retryRecorder replaces the acquisition retry policy so tests neither sleep
// nor depend on jitter. Every pause is recorded and returns at once.
type retryRecorder struct {
	mu     sync.Mutex
	pauses []time.Duration
}

func (r *retryRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.pauses)
}

func recordRetries(t *testing.T, attempts int) *retryRecorder {
	t.Helper()
	recorder := &retryRecorder{}
	previous := nativeRetry
	nativeRetry = nativeRetryPolicy{
		attempts: attempts,
		backoff:  func(retry int) time.Duration { return time.Duration(retry) * time.Millisecond },
		pause: func(ctx context.Context, d time.Duration) error {
			recorder.mu.Lock()
			recorder.pauses = append(recorder.pauses, d)
			recorder.mu.Unlock()
			return ctx.Err()
		},
	}
	t.Cleanup(func() { nativeRetry = previous })
	return recorder
}

type fakeTimeoutError struct{ text string }

func (e fakeTimeoutError) Error() string   { return e.text }
func (e fakeTimeoutError) Timeout() bool   { return true }
func (e fakeTimeoutError) Temporary() bool { return true }

func TestNativeTransientReason(t *testing.T) {
	get := func(err error) error { return &url.Error{Op: "Get", URL: "https://cluster.example/api", Err: err} }
	for _, tc := range []struct {
		name string
		err  error
		want string
	}{
		{"closed connection", get(io.EOF), "eof"},
		{"truncated body", io.ErrUnexpectedEOF, "eof"},
		{"wrapped EOF", errors.Join(errors.New("context"), io.EOF), "eof"},
		{"connection reset", get(&net.OpError{Op: "read", Net: "tcp", Err: os.NewSyscallError("read", syscall.ECONNRESET)}), "connection_reset"},
		{"reset by peer text", get(errors.New("read tcp 127.0.0.1:1->127.0.0.1:2: read: connection reset by peer")), "eof"},
		{"http2 goaway", get(errors.New("http2: server sent GOAWAY and closed the connection; LastStreamID=1")), "eof"},
		{"http2 connection lost", get(errors.New("http2: client connection lost")), "http2_connection_lost"},
		{"tls handshake timeout", get(fakeTimeoutError{"net/http: TLS handshake timeout"}), "timeout"},
		{"dial timeout", get(&net.OpError{Op: "dial", Net: "tcp", Err: fakeTimeoutError{"i/o timeout"}}), "timeout"},
		{"too many requests", k8serrors.NewTooManyRequests("slow down", 0), "too_many_requests"},
		{"internal error", k8serrors.NewInternalError(errors.New("etcd")), "server_error"},
		{"bad gateway", &k8serrors.StatusError{ErrStatus: metav1.Status{Code: 502}}, "server_error"},
		{"service unavailable", k8serrors.NewServiceUnavailable("overloaded"), "server_error"},
		{"gateway timeout", k8serrors.NewTimeoutError("slow", 0), "server_error"},
		{"wrapped status", errors.Join(errors.New("context"), k8serrors.NewServiceUnavailable("overloaded")), "server_error"},
		// client-go waits and retries an answer that names a delay before it
		// returns it, so repeating again would multiply the waits.
		{"too many requests naming a delay", k8serrors.NewTooManyRequests("slow down", 1), ""},
		{"timeout naming a delay", k8serrors.NewTimeoutError("slow", 5), ""},
		{"nil", nil, ""},
		{"unauthorized", k8serrors.NewUnauthorized("expired"), ""},
		{"forbidden", k8serrors.NewForbidden(schema.GroupResource{Resource: "namespaces"}, "kube-system", nil), ""},
		{"not found", k8serrors.NewNotFound(schema.GroupResource{Resource: "namespaces"}, "kube-system"), ""},
		{"bad request", k8serrors.NewBadRequest("no"), ""},
		{"conflict", k8serrors.NewConflict(schema.GroupResource{Resource: "namespaces"}, "kube-system", errors.New("x")), ""},
		{"canceled", context.Canceled, ""},
		{"deadline", context.DeadlineExceeded, ""},
		{"canceled request", get(context.Canceled), ""},
		{"deadline request", get(context.DeadlineExceeded), ""},
		{"certificate", get(x509.UnknownAuthorityError{}), ""},
		{"connection refused", get(&net.OpError{Op: "dial", Net: "tcp", Err: os.NewSyscallError("connect", syscall.ECONNREFUSED)}), ""},
		{"local budget", errNativeDiscoveryBytes(), ""},
		{"other", errors.New("boom"), ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, nativeTransientReason(tc.err))
		})
	}
}

func TestRetryNativeRequestRetriesTransientFailures(t *testing.T) {
	recorder := recordRetries(t, 3)
	calls := 0
	err := retryNativeRequest(context.Background(), func() error {
		calls++
		if calls < 3 {
			return io.EOF
		}
		return nil
	})
	require.NoError(t, err)
	require.Equal(t, 3, calls)
	require.Equal(t, []time.Duration{time.Millisecond, 2 * time.Millisecond}, recorder.pauses, "backoff grows with each retry")
}

func TestRetryNativeRequestIsBounded(t *testing.T) {
	recorder := recordRetries(t, 3)
	calls := 0
	last := k8serrors.NewServiceUnavailable("overloaded")
	err := retryNativeRequest(context.Background(), func() error {
		calls++
		return last
	})
	require.Same(t, last, err, "the last error is returned unchanged")
	require.Equal(t, 3, calls)
	require.Equal(t, 2, recorder.count(), "no pause after the final attempt")
}

func TestRetryNativeRequestDoesNotRepeatFinalFailures(t *testing.T) {
	for name, failure := range map[string]error{
		"unauthorized": k8serrors.NewUnauthorized("expired"),
		"forbidden":    k8serrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "", nil),
		"budget":       errNativeDiscoveryBytes(),
		"canceled":     context.Canceled,
		"deadline":     context.DeadlineExceeded,
		"other":        errors.New("boom"),
	} {
		t.Run(name, func(t *testing.T) {
			recorder := recordRetries(t, 3)
			calls := 0
			err := retryNativeRequest(context.Background(), func() error {
				calls++
				return failure
			})
			require.True(t, err == failure, "the error is returned unchanged")
			require.Equal(t, 1, calls)
			require.Zero(t, recorder.count())
		})
	}
}

func TestRetryNativeRequestStopsWhenContextEnds(t *testing.T) {
	t.Run("during backoff", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		previous := nativeRetry
		t.Cleanup(func() { nativeRetry = previous })
		nativeRetry = nativeRetryPolicy{
			attempts: 5,
			backoff:  func(int) time.Duration { return time.Hour },
			pause:    func(ctx context.Context, _ time.Duration) error { cancel(); return ctx.Err() },
		}
		calls := 0
		err := retryNativeRequest(ctx, func() error { calls++; return io.EOF })
		require.ErrorIs(t, err, context.Canceled)
		require.Equal(t, 1, calls)
	})
	t.Run("before backoff", func(t *testing.T) {
		recorder := recordRetries(t, 5)
		ctx, cancel := context.WithCancel(context.Background())
		calls := 0
		err := retryNativeRequest(ctx, func() error { calls++; cancel(); return io.EOF })
		require.ErrorIs(t, err, context.Canceled)
		require.Equal(t, 1, calls)
		require.Zero(t, recorder.count())
	})
}

func TestNativeRetryDefaults(t *testing.T) {
	require.Equal(t, 3, nativeRetry.attempts)
	for retry := 1; retry <= 3; retry++ {
		base := 100 * time.Millisecond << (retry - 1)
		for range 200 {
			got := nativeRetryBackoff(retry)
			require.GreaterOrEqual(t, got, base)
			require.Less(t, got, base+base/2)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	require.ErrorIs(t, nativeRetryPause(ctx, time.Hour), context.Canceled, "a pause ends with its context")
	require.NoError(t, nativeRetryPause(context.Background(), time.Millisecond))
}
