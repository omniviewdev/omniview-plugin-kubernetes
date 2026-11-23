package main

// The session driver: Open through the SDK's Client, a receive loop that records and accounts every frame, and the
// helpers a scenario uses to talk (send input, resize, close) and to wait (for text, for the end).

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"hash"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	ep "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	execv2 "github.com/omniviewdev/plugin-sdk/proto/exec/v2"
)

func resourceErrorCode(err error) string {
	var op *resourcev2.ResourceOperationError
	if errors.As(err, &op) && op != nil {
		return op.Code
	}
	return ""
}

// recvOpts tune the receive loop of one session.
type recvOpts struct {
	Keep         bool          // keep the output (all streams, in arrival order) for waits, up to KeepMax
	KeepMax      int           // default 4 MiB
	Hash         bool          // sha256 of the bytes of each stream, in arrival order
	FrameDelay   time.Duration // sleep after every frame (slow consumer)
	PauseAfter   uint64        // stop reading for PauseFor once this many output bytes were received
	PauseFor     time.Duration
	OutputSample int                                              // 0: a line for every Output frame; N: the first 64 and then every Nth (the others are counted, hashed and checked, not written)
	SkipVerify   bool                                             // flood only: neither hash nor pattern-check the bytes (the rate without the cost of verifying)
	Pattern      func(stream string, off uint64, data []byte) int // counts the bytes of a chunk that differ from the expected stream
}

type dropRange struct {
	Stream string  `json:"stream"`
	From   uint64  `json:"from_offset"`
	Bytes  uint64  `json:"bytes"`
	Reason string  `json:"reason"`
	TMs    float64 `json:"t_ms"`
}

// session is one Open stream and everything its frames said.
type session struct {
	rec      *recorder
	rg       *rig
	caseName string
	run      int
	id       string
	conn     ep.Conn
	opts     recvOpts

	t0       time.Time // before the Open call
	tOpenRet time.Duration

	mu   sync.Mutex
	cond *sync.Cond
	done chan struct{}

	// what was seen
	opened              *execv2.Opened
	started             *execv2.Started
	startedAt           time.Duration
	firstOutAt          time.Duration
	lastOutAt           time.Duration
	endedFrame          *execv2.Ended
	endedAt             time.Duration
	recvErr             error
	recvEnd             time.Duration
	notices             []string
	links               []string
	otherFrames         []string
	afterEnded          int
	outOfOrder          []string
	nFrames             int
	nOut                int // Output frames so far
	outFrames           map[string]int
	outBytes            map[string]uint64
	sums                map[string]hash.Hash
	drops               []dropRange
	droppedBytes        uint64
	expected            uint64 // the next offset the contiguity check expects
	patternErrors       int
	keep                []byte
	keepTrunc           bool
	byStream            map[string][]byte // the kept output of each stream
	startedBeforeOutput bool
	sawOutput           bool
	sent                struct{ frames, inputBytes int }
	pausedFor           time.Duration
}

