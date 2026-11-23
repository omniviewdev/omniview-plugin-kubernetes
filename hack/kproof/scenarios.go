package main

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

func registry() []scenarioDef {
	own := []variant{{}, {suffix: "own", env: []string{"KPROOF_EXECUTOR=own"}}}
	return []scenarioDef{
		{id: "s0", name: "s0-describe", title: "Describe, Options of three/states/states2", timeout: 5 * time.Minute, fn: s0},
		{id: "s1", name: "s1-tty-shell", title: "TTY shell: echo, stty size before/after resize, exit 3", timeout: 6 * time.Minute, fn: s1},
		{id: "s2", name: "s2-nontty", title: "Non-TTY split streams, exit statuses, refusals", timeout: 25 * time.Minute, viaTap: true, variants: own, fn: s2},
		{id: "s3", name: "s3-stdin", title: "Stdin: close_input, Close{KILL}, stream cancel", timeout: 10 * time.Minute, viaTap: true, fn: s3},
		{id: "s4", name: "s4-flood", title: "Flood 64 MiB, slow consumer, baselines", timeout: 40 * time.Minute, fn: s4},
		{id: "s5", name: "s5-container-killed", title: "Container killed / pod deleted / kubelet and containerd restarted mid-session", timeout: 30 * time.Minute, viaTap: true, variants: own, fn: s5},
		{id: "s6", name: "s6-apiserver-drop", title: "API-server connection dropped (FIN, RST, blackhole, apiserver restart)", timeout: 40 * time.Minute, viaTap: true, variants: own, fn: s6},
		{id: "s7", name: "s7-kill-behaviour", title: "Does the remote process survive Close/KILL/cancel?", timeout: 20 * time.Minute, viaTap: true, fn: s7},
		{id: "s8", name: "s8-attach", title: "Attach to the tty pod", timeout: 10 * time.Minute, viaTap: true, fn: s8},
		{id: "s9", name: "s9-picker", title: "Picker details: Options choices vs Open outcome", timeout: 12 * time.Minute, viaTap: true, fn: s9},
		{id: "s10", name: "s10-refusals", title: "Refusals: RBAC denied, missing selection, wrong reference type", timeout: 10 * time.Minute, fn: s10},
		{id: "s11", name: "s11-resize-flood", title: "200 resize frames while cat runs", timeout: 8 * time.Minute, fn: s11},
		{id: "s12", name: "s12-open-latency", title: "Open latency over 20 sequential opens", timeout: 10 * time.Minute, fn: s12},
	}
}

// tapMark is the number of WebSocket connections the tap has seen so far (0 without a tap).
func (e *scenarioEnv) tapMark() int {
	e.mu.Lock()
	t := e.tap
	e.mu.Unlock()
	if t == nil {
		return 0
	}
	return t.wsMark()
}

// tapViews is what the tap saw of the WebSocket connections opened since mark.
func (e *scenarioEnv) tapViews(mark int) []map[string]any {
	e.mu.Lock()
	t := e.tap
	e.mu.Unlock()
	if t == nil {
		return nil
	}
	var out []map[string]any
	for _, w := range t.wsSince(mark) {
		select {
		case <-w.finished:
		case <-time.After(2 * time.Second):
		}
		w.mu.Lock()
		dur := -1.0
		if !w.End.IsZero() {
			dur = ms(w.End.Sub(w.Start))
		}
		v := map[string]any{"ws": w.ID, "path": w.Path, "query": w.Query, "subprotocol": w.Selected, "duration_ms": dur, "finished": !w.End.IsZero(),
			"dial_status": w.DialStatus, "dial_body": tail(w.DialBody, 400), "c2s_msgs": w.C2SMsgs, "s2c_msgs": w.S2CMsgs, "status_msgs": w.Status, "channel_bytes": w.ChBytes}
		w.mu.Unlock()
		v["status_view"], v["close_view"] = w.StatusView(), w.CloseView()
		out = append(out, v)
	}
	return out
}

