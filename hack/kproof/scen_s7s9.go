package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	ep "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	execv2 "github.com/omniviewdev/plugin-sdk/proto/exec/v2"
)

// ---------------------------------------------------------------------------------------------------------------
// S7: does the remote process survive the end of the session?
// ---------------------------------------------------------------------------------------------------------------

const sleepsScript = `ps -o pid,args | awk '$2=="sleep" && $3=="600" {print $1}'`

// sleeps lists the pids of "sleep 600" in quiet/main, through kubectl exec (the control channel of the check).
func (e *scenarioEnv) sleeps() ([]string, string, error) {
	out, err := e.kube.inPod(e.ctx, "quiet", "main", sleepsScript)
	return strings.Fields(out), strings.TrimSpace(out), err
}

func (e *scenarioEnv) psAll() string {
	out, err := e.kube.inPod(e.ctx, "quiet", "main", "ps -o pid,ppid,args")
	if err != nil {
		return "ps failed: " + err.Error()
	}
	return strings.TrimSpace(out)
}

// orphansScript lists what the sessions of the scenarios leave behind in quiet/main: `sleep 600`, the exec'd shells (args
// exactly /bin/sh), `cat` and `wc`. PID 1 is `sleep 3600` and is never listed.
const orphansScript = `ps -o pid,args | awk '($2=="sleep" && $3=="600") || ($2=="/bin/sh" && NF==2) || ($2=="cat" && NF==2) || $2=="wc" {print $1}'`

// killSleeps kills the orphans of earlier sessions in quiet/main (the name is kept: it is called before each S7 case).
func (e *scenarioEnv) killSleeps() {
	_, _ = e.kube.inPod(e.ctx, "quiet", "main", `kill -9 $(`+orphansScript+`) 2>/dev/null; true`)
}

func s7(e *scenarioEnv) error {
	kinds := []struct {
		name  string
		s     spec
		typed string
	}{
		{"nontty-sleep-600", spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: []string{"sleep", "600"}}, ""},
		{"tty-sh-running-sleep-600", spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: []string{"/bin/sh"}, TTY: true, Cols: 100, Rows: 30}, "sleep 600\n"},
	}
	ends := []string{"Close{GRACEFUL}", "Close{KILL}", "stream cancel (Conn.Close)"}
	runs := e.f.runs
	for _, k := range kinds {
		for _, end := range ends {
			for run := 1; run <= runs; run++ {
				if e.ctx.Err() != nil {
					return e.ctx.Err()
				}
				e.killSleeps()
				time.Sleep(500 * time.Millisecond)
				k, end := k, end
				name := k.name + "/" + end
				e.runCase(e.rg, name, run, k.s, recvOpts{Keep: true}, 60*time.Second, func(ss *session) map[string]any {
					obs := map[string]any{}
					if k.s.TTY {
						m := ss.mark()
						ss.waitFor(m, 15*time.Second, func(t string) bool { return len(t) > 0 })
						_ = ss.input(k.typed)
					}
					time.Sleep(2 * time.Second)
					pids, _, err := e.sleeps()
					obs["sleep600_pids_before_end"] = pids
					obs["sleep600_check_before_error"] = errText(err)
					obs["ps_before_end"] = e.psAll()
					te := ss.since()
					obs["end_requested_at_ms"] = ms(te)
					switch end {
					case "Close{GRACEFUL}":
						_ = ss.closeMode(execv2.CloseMode_CLOSE_MODE_GRACEFUL)
					case "Close{KILL}":
						_ = ss.closeMode(execv2.CloseMode_CLOSE_MODE_KILL)
					default:
						ss.cancel()
					}
					ended := ss.waitEnd(30 * time.Second)
					obs["stream_ended_within_30s"] = ended
					if t, how, ok := ss.endTime(); ok {
						obs["end_arrived_as"] = how
						obs["end_after_request_ms"] = ms(t - te)
					}
					time.Sleep(5 * time.Second)
					pids, _, err = e.sleeps()
					obs["sleep600_pids_5s_after_end"] = pids
					obs["sleep600_check_after_error"] = errText(err)
					obs["remote_process_survives"] = len(pids) > 0
					obs["ps_5s_after_end"] = e.psAll()
					return obs
				})
				e.killSleeps()
			}
		}
	}
	return nil
}

// ---------------------------------------------------------------------------------------------------------------
// S8: attach
// ---------------------------------------------------------------------------------------------------------------

func capsMap(f *execv2.SessionFacts) map[string]any {
	var m map[string]any
	b := rawJSON(f.GetCapabilities())
	_ = json.Unmarshal(b, &m)
	return m
}

func diffMaps(a, b map[string]any) []string {
	var out []string
	keys := map[string]bool{}
	for k := range a {
		keys[k] = true
	}
	for k := range b {
		keys[k] = true
	}
	for k := range keys {
		x, y := fmt.Sprint(a[k]), fmt.Sprint(b[k])
		if x != y {
			out = append(out, fmt.Sprintf("%s: exec=%s attach=%s", k, x, y))
		}
	}
	return out
}

