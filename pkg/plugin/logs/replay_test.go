package logs

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// The replay count says how many lines at the head of the stream the follow opens are replay.
// Its oracle here is the stream itself: the lines the follow stream delivers before the first
// line that is written after it opened, read as the SDK reads them (a line scanner).

const liveMarker = "LIVE-AFTER-THE-OPEN"

type replayFixture struct {
	t        *testing.T
	kubelet  *fakeKubelet
	leases   *leases
	ctx      *types.PluginContext
	openings *openings // what a count and the stream it precedes share, as the handlers of Register share it
}

func newReplayFixture(t *testing.T) *replayFixture {
	t.Helper()
	k := newFakeKubelet(t)
	return &replayFixture{
		t: t, kubelet: k, leases: newLeases(k), openings: newOpenings(nil),
		ctx: &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}},
	}
}

// request is the request the SDK hands the handler for a container of a pod in namespace "ns",
// the way the pod's source builder labels it.
func (f *replayFixture) request(pod, container string, mutate ...func(*sdklogs.LogStreamRequest)) sdklogs.LogStreamRequest {
	req := sdklogs.LogStreamRequest{
		SourceID: pod + "/" + container,
		Labels:   map[string]string{"pod": pod, "namespace": "ns", "container": container},
		Follow:   true,
	}
	for _, m := range mutate {
		m(&req)
	}
	return req
}

func (f *replayFixture) count(req sdklogs.LogStreamRequest) (int64, error) {
	return nativeReplayCountWith(f.leases.borrow, replayCountBound, f.openings)(f.ctx, req)
}

// open is the stream's open, as the SDK makes it after the count.
func (f *replayFixture) open(req sdklogs.LogStreamRequest) (io.ReadCloser, error) {
	return nativeHandlerWith(f.leases.borrow, f.openings)(f.ctx, req)
}

// streamHead opens the follow stream for req and returns the lines it delivers first. When the
// container is still running those are the lines before a marker that the fixture writes once the
// stream is open (so it is live by definition); a stream that ends by itself (a previous instance,
// a byte limit) is read to its end.
func (f *replayFixture) streamHead(c *fakeContainer, req sdklogs.LogStreamRequest) []string {
	f.t.Helper()
	return f.streamHeadEnding(c, req, req.IncludePrevious)
}

// streamHeadEnding is streamHead for a stream that the test knows ends by itself (a previous instance,
// a byte limit that cuts the tail) or runs on: a stream that must run on has to reach the live marker,
// whatever else limits it, or the test fails.
func (f *replayFixture) streamHeadEnding(c *fakeContainer, req sdklogs.LogStreamRequest, ends bool) []string {
	f.t.Helper()
	stream, err := f.open(req)
	require.NoError(f.t, err)
	defer func() { _ = stream.Close() }()
	timer := time.AfterFunc(10*time.Second, func() { _ = stream.Close() })
	defer timer.Stop()
	if c != nil && !ends {
		f.kubelet.write(c, liveMarker)
	}
	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 0, 4096), sdklogs.MaxScannerBuffer)
	var head []string
	for scanner.Scan() {
		line := scanner.Text()
		if _, content, ok := strings.Cut(line, " "); ok {
			line = content
		}
		if line == liveMarker {
			return head
		}
		head = append(head, line)
	}
	if c != nil && !ends {
		f.t.Fatalf("the stream ended before the live marker (%d lines read): %v", len(head), scanner.Err())
	}
	return head
}

func withTail(n int64) func(*sdklogs.LogStreamRequest) {
	return func(r *sdklogs.LogStreamRequest) { r.TailLines = n }
}

func TestReplayCountIsTheNumberOfLinesTheFollowStreamDeliversFirst(t *testing.T) {
	const lines = 6000 // above the 5,000 lines a finite read of the plugin is clamped to
	for _, tc := range []struct {
		name string
		tail int64
		want int
	}{
		{"the host's default tail", 1000, 1000},
		{"a tail of one", 1, 1},
		{"a tail above the finite read's clamp", 5500, 5500},
		{"a tail above the lines the container wrote", 7000, lines},
		{"no tail: the whole file", 0, lines},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newReplayFixture(t)
			c := f.kubelet.container("ns", "pod", "app")
			f.kubelet.writeNumbered(c, "app", 1, lines)
			req := f.request("pod", "app", withTail(tc.tail))

			n, err := f.count(req)
			require.NoError(t, err)
			head := f.streamHead(c, req)

			assert.Equal(t, int64(tc.want), n)
			assert.Len(t, head, tc.want, "the oracle: the lines the stream delivers before a line written after it opened")
			assert.EqualValues(t, len(head), n, "the count is the number of lines at the head of the stream")
		})
	}
}