// openSession builds and sends the Open request of s and starts the receive loop. A refusal is returned as an error
// (and recorded); nothing ran.
func (e *scenarioEnv) openSession(ctx context.Context, rg *rig, caseName string, run int, s spec, opts recvOpts) (*session, error) {
	pod, err := rg.pod(s.Pod)
	if err != nil {
		return nil, err
	}
	if s.SessionID == "" {
		s.SessionID = "kp-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:20]
	}
	req, err := rg.openRequest(pod, s)
	if err != nil {
		return nil, err
	}
	ss := &session{rec: e.rec, rg: rg, caseName: caseName, run: run, id: s.SessionID, opts: opts, done: make(chan struct{}),
		outFrames: map[string]int{}, outBytes: map[string]uint64{}, sums: map[string]hash.Hash{}}
	ss.cond = sync.NewCond(&ss.mu)
	if opts.KeepMax == 0 {
		ss.opts.KeepMax = 4 << 20
	}
	ss.t0 = time.Now()
	ss.emit(line{Dir: "send", Kind: "open", F: map[string]any{"request": rawJSON(req), "go_call_ctx": "plugin context with connection " + rg.Conn.ID + ", catalog revision " + pod.Revision}})
	callCtx := rg.callCtx(ctx, pod.Revision)
	conn, err := rg.P.V2.Open(callCtx, req)
	if err != nil && isResetRequired(err) {
		// The catalog pin went stale (the host would re-read the record and retry): record it and do so once.
		ss.emit(line{Dir: "refusal", Kind: "open_refused", F: map[string]any{"retry": true, "err": describeErr(err)}})
		if rerr := rg.refresh(ctx); rerr == nil {
			if pod2, perr := rg.pod(s.Pod); perr == nil {
				if req2, rerr2 := rg.openRequest(pod2, s); rerr2 == nil {
					ss.t0 = time.Now()
					conn, err = rg.P.V2.Open(rg.callCtx(ctx, pod2.Revision), req2)
				}
			}
		}
	}
	ss.tOpenRet = time.Since(ss.t0)
	if err != nil {
		ss.emit(line{Dir: "refusal", Kind: "open_refused", F: map[string]any{"err": describeErr(err), "open_ms": ms(ss.tOpenRet)}})
		return nil, err
	}
	ss.conn = conn
	ss.opened = conn.Opened()
	if opts.OutputSample > 0 {
		ss.emit(line{Dir: "event", Kind: "output_sampling", F: map[string]any{"policy": fmt.Sprintf("Output frames are written for the first 64 and then every %dth; all others are counted, hashed and checked, not written (frame_no says which)", opts.OutputSample)}})
	}
	ss.emit(line{Dir: "recv", Kind: "opened", TMs: ms(ss.tOpenRet), F: map[string]any{
		"facts": rawJSON(ss.opened.GetFacts()), "replay": rawJSON(ss.opened.GetReplay()), "open_to_opened_ms": ms(ss.tOpenRet)}})
	go ss.recvLoop()
	return ss, nil
}

func (s *session) since() time.Duration { return time.Since(s.t0) }

func (s *session) emit(l line) {
	l.Case, l.Run, l.Session = s.caseName, s.run, s.id
	if l.TMs == 0 {
		l.TMs = ms(s.since())
	}
	s.rec.emit(l)
}

// recvLoop reads frames until the stream ends, recording and accounting each one.
func (s *session) recvLoop() {
	defer close(s.done)
	for {
		frame, err := s.conn.Recv()
		now := s.since()
		if err != nil {
			s.mu.Lock()
			s.recvErr, s.recvEnd = err, now
			s.cond.Broadcast()
			s.mu.Unlock()
			if errors.Is(err, io.EOF) {
				s.emit(line{Dir: "recv", Kind: "eof", TMs: ms(now), F: map[string]any{"note": "the stream ended with status OK"}})
			} else {
				s.emit(line{Dir: "recv", Kind: "recv_error", TMs: ms(now), F: map[string]any{"err": describeErr(err)}})
			}
			return
		}
		s.handle(frame, now)
		if s.opts.FrameDelay > 0 {
			time.Sleep(s.opts.FrameDelay)
		}
	}
}

