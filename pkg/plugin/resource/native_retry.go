package resource

import (
	"context"
	"errors"
	"io"
	"math/rand/v2"
	"net/http"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	utilnet "k8s.io/apimachinery/pkg/util/net"
)

// Catalog acquisition issues many independent read-only requests. A loaded API
// server answers some of them with a closed connection, a handshake timeout or
// 429/5xx, and the same request a moment later usually succeeds. Such requests
// are repeated a few times inside the acquisition deadline instead of failing
// the whole connection start.
type nativeRetryPolicy struct {
	// attempts is the number of tries per request, the first included.
	attempts int
	// backoff returns the pause before retry number retry, counting from 1.
	backoff func(retry int) time.Duration
	// pause waits for d and returns ctx's error if ctx ends first.
	pause func(ctx context.Context, d time.Duration) error
}

// nativeRetry is the policy for acquisition requests. Tests replace it.
var nativeRetry = nativeRetryPolicy{attempts: 3, backoff: nativeRetryBackoff, pause: nativeRetryPause}

// nativeRetryBackoff doubles from 100 ms and adds up to 50% jitter so that
// concurrent workers do not retry in step.
func nativeRetryBackoff(retry int) time.Duration {
	d := 100 * time.Millisecond << (retry - 1)
	return d + rand.N(d/2)
}

func nativeRetryPause(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// retryNativeRequest runs a read-only request, repeating it after a short
// backoff while it fails with a transient error (see nativeTransientReason).
// Any other error, including authentication and authorization failures, local
// budget errors and cancellation, is returned at once, as is the last error
// once the attempts are used up. Backoff stops when ctx ends.
func retryNativeRequest(ctx context.Context, request func() error) error {
	policy := nativeRetry
	for attempt := 1; ; attempt++ {
		err := request()
		if err == nil {
			return nil
		}
		reason := nativeTransientReason(err)
		if reason == "" || attempt >= policy.attempts {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		trace.SpanFromContext(ctx).AddEvent("request.retry", trace.WithAttributes(
			attribute.Int("attempt", attempt), attribute.String("reason", reason)))
		if err := policy.pause(ctx, policy.backoff(attempt)); err != nil {
			return err
		}
	}
}

// nativeTransientReason names why err is a transient failure of a read-only
// request: a closed or reset connection, a timeout, or a 429/5xx answer. The
// result is a closed vocabulary safe for span attributes. It is empty when
// repeating the request cannot help: authentication, authorization and other
// client errors, local budget limits, and cancellation or deadline expiry. It is
// also empty for an answer that named a retry delay, because client-go has then
// already waited and retried until it gave up, and repeating would multiply that.
func nativeTransientReason(err error) string {
	if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return ""
	}
	var status k8serrors.APIStatus
	if errors.As(err, &status) {
		s := status.Status()
		switch {
		case s.Details != nil && s.Details.RetryAfterSeconds > 0:
			return ""
		case s.Code == http.StatusTooManyRequests:
			return "too_many_requests"
		case s.Code >= http.StatusInternalServerError:
			return "server_error"
		}
		return ""
	}
	switch {
	case utilnet.IsConnectionReset(err):
		return "connection_reset"
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF), utilnet.IsProbableEOF(err):
		return "eof"
	case utilnet.IsHTTP2ConnectionLost(err):
		return "http2_connection_lost"
	case utilnet.IsTimeout(err):
		return "timeout"
	}
	return ""
}