func TestReplayCountDoesNotStopAtTheFiniteReadsBounds(t *testing.T) {
	// A finite read of the plugin stops at 1 MiB; the stream the follow opens does not.
	f := newReplayFixture(t)
	c := f.kubelet.container("ns", "pod", "app")
	payload := strings.Repeat("x", 1024)
	for i := range 3000 { // about 3.2 MB with the timestamps
		f.kubelet.write(c, fmt.Sprintf("%05d %s", i, payload))
	}
	req := f.request("pod", "app")

	n, err := f.count(req)
	require.NoError(t, err)

	assert.EqualValues(t, 3000, n)
	assert.EqualValues(t, 3000, len(f.streamHead(c, req)))
}

func TestReplayCountOfFewerLinesThanTheTailAndOfNone(t *testing.T) {
	for _, tc := range []struct {
		name  string
		lines int
	}{
		{"three lines in a tail of 1000", 3},
		{"a container that wrote nothing", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newReplayFixture(t)
			c := f.kubelet.container("ns", "pod", "app")
			f.kubelet.writeNumbered(c, "app", 1, tc.lines)
			req := f.request("pod", "app", withTail(1000))

			n, err := f.count(req)
			require.NoError(t, err)

			assert.EqualValues(t, tc.lines, n)
			assert.Len(t, f.streamHead(c, req), tc.lines)
		})
	}
}

func TestReplayCountOfThePreviousInstance(t *testing.T) {
	f := newReplayFixture(t)
	c := f.kubelet.container("ns", "pod", "app")
	f.kubelet.writeNumbered(c, "now", 1, 20)
	c.previous = newFakeLog()
	for i := range 7 {
		c.previous.append(fakeLine{at: f.kubelet.stamp(), text: fmt.Sprintf("before the restart %d", i)})
	}
	req := f.request("pod", "app", withTail(1000), func(r *sdklogs.LogStreamRequest) { r.IncludePrevious = true })

	n, err := f.count(req)
	require.NoError(t, err)

	assert.EqualValues(t, 7, n, "the count reads the instance the stream reads, not the one that runs")
	assert.Len(t, f.streamHead(c, req), 7)
	reads := f.kubelet.Reads("app")
	require.Len(t, reads, 2)
	assert.Equal(t, "true", reads[0].Query.Get("previous"))
}

func TestReplayCountOfAPreviousInstanceThatEndsInARecordWithNoLineFeed(t *testing.T) {
	// A running container's last record with no line feed is held back from a follow. The stream of a
	// previous instance ends where its log does, so its reader gets that record as a line, and it is
	// counted (a kubelet answers for an instance it no longer has with a sentence of this kind).
	f := newReplayFixture(t)
	c := f.kubelet.container("ns", "pod", "app")
	c.previous = newFakeLog()
	for i := range 3 {
		c.previous.append(fakeLine{at: f.kubelet.stamp(), text: fmt.Sprintf("before the restart %d", i)})
	}
	c.previous.writePartial("the container's log is gone")
	req := f.request("pod", "app", withTail(1000), func(r *sdklogs.LogStreamRequest) { r.IncludePrevious = true })

	n, err := f.count(req)
	require.NoError(t, err)

	assert.EqualValues(t, 4, n)
	assert.Len(t, f.streamHead(c, req), 4)
}

func TestReplayCountOfAContainerWithNoPreviousInstanceIsAnError(t *testing.T) {
	f := newReplayFixture(t)
	f.kubelet.writeNumbered(f.kubelet.container("ns", "pod", "app"), "now", 1, 20)
	req := f.request("pod", "app", func(r *sdklogs.LogStreamRequest) { r.IncludePrevious = true })

	n, err := f.count(req)

	require.Error(t, err, "a refused count is an error: a zero would mark the source caught up before its replay")
	assert.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
	assert.Zero(t, n)
}

// withoutLimit is a query without its byte limit.
func withoutLimit(q url.Values) url.Values {
	out := url.Values{}
	for k, v := range q {
		if k != "limitBytes" {
			out[k] = v
		}
	}
	return out
}

