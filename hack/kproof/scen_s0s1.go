package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	ep "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	execv2 "github.com/omniviewdev/plugin-sdk/proto/exec/v2"
)

// ---------------------------------------------------------------------------------------------------------------
// S0: Describe, Options
// ---------------------------------------------------------------------------------------------------------------

func featureNames(d *execv2.DescribeResponse) []string {
	var out []string
	for _, f := range d.GetFeatures() {
		out = append(out, trimEnum(f.String(), "FEATURE_"))
	}
	return out
}

func capsLine(c *ep.Capabilities) string {
	return fmt.Sprintf("%+v", *c)
}

type optionsSnap struct {
	Pod      string            `json:"pod"`
	Snapshot int               `json:"snapshot"`
	At       string            `json:"at"`
	Actual   map[string]string `json:"kubelet_states"`
	Rows     []map[string]any  `json:"choices"`
	Modes    []map[string]any  `json:"modes"`
	Err      string            `json:"error,omitempty"`
}

func s0(e *scenarioEnv) error {
	rg := e.rg
	d, err := rg.describe(e.ctx)
	e.rec.note("describe", 0, "describe", map[string]any{"response": rawJSON(d), "error": describeErr(err)})
	if err != nil {
		e.fact("describe_error", errString(err))
	} else {
		e.fact("describe", map[string]any{"contract_version": d.GetContractVersion(), "features": featureNames(d), "targets": len(d.GetTargets())})
		e.fact("describe_json", string(rawJSON(d)))
	}

	var snaps []optionsSnap
	plan := []struct {
		pod string
		n   int
	}{{"three", 3}, {"states", 3}, {"states2", 3}, {"quiet", 1}, {"victim", 1}, {"tty", 1}}
	for _, p := range plan {
		for i := 1; i <= p.n; i++ {
			if err := rg.refresh(e.ctx); err != nil {
				return err
			}
			pod, err := rg.pod(p.pod)
			if err != nil {
				return err
			}
			actual, _ := e.kube.containerStates(e.ctx, p.pod)
			t0 := time.Now()
			res, oerr := rg.options(e.ctx, pod)
			dur := time.Since(t0)
			wire, werr := rg.optionsWire(e.ctx, pod)
			sn := optionsSnap{Pod: p.pod, Snapshot: i, At: time.Now().Format(time.RFC3339Nano), Actual: actual}
			f := map[string]any{"pod": p.pod, "kubelet_states": actual, "sdk_client_ms": ms(dur), "sdk_client_error": describeErr(oerr), "wire_error": describeErr(werr)}
			if wire != nil {
				f["wire_response"] = rawJSON(wire)
			}
			e.rec.note("options-"+p.pod, i, "options", f)
			if oerr != nil {
				sn.Err = errString(oerr)
			} else {
				for _, o := range res.Options {
					for _, c := range o.Choices {
						if o.Name == "container" {
							sn.Rows = append(sn.Rows, map[string]any{"container": c.Value, "kind": c.Kind, "state": c.State.String(), "detail": c.Detail,
								"default": c.IsDefault, "display": c.DisplayName, "claimed_exec_able": c.State == ep.ChoiceStateReady})
						} else {
							m := map[string]any{"option": o.Name, "choice": c.Value, "state": c.State.String(), "default": c.IsDefault}
							if c.Capabilities != nil {
								m["capabilities"] = capsLine(c.Capabilities)
							}
							sn.Modes = append(sn.Modes, m)
						}
					}
				}
			}
			snaps = append(snaps, sn)
			if (p.pod == "states" || p.pod == "states2" || p.pod == "three") && i < p.n {
				if !e.sleep(6 * time.Second) {
					return e.ctx.Err()
				}
			}
		}
	}
	e.fact("options_snapshots", snaps)
	return nil
}

// ---------------------------------------------------------------------------------------------------------------
// S1: TTY shell
// ---------------------------------------------------------------------------------------------------------------

var sizeRe = regexp.MustCompile(`\r\n(\d+) (\d+)\r\n`)

// sttySize types "stty size" and returns what the shell printed: rows and columns.
func (s *session) sttySize(timeout time.Duration) (rows, cols int, raw string, ok bool) {
	m := s.mark()
	_ = s.input("stty size\n")
	txt, _ := s.waitFor(m, timeout, func(t string) bool { return sizeRe.MatchString(t) })
	if g := sizeRe.FindStringSubmatch(txt); g != nil {
		rows, _ = strconv.Atoi(g[1])
		cols, _ = strconv.Atoi(g[2])
		return rows, cols, head([]byte(txt), 120), true
	}
	return 0, 0, head([]byte(txt), 120), false
}

func s1(e *scenarioEnv) error {
	for run := 1; run <= e.f.runs; run++ {
		e.runCase(e.rg, "tty-shell", run, spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: []string{"/bin/sh"}, TTY: true, Cols: 100, Rows: 30},
			recvOpts{Keep: true}, 60*time.Second, func(ss *session) map[string]any {
				obs := map[string]any{}
				m := ss.mark()
				_, gotFirst := ss.waitFor(m, 10*time.Second, func(t string) bool { return len(t) > 0 })
				obs["first_output_within_10s"] = gotFirst
				// echo
				m = ss.mark()
				_ = ss.input("echo hello-k\n")
				txt, ok := ss.waitText(m, "\r\nhello-k\r\n", 10*time.Second)
				obs["echo_hello_k_seen"] = ok
				obs["echo_output"] = head([]byte(txt), 120)
				// stty size BEFORE any resize
				t0 := time.Now()
				rows, cols, raw, ok := ss.sttySize(10 * time.Second)
				obs["stty_before_resize"] = fmt.Sprintf("%d %d", rows, cols)
				obs["stty_before_resize_ok"] = ok
				obs["stty_before_resize_raw"] = raw
				obs["stty_before_resize_ms"] = ms(time.Since(t0))
				// resize 120x40, seq 1, then stty size
				tr := time.Now()
				_ = ss.resize(1, 120, 40)
				rows, cols, raw, ok = ss.sttySize(10 * time.Second)
				obs["stty_after_resize_first"] = fmt.Sprintf("%d %d", rows, cols)
				obs["stty_after_resize_first_raw"] = raw
				seen := -1.0
				if ok && rows == 40 && cols == 120 {
					seen = ms(time.Since(tr))
				} else {
					for i := 0; i < 10 && seen < 0; i++ {
						ss.rec.note(ss.caseName, ss.run, "poll_stty_after_resize", map[string]any{"i": i})
						time.Sleep(300 * time.Millisecond)
						rows, cols, _, ok = ss.sttySize(5 * time.Second)
						if ok && rows == 40 && cols == 120 {
							seen = ms(time.Since(tr))
						}
					}
				}
				obs["resize_effective_after_ms"] = seen
				obs["stty_after_resize_final"] = fmt.Sprintf("%d %d", rows, cols)
				// exit 3
				m = ss.mark()
				_ = ss.input("exit 3\n")
				_, _ = ss.waitFor(m, 15*time.Second, func(t string) bool { return strings.Contains(t, "exit 3") })
				return obs
			})
	}
	return nil
}
