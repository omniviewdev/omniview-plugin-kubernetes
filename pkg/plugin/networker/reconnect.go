package networker

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"runtime/debug"
	"sync"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/utils/remoteerr"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	"k8s.io/client-go/tools/portforward"
)

const (
	// maxReconnectAttempts bounds consecutive reconnect attempts. The count
	// restarts after a tunnel stays up for healthyTunnelThreshold.
	maxReconnectAttempts = 10

	// healthyTunnelThreshold is how long a tunnel must stay up before it is
	// considered healthy: a later drop then starts a fresh reconnect budget and
	// backoff instead of consuming the one left from earlier drops.
	healthyTunnelThreshold = 30 * time.Second

	maxReconnectBackoff = 30 * time.Second
)

// reconnectClock is the time source of the reconnect loop.
type reconnectClock interface {
	Now() time.Time
	After(d time.Duration) <-chan time.Time
}

type realClock struct{}

func (realClock) Now() time.Time                         { return time.Now() }
func (realClock) After(d time.Duration) <-chan time.Time { return time.After(d) }

// reconnectLoop keeps a port-forward to a workload alive by re-resolving the
// backing pod and opening a new tunnel whenever the connection to the pod is
// lost.
type reconnectLoop struct {
	log         logging.Logger
	clock       reconnectClock
	resourceKey string
	namespace   string

	// resolve returns the pod to forward to.
	resolve func(ctx context.Context) (string, error)
	// forward opens one tunnel to podName and blocks until it closes. The
	// forwarder closes ready when it listens successfully; ready is private to
	// that single call because a forwarder closes it on every successful tunnel.
	forward func(ctx context.Context, podName string, ready chan struct{}) error

	// ready is the session-level readiness channel handed to the caller. It is
	// closed once, when the first tunnel becomes ready.
	ready     chan struct{}
	readyOnce sync.Once
}

func newReconnectLoop(log logging.Logger, resourceKey, namespace string) *reconnectLoop {
	return &reconnectLoop{
		log:         log,
		clock:       realClock{},
		resourceKey: resourceKey,
		namespace:   namespace,
		ready:       make(chan struct{}),
	}
}

func (l *reconnectLoop) signalReady() {
	l.readyOnce.Do(func() { close(l.ready) })
}

// start runs the loop in a goroutine, starting with initialPod, and returns the
// forwarder result. A panic inside the loop is reported through ErrCh.
func (l *reconnectLoop) start(ctx context.Context, initialPod string) *networker.ForwarderResult {
	errCh := make(chan error, 1)
	go func() {
		defer close(errCh)
		if err := safeCall(ctx, l.log, "workload port-forward", func() error {
			return l.run(ctx, initialPod)
		}); err != nil {
			errCh <- err
		}
	}()
	return &networker.ForwarderResult{Ready: l.ready, ErrCh: errCh}
}