// queryWithoutFollow is the query of a log request with follow removed.
func queryWithoutFollow(q url.Values) url.Values {
	out := url.Values{}
	for k, v := range q {
		if k != "follow" {
			out[k] = v
		}
	}
	return out
}

func TestReplayCountAsksForTheStreamsLinesAndNothingElse(t *testing.T) {
	since := time.Date(2026, 11, 22, 9, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name   string
		mutate func(*sdklogs.LogStreamRequest)
		check  func(t *testing.T, q url.Values)
	}{
		{"nothing set", func(*sdklogs.LogStreamRequest) {}, func(t *testing.T, q url.Values) {
			assert.False(t, q.Has("tailLines"))
			assert.False(t, q.Has("limitBytes"))
		}},
		{"a tail, the previous instance, a limit and a window", func(r *sdklogs.LogStreamRequest) {
			r.TailLines, r.IncludePrevious, r.LimitBytes, r.SinceSeconds = 1000, true, 65536, 30
		}, func(t *testing.T, q url.Values) {
			assert.Equal(t, "1000", q.Get("tailLines"))
			assert.Equal(t, "true", q.Get("previous"))
			assert.False(t, q.Has("sinceSeconds"), "a relative window is resolved to an instant, once, for the count and the stream")
			assert.Regexp(t, `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$`, q.Get("sinceTime"), "an instant floored to the second")
		}},
		{"since a time, which wins over seconds", func(r *sdklogs.LogStreamRequest) {
			r.SinceTime, r.SinceSeconds = &since, 30
		}, func(t *testing.T, q url.Values) {
			assert.Equal(t, since.Format(time.RFC3339), q.Get("sinceTime"))
			assert.False(t, q.Has("sinceSeconds"))
		}},
		{"limits above the finite read's own", func(r *sdklogs.LogStreamRequest) {
			r.TailLines, r.LimitBytes = 6000, 2<<20
		}, func(t *testing.T, q url.Values) {
			assert.Equal(t, "6000", q.Get("tailLines"), "not clamped to 5000")
		}},
		{"the container named by the target, not by a label", func(r *sdklogs.LogStreamRequest) {
			delete(r.Labels, "container")
			r.Target = "app"
		}, func(t *testing.T, q url.Values) {
			assert.Equal(t, "app", q.Get("container"))
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newReplayFixture(t)
			c := f.kubelet.container("ns", "pod", "app")
			c.previous = newFakeLog()
			f.kubelet.writeNumbered(c, "app", 1, 10)
			req := f.request("pod", "app", tc.mutate)

			_, err := f.count(req)
			require.NoError(t, err)
			stream, err := f.open(req)
			require.NoError(t, err)
			require.NoError(t, stream.Close())

			reads := f.kubelet.Reads("app")
			require.Len(t, reads, 2, "one read to count, one to stream")
			counted, streamed := reads[0].Query, reads[1].Query
			assert.Empty(t, counted.Get("follow"), "the count is a finite read: follow is not asked for")
			assert.Equal(t, "true", streamed.Get("follow"))
			assert.Equal(t, withoutLimit(queryWithoutFollow(streamed)), withoutLimit(queryWithoutFollow(counted)), "the count asks for the lines of the stream, and for nothing else")
			if req.LimitBytes > 0 {
				assert.Equal(t, strconv.FormatInt(req.LimitBytes, 10), streamed.Get("limitBytes"), "the stream's limit is the request's, unclamped")
				assert.Equal(t, strconv.FormatInt(req.LimitBytes+replayCountCutSlack, 10), counted.Get("limitBytes"), "the count asks for a little more than the limit, to see whether the record it cuts is a whole one")
			} else {
				assert.False(t, counted.Has("limitBytes"))
			}
			assert.Equal(t, "true", counted.Get("timestamps"), "the bytes of a byte limit include the timestamps the stream carries")
			tc.check(t, counted)
		})
	}
}

