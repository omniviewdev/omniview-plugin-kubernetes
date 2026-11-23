package main

import (
	"time"

	execv2 "github.com/omniviewdev/plugin-sdk/proto/exec/v2"
)

// streamText is the kept output of one stream ("STDOUT", "STDERR", "TTY").
func (s *session) streamText(name string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return string(s.byStream[name])
}

func (e *scenarioEnv) hasEnv(kv string) bool {
	for _, v := range e.f.extraEnv {
		if v == kv {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------------------------------------------
// S2: non-TTY split streams, exit statuses, refusals
// ---------------------------------------------------------------------------------------------------------------

type s2case struct {
	name      string
	pod       string
	container string
	argv      []string
	tty       bool
}

func s2cases() []s2case {
	sh := func(script string) []string { return []string{"sh", "-c", script} }
	return []s2case{
		{name: "split-out-err", pod: "quiet", container: "main", argv: sh("echo out; echo err >&2")},
		{name: "exit0", pod: "quiet", container: "main", argv: sh("exit 0")},
		{name: "true", pod: "quiet", container: "main", argv: []string{"true"}},
		{name: "exit3", pod: "quiet", container: "main", argv: sh("exit 3")},
		{name: "exit137", pod: "quiet", container: "main", argv: sh("exit 137")},
		{name: "kill-9-self", pod: "quiet", container: "main", argv: sh("kill -9 $$")},
		{name: "kill-term-self", pod: "quiet", container: "main", argv: sh("kill -TERM $$")},
		{name: "no-such-binary", pod: "quiet", container: "main", argv: []string{"/no/such/binary"}},
		{name: "tty-exit0", pod: "quiet", container: "main", argv: sh("exit 0"), tty: true},
		{name: "tty-exit3", pod: "quiet", container: "main", argv: sh("exit 3"), tty: true},
		{name: "tty-kill-9-self", pod: "quiet", container: "main", argv: sh("kill -9 $$"), tty: true},
		{name: "tty-no-such-binary", pod: "quiet", container: "main", argv: []string{"/no/such/binary"}, tty: true},
		{name: "container-nope", pod: "quiet", container: "nope", argv: []string{"true"}},
		{name: "states2/pullfail(ImagePullBackOff)", pod: "states2", container: "pullfail", argv: []string{"true"}},
		{name: "states2/crash(CrashLoopBackOff)", pod: "states2", container: "crash", argv: []string{"true"}},
		{name: "states2/done(init,completed)", pod: "states2", container: "done", argv: []string{"true"}},
		{name: "states2/ok(running)", pod: "states2", container: "ok", argv: []string{"true"}},
		{name: "states/app(Waiting,PodInitializing)", pod: "states", container: "app", argv: []string{"true"}},
		{name: "states/side(Waiting,PodInitializing)", pod: "states", container: "side", argv: []string{"true"}},
		{name: "states/wait(init,running)", pod: "states", container: "wait", argv: []string{"true"}},
	}
}

func s2(e *scenarioEnv) error {
	runs := e.f.runs
	for _, c := range s2cases() {
		for run := 1; run <= runs; run++ {
			if e.ctx.Err() != nil {
				return e.ctx.Err()
			}
			// a command that runs without a terminal (or with one) and ends by itself: nothing to send
			e.runCase(e.rg, c.name, run, spec{Pod: c.pod, Container: c.container, Mode: "exec", Argv: c.argv, TTY: c.tty, Cols: 100, Rows: 30},
				recvOpts{Keep: true}, 60*time.Second, nil)
		}
	}
	if e.hasEnv("KPROOF_EXECUTOR=own") {
		return nil
	}
	// The exit-0 cases under the three ways the provider can end a nil stream (KPROOF_NIL unset is the main run above).
	for _, nilMode := range []string{"code0", "transport0"} {
		rg, err := e.launchViaTap("nil-"+nilMode, "KPROOF_NIL="+nilMode)
		if err != nil {
			e.rec.note("", 0, "nil_variant_launch_failed", map[string]any{"variant": nilMode, "error": err.Error()})
			continue
		}
		for _, c := range s2cases() {
			if c.name != "exit0" && c.name != "true" {
				continue
			}
			for run := 1; run <= runs; run++ {
				e.runCase(rg, c.name+"[KPROOF_NIL="+nilMode+"]", run, spec{Pod: c.pod, Container: c.container, Mode: "exec", Argv: c.argv, Cols: 100, Rows: 30},
					recvOpts{Keep: true}, 60*time.Second, nil)
			}
		}
	}
	return nil
}

// ---------------------------------------------------------------------------------------------------------------
// S3: stdin
// ---------------------------------------------------------------------------------------------------------------

type s3case struct {
	name string
	argv []string
	end  string // "kill", "graceful", "cancel"
}

func s3(e *scenarioEnv) error {
	cases := []s3case{
		{"cat/close_input then Close{KILL}", []string{"cat"}, "kill"},
		{"cat/close_input then Close{GRACEFUL}", []string{"cat"}, "graceful"},
		{"cat/close_input then stream cancel", []string{"cat"}, "cancel"},
		{"cat|wc -c/close_input then Close{KILL}", []string{"sh", "-c", "cat | wc -c"}, "kill"},
		{"cat|wc -c/close_input then stream cancel", []string{"sh", "-c", "cat | wc -c"}, "cancel"},
	}
	runs := e.f.runs
	if runs > 2 {
		runs = 2 // each run waits 10 s for a close_input that is expected to be ignored
	}
	for _, c := range cases {
		for run := 1; run <= runs; run++ {
			if e.ctx.Err() != nil {
				return e.ctx.Err()
			}
			c := c
			e.killSleeps()
			e.runCase(e.rg, c.name, run, spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: c.argv, Cols: 100, Rows: 30},
				recvOpts{Keep: true}, 40*time.Second, func(ss *session) map[string]any {
					obs := map[string]any{}
					m := ss.mark()
					_ = ss.input("abc\n")
					if c.argv[0] == "cat" {
						_, ok := ss.waitText(m, "abc\n", 10*time.Second)
						obs["echo_abc_seen"] = ok
					} else {
						time.Sleep(1500 * time.Millisecond)
					}
					tci := time.Now()
					_ = ss.closeInput()
					obs["close_input_sent_at_ms"] = ms(ss.since())
					ended := ss.waitEnd(10 * time.Second)
					obs["ended_within_10s_of_close_input"] = ended
					obs["waited_after_close_input_ms"] = ms(time.Since(tci))
					if !ended {
						if c.argv[0] == "cat" {
							m = ss.mark()
							_ = ss.input("def\n")
							_, ok := ss.waitText(m, "def\n", 5*time.Second)
							obs["echo_def_after_close_input_seen"] = ok
						}
						switch c.end {
						case "kill":
							obs["end_requested_at_ms"] = ms(ss.since())
							_ = ss.closeMode(execv2.CloseMode_CLOSE_MODE_KILL)
						case "graceful":
							obs["end_requested_at_ms"] = ms(ss.since())
							_ = ss.closeMode(execv2.CloseMode_CLOSE_MODE_GRACEFUL)
						case "cancel":
							obs["end_requested_at_ms"] = ms(ss.since())
							ss.cancel()
						}
					}
					obs["stdout_kept"] = head([]byte(ss.streamText("STDOUT")), 80)
					ss.waitEnd(30 * time.Second)
					if t, how, ok := ss.endTime(); ok {
						obs["end_arrived_as"] = how
						obs["end_arrived_at_ms"] = ms(t)
						if req, ok := obs["end_requested_at_ms"].(float64); ok {
							obs["end_after_request_ms"] = ms(t) - req
						}
					}
					time.Sleep(3 * time.Second)
					obs["remote_processes_3s_after_end"] = e.psAll()
					return obs
				})
		}
	}
	return nil
}