// run blocks until the session ends. It returns nil on a clean shutdown or
// cancellation, and the error to surface otherwise.
func (l *reconnectLoop) run(ctx context.Context, podName string) error {
	log := l.log
	sessionStarted := time.Now()
	firstAttempt := true

	for attempt := 0; attempt < maxReconnectAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			log.Infow(ctx, "workload port-forward: context cancelled, stopping",
				"duration_ms", time.Since(sessionStarted).Milliseconds(), "outcome", "canceled")
			return nil
		}

		// On reconnect, re-resolve the backing pod.
		if !firstAttempt {
			backoff := min(time.Duration(1<<attempt)*time.Second, maxReconnectBackoff)
			log.Info(ctx, "workload port-forward: reconnecting",
				logging.String("resource_key", l.resourceKey),
				logging.Int("attempt", attempt+1),
				logging.Duration("backoff", backoff),
			)

			select {
			case <-ctx.Done():
				return nil
			case <-l.clock.After(backoff):
			}

			resolved, err := l.resolve(ctx)
			if err != nil {
				log.Warnw(ctx, "workload port-forward: failed to resolve backing pod on reconnect",
					append([]any{"attempt", attempt + 1}, diag.ClassifyError(err, false).LogFields()...)...)
				continue
			}
			podName = resolved
			log.Info(ctx, "workload port-forward: re-resolved backing pod",
				logging.String("pod", podName),
			)
		}
		firstAttempt = false

		tunnelStarted := l.clock.Now()
		fwErr := l.attempt(ctx, podName)
		if fwErr == nil {
			log.Infow(ctx, "workload port-forward: tunnel closed cleanly",
				"duration_ms", time.Since(sessionStarted).Milliseconds(), "outcome", "success")
			return nil // clean shutdown
		}
		if errors.Is(fwErr, portforward.ErrLostConnectionToPod) {
			log.Warn(ctx, "workload port-forward: lost connection to pod, will reconnect",
				logging.String("pod", podName),
				logging.String("namespace", l.namespace),
			)
			if l.clock.Now().Sub(tunnelStarted) >= healthyTunnelThreshold {
				// The tunnel was healthy for a while: this drop is a new incident, not
				// a continuation of the previous one. The loop increment makes the
				// next backoff the first one.
				attempt = 0
			}
			continue
		}
		// Unrecoverable error.
		log.Errorw(ctx, "workload port-forward: unrecoverable error",
			append([]any{"resource_id", podName, "duration_ms", time.Since(sessionStarted).Milliseconds()},
				diag.ClassifyError(fwErr, false).LogFields()...)...)
		return remoteerr.Sanitize("port-forward tunnel", fwErr)
	}

	log.Error(ctx, "workload port-forward: exceeded max reconnect attempts",
		logging.Int("max_attempts", maxReconnectAttempts),
		logging.String("resource_key", l.resourceKey),
	)
	return fmt.Errorf("exceeded %d reconnect attempts for %s", maxReconnectAttempts, l.resourceKey)
}

// attempt runs one tunnel with its own ready channel and reports the first
// readiness to the session-level channel. A panic in the tunnel is returned as
// an error.
func (l *reconnectLoop) attempt(ctx context.Context, podName string) error {
	ready := make(chan struct{})
	done := make(chan struct{})
	watched := make(chan struct{})
	go func() {
		defer close(watched)
		select {
		case <-ready:
			l.signalReady()
		case <-done:
			// The tunnel may have become ready and ended at once; do not lose that.
			select {
			case <-ready:
				l.signalReady()
			default:
			}
		}
	}()
	defer func() {
		close(done)
		<-watched
	}()

	return safeCall(ctx, l.log, "workload port-forward", func() error {
		return l.forward(ctx, podName, ready)
	})
}

// safeCall runs fn and turns a panic into an error, so a fault in a tunnel
// goroutine ends that session instead of the whole plugin process. The panic
// value and stack are logged; the returned error carries no panic text.
func safeCall(ctx context.Context, log logging.Logger, op string, fn func() error) (err error) {
	defer func() {
		if r := recover(); r != nil {
			log.Errorw(ctx, op+": tunnel panicked",
				"panic", fmt.Sprint(r),
				"stack", string(debug.Stack()),
			)
			err = remoteerr.Sanitize("port-forward tunnel", fmt.Errorf("panic: %v", r))
		}
	}()
	return fn()
}

// lineCountWriter is the tunnel's output sink. client-go writes progress lines
// to it from one goroutine per connection, so it is safe for concurrent use,
// and it keeps only a line count: nothing reads the text and the tunnel can
// live for days.
type lineCountWriter struct {
	mu          sync.Mutex
	lines       int
	partialLine bool
}

// Write counts the lines in p and discards the content.
func (w *lineCountWriter) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.lines += bytes.Count(p, []byte{'\n'})
	w.partialLine = p[len(p)-1] != '\n'
	return len(p), nil
}

// Lines returns the number of lines written so far; a trailing line without a
// newline counts as one.
func (w *lineCountWriter) Lines() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.partialLine {
		return w.lines + 1
	}
	return w.lines
}