func TestReplayCountOfARefusalIsAnErrorOfTheClassTheStreamsOpenGets(t *testing.T) {
	for _, tc := range []struct {
		name  string
		setup func(c *fakeContainer)
		code  string
	}{
		{"a container that has not started", func(c *fakeContainer) { c.waiting = "ContainerCreating" }, "INVALID_REQUEST"},
		{"a refused user", func(c *fakeContainer) { c.status = http.StatusForbidden }, "FORBIDDEN"},
		{"a pod that is gone", func(c *fakeContainer) { c.status = http.StatusNotFound }, "NOT_FOUND"},
		{"a server error", func(c *fakeContainer) { c.status = http.StatusInternalServerError }, "PROVIDER_ERROR"},
		{"an unavailable server", func(c *fakeContainer) { c.status = http.StatusServiceUnavailable }, "UNAVAILABLE"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newReplayFixture(t)
			c := f.kubelet.container("ns", "pod", "app")
			f.kubelet.writeNumbered(c, "app", 1, 5)
			tc.setup(c)
			req := f.request("pod", "app", withTail(100))

			n, err := f.count(req)

			require.Error(t, err, "a refused count is an error: a zero would mark the source caught up before its replay")
			assert.Equal(t, tc.code, resourcev2.ErrorCode(err))
			assert.Zero(t, n)
			_, opened := nativeHandler(f.leases.borrow)(f.ctx, req)
			require.Error(t, opened)
			assert.Equal(t, resourcev2.ErrorCode(opened), resourcev2.ErrorCode(err), "the stream's open fails with the same class")
		})
	}
}

func TestReplayCountOfAnErrorNeverCarriesTheKubernetesText(t *testing.T) {
	sink := captureDefaultLogs(t)
	exporter := captureSpans(t)
	f := newReplayFixture(t)
	c := f.kubelet.container("ns", "pod", "app")
	c.serve = func(w http.ResponseWriter, _ *http.Request) {
		fakeStatus(w, http.StatusForbidden, "Forbidden", "secret-denied-text")
	}

	_, err := f.count(f.request("pod", "app"))

	require.Error(t, err)
	assert.NotContains(t, err.Error(), "secret")
	assert.NotContains(t, recordText(sink), "secret")
	for _, span := range exporter.GetSpans() {
		assert.NotContains(t, span.Status.Description, "secret")
		for _, attr := range span.Attributes {
			assert.NotContains(t, attr.Value.String(), "secret")
		}
	}
}

// bodies serves a raw body for every request of a container, whatever its query.
func bodies(body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, body)
	}
}

func TestReplayCountCountsLineFeeds(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
		want int64
	}{
		{"lines that end with a line feed", "a\nb\nc\n", 3},
		{"a last record with no line feed is not a line yet", "a\nb\nc", 2},
		{"a body of one incomplete record", "no newline yet", 0},
		{"CRLF is one line feed", "a\r\nb\r\nc\r\n", 3},
		{"a CR alone is not a line", "a\rb\rc\n", 1},
		{"empty lines are lines", "\n\n\n", 3},
		{"an empty body", "", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newReplayFixture(t)
			f.kubelet.container("ns", "pod", "app").serve = bodies(tc.body)

			n, err := f.count(f.request("pod", "app"))

			require.NoError(t, err)
			assert.Equal(t, tc.want, n)
		})
	}
}

func TestReplayCountDoesNotCountTheRecordTheStreamHoldsBack(t *testing.T) {
	// A kubelet ends a finite read with the record that has no line feed yet, and holds that record
	// back from a follow until it is complete: it is not part of the stream's replay.
	f := newReplayFixture(t)
	c := f.kubelet.container("ns", "pod", "app")
	f.kubelet.writeNumbered(c, "app", 1, 4)
	c.current.writePartial("app 000005 still being writ")
	req := f.request("pod", "app", withTail(100))

	n, err := f.count(req)
	require.NoError(t, err)

	assert.EqualValues(t, 4, n)
	assert.Len(t, f.streamHead(c, req), 4)
}

func TestReplayCountOfATailCutByTheByteLimit(t *testing.T) {
	// The kubelet writes limitBytes bytes of the tail and ends the response, follow or not, in the
	// middle of a line if the limit falls there; the SDK's reader delivers that fragment as a line.
	const rendered = int64(30 + 1 + len("app 000001") + 1) // a timestamp, a space, the text and a line feed
	for _, tc := range []struct {
		name  string
		limit int64
		want  int
		ends  bool // the limit cuts the tail: the stream ends by itself
	}{
		{"a limit that ends in the middle of a line", 4*rendered + 10, 5, true},
		{"a limit that ends on a line feed", 4 * rendered, 4, true},
		{"a limit above what the tail holds", 100 * rendered, 10, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newReplayFixture(t)
			c := f.kubelet.container("ns", "pod", "app")
			f.kubelet.writeNumbered(c, "app", 1, 10)
			req := f.request("pod", "app", withTail(1000), func(r *sdklogs.LogStreamRequest) { r.LimitBytes = tc.limit })

			n, err := f.count(req)
			require.NoError(t, err)

			head := f.streamHeadEnding(c, req, tc.ends)
			assert.Len(t, head, tc.want)
			assert.EqualValues(t, len(head), n, "the count is the number of lines the stream delivers first, the cut one included")
		})
	}
}