func s8(e *scenarioEnv) error {
	// the capabilities Opened carries for each mode, on the same pod
	var execCaps, attachCaps map[string]any
	if ss, err := e.openSession(e.ctx, e.rg, "opened-capabilities-exec", 1, spec{Pod: "tty", Container: "main", Mode: "exec", Argv: []string{"true"}}, recvOpts{Keep: true}); err == nil {
		execCaps = capsMap(ss.opened.GetFacts())
		e.fact("opened_exec_facts", string(rawJSON(ss.opened.GetFacts())))
		ss.waitEnd(30 * time.Second)
		ss.cancel()
	} else {
		e.fact("opened_exec_error", errString(err))
	}
	runs := e.f.runs
	for run := 1; run <= runs; run++ {
		if e.ctx.Err() != nil {
			return e.ctx.Err()
		}
		if err := e.kube.waitReady(e.ctx, "tty", 180*time.Second); err != nil {
			return err
		}
		if err := e.rg.refresh(e.ctx); err != nil {
			return err
		}
		before, _ := e.kube.containerStates(e.ctx, "tty")
		e.runCase(e.rg, "attach/tty-pod/exit-pid1", run, spec{Pod: "tty", Container: "main", Mode: "attach", TTY: true, Cols: 100, Rows: 30},
			recvOpts{Keep: true}, 90*time.Second, func(ss *session) map[string]any {
				obs := map[string]any{"victim_states_before": before}
				if run == 1 && ss.opened != nil {
					attachCaps = capsMap(ss.opened.GetFacts())
					e.fact("opened_attach_facts", string(rawJSON(ss.opened.GetFacts())))
				}
				m := ss.mark()
				_, first := ss.waitFor(m, 5*time.Second, func(t string) bool { return len(t) > 0 })
				obs["output_before_any_input_within_5s"] = first
				m = ss.mark()
				_ = ss.input("echo attached\n")
				txt, ok := ss.waitText(m, "attached\r\n", 10*time.Second)
				obs["echo_attached_seen"] = ok
				obs["echo_output"] = head([]byte(txt), 160)
				tex := ss.since()
				obs["exit_sent_at_ms"] = ms(tex)
				_ = ss.input("exit\n")
				ss.waitEnd(60 * time.Second)
				if t, how, ok := ss.endTime(); ok {
					obs["end_arrived_as"] = how
					obs["end_after_exit_sent_ms"] = ms(t - tex)
				}
				return obs
			})
		time.Sleep(3 * time.Second)
		after, _ := e.kube.containerStates(e.ctx, "tty")
		e.rec.note("attach/tty-pod/exit-pid1", run, "tty_pod_states_after", map[string]any{"states": after})
	}
	if execCaps != nil && attachCaps != nil {
		e.fact("opened_capabilities_diff_exec_vs_attach", diffMaps(execCaps, attachCaps))
	}
	return nil
}

// ---------------------------------------------------------------------------------------------------------------
// S9: the picker against reality
// ---------------------------------------------------------------------------------------------------------------

type pickerRow struct {
	Pod       string `json:"pod"`
	Pass      int    `json:"pass"`
	Container string `json:"container"`
	Kind      string `json:"kind"`
	State     string `json:"state"`
	Detail    string `json:"detail"`
	Default   bool   `json:"default"`
	Kubelet   string `json:"kubelet_state"`
	Claimed   bool   `json:"claimed_exec_able"`
	Outcome   string `json:"open_outcome"`
	TapStatus string `json:"tap_status_channel"`
	ExecAble  string `json:"measured_exec_able"`
}

func s9(e *scenarioEnv) error {
	var rows []pickerRow
	pods := []struct {
		name   string
		passes int
	}{{"three", 1}, {"states", 1}, {"states2", 2}}
	for _, p := range pods {
		for pass := 1; pass <= p.passes; pass++ {
			if e.ctx.Err() != nil {
				return e.ctx.Err()
			}
			if pass > 1 && !e.sleep(25*time.Second) {
				return e.ctx.Err()
			}
			if err := e.rg.refresh(e.ctx); err != nil {
				return err
			}
			pod, err := e.rg.pod(p.name)
			if err != nil {
				return err
			}
			actual, _ := e.kube.containerStates(e.ctx, p.name)
			res, err := e.rg.options(e.ctx, pod)
			if err != nil {
				e.rec.note(p.name, pass, "options_failed", map[string]any{"error": errString(err)})
				continue
			}
			for _, o := range res.Options {
				if o.Name != "container" {
					continue
				}
				for _, c := range o.Choices {
					sm := e.runCase(e.rg, p.name+"/"+c.Value, pass, spec{Pod: p.name, Container: c.Value, Mode: "exec", Argv: []string{"true"}}, recvOpts{Keep: true}, 60*time.Second, nil)
					row := pickerRow{Pod: p.name, Pass: pass, Container: c.Value, Kind: c.Kind, State: c.State.String(), Detail: c.Detail, Default: c.IsDefault,
						Kubelet: actual[c.Value], Claimed: c.State == ep.ChoiceStateReady}
					switch {
					case sm.Refused != "":
						row.Outcome = "Open refused: " + sm.Refused
					default:
						row.Outcome = sm.EndLine
					}
					if tv, ok := sm.Extra["tap"].([]map[string]any); ok && len(tv) > 0 {
						row.TapStatus = fmt.Sprint(tv[0]["status_view"])
						if ds, _ := tv[0]["dial_status"].(int); ds != 0 {
							row.TapStatus = fmt.Sprintf("upgrade refused HTTP %d: %v", ds, tv[0]["dial_body"])
						}
					} else {
						row.TapStatus = "no exec connection reached the API server"
					}
					switch {
					case strings.Contains(row.TapStatus, "Success"):
						row.ExecAble = "yes (status Success)"
					case strings.HasPrefix(row.TapStatus, "upgrade refused"), strings.Contains(row.TapStatus, "no exec connection"):
						row.ExecAble = "no"
					default:
						row.ExecAble = "no/other: " + row.TapStatus
					}
					rows = append(rows, row)
				}
			}
		}
	}
	e.fact("picker", rows)
	return nil
}
