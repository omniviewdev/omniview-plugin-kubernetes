package main

import (
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/clientcmd/api"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	execv2 "github.com/omniviewdev/plugin-sdk/proto/exec/v2"
)

// ---------------------------------------------------------------------------------------------------------------
// S10: refusals
// ---------------------------------------------------------------------------------------------------------------

// rbacKubeconfig is the admin kubeconfig plus a second context, "noexec", that authenticates as the ServiceAccount of
// the fixtures (Role: get and list on pods only) with a token.
func (e *scenarioEnv) rbacKubeconfig(path string) error {
	tok, err := e.kube.kubectl(e.ctx, "-n", namespace, "create", "token", "noexec", "--duration=2h")
	if err != nil {
		return err
	}
	cfg, err := clientcmd.LoadFromFile(e.f.kubeconfig)
	if err != nil {
		return err
	}
	cur := cfg.Contexts[cfg.CurrentContext]
	if cur == nil {
		return fmt.Errorf("kubeconfig has no current context")
	}
	cfg.Clusters["noexec"] = cfg.Clusters[cur.Cluster].DeepCopy()
	cfg.AuthInfos["noexec"] = &api.AuthInfo{Token: strings.TrimSpace(tok)}
	cfg.Contexts["noexec"] = &api.Context{Cluster: "noexec", AuthInfo: "noexec"}
	return clientcmd.WriteToFile(*cfg, path)
}