// countingReader reports the largest read it was asked for.
type countingReader struct {
	r       io.Reader
	largest int
	total   int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	if len(p) > c.largest {
		c.largest = len(p)
	}
	n, err := c.r.Read(p)
	c.total += int64(n)
	return n, err
}

func TestCountLinesHoldsNoLineInMemory(t *testing.T) {
	// A line of 1 GiB, then a few small ones: a counter that reads a line before it counts it would hold 1 GiB.
	const huge = int64(1) << 30
	body := io.MultiReader(
		io.LimitReader(xReader{}, huge),
		strings.NewReader("\nsecond\nthird\n"),
	)
	reader := &countingReader{r: body}

	got, err := countLines(reader, 0)

	require.NoError(t, err)
	assert.EqualValues(t, 3, got.lines)
	assert.Greater(t, got.bytes, huge)
	assert.Equal(t, got.bytes, reader.total)
	assert.LessOrEqual(t, reader.largest, replayCountChunk, "every read is bounded by the chunk, whatever the line")
}

// xBlock is what xReader hands out, so that a reader of gigabytes costs a copy and not a loop.
var xBlock = []byte(strings.Repeat("x", 64<<10))

// xReader yields 'x' for ever.
type xReader struct{}

func (xReader) Read(p []byte) (int, error) {
	return copy(p, xBlock), nil
}

func TestReplayCountOfAHugeLineAllocatesNothingOfItsSize(t *testing.T) {
	const size = 192 << 20 // one line of 192 MiB, then two small ones
	f := newReplayFixture(t)
	f.kubelet.container("ns", "pod", "app").serve = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		chunk := []byte(strings.Repeat("x", 64<<10))
		for written := 0; written < size; written += len(chunk) {
			if _, err := w.Write(chunk); err != nil {
				return
			}
		}
		_, _ = io.WriteString(w, "\nsecond\nthird\n")
	}
	req := f.request("pod", "app")

	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	n, err := f.count(req)
	runtime.ReadMemStats(&after)

	require.NoError(t, err)
	assert.EqualValues(t, 3, n)
	allocated := after.TotalAlloc - before.TotalAlloc
	assert.Less(t, allocated, uint64(8<<20), "a count of a %d MiB body allocated %d bytes: its memory is the chunk's, not the body's", size>>20, allocated)
}

func TestReplayCountThatTakesLongerThanItsBoundIsUnknown(t *testing.T) {
	const bound = 60 * time.Millisecond
	for _, tc := range []struct {
		name  string
		serve func(released chan<- struct{}) func(http.ResponseWriter, *http.Request)
	}{
		{"a read that never answers", func(released chan<- struct{}) func(http.ResponseWriter, *http.Request) {
			return func(_ http.ResponseWriter, r *http.Request) {
				<-r.Context().Done()
				released <- struct{}{}
			}
		}},
		{"a body that never ends", func(released chan<- struct{}) func(http.ResponseWriter, *http.Request) {
			return func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
				for {
					if _, err := io.WriteString(w, "a line\n"); err != nil {
						released <- struct{}{}
						return
					}
					w.(http.Flusher).Flush()
					select {
					case <-r.Context().Done():
						released <- struct{}{}
						return
					case <-time.After(5 * time.Millisecond):
					}
				}
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newReplayFixture(t)
			released := make(chan struct{}, 1)
			f.kubelet.container("ns", "pod", "app").serve = tc.serve(released)
			exporter := captureSpans(t)

			started := time.Now()
			n, err := nativeReplayCountWithin(f.leases.borrow, bound)(f.ctx, f.request("pod", "app"))
			took := time.Since(started)

			require.NoError(t, err, "a count that is not had in time is unknown, not a failed open")
			assert.Equal(t, replayUnknown, n, "no number is guessed: the replay's end is not given, so the source stays unknown")
			assert.GreaterOrEqual(t, took, bound)
			assert.Less(t, took, 10*bound+time.Second)
			select {
			case <-released:
			case <-time.After(5 * time.Second):
				t.Fatal("the count left its request open")
			}
			assert.Zero(t, f.leases.held.Load(), "the lease of the client is given back")
			spans := exporter.GetSpans()
			require.Len(t, spans, 1)
			attrs := map[string]string{}
			for _, attr := range spans[0].Attributes {
				attrs[string(attr.Key)] = attr.Value.String()
			}
			assert.Equal(t, "true", attrs["replay.unknown"])
		})
	}
}

