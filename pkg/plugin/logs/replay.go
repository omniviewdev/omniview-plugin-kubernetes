package logs

import (
	"bytes"
	"context"
	"errors"
	"io"
	"math"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/kubernetes"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// Replay count: the plugin's half of the SDK's replay markers (plugin-sdk v0.22.0).
//
// A reader that asks for replay markers is told where each source's replay ends: the SDK flags
// the first n lines of the stream a handler opens as replay and sends a caught-up event after
// the n-th. n is the handler's to say, and a Pod's handler says it with one more read of the
// container's log: the same request as the stream's, with follow off, read to its end and
// counted. The count is made before each opening of a source, so it delays that opening.
//
// What the count owes the stream:
//
//   - It counts what the stream will deliver first, not what the container holds. The request is
//     the stream's own (podLogOptions: tail, since, previous, limit, container, timestamps) with
//     Follow off, and none of the finite read's clamps (a finite read of the plugin stops at 5,000
//     lines and 1 MiB, a stream does not: a clamped count would be early).
//   - A window of sinceSeconds starts at one instant for both: the kubelet counts back from the
//     moment it receives each request, so the stream's window would start later than the count's by
//     the time the open takes, and the stream would deliver fewer old lines than were counted. The
//     count resolves the window once, to a time floored to the second (the precision of sinceTime),
//     and the stream of the same opening uses that time (openings).
//   - It counts the lines the SDK's reader will read, as that reader reads them: a line is what a
//     line feed ends. A record that has no line feed yet (the kubelet ends a finite read with it
//     and holds it back from a follow of a running container until it is complete) is not a line.
//     The last record of a stream that ENDS where the body does is one, because the reader gets what
//     is left at the end: a previous instance (its follow ends at its end) and a byte limit that
//     cuts a record that is whole in the log (the kubelet cuts the follow at the same byte and
//     ends it). A limit that falls inside a record that is not whole is not one: the follow holds
//     that record back, so it neither ends there nor delivers it. The count asks for a little more
//     than the stream's limit (replayCountCutSlack) and applies the limit itself, to see which it is.
//   - It changes nothing about the stream. It only reads, and the stream is opened as it always
//     was, with the request it always had (but for the resolved since time).
//
// What it costs: one extra read of the same tail per opened source (+12 ms and 0.1 MB for the
// host's default tail of 1,000 lines of 100 bytes, +86 ms and 10 MB for a tail of 10 MB, measured
// by the SDK's review on loopback), and no memory of its own beyond one chunk (replayCountChunk)
// per count at a time, whatever the tail, the byte limit or the length of a line: the body is
// counted as it arrives and dropped.
//
// What bounds it: replayCountBound, for the whole read, from the request to the last byte. A count
// that is not had by then is not a failed open (the stream would have opened): see replayUnknown.

// replayCountBound is the longest a replay count may take, from the request to the last byte. The
// opening of a source waits for its count, and so do SESSION_READY and the source's slot among the
// session's twenty, and the SDK adds no timer to it: this is the longest the count can delay a
// source's first line. A count costs milliseconds on loopback (12 ms for the host's default tail of
// 1,000 small lines, 86 ms for a tail of 10 MB) and the transfer of the tail on a real link: 5 s is
// 10 MB at 16 Mbit/s. A count slower than that is a stalled kubelet or a very slow link, and the
// stream that follows it would be slow too.
const replayCountBound = 5 * time.Second

// replayUnknown is what a count returns when it was not had within its bound. It means exactly
// this: THE COUNT COULD NOT BE HAD WITHIN replayCountBound, SO THIS OPENING IS NEVER MARKED CAUGHT
// UP. A consumer must treat a source that is not yet marked as UNKNOWN, and must not use the
// per-line flag of an unmarked source as a fact: every line of that opening is flagged replay, live
// ones too.
//
// It is a workaround for a signal the producer lacks. plugin-sdk v0.22.0 has no way for
// ReplayCount to say "the end of this replay is not known": a count is a number of lines or an
// error, and an error fails the attempt as a failed open does (the open is retried with the SDK's
// backoff, five times, then reported), so the logs of a container whose tail is merely slow to
// count would not open at all, and the stream is not what failed. What the SDK does document is
// the state of a source that asked and is not caught up: unknown. A count that the stream never
// reaches puts a source there: no line is the last of the replay, so no caught-up event comes. The
// SDK names that as the likeliest mistake of a count; here it is chosen, and only here. No number
// is guessed: not zero, which would mark the source caught up before its replay, and not the lines
// counted so far, which would mark it early. The next opening of the source (a reconnect, a source
// enabled again) counts again. The answer the SDK should give instead is specified in
// docs/status/SDK3-k8s.md, section 3.
const replayUnknown int64 = math.MaxInt64

// replayCountChunk is the size of the buffer a count reads its body through: the whole of its own
// memory.
const replayCountChunk = 32 << 10

// replayCountCutSlack is how much more than a byte limit a count asks for, to see whether the
// record the limit cuts is a whole one: a line feed in the bytes past the limit says it is.
const replayCountCutSlack = 32 << 10

var replayBuffers = sync.Pool{New: func() any {
	buffer := make([]byte, replayCountChunk)
	return &buffer
}}

var lineFeed = []byte{'\n'}

// lineCount is what one pass over a body found.
type lineCount struct {
	lines     int64 // line feeds within the limit
	bytes     int64 // bytes read, the ones past the limit included
	endsOpen  bool  // the last byte within the limit is not a line feed
	cut       bool  // the body goes on past the limit
	completes bool  // a line feed comes after the limit: the record it cuts is a whole one
}

// countLines reads r and counts the line feeds in its first limit bytes (all of it when limit is
// 0), through one buffer of replayCountChunk bytes: it holds no line, however long. Past the limit
// it only looks for the line feed that ends the record the limit cuts, and stops at it.
func countLines(r io.Reader, limit int64) (lineCount, error) {
	buffer := replayBuffers.Get().(*[]byte)
	defer replayBuffers.Put(buffer)
	var found lineCount
	var inside int64 // bytes within the limit so far
	for {
		n, err := r.Read(*buffer)
		if n > 0 {
			chunk := (*buffer)[:n]
			found.bytes += int64(n)
			within := n
			if limit > 0 {
				within = int(min(int64(n), limit-inside))
			}
			if within > 0 {
				found.lines += int64(bytes.Count(chunk[:within], lineFeed))
				found.endsOpen = chunk[within-1] != '\n'
				inside += int64(within)
			}
			if within < n {
				found.cut = true
				if bytes.IndexByte(chunk[within:], '\n') >= 0 {
					found.completes = true
					return found, nil
				}
			}
		}
		switch {
		case errors.Is(err, io.EOF):
			return found, nil
		case err != nil:
			return lineCount{}, err
		}
	}
}

// openings carries, from the count of an opening to the stream of the same opening, what the two
// must share to read the same lines: the instant a relative window of sinceSeconds starts at.
type openings struct {
	now     func() time.Time
	cutoffs sync.Map // the context of the source's run -> the time its window starts at (time.Time)
}

func newOpenings(now func() time.Time) *openings {
	if now == nil {
		now = time.Now
	}
	return &openings{now: now}
}

// resolveSince fixes a relative window (sinceSeconds) to an instant, floored to the second, which
// is the precision sinceTime has, and remembers it for the stream of the opening: the SDK calls the
// count and then the handler of an opening with the context of the source's run, which it gives
// each run once and shares by every opening of that run. A request without a relative window comes
// back as it was.
func (o *openings) resolveSince(ctx context.Context, req sdklogs.LogStreamRequest) sdklogs.LogStreamRequest {
	if o == nil || ctx == nil || req.SinceSeconds <= 0 || req.SinceTime != nil {
		return req
	}
	cutoff := o.now().Add(-time.Duration(req.SinceSeconds) * time.Second).UTC().Truncate(time.Second)
	if _, loaded := o.cutoffs.Swap(ctx, cutoff); !loaded {
		context.AfterFunc(ctx, func() { o.cutoffs.Delete(ctx) })
	}
	req.SinceTime, req.SinceSeconds = &cutoff, 0
	return req
}

// applySince gives the stream of an opening the instant its count resolved, if it had one: a stream
// that no count preceded (a reader that did not ask, a finite read) is the request it always was.
func (o *openings) applySince(ctx context.Context, req sdklogs.LogStreamRequest) sdklogs.LogStreamRequest {
	if o == nil || ctx == nil || req.SinceSeconds <= 0 || req.SinceTime != nil {
		return req
	}
	if cutoff, ok := o.cutoffs.Load(ctx); ok {
		at := cutoff.(time.Time)
		req.SinceTime, req.SinceSeconds = &at, 0
	}
	return req
}

// replayResult is what a count found.
type replayResult struct {
	lines   int64
	bytes   int64
	unknown bool // not had within its bound: the replay's end is not known
}

// nativeReplayCountWithin is the replay count of the plugin's Pod logs, bounded by bound, for a
// stream that nothing shares a window with.
func nativeReplayCountWithin(borrow ClientBorrower, bound time.Duration) sdklogs.ReplayCountFunc {
	return nativeReplayCountWith(borrow, bound, nil)
}

// nativeReplayCountWith is the replay count of the plugin's Pod logs, bounded by bound. The stream
// of each opening that it counts shares the instant of its since window through shared.
func nativeReplayCountWith(borrow ClientBorrower, bound time.Duration, shared *openings) sdklogs.ReplayCountFunc {
	return func(ctx *types.PluginContext, req sdklogs.LogStreamRequest) (int64, error) {
		log := logsLogger(ctx)
		baseCtx := logsBaseContext(ctx)
		req = shared.resolveSince(ctx.Context, req)
		_, span := diag.Tracer().Start(baseCtx, "kubernetes.logs.replay.count", trace.WithAttributes(
			attribute.Bool("include_previous", req.IncludePrevious),
			attribute.Int64("tail_lines", req.TailLines),
			attribute.Int64("limit_bytes", req.LimitBytes),
			attribute.String("resource.namespace", req.Labels["namespace"]),
			attribute.String("resource.id", req.Labels["pod"]),
		))
		started := time.Now()
		var result replayResult
		err := borrow(baseCtx, logRoute(ctx, req.Route), func(nativeCtx context.Context, client *kubernetes.Clientset) error {
			local := *ctx
			local.Context = nativeCtx
			var err error
			result, err = podReplayCount(&kubeauth.KubeClientBundle{Clientset: client}, &local, req, bound)
			return err
		})
		span.SetAttributes(
			attribute.Int64("replay.lines", result.lines),
			attribute.Int64("replay.bytes", result.bytes),
			attribute.Bool("replay.unknown", result.unknown),
		)
		took := time.Since(started)
		if err != nil {
			diag.EndSpan(span, err, false)
			return 0, safeLogError(baseCtx, log, "replay_count", err)
		}
		diag.EndSpan(span, nil, false)
		if result.unknown {
			log.Warnw(baseCtx, "native log replay not counted within its bound; this opening is never marked caught up",
				"bound_ms", bound.Milliseconds(), "duration_ms", took.Milliseconds())
			return replayUnknown, nil
		}
		log.Debugw(baseCtx, "native log replay counted",
			"lines", result.lines, "bytes", result.bytes, "duration_ms", took.Milliseconds())
		return result.lines, nil
	}
}

// podReplayCount counts the lines at the head of the follow stream that req opens: it reads the
// stream's own lines once more, with follow off, and counts them as they arrive.
func podReplayCount(clients *kubeauth.KubeClientBundle, ctx *types.PluginContext, req sdklogs.LogStreamRequest, bound time.Duration) (replayResult, error) {
	target, err := resolvePodLogTarget(ctx, req)
	if err != nil {
		return replayResult{}, err
	}
	opts := podLogOptions(req, target.container)
	opts.Follow = false
	// The count applies the stream's byte limit itself and asks for a little more than it: whether
	// the record the limit cuts is a whole one decides what the stream, cut at the same byte, delivers.
	var limit int64
	if opts.LimitBytes != nil && *opts.LimitBytes > 0 {
		limit = *opts.LimitBytes
		if wider := limit + replayCountCutSlack; wider > limit {
			opts.LimitBytes = &wider
		}
	}

	counting, cancel := context.WithTimeout(ctx.Context, bound)
	defer cancel()
	var found lineCount
	body, err := clients.Clientset.CoreV1().Pods(target.namespace).GetLogs(target.pod, opts).Stream(counting)
	if err == nil {
		found, err = countLines(body, limit)
		_ = body.Close()
	}
	if err != nil {
		// The bound is this count's own: a caller that gave up (a source that was removed) is still an error,
		// and so is a refusal the server gave, whatever the clock says by the time it is read.
		var refused apierrors.APIStatus
		if !errors.As(err, &refused) && ctx.Context.Err() == nil && errors.Is(counting.Err(), context.DeadlineExceeded) {
			return replayResult{unknown: true}, nil
		}
		return replayResult{}, err
	}

	lines := found.lines
	if found.endsOpen && deliversLastRecord(req, found) {
		lines++
	}
	return replayResult{lines: lines, bytes: found.bytes}, nil
}

// deliversLastRecord reports whether the reader of the stream that req opens gets the last record of
// the body, which has no line feed, as a line: it does when the stream ends where the body does. The
// stream of a terminated instance ends with its last record, cut or not. The stream of a running
// container ends where its byte limit cuts it, when the record that limit cuts is a whole one in the
// log; a record that is not whole is held back from the follow, which then neither ends there nor
// delivers it.
func deliversLastRecord(req sdklogs.LogStreamRequest, found lineCount) bool {
	return req.IncludePrevious || (found.cut && found.completes)
}