func s10(e *scenarioEnv) error {
	runs := 2
	if e.f.runs < runs {
		runs = e.f.runs
	}
	// A. missing / odd selections, wrong reference type, on the admin connection
	if cm, err := e.rg.enumerate(e.ctx, "k8s:/configmaps", namespace); err != nil {
		e.rec.note("wrong-reference-type", 0, "enumerate_configmaps_failed", map[string]any{"error": err.Error()})
	} else {
		var ref *resourcev2.ResourceReference
		for _, r := range cm {
			rr := r.Record.Reference
			ref = &rr
			break
		}
		if ref != nil {
			for run := 1; run <= runs; run++ {
				e.runCase(e.rg, "wrong-reference-type (a k8s:/configmaps reference)", run, spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: []string{"true"}, Reference: ref},
					recvOpts{Keep: true}, 30*time.Second, nil)
			}
		}
	}
	for run := 1; run <= runs; run++ {
		e.runCase(e.rg, "no-selection-at-all (quiet)", run, spec{Pod: "quiet", Argv: []string{"true"}}, recvOpts{Keep: true}, 30*time.Second, nil)
		e.runCase(e.rg, "no-container-in-selection-multi-container-pod (three)", run, spec{Pod: "three", Mode: "exec", Argv: []string{"true"}}, recvOpts{Keep: true}, 30*time.Second, nil)
		e.runCase(e.rg, "no-container-in-selection-states2-default-is-ok (states2)", run, spec{Pod: "states2", Mode: "exec", Argv: []string{"true"}}, recvOpts{Keep: true}, 30*time.Second, nil)
		e.runCase(e.rg, "mode-bogus", run, spec{Pod: "quiet", Container: "main", Mode: "bogus", Argv: []string{"true"}}, recvOpts{Keep: true}, 30*time.Second, nil)
		e.runCase(e.rg, "container-not-a-closed-code(UPPER)", run, spec{Pod: "quiet", Container: "MAIN", Mode: "exec", Argv: []string{"true"}}, recvOpts{Keep: true}, 30*time.Second, nil)
		e.runCase(e.rg, "duplicate-selection-name", run, spec{Pod: "quiet", Selection: []*execv2.NameValue{{Name: "container", Value: "main"}, {Name: "container", Value: "main"}}, Argv: []string{"true"}},
			recvOpts{Keep: true}, 30*time.Second, nil)
		e.runCase(e.rg, "argv0-empty", run, spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: []string{""}}, recvOpts{Keep: true}, 30*time.Second, nil)
		e.runCase(e.rg, "size-without-tty (100x30, tty=false)", run, spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: []string{"true"}, Cols: 100, Rows: 30, SizeAnyway: true},
			recvOpts{Keep: true}, 30*time.Second, nil)
		e.runCase(e.rg, "tty-size-over-max-dimension", run, spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: []string{"true"}, TTY: true, Cols: 5000, Rows: 30},
			recvOpts{Keep: true}, 30*time.Second, nil)
		e.runCase(e.rg, "default-argv (empty argv: the target's /bin/sh) + immediate close_input ignored", run, spec{Pod: "quiet", Container: "main", Mode: "exec", TTY: true, Cols: 100, Rows: 30},
			recvOpts{Keep: true}, 8*time.Second, func(ss *session) map[string]any {
				m := ss.mark()
				ss.waitFor(m, 5*time.Second, func(t string) bool { return len(t) > 0 })
				_ = ss.input("exit\n")
				return nil
			})
	}

	// B. a stale reference: the pod was deleted and recreated, the host still holds the old record
	old, err := e.rg.pod("victim")
	if err == nil {
		_, _ = e.kube.kubectl(e.ctx, "-n", namespace, "delete", "pod", "victim", "--force", "--grace-period=0", "--wait=false")
		_ = e.kube.waitGone(e.ctx, "victim", 60*time.Second)
		if rerr := e.recreateVictim(e.ctx); rerr != nil {
			e.rec.note("stale-reference", 0, "recreate_failed", map[string]any{"error": rerr.Error()})
		}
		// the old record, the old incarnation, the live pod under the same name
		e.rg.mu.Lock()
		e.rg.pods["victim-old"] = podRec{Name: "victim", Record: old.Record, Revision: old.Revision}
		e.rg.mu.Unlock()
		for run := 1; run <= runs; run++ {
			e.runCase(e.rg, "stale-reference (old incarnation of a recreated pod)", run, spec{Pod: "victim-old", Container: "main", Mode: "exec", Argv: []string{"true"}},
				recvOpts{Keep: true}, 30*time.Second, nil)
			res, oerr := e.rg.options(e.ctx, old)
			e.rec.note("stale-reference", run, "options_with_old_record", map[string]any{"ok": oerr == nil, "error": errString(oerr), "has_result": res != nil})
		}
		_ = e.rg.refresh(e.ctx)
	}

	// C. RBAC: a connection whose identity may get and list pods and nothing else
	kc := filepath.Join(e.workDir, fmt.Sprintf("rbac-%d.kubeconfig", time.Now().UnixNano()))
	if err := e.rbacKubeconfig(kc); err != nil {
		e.rec.note("rbac", 0, "kubeconfig_failed", map[string]any{"error": err.Error()})
		return nil
	}
	dir := filepath.Join(e.workDir, fmt.Sprintf("s10-rbac-%d", time.Now().UnixNano()))
	p, err := launch(launchOpts{Name: "s10-rbac", Binary: e.f.plugin, PluginYAML: e.f.pluginYAML, Kubeconfig: kc, Dir: dir, LogLevel: e.f.logLevel,
		ExtraEnv: append([]string{"KPROOF_TRACE=" + e.tracePath("rbac")}, e.f.extraEnv...)})
	if err != nil {
		e.rec.note("rbac", 0, "plugin_launch_failed", map[string]any{"error": err.Error()})
		return nil
	}
	rg, err := newRig(e.ctx, p, "noexec")
	if err != nil {
		p.close()
		e.rec.note("rbac", 0, "connection_failed", map[string]any{"error": err.Error()})
		return nil
	}
	rg.Variant = "rbac"
	e.mu.Lock()
	e.rigs = append(e.rigs, rg)
	e.mu.Unlock()
	e.rec.note("rbac", 0, "rbac_connection_started", map[string]any{"connection": rg.Conn.ID, "status": string(rg.Status.Status), "error": rg.Status.Error})
	if err := rg.refresh(e.ctx); err != nil {
		// the plugin may need more than get/list on pods to enumerate: record exactly what it asked for and stop
		e.rec.note("rbac", 0, "enumerate_as_noexec_failed", map[string]any{"error": err.Error()})
		e.fact("rbac_enumerate_error", err.Error())
		return nil
	}
	pod, err := rg.pod("quiet")
	if err != nil {
		return err
	}
	for run := 1; run <= runs; run++ {
		res, oerr := rg.options(e.ctx, pod)
		f := map[string]any{"ok": oerr == nil, "error": errString(oerr)}
		if res != nil {
			var names []string
			for _, o := range res.Options {
				names = append(names, fmt.Sprintf("%s(%d choices)", o.Name, len(o.Choices)))
			}
			f["options"] = names
		}
		e.rec.note("rbac/options", run, "options_as_noexec", f)
		e.runCase(rg, "rbac-denied/exec (noexec connection)", run, spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: []string{"true"}}, recvOpts{Keep: true}, 30*time.Second, nil)
		e.runCase(rg, "rbac-denied/exec tty (noexec connection)", run, spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: []string{"/bin/sh"}, TTY: true, Cols: 100, Rows: 30}, recvOpts{Keep: true}, 30*time.Second, nil)
		e.runCase(rg, "rbac-denied/attach (noexec connection)", run, spec{Pod: "quiet", Container: "main", Mode: "attach", TTY: false}, recvOpts{Keep: true}, 30*time.Second, nil)
	}
	return nil
}

// ---------------------------------------------------------------------------------------------------------------
// S11: a resize flood
// ---------------------------------------------------------------------------------------------------------------

