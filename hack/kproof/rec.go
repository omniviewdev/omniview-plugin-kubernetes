package main

// The recorder: one JSON line per frame sent or received, per refusal, per fault, with timestamps. A line starts with
// scenario, case, run, session, t_ms (milliseconds since the Open call began), wall (RFC3339Nano), dir and kind, and is
// followed by the fields of that kind in alphabetical order.

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	ep "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	execv2 "github.com/omniviewdev/plugin-sdk/proto/exec/v2"
)

type line struct {
	Scenario string
	Case     string
	Run      int
	Session  string
	TMs      float64
	Wall     time.Time
	Dir      string // send | recv | event | refusal | fault | note | summary
	Kind     string
	F        map[string]any
}

func (l line) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	put := func(k string, v any, first bool) error {
		if !first {
			b.WriteByte(',')
		}
		kb, _ := json.Marshal(k)
		vb, err := json.Marshal(v)
		if err != nil {
			return err
		}
		b.Write(kb)
		b.WriteByte(':')
		b.Write(vb)
		return nil
	}
	if err := put("scenario", l.Scenario, true); err != nil {
		return nil, err
	}
	if l.Case != "" {
		_ = put("case", l.Case, false)
	}
	_ = put("run", l.Run, false)
	if l.Session != "" {
		_ = put("session", l.Session, false)
	}
	_ = put("t_ms", round3(l.TMs), false)
	_ = put("wall", l.Wall.Format(time.RFC3339Nano), false)
	_ = put("dir", l.Dir, false)
	_ = put("kind", l.Kind, false)
	keys := make([]string, 0, len(l.F))
	for k := range l.F {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if err := put(k, l.F[k], false); err != nil {
			return nil, fmt.Errorf("field %s: %w", k, err)
		}
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

func round3(v float64) float64 { return float64(int64(v*1000+0.5)) / 1000 }

func ms(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }

// recorder appends lines to one file; it is safe for concurrent use.
type recorder struct {
	mu       sync.Mutex
	f        *os.File
	w        *bufio.Writer
	scenario string
	lines    int
	done     chan struct{}
}

func newRecorder(path, scenario string) (*recorder, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return nil, err
	}
	r := &recorder{f: f, w: bufio.NewWriterSize(f, 1<<20), scenario: scenario, done: make(chan struct{})}
	go func() { // flush now and then so that a hung run leaves its evidence on disk
		t := time.NewTicker(500 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				r.mu.Lock()
				_ = r.w.Flush()
				r.mu.Unlock()
			case <-r.done:
				return
			}
		}
	}()
	return r, nil
}