func (s *session) handle(frame *execv2.ServerFrame, now time.Duration) {
	s.mu.Lock()
	s.nFrames++
	if s.endedFrame != nil {
		s.afterEnded++
	}
	s.mu.Unlock()
	switch f := frame.GetFrame().(type) {
	case *execv2.ServerFrame_Opened:
		s.mu.Lock()
		s.outOfOrder = append(s.outOfOrder, "second Opened frame")
		s.mu.Unlock()
		s.emit(line{Dir: "recv", Kind: "opened_again", TMs: ms(now), F: map[string]any{"facts": rawJSON(f.Opened.GetFacts())}})
	case *execv2.ServerFrame_Started:
		s.mu.Lock()
		if s.started != nil {
			s.outOfOrder = append(s.outOfOrder, "second Started frame")
		} else {
			s.started, s.startedAt = f.Started, now
			s.startedBeforeOutput = !s.sawOutput
		}
		s.cond.Broadcast()
		s.mu.Unlock()
		s.emit(line{Dir: "recv", Kind: "started", TMs: ms(now), F: map[string]any{"facts": rawJSON(f.Started.GetFacts()),
			"before_first_output": !s.sawOutputLocked()}})
	case *execv2.ServerFrame_Output:
		s.onOutput(f.Output, now)
	case *execv2.ServerFrame_Dropped:
		d := f.Dropped
		s.mu.Lock()
		dr := dropRange{Stream: streamName(d.GetStream()), From: d.GetFromOffset(), Bytes: d.GetBytes(), Reason: trimEnum(d.GetReason().String(), "DROP_REASON_"), TMs: ms(now)}
		if d.GetFromOffset() != s.expected {
			s.outOfOrder = append(s.outOfOrder, fmt.Sprintf("Dropped from_offset %d, expected %d", d.GetFromOffset(), s.expected))
		}
		s.expected = d.GetFromOffset() + d.GetBytes()
		s.drops = append(s.drops, dr)
		s.droppedBytes += d.GetBytes()
		s.cond.Broadcast()
		s.mu.Unlock()
		mr := "absent"
		if d.ModeReset != nil {
			mr = fmt.Sprintf("present(%d bytes)", len(d.ModeReset))
		}
		s.emit(line{Dir: "recv", Kind: "dropped", TMs: ms(now), F: map[string]any{"stream": dr.Stream, "from_offset": dr.From, "bytes": dr.Bytes, "reason": dr.Reason, "mode_reset": mr}})
	case *execv2.ServerFrame_Notice:
		k := trimEnum(f.Notice.GetKind().String(), "NOTICE_KIND_")
		s.mu.Lock()
		s.notices = append(s.notices, k)
		s.mu.Unlock()
		s.emit(line{Dir: "recv", Kind: "notice", TMs: ms(now), F: map[string]any{"notice": k}})
	case *execv2.ServerFrame_Link:
		st := trimEnum(f.Link.GetState().String(), "LINK_STATE_")
		s.mu.Lock()
		s.links = append(s.links, st)
		s.mu.Unlock()
		s.emit(line{Dir: "recv", Kind: "link", TMs: ms(now), F: map[string]any{"state": st, "silent_ms": f.Link.GetSilentMs()}})
	case *execv2.ServerFrame_Resized:
		s.emit(line{Dir: "recv", Kind: "resized", TMs: ms(now), F: map[string]any{"seq": f.Resized.GetSeq(),
			"cols": f.Resized.GetSize().GetCols(), "rows": f.Resized.GetSize().GetRows(), "result": trimEnum(f.Resized.GetResult().String(), "RESIZE_RESULT_")}})
	case *execv2.ServerFrame_Detached:
		s.emit(line{Dir: "recv", Kind: "detached", TMs: ms(now), F: map[string]any{"frame": rawJSON(f.Detached)}})
	case *execv2.ServerFrame_Mark:
		s.emit(line{Dir: "recv", Kind: "mark", TMs: ms(now), F: map[string]any{"frame": rawJSON(f.Mark)}})
	case *execv2.ServerFrame_Fact:
		s.emit(line{Dir: "recv", Kind: "fact", TMs: ms(now), F: map[string]any{"frame": rawJSON(f.Fact)}})
	case *execv2.ServerFrame_Ended:
		s.mu.Lock()
		s.endedFrame, s.endedAt = f.Ended, now
		s.cond.Broadcast()
		s.mu.Unlock()
		fields := describeEnd(f.Ended)
		fields["duration_ms_client"] = ms(now)
		fields["ended_raw"] = rawJSON(f.Ended)
		s.emit(line{Dir: "recv", Kind: "ended", TMs: ms(now), F: fields})
	default:
		s.mu.Lock()
		s.otherFrames = append(s.otherFrames, fmt.Sprintf("%T", frame.GetFrame()))
		s.mu.Unlock()
		s.emit(line{Dir: "recv", Kind: "unknown_frame", TMs: ms(now), F: map[string]any{"go_type": fmt.Sprintf("%T", frame.GetFrame())}})
	}
}

func (s *session) sawOutputLocked() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sawOutput
}