func s11(e *scenarioEnv) error {
	for run := 1; run <= e.f.runs; run++ {
		e.runCase(e.rg, "resize-flood-200", run, spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: []string{"/bin/sh"}, TTY: true, Cols: 100, Rows: 30},
			recvOpts{Keep: true}, 60*time.Second, func(ss *session) map[string]any {
				obs := map[string]any{}
				m := ss.mark()
				ss.waitFor(m, 10*time.Second, func(t string) bool { return len(t) > 0 })
				m = ss.mark()
				_ = ss.input("cat\n")
				ss.waitText(m, "cat\r\n", 5*time.Second)
				time.Sleep(500 * time.Millisecond)

				ping := func(token string, timeout time.Duration) (float64, bool) {
					m := ss.mark()
					t0 := time.Now()
					_ = ss.input(token + "\n")
					// the tty echoes the line, then cat prints it: the second occurrence is cat's
					_, ok := ss.waitFor(m, timeout, func(t string) bool { return strings.Count(t, token) >= 2 })
					return ms(time.Since(t0)), ok
				}
				var base []float64
				for i := range 8 {
					d, ok := ping(fmt.Sprintf("base%02d", i), 5*time.Second)
					if ok {
						base = append(base, d)
					}
				}
				obs["echo_latency_ms_baseline"] = base
				obs["echo_latency_baseline_median_ms"] = median(base)

				// the storm: 200 resizes as fast as Send allows, alternating 80x24 (odd) and 132x43 (even); a pinger
				// measures the echo latency meanwhile
				var mu sync.Mutex
				var during []float64
				var missed int
				stop := make(chan struct{})
				var wg sync.WaitGroup
				wg.Add(1)
				go func() {
					defer wg.Done()
					for i := 0; ; i++ {
						select {
						case <-stop:
							return
						default:
						}
						d, ok := ping(fmt.Sprintf("during%03d", i), 5*time.Second)
						mu.Lock()
						if ok {
							during = append(during, d)
						} else {
							missed++
						}
						mu.Unlock()
					}
				}()
				t0 := time.Now()
				var sendErr error
				for i := 1; i <= 200; i++ {
					cols, rows := uint32(80), uint32(24)
					if i%2 == 0 {
						cols, rows = 132, 43
					}
					if sendErr = ss.resize(uint32(i), cols, rows); sendErr != nil {
						break
					}
				}
				obs["storm_send_ms"] = ms(time.Since(t0))
				obs["storm_send_error"] = errText(sendErr)
				time.Sleep(1500 * time.Millisecond)
				close(stop)
				wg.Wait()
				mu.Lock()
				obs["echo_latency_ms_during_and_after_storm"] = during
				obs["echo_latency_during_median_ms"] = median(during)
				obs["echo_latency_during_max_ms"] = percentile(during, 100)
				obs["echo_pings_missed_within_5s"] = missed
				mu.Unlock()

				// leave cat (^D at the start of a line), then ask the tty
				m = ss.mark()
				_ = ss.input("\x04")
				time.Sleep(500 * time.Millisecond)
				tl := time.Now()
				rows, cols, raw, ok := ss.sttySize(10 * time.Second)
				obs["stty_size_after_storm"] = fmt.Sprintf("%d %d", rows, cols)
				obs["stty_size_after_storm_ok"] = ok
				obs["stty_size_raw"] = raw
				obs["last_resize_sent"] = "seq 200: 132 cols x 43 rows"
				obs["last_size_won"] = ok && rows == 43 && cols == 132
				obs["stty_read_ms"] = ms(time.Since(tl))
				_ = ss.input("exit\n")
				return obs
			})
	}
	return nil
}

// ---------------------------------------------------------------------------------------------------------------
// S12: open latency
// ---------------------------------------------------------------------------------------------------------------

func s12(e *scenarioEnv) error {
	type series struct {
		name string
		s    spec
		tty  bool
	}
	all := []series{
		{"nontty printf x (ends at once)", spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: []string{"sh", "-c", "printf x"}}, false},
		{"tty /bin/sh (prompt, then exit)", spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: []string{"/bin/sh"}, TTY: true, Cols: 100, Rows: 30}, true},
	}
	stats := map[string]any{}
	for _, se := range all {
		var opened, started, first, ended []float64
		for i := 1; i <= 20; i++ {
			if e.ctx.Err() != nil {
				return e.ctx.Err()
			}
			se := se
			sm := e.runCase(e.rg, se.name, i, se.s, recvOpts{Keep: true}, 30*time.Second, func(ss *session) map[string]any {
				if se.tty {
					m := ss.mark()
					ss.waitFor(m, 10*time.Second, func(t string) bool { return len(t) > 0 })
					_ = ss.input("exit\n")
				}
				return nil
			})
			if sm.Refused != "" {
				continue
			}
			opened = append(opened, sm.OpenToOpenedMs)
			if sm.StartedAtMs >= 0 {
				started = append(started, sm.StartedAtMs)
			}
			if sm.FirstOutputMs >= 0 {
				first = append(first, sm.FirstOutputMs)
			}
			if sm.EndedAtMs >= 0 {
				ended = append(ended, sm.EndedAtMs)
			}
		}
		row := func(v []float64) map[string]any {
			return map[string]any{"n": len(v), "median_ms": median(v), "p95_ms": percentile(v, 95), "min_ms": percentile(v, 0), "max_ms": percentile(v, 100), "values": v}
		}
		stats[se.name] = map[string]any{"open_to_opened": row(opened), "open_to_started": row(started), "open_to_first_output": row(first), "open_to_ended": row(ended)}
	}
	e.fact("open_latency", stats)
	return nil
}