// runCase opens one session, lets drive talk to it, waits for its end and records the summary: the frames, the plugin's
// trace lines, the tap's view of the WebSocket connection(s) opened meanwhile. A refusal of the Open is recorded as the
// case's result (nothing ran).
func (e *scenarioEnv) runCase(rg *rig, caseName string, run int, s spec, opts recvOpts, endWait time.Duration,
	drive func(*session) map[string]any) summary {
	return e.runCaseEx(rg, caseName, run, s, opts, endWait, drive, nil)
}

// runCaseEx is runCase with a post hook that may add to the summary once the session is over (the flood's hashes).
func (e *scenarioEnv) runCaseEx(rg *rig, caseName string, run int, s spec, opts recvOpts, endWait time.Duration,
	drive func(*session) map[string]any, post func(*session, *summary)) summary {
	e.newTrace(rg.Variant, 0, 0) // forget what earlier sessions left
	tapMark := e.tapMark()
	ss, err := e.openSession(e.ctx, rg, caseName, run, s, opts)
	if err != nil {
		sm := summary{Scenario: e.def.name, Case: caseName, Run: run, Refused: errString(err), Extra: map[string]any{"open_error": describeErr(err)},
			OutFrames: map[string]int{}, OutBytes: map[string]uint64{}}
		e.addSummary(sm)
		return sm
	}
	var observed map[string]any
	if drive != nil {
		observed = drive(ss)
	}
	if !ss.waitEnd(endWait) {
		ss.emit(line{Dir: "event", Kind: "no_end_in_time", F: map[string]any{"waited_s": endWait.Seconds()}})
		ss.cancel()
		ss.waitEnd(10 * time.Second)
	}
	trace := e.newTrace(rg.Variant, 1, 3*time.Second)
	sm := ss.summarize(e.def.name)
	sm.Extra = map[string]any{"trace": trace, "trace_text": traceSummary(trace)}
	if opts.Keep {
		kept := map[string]string{}
		ss.mu.Lock()
		for k, v := range ss.byStream {
			kept[k] = head(v, 160)
		}
		ss.mu.Unlock()
		sm.Extra["kept_output"] = kept
	}
	if observed != nil {
		sm.Extra["observed"] = observed
	}
	if tv := e.tapViews(tapMark); tv != nil {
		sm.Extra["tap"] = tv
	}
	if post != nil {
		post(ss, &sm)
	}
	e.addSummary(sm)
	ss.cancel()
	return sm
}

// ---------------------------------------------------------------------------------------------------------------
// small helpers shared by the scenarios
// ---------------------------------------------------------------------------------------------------------------

func median(v []float64) float64 {
	if len(v) == 0 {
		return -1
	}
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	if len(s)%2 == 1 {
		return s[len(s)/2]
	}
	return (s[len(s)/2-1] + s[len(s)/2]) / 2
}

func percentile(v []float64, p float64) float64 {
	if len(v) == 0 {
		return -1
	}
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	// nearest rank
	i := int(float64(len(s))*p/100+0.999999) - 1
	if i < 0 {
		i = 0
	}
	if i >= len(s) {
		i = len(s) - 1
	}
	return s[i]
}

// podFault is a handle on what a scenario did to the cluster, for the timing of the end.
type faultMark struct {
	At   time.Time
	Done time.Time
}

func (e *scenarioEnv) ensureFixture(ctx context.Context, why string) error {
	t0 := time.Now()
	out, err := e.kube.applyFixtures(ctx)
	e.rec.note("", 0, "fixtures_applied", map[string]any{"why": why, "ms": ms(time.Since(t0)), "error": errText(err), "tail": tail(out, 1500)})
	if err != nil {
		return err
	}
	return e.rg.refresh(ctx)
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func tail(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return "..." + s[len(s)-n:]
	}
	return s
}

func str(v any) string { return fmt.Sprint(v) }
