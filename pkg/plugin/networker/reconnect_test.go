package networker

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/tools/portforward"
)

// fakeClock is a manual clock: After returns an already-fired channel and moves
// time forward by the requested duration, recording each wait.
type fakeClock struct {
	mu    sync.Mutex
	now   time.Time
	waits []time.Duration
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

func (c *fakeClock) After(d time.Duration) <-chan time.Time {
	c.mu.Lock()
	c.waits = append(c.waits, d)
	c.now = c.now.Add(d)
	now := c.now
	c.mu.Unlock()
	ch := make(chan time.Time, 1)
	ch <- now
	return ch
}

func (c *fakeClock) Waits() []time.Duration {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]time.Duration(nil), c.waits...)
}

// tunnelStep scripts one tunnel: how long it stays up and how it ends.
type tunnelStep struct {
	uptime time.Duration
	err    error
}

// newTestLoop builds a loop whose forward behaves like client-go's
// PortForwarder: it closes the ready channel it is given on every tunnel that
// comes up. After the script runs out it ends the session cleanly.
func newTestLoop(clock *fakeClock, steps []tunnelStep) (*reconnectLoop, *int) {
	loop := newReconnectLoop(logging.NewNop(), "k8s:/services", "ns")
	loop.clock = clock
	loop.resolve = func(context.Context) (string, error) { return "pod-b", nil }
	calls := new(int)
	loop.forward = func(_ context.Context, _ string, ready chan struct{}) error {
		step := tunnelStep{}
		if *calls < len(steps) {
			step = steps[*calls]
		}
		*calls++
		close(ready)
		clock.Advance(step.uptime)
		return step.err
	}
	return loop, calls
}

func lost() error { return portforward.ErrLostConnectionToPod }

func drain(t *testing.T, errCh <-chan error) error {
	t.Helper()
	select {
	case err, ok := <-errCh:
		if !ok {
			return nil
		}
		return err
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for the forward session to end")
		return nil
	}
}

func TestReconnectLoopSurvivesRepeatedReadyClose(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1000, 0)}
	loop, calls := newTestLoop(clock, []tunnelStep{{err: lost()}, {err: lost()}})

	result := loop.start(context.Background(), "pod-a")

	require.NoError(t, drain(t, result.ErrCh))
	assert.Equal(t, 3, *calls, "two reconnects after the first tunnel")
	select {
	case <-result.Ready:
	default:
		t.Fatal("session ready channel must be closed after the first tunnel came up")
	}
}

func TestReconnectLoopReportsFirstReadinessOnly(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1000, 0)}
	loop, _ := newTestLoop(clock, nil)
	// The first tunnel blocks after becoming ready, like a live tunnel.
	release := make(chan struct{})
	loop.forward = func(_ context.Context, _ string, ready chan struct{}) error {
		close(ready)
		<-release
		return nil
	}

	result := loop.start(context.Background(), "pod-a")

	select {
	case <-result.Ready:
	case <-time.After(10 * time.Second):
		t.Fatal("ready not reported while the tunnel is still up")
	}
	close(release)
	require.NoError(t, drain(t, result.ErrCh))
}

func TestReconnectLoopNotReadyWhenTunnelNeverComesUp(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1000, 0)}
	loop, _ := newTestLoop(clock, nil)
	loop.forward = func(context.Context, string, chan struct{}) error { return errors.New("dial failed") }

	result := loop.start(context.Background(), "pod-a")

	require.Error(t, drain(t, result.ErrCh))
	select {
	case <-result.Ready:
		t.Fatal("ready must not be closed when no tunnel came up")
	default:
	}
}

func TestReconnectLoopTunnelPanicBecomesSessionError(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1000, 0)}
	loop, _ := newTestLoop(clock, nil)
	loop.forward = func(context.Context, string, chan struct{}) error { panic("close of closed channel") }

	result := loop.start(context.Background(), "pod-a")

	err := drain(t, result.ErrCh)
	require.Error(t, err)
	assert.NotContains(t, err.Error(), "close of closed channel", "panic text must not reach the client")
}

func TestSafeCallRecoversPanic(t *testing.T) {
	err := safeCall(context.Background(), logging.NewNop(), "test", func() error { panic("boom") })
	require.Error(t, err)
	assert.NoError(t, safeCall(context.Background(), logging.NewNop(), "test", func() error { return nil }))
}

func TestReconnectBudgetIsConsecutiveWithoutHealthyTunnel(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1000, 0)}
	steps := make([]tunnelStep, 20)
	for i := range steps {
		steps[i] = tunnelStep{uptime: time.Second, err: lost()}
	}
	loop, calls := newTestLoop(clock, steps)

	result := loop.start(context.Background(), "pod-a")

	err := drain(t, result.ErrCh)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeded")
	assert.Equal(t, maxReconnectAttempts, *calls)
}

func TestReconnectBudgetAndBackoffResetAfterHealthyTunnel(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1000, 0)}
	// Four quick drops raise the backoff to 16 s; a tunnel that then stays up
	// for the healthy period starts a new incident; and so on well past the old
	// lifetime budget of 10 attempts.
	var steps []tunnelStep
	for range 3 {
		for range 4 {
			steps = append(steps, tunnelStep{uptime: time.Second, err: lost()})
		}
		steps = append(steps, tunnelStep{uptime: healthyTunnelThreshold, err: lost()})
	}
	loop, calls := newTestLoop(clock, steps)

	result := loop.start(context.Background(), "pod-a")

	require.NoError(t, drain(t, result.ErrCh), "session must outlive the old lifetime budget")
	assert.Equal(t, len(steps)+1, *calls)
	waits := clock.Waits()
	require.Len(t, waits, len(steps))
	// The backoff grows while drops follow each other, and is back at the first
	// step after every tunnel that stayed up for the healthy period. The tunnel
	// opened after a reset counts as the first reconnect of the new incident.
	sec := time.Second
	assert.Equal(t, []time.Duration{
		2 * sec, 4 * sec, 8 * sec, 16 * sec, 2 * sec,
		4 * sec, 8 * sec, 16 * sec, 30 * sec, 2 * sec,
		4 * sec, 8 * sec, 16 * sec, 30 * sec, 2 * sec,
	}, waits)
}

func TestReconnectBackoffDoesNotResetBelowHealthyThreshold(t *testing.T) {
	clock := &fakeClock{now: time.Unix(1000, 0)}
	steps := []tunnelStep{
		{uptime: healthyTunnelThreshold - time.Second, err: lost()},
		{uptime: healthyTunnelThreshold - time.Second, err: lost()},
		{uptime: healthyTunnelThreshold - time.Second, err: lost()},
	}
	loop, _ := newTestLoop(clock, steps)

	result := loop.start(context.Background(), "pod-a")

	require.NoError(t, drain(t, result.ErrCh))
	assert.Equal(t, []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second}, clock.Waits())
}

func TestLineCountWriterConcurrentWrites(t *testing.T) {
	const writers, perWriter = 50, 200
	w := new(lineCountWriter)
	var wg sync.WaitGroup
	for range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range perWriter {
				_, _ = w.Write([]byte("Handling connection for 8080\n"))
				_ = w.Lines()
			}
		}()
	}
	wg.Wait()
	assert.Equal(t, writers*perWriter, w.Lines())
}

func TestLineCountWriterRetainsNoContent(t *testing.T) {
	w := new(lineCountWriter)
	chunk := make([]byte, 1<<20)
	for range 64 {
		_, err := w.Write(chunk)
		require.NoError(t, err)
	}
	assert.Equal(t, 1, w.Lines())
}