func (s *session) onOutput(o *execv2.Output, now time.Duration) {
	stream := streamName(o.GetStream())
	data := o.GetData()
	s.mu.Lock()
	if !s.sawOutput {
		s.sawOutput = true
		s.firstOutAt = now
		if s.started == nil {
			s.outOfOrder = append(s.outOfOrder, "Output before Started")
		}
	}
	s.lastOutAt = now
	if o.GetOffset() != s.expected {
		s.outOfOrder = append(s.outOfOrder, fmt.Sprintf("Output offset %d, expected %d (stream %s, len %d)", o.GetOffset(), s.expected, stream, len(data)))
	}
	s.expected = o.GetOffset() + uint64(len(data))
	s.outFrames[stream]++
	s.nOut++
	s.outBytes[stream] += uint64(len(data))
	if s.opts.Hash {
		h := s.sums[stream]
		if h == nil {
			h = sha256.New()
			s.sums[stream] = h
		}
		h.Write(data)
	}
	if s.opts.Pattern != nil {
		s.patternErrors += s.opts.Pattern(stream, o.GetOffset(), data)
	}
	if s.opts.Keep {
		if len(s.keep)+len(data) <= s.opts.KeepMax {
			s.keep = append(s.keep, data...)
			if s.byStream == nil {
				s.byStream = map[string][]byte{}
			}
			s.byStream[stream] = append(s.byStream[stream], data...)
		} else {
			s.keepTrunc = true
		}
	}
	nOut := s.nOut
	total := uint64(0)
	for _, b := range s.outBytes {
		total += b
	}
	s.cond.Broadcast()
	s.mu.Unlock()
	if s.opts.OutputSample <= 0 || nOut <= 64 || nOut%s.opts.OutputSample == 0 {
		s.emit(line{Dir: "recv", Kind: "output", TMs: ms(now), F: map[string]any{"stream": stream, "offset": o.GetOffset(), "len": len(data), "head": head(data, 80), "frame_no": nOut}})
	}
	if s.opts.PauseAfter > 0 && s.pausedFor == 0 && total >= s.opts.PauseAfter {
		s.pausedFor = s.opts.PauseFor
		s.emit(line{Dir: "event", Kind: "consumer_pause_begin", F: map[string]any{"after_bytes": total, "pause_ms": s.opts.PauseFor.Milliseconds()}})
		time.Sleep(s.opts.PauseFor)
		s.emit(line{Dir: "event", Kind: "consumer_pause_end"})
	}
}

// ---------------------------------------------------------------------------------------------------------------
// sending
// ---------------------------------------------------------------------------------------------------------------

func (s *session) send(frame *execv2.ClientFrame, kind string, f map[string]any) error {
	s.emit(line{Dir: "send", Kind: kind, F: f})
	err := s.conn.Send(frame)
	if err != nil {
		s.emit(line{Dir: "send", Kind: "send_error", F: map[string]any{"for": kind, "err": describeErr(err)}})
	}
	s.mu.Lock()
	s.sent.frames++
	s.mu.Unlock()
	return err
}

func (s *session) input(text string) error {
	s.mu.Lock()
	s.sent.inputBytes += len(text)
	s.mu.Unlock()
	return s.send(&execv2.ClientFrame{Frame: &execv2.ClientFrame_Input{Input: []byte(text)}}, "input", map[string]any{"len": len(text), "head": head([]byte(text), 80)})
}

func (s *session) inputBytes(b []byte) error {
	s.mu.Lock()
	s.sent.inputBytes += len(b)
	s.mu.Unlock()
	return s.send(&execv2.ClientFrame{Frame: &execv2.ClientFrame_Input{Input: b}}, "input", map[string]any{"len": len(b), "head": head(b, 80)})
}

func (s *session) resize(seq, cols, rows uint32) error {
	return s.send(&execv2.ClientFrame{Frame: &execv2.ClientFrame_Resize{Resize: &execv2.Resize{Seq: seq, Size: &execv2.Size{Cols: cols, Rows: rows}}}},
		"resize", map[string]any{"seq": seq, "cols": cols, "rows": rows})
}

func (s *session) closeMode(mode execv2.CloseMode) error {
	return s.send(&execv2.ClientFrame{Frame: &execv2.ClientFrame_Close{Close: &execv2.Close{Mode: mode}}}, "close", map[string]any{"mode": trimEnum(mode.String(), "CLOSE_MODE_")})
}

func (s *session) closeInput() error {
	return s.send(&execv2.ClientFrame{Frame: &execv2.ClientFrame_CloseInput{CloseInput: &execv2.CloseInput{}}}, "close_input", nil)
}

func (s *session) signal(sig execv2.Signal) error {
	return s.send(&execv2.ClientFrame{Frame: &execv2.ClientFrame_Signal{Signal: sig}}, "signal", map[string]any{"signal": trimEnum(sig.String(), "SIGNAL_")})
}

