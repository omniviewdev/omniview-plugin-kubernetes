package logs

import (
	"fmt"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// fakeClock is a clock the test moves.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// newReplayFixtureClock is a fixture whose kubelet and plugin read one clock the test moves.
func newReplayFixtureClock(t *testing.T, clock *fakeClock) *replayFixture {
	t.Helper()
	f := newReplayFixture(t)
	f.kubelet.setNow(clock.Now)
	f.openings = newOpenings(clock.Now)
	return f
}

// since: the count and the stream each count back from "now" when the kubelet receives them, so a window
// of sinceSeconds starts a little later for the stream than it did for the count, and the stream delivers
// fewer old lines than were counted. The plugin resolves the window once, to a second, for both.
func TestTheWindowOfSinceSecondsStartsAtTheSameInstantForTheCountAndTheStream(t *testing.T) {
	t0 := time.Date(2026, 11, 22, 10, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name   string
		offset time.Duration // how far into a second the plugin's clock is when it counts
	}{
		{"the clock is on a second", 0},
		{"the clock is inside a second", 900 * time.Millisecond},
	} {
		t.Run(tc.name, func(t *testing.T) {
			clock := &fakeClock{t: t0.Add(tc.offset)}
			f := newReplayFixtureClock(t, clock)
			c := f.kubelet.container("ns", "pod", "app")
			for _, before := range []time.Duration{10 * time.Second, 9900 * time.Millisecond, 9700 * time.Millisecond, 8900 * time.Millisecond, 5 * time.Second, time.Second} {
				c.current.append(fakeLine{at: t0.Add(-before), text: fmt.Sprintf("written %v before", before)})
			}
			// The stream's request reaches the kubelet half a second after the count's did.
			f.kubelet.setOnRequest(func(_ int, q url.Values) {
				if q.Get("follow") == "true" {
					clock.Advance(500 * time.Millisecond)
				}
			})
			req := f.request("pod", "app", func(r *sdklogs.LogStreamRequest) { r.SinceSeconds = 10 })

			n, err := f.count(req)
			require.NoError(t, err)
			head := f.streamHead(c, req)

			assert.Len(t, head, 6, "the window starts at the second the count resolved: all six lines are in it")
			assert.EqualValues(t, len(head), n, "the stream delivers the lines the count counted")
			reads := f.kubelet.Reads("app")
			require.Len(t, reads, 2)
			cutoff := t0.Add(-10 * time.Second).Format(time.RFC3339)
			for _, read := range reads {
				assert.Equal(t, cutoff, read.Query.Get("sinceTime"), "both reads start at the one instant, floored to the second")
				assert.False(t, read.Query.Has("sinceSeconds"))
			}
		})
	}
}

func TestAStreamOpenedWithoutACountKeepsItsRelativeWindow(t *testing.T) {
	// A reader that did not ask is never counted: its stream is the request it always was.
	f := newReplayFixture(t)
	f.kubelet.writeNumbered(f.kubelet.container("ns", "pod", "app"), "app", 1, 3)

	stream, err := f.open(f.request("pod", "app", func(r *sdklogs.LogStreamRequest) { r.SinceSeconds = 10 }))
	require.NoError(t, err)
	require.NoError(t, stream.Close())

	reads := f.kubelet.Reads("app")
	require.Len(t, reads, 1)
	assert.Equal(t, "10", reads[0].Query.Get("sinceSeconds"))
	assert.False(t, reads[0].Query.Has("sinceTime"))
}

// byte limit, shape two: a running container's last record has no line feed yet and a follow holds it
// back, so a stream whose limit falls inside that record does not end there and never delivers it.
func TestReplayCountOfAByteLimitThatCutsTheRecordAContainerIsStillWriting(t *testing.T) {
	const rendered = int64(30 + 1 + len("app 000001") + 1)
	for _, tc := range []struct {
		name  string
		limit int64
		ends  bool // the limit is reached by complete records: the stream ends by itself
	}{
		{"the limit falls inside the unfinished record", 4*rendered + 55, false},
		{"the limit falls on the line feed before it", 4 * rendered, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newReplayFixture(t)
			c := f.kubelet.container("ns", "pod", "app")
			f.kubelet.writeNumbered(c, "app", 1, 4)
			c.current.writePartial("app 000005 still being writ")
			req := f.request("pod", "app", withTail(1000), func(r *sdklogs.LogStreamRequest) { r.LimitBytes = tc.limit })

			n, err := f.count(req)
			require.NoError(t, err)

			head := f.streamHeadEnding(c, req, tc.ends)
			assert.Len(t, head, 4)
			assert.EqualValues(t, len(head), n, "the count does not count a fragment the stream never delivers")
		})
	}
}