func TestReplayCountThatIsCancelledIsAnErrorNotUnknown(t *testing.T) {
	f := newReplayFixture(t)
	arrived := make(chan struct{})
	f.kubelet.container("ns", "pod", "app").serve = func(_ http.ResponseWriter, r *http.Request) {
		close(arrived)
		<-r.Context().Done()
	}
	ctx, cancel := context.WithCancel(context.Background())
	f.ctx = &types.PluginContext{Context: ctx, Connection: &types.Connection{ID: "selected"}}
	go func() {
		<-arrived
		cancel()
	}()

	n, err := nativeReplayCountWithin(f.leases.borrow, time.Minute)(f.ctx, f.request("pod", "app"))

	require.ErrorIs(t, err, context.Canceled, "a source that was removed is not a source with an unknown replay")
	assert.Zero(t, n)
	assert.Zero(t, f.leases.held.Load())
}

func TestReplayCountHoldsTheClientOnlyWhileItCounts(t *testing.T) {
	f := newReplayFixture(t)
	c := f.kubelet.container("ns", "pod", "app")
	f.kubelet.writeNumbered(c, "app", 1, 5)
	var heldDuring atomic.Int32
	f.kubelet.setOnRequest(func(int, url.Values) { heldDuring.Store(f.leases.held.Load()) })

	_, err := f.count(f.request("pod", "app"))

	require.NoError(t, err)
	assert.EqualValues(t, 1, heldDuring.Load(), "the generation lease is held while the read runs")
	assert.Zero(t, f.leases.held.Load(), "and given back when the count is had")
	assert.EqualValues(t, 1, f.leases.taken.Load())
	routes := f.leases.Routes()
	require.Len(t, routes, 1)
	assert.Equal(t, "selected", routes[0].Connection, "the count borrows the connection's client by its ID, as the stream does")
}

func TestReplayCountRunsAtTheSameTimeForDifferentSources(t *testing.T) {
	f := newReplayFixture(t)
	const sources = 12
	var inFlight, peak atomic.Int32
	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseAll := func() { releaseOnce.Do(func() { close(release) }) }
	t.Cleanup(releaseAll) // a failed assertion must not leave the held requests blocking the server's close
	for i := range sources {
		c := f.kubelet.container("ns", "pod", fmt.Sprintf("c%d", i))
		f.kubelet.writeNumbered(c, fmt.Sprintf("c%d", i), 1, i+1)
	}
	f.kubelet.setOnRequest(func(int, url.Values) {
		now := inFlight.Add(1)
		for {
			old := peak.Load()
			if now <= old || peak.CompareAndSwap(old, now) {
				break
			}
		}
		<-release
		inFlight.Add(-1)
	})
	counts := make([]int64, sources)
	var wg sync.WaitGroup
	for i := range sources {
		wg.Add(1)
		go func() {
			defer wg.Done()
			n, err := f.count(f.request("pod", fmt.Sprintf("c%d", i)))
			assert.NoError(t, err)
			counts[i] = n
		}()
	}
	require.Eventually(t, func() bool { return inFlight.Load() == sources }, 5*time.Second, time.Millisecond, "the counts of different sources do not wait for one another")
	releaseAll()
	wg.Wait()

	for i := range sources {
		assert.EqualValues(t, i+1, counts[i], "each source is counted for its own container")
	}
}

func TestReplayCountNeverReturnsANegativeNumber(t *testing.T) {
	f := newReplayFixture(t)
	for _, body := range []string{"", "\n", "a\nb\n", strings.Repeat("x\n", 5000)} {
		f.kubelet.container("ns", "pod", "app").serve = bodies(body)
		n, err := f.count(f.request("pod", "app"))
		require.NoError(t, err)
		assert.GreaterOrEqual(t, n, int64(0))
	}
}