func (r *recorder) emit(l line) {
	l.Scenario = r.scenario
	if l.Wall.IsZero() {
		l.Wall = time.Now()
	}
	data, err := json.Marshal(l)
	if err != nil {
		data, _ = json.Marshal(map[string]any{"scenario": r.scenario, "dir": "error", "kind": "marshal", "error": err.Error()})
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	_, _ = r.w.Write(data)
	_ = r.w.WriteByte('\n')
	r.lines++
}

// note records a free-form event of the scenario itself (what was done, a fault, a check).
func (r *recorder) note(caseName string, run int, kind string, f map[string]any) {
	r.emit(line{Case: caseName, Run: run, Dir: "event", Kind: kind, F: f})
}

func (r *recorder) close() {
	close(r.done)
	r.mu.Lock()
	defer r.mu.Unlock()
	_ = r.w.Flush()
	_ = r.f.Close()
}

// ---------------------------------------------------------------------------------------------------------------
// Describing messages
// ---------------------------------------------------------------------------------------------------------------

var pj = protojson.MarshalOptions{UseProtoNames: true}

// rawJSON is the protojson of a message, to embed in a line.
func rawJSON(m proto.Message) json.RawMessage {
	if m == nil {
		return json.RawMessage("null")
	}
	b, err := pj.Marshal(m)
	if err != nil {
		return json.RawMessage(strconv.Quote("protojson: " + err.Error()))
	}
	// protojson output is deliberately unstable in its whitespace; compact it so that a line stays one line.
	var out bytes.Buffer
	if err := json.Compact(&out, b); err != nil {
		return json.RawMessage(strconv.Quote("compact: " + err.Error()))
	}
	return out.Bytes()
}

// head escapes the first n bytes of data as Go would quote them.
func head(data []byte, n int) string {
	if len(data) > n {
		return strconv.QuoteToASCII(string(data[:n])) + "..."
	}
	return strconv.QuoteToASCII(string(data))
}

func streamName(s execv2.Stream) string {
	switch s {
	case execv2.Stream_STREAM_TTY:
		return "TTY"
	case execv2.Stream_STREAM_STDOUT:
		return "STDOUT"
	case execv2.Stream_STREAM_STDERR:
		return "STDERR"
	}
	return s.String()
}

func trimEnum(s string, prefix string) string {
	if len(s) > len(prefix) && s[:len(prefix)] == prefix {
		return s[len(prefix):]
	}
	return s
}

func surviveName(b *bool) string {
	switch {
	case b == nil:
		return "absent"
	case *b:
		return "true"
	}
	return "false"
}

// describeEnd is the full End arm of an Ended frame as flat fields.
func describeEnd(e *execv2.Ended) map[string]any {
	if e == nil {
		return nil
	}
	f := map[string]any{
		"start_observed": e.GetStartObserved(), "duration_ms": e.GetDurationMs(), "bytes_out": e.GetBytesOut(),
		"bytes_in": e.GetBytesIn(), "dropped_bytes": e.GetDroppedBytes(),
		"output": trimEnum(e.GetOutput().String(), "OUTPUT_COMPLETENESS_"), "last_offset": e.GetLastOffset(),
	}
	if e.ModeReset == nil {
		f["mode_reset"] = "absent"
	} else {
		f["mode_reset"] = fmt.Sprintf("present(%d bytes)", len(e.ModeReset))
	}
	end := e.GetEnd()
	f["remote_may_survive"] = surviveName(end.RemoteMaySurvive)
	switch k := end.GetKind().(type) {
	case *execv2.End_Exited:
		f["end"] = "exited"
		f["exit_code"] = k.Exited.GetExitCode()
		f["source"] = trimEnum(k.Exited.GetSource().String(), "EXIT_SOURCE_")
	case *execv2.End_Signaled:
		f["end"] = "signaled"
		f["signal"] = k.Signaled.GetSignal()
		f["signal_number"] = k.Signaled.GetSignalNumber()
		if k.Signaled.CoreDumped != nil {
			f["core_dumped"] = k.Signaled.GetCoreDumped()
		} else {
			f["core_dumped"] = "absent"
		}
		f["source"] = trimEnum(k.Signaled.GetSource().String(), "EXIT_SOURCE_")
	case *execv2.End_Closed:
		f["end"] = "closed"
		f["closed_by"] = trimEnum(k.Closed.GetBy().String(), "CLOSED_BY_")
	case *execv2.End_Failed:
		f["end"] = "failed"
		fl := k.Failed
		f["failed_class"] = trimEnum(fl.GetClass().String(), "ERROR_CLASS_")
		f["failed_reason"] = trimEnum(fl.GetReason().String(), "ERROR_REASON_")
		f["failed_stage"] = trimEnum(fl.GetStage().String(), "FAILURE_STAGE_")
		f["failed_facts"] = rawJSON(fl.GetFacts())
		f["failed_public_message"] = fl.GetPublicMessage()
	case *execv2.End_Lost:
		f["end"] = "lost"
		f["lost_cause"] = trimEnum(k.Lost.GetCause().String(), "LOST_CAUSE_")
	default:
		f["end"] = "unset-arm"
	}
	return f
}

// endString is the End arm in one line, for tables.
func endString(e *execv2.Ended) string {
	if e == nil {
		return "(no Ended frame)"
	}
	d := describeEnd(e)
	var s string
	switch d["end"] {
	case "exited":
		s = fmt.Sprintf("Exited{code=%v, source=%v}", d["exit_code"], d["source"])
	case "signaled":
		s = fmt.Sprintf("Signaled{%v/%v, core=%v, source=%v}", d["signal"], d["signal_number"], d["core_dumped"], d["source"])
	case "closed":
		s = fmt.Sprintf("Closed{by=%v}", d["closed_by"])
	case "failed":
		s = fmt.Sprintf("Failed{class=%v, reason=%v, stage=%v, facts=%s}", d["failed_class"], d["failed_reason"], d["failed_stage"], d["failed_facts"])
	case "lost":
		s = fmt.Sprintf("Lost{cause=%v}", d["lost_cause"])
	default:
		s = "End{unset arm}"
	}
	return fmt.Sprintf("%s remote_may_survive=%v start_observed=%v bytes_out=%v dropped=%v output=%v last_offset=%v", s,
		d["remote_may_survive"], d["start_observed"], d["bytes_out"], d["dropped_bytes"], d["output"], d["last_offset"])
}

// describeErr classifies an error as the host sees it.
func describeErr(err error) map[string]any {
	if err == nil {
		return nil
	}
	f := map[string]any{"error": err.Error(), "go_type": fmt.Sprintf("%T", err)}
	var xe *ep.Error
	if errors.As(err, &xe) {
		f["exec_class"] = xe.Class.String()
		f["exec_reason"] = xe.Reason.String()
		f["exec_facts"] = map[string]any{"program": xe.Facts.Program, "selection_name": xe.Facts.SelectionName,
			"selection_value": xe.Facts.SelectionValue, "retry_after_ms": xe.Facts.RetryAfter.Milliseconds()}
		if xe.Message != "" {
			f["exec_message"] = xe.Message
		}
		if xe.Err != nil {
			f["exec_cause"] = xe.Err.Error()
		}
	}
	if code := resourceErrorCode(err); code != "" {
		f["resource_error_code"] = code
	}
	return f
}

// errString is the class/reason of a refusal in one line.
func errString(err error) string {
	if err == nil {
		return "(nil)"
	}
	var xe *ep.Error
	if errors.As(err, &xe) {
		s := fmt.Sprintf("exec.Error{class=%s, reason=%s, facts={program=%q, selection=%s=%q, retry_after=%v}}", xe.Class, xe.Reason,
			xe.Facts.Program, xe.Facts.SelectionName, xe.Facts.SelectionValue, xe.Facts.RetryAfter)
		if xe.Message != "" {
			s += " message=" + strconv.Quote(xe.Message)
		}
		return s
	}
	if code := resourceErrorCode(err); code != "" {
		return fmt.Sprintf("resource error %s: %v", code, err)
	}
	return fmt.Sprintf("%T: %v", err, err)
}