func (s *session) query(id uint32, kind execv2.FactKind) error {
	return s.send(&execv2.ClientFrame{Frame: &execv2.ClientFrame_Query{Query: &execv2.Query{Id: id, Kind: kind}}}, "query", map[string]any{"id": id, "kind": kind.String()})
}

func (s *session) detach() error {
	return s.send(&execv2.ClientFrame{Frame: &execv2.ClientFrame_Detach{Detach: &execv2.Detach{}}}, "detach", nil)
}

// cancel ends the stream from the host's side (Conn.Close: the stream's context is cancelled).
func (s *session) cancel() {
	s.emit(line{Dir: "send", Kind: "conn_close", F: map[string]any{"note": "Conn.Close(): cancels the Open stream"}})
	_ = s.conn.Close()
}

// ---------------------------------------------------------------------------------------------------------------
// waiting
// ---------------------------------------------------------------------------------------------------------------

// mark is the length of the kept output now; waitText looks only at what arrived after it.
func (s *session) mark() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.keep)
}

func (s *session) kept(from int) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if from > len(s.keep) {
		from = len(s.keep)
	}
	return string(s.keep[from:])
}

// waitFor waits until pred(output since mark) is true, the session is done, or timeout passes. It returns the output
// since mark and whether pred held.
func (s *session) waitFor(from int, timeout time.Duration, pred func(string) bool) (string, bool) {
	deadline := time.Now().Add(timeout)
	timer := time.AfterFunc(timeout, func() { s.mu.Lock(); s.cond.Broadcast(); s.mu.Unlock() })
	defer timer.Stop()
	s.mu.Lock()
	defer s.mu.Unlock()
	for {
		start := from
		if start > len(s.keep) {
			start = len(s.keep)
		}
		text := string(s.keep[start:])
		if pred(text) {
			return text, true
		}
		select {
		case <-s.done:
			return text, false
		default:
		}
		if !time.Now().Before(deadline) {
			return text, false
		}
		s.cond.Wait()
	}
}

func (s *session) waitText(from int, substr string, timeout time.Duration) (string, bool) {
	return s.waitFor(from, timeout, func(t string) bool { return strings.Contains(t, substr) })
}

// waitEnd waits until the receive loop is over (the stream ended).
func (s *session) waitEnd(timeout time.Duration) bool {
	select {
	case <-s.done:
		return true
	case <-time.After(timeout):
		return false
	}
}

func (s *session) isDone() bool {
	select {
	case <-s.done:
		return true
	default:
		return false
	}
}

// waitStarted waits for the Started frame or the end of the session.
func (s *session) waitStarted(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	timer := time.AfterFunc(timeout, func() { s.mu.Lock(); s.cond.Broadcast(); s.mu.Unlock() })
	defer timer.Stop()
	s.mu.Lock()
	defer s.mu.Unlock()
	for s.started == nil {
		select {
		case <-s.done:
			return false
		default:
		}
		if !time.Now().Before(deadline) {
			return false
		}
		s.cond.Wait()
	}
	return true
}

// ---------------------------------------------------------------------------------------------------------------
// the summary of a session
// ---------------------------------------------------------------------------------------------------------------

// summary is what a session did, as one record for the tables.
type summary struct {
	Scenario       string            `json:"scenario"`
	Case           string            `json:"case"`
	Run            int               `json:"run"`
	Session        string            `json:"session"`
	Refused        string            `json:"refused,omitempty"`
	OpenToOpenedMs float64           `json:"open_to_opened_ms"`
	StartedAtMs    float64           `json:"started_at_ms"`
	StartedFacts   string            `json:"started_facts,omitempty"`
	OpenedFacts    string            `json:"opened_facts,omitempty"`
	FirstOutputMs  float64           `json:"first_output_ms"`
	LastOutputMs   float64           `json:"last_output_ms"`
	EndedAtMs      float64           `json:"ended_at_ms"`
	StreamEndMs    float64           `json:"stream_end_ms"`
	StreamEnd      string            `json:"stream_end"`
	End            map[string]any    `json:"end,omitempty"`
	EndLine        string            `json:"end_line,omitempty"`
	OutFrames      map[string]int    `json:"out_frames"`
	OutBytes       map[string]uint64 `json:"out_bytes"`
	SHA256         map[string]string `json:"sha256,omitempty"`
	Drops          []dropRange       `json:"drops,omitempty"`
	DropRanges     int               `json:"drop_ranges"`
	DroppedBytes   uint64            `json:"dropped_bytes_seen"`
	Notices        []string          `json:"notices,omitempty"`
	Links          []string          `json:"links,omitempty"`
	Anomalies      []string          `json:"anomalies,omitempty"`
	PatternErrors  int               `json:"pattern_errors,omitempty"`
	Frames         int               `json:"frames"`
	InputBytesSent int               `json:"input_bytes_sent"`
	Checks         map[string]bool   `json:"checks,omitempty"`
	Extra          map[string]any    `json:"extra,omitempty"`
}