func TestReplayCountResolvesTheContainerThroughTheStreamsRules(t *testing.T) {
	f := newReplayFixture(t)
	f.kubelet.writeNumbered(f.kubelet.container("ns", "pod", "app"), "app", 1, 2)
	for _, tc := range []struct {
		name   string
		mutate func(*sdklogs.LogStreamRequest)
	}{
		{"a source of another namespace than the resource's", func(r *sdklogs.LogStreamRequest) {
			r.Route = &resourcev2.AccessRoute{Connection: "selected"}
			r.Reference = &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
				Provider: "kubernetes", Authority: "host-owned", Type: "k8s:/pods",
				Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "other"}}, ID: "pod",
			}}
		}},
		{"a source of another pod than the resource's", func(r *sdklogs.LogStreamRequest) {
			r.Route = &resourcev2.AccessRoute{Connection: "selected"}
			r.Reference = &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
				Provider: "kubernetes", Authority: "host-owned", Type: "k8s:/pods",
				Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "ns"}}, ID: "pod",
			}}
			r.Labels["pod"] = "another"
		}},
		{"a pod nobody named", func(r *sdklogs.LogStreamRequest) { delete(r.Labels, "pod") }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := f.request("pod", "app", tc.mutate)

			_, err := f.count(req)
			require.Error(t, err)
			_, opened := nativeHandler(f.leases.borrow)(f.ctx, req)
			require.Error(t, opened)

			assert.Equal(t, resourcev2.ErrorCode(opened), resourcev2.ErrorCode(err))
			assert.Empty(t, f.kubelet.Requests(), "refused before any request, as the stream's open is")
		})
	}
}

func TestReplayCountOfACanonicalReferenceReadsOnlyTheLog(t *testing.T) {
	// The host opens a Pod's logs by the Pod's canonical reference and the connection's route, with
	// no Pod name in the labels: the count resolves the container as the stream does, and reads the
	// log and nothing else (the fake refuses every other request).
	f := newReplayFixture(t)
	c := f.kubelet.container("ns", "pod", "app")
	f.kubelet.writeNumbered(c, "app", 1, 37)
	ref := &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
		Provider: "kubernetes", Authority: "host-owned", Type: "k8s:/pods",
		Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "ns"}}, ID: "pod",
	}}
	req := sdklogs.LogStreamRequest{
		Reference: ref, Route: &resourcev2.AccessRoute{Connection: "selected"},
		Labels: map[string]string{"container": "app"}, Follow: true, TailLines: 1000,
	}

	n, err := f.count(req)

	require.NoError(t, err)
	assert.EqualValues(t, 37, n)
	assert.Len(t, f.streamHead(c, req), 37)
	for _, read := range f.kubelet.Requests() {
		assert.Equal(t, "app", read.Container)
	}
}

func TestReplayCountIsLoggedAndTraced(t *testing.T) {
	sink := captureDefaultLogs(t)
	exporter := captureSpans(t)
	f := newReplayFixture(t)
	f.kubelet.writeNumbered(f.kubelet.container("ns", "pod", "app"), "app", 1, 42)

	n, err := f.count(f.request("pod", "app", withTail(1000)))

	require.NoError(t, err)
	assert.EqualValues(t, 42, n)
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, "kubernetes.logs.replay.count", spans[0].Name)
	attrs := map[string]string{}
	for _, attr := range spans[0].Attributes {
		attrs[string(attr.Key)] = attr.Value.String()
	}
	assert.Equal(t, "success", attrs["outcome"])
	assert.Equal(t, "42", attrs["replay.lines"])
	assert.Equal(t, "false", attrs["replay.unknown"])
	assert.Equal(t, "1000", attrs["tail_lines"])
	text := recordText(sink)
	assert.Contains(t, text, "native log replay counted")
	assert.Contains(t, text, "lines=42")
	assert.NotContains(t, text, "app 0000", "no log text is logged")
}

func TestHandlerDeclaresReplayCountBesideTheStream(t *testing.T) {
	f := newReplayFixture(t)

	pods, ok := handlers(f.leases.borrow)["k8s:/pods"]

	require.True(t, ok)
	require.NotNil(t, pods.Handler)
	require.NotNil(t, pods.ReplayCount, "a Pod's logs declare the count of their replay: without it a reader that asks gets no marker")
	require.NotNil(t, pods.SourceBuilder)
}