func (s *session) summarize(scenario string) summary {
	s.mu.Lock()
	defer s.mu.Unlock()
	sm := summary{Scenario: scenario, Case: s.caseName, Run: s.run, Session: s.id, OpenToOpenedMs: ms(s.tOpenRet),
		StartedAtMs: -1, FirstOutputMs: -1, EndedAtMs: -1, StreamEndMs: -1, OutFrames: map[string]int{}, OutBytes: map[string]uint64{},
		Frames: s.nFrames, InputBytesSent: s.sent.inputBytes, Notices: s.notices, Links: s.links, Drops: s.drops, DropRanges: len(s.drops),
		DroppedBytes: s.droppedBytes, PatternErrors: s.patternErrors, Checks: map[string]bool{}}
	for k, v := range s.outFrames {
		sm.OutFrames[k] = v
	}
	for k, v := range s.outBytes {
		sm.OutBytes[k] = v
	}
	if len(s.sums) > 0 {
		sm.SHA256 = map[string]string{}
		for k, h := range s.sums {
			sm.SHA256[k] = fmt.Sprintf("%x", h.Sum(nil))
		}
	}
	if s.started != nil {
		sm.StartedAtMs = ms(s.startedAt)
		sm.StartedFacts = string(rawJSON(s.started.GetFacts()))
	}
	if s.opened != nil {
		sm.OpenedFacts = string(rawJSON(s.opened.GetFacts()))
	}
	if s.sawOutput {
		sm.FirstOutputMs = ms(s.firstOutAt)
		sm.LastOutputMs = ms(s.lastOutAt)
	}
	switch {
	case s.recvErr == nil:
		sm.StreamEnd = "(still open)"
	case errors.Is(s.recvErr, io.EOF):
		sm.StreamEnd, sm.StreamEndMs = "EOF (status OK)", ms(s.recvEnd)
	default:
		sm.StreamEnd, sm.StreamEndMs = "error: "+errString(s.recvErr), ms(s.recvEnd)
	}
	if s.endedFrame != nil {
		sm.EndedAtMs = ms(s.endedAt)
		sm.End = describeEnd(s.endedFrame)
		sm.EndLine = endString(s.endedFrame)
		e := s.endedFrame
		var outSum uint64
		for _, b := range s.outBytes {
			outSum += b
		}
		sm.Checks["bytes_out==last_offset"] = e.GetBytesOut() == e.GetLastOffset()
		sm.Checks["sum(output)+dropped==last_offset"] = outSum+s.droppedBytes == e.GetLastOffset()
		sm.Checks["dropped_bytes==sum(Dropped)"] = e.GetDroppedBytes() == s.droppedBytes
		sm.Checks["output==TRUNCATED iff dropped>0"] = (e.GetOutput() == execv2.OutputCompleteness_OUTPUT_COMPLETENESS_TRUNCATED) == (e.GetDroppedBytes() > 0)
		sm.Checks["Started before first Output (or no output)"] = !s.sawOutput || (s.started != nil && s.startedBeforeOutput)
	}
	sm.Anomalies = append(sm.Anomalies, s.outOfOrder...)
	if s.afterEnded > 0 {
		sm.Anomalies = append(sm.Anomalies, fmt.Sprintf("%d frame(s) after Ended", s.afterEnded))
	}
	if len(s.otherFrames) > 0 {
		sm.Anomalies = append(sm.Anomalies, "unknown frames: "+strings.Join(s.otherFrames, ","))
	}
	return sm
}
