package main

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// endTimes returns when the session's first terminal event arrived (the Ended frame, else the receive error) on the
// session's clock, and which it was.
func (s *session) endTime() (time.Duration, string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case s.endedFrame != nil:
		return s.endedAt, "Ended frame", true
	case s.recvErr != nil:
		return s.recvEnd, "stream error/EOF without Ended", true
	}
	return 0, "", false
}

// liveSession is the settle step of a fault case: the session has to be running before the fault.
func settleLive(ss *session, tty bool) map[string]any {
	obs := map[string]any{}
	if tty {
		m := ss.mark()
		_, ok := ss.waitFor(m, 15*time.Second, func(t string) bool { return len(t) > 0 })
		obs["first_output_before_fault"] = ok
		time.Sleep(1500 * time.Millisecond)
	} else {
		time.Sleep(2500 * time.Millisecond)
	}
	return obs
}

// ---------------------------------------------------------------------------------------------------------------
// S5: the container (or the node's runtime) goes away under a live session
// ---------------------------------------------------------------------------------------------------------------

type s5fault struct {
	id, name string
	do       func(e *scenarioEnv, obs map[string]any) error
	recover  func(e *scenarioEnv, obs map[string]any) error
}

func (e *scenarioEnv) recreateVictim(ctx context.Context) error {
	_, err := e.kube.kubectl(ctx, "apply", "-f", filepath.Join(filepath.Dir(e.f.fixtures), "victim.yaml"))
	if err != nil {
		return err
	}
	return e.kube.waitReady(ctx, "victim", 120*time.Second)
}

func s5faults() []s5fault {
	return []s5fault{
		{id: "a", name: "kill -9 of the container's PID 1 from the node",
			do: func(e *scenarioEnv, obs map[string]any) error {
				pid, id, err := e.kube.containerPID(e.ctx, "victim", "main")
				obs["container_id"], obs["container_pid_on_node"] = id, pid
				if err != nil {
					return err
				}
				out, err := e.kube.nodeExec(e.ctx, 20*time.Second, "kill", "-9", strconv.Itoa(pid))
				obs["fault_command"] = fmt.Sprintf("docker exec %s kill -9 %d", e.kube.node, pid)
				obs["fault_output"] = strings.TrimSpace(out)
				return err
			},
			recover: func(e *scenarioEnv, obs map[string]any) error {
				return e.kube.waitReady(e.ctx, "victim", 120*time.Second)
			}},
		{id: "b", name: "kubectl delete pod --force --grace-period=0 (recreated after)",
			do: func(e *scenarioEnv, obs map[string]any) error {
				out, err := e.kube.kubectl(e.ctx, "-n", namespace, "delete", "pod", "victim", "--force", "--grace-period=0", "--wait=false")
				obs["fault_command"] = "kubectl -n kproof delete pod victim --force --grace-period=0 --wait=false"
				obs["fault_output"] = strings.TrimSpace(out)
				return err
			},
			recover: func(e *scenarioEnv, obs map[string]any) error { return e.recreateVictim(e.ctx) }},
		{id: "c", name: "kubectl delete pod (grace period 1 s, recreated after)",
			do: func(e *scenarioEnv, obs map[string]any) error {
				out, err := e.kube.kubectl(e.ctx, "-n", namespace, "delete", "pod", "victim", "--wait=false")
				obs["fault_command"] = "kubectl -n kproof delete pod victim --wait=false"
				obs["fault_output"] = strings.TrimSpace(out)
				return err
			},
			recover: func(e *scenarioEnv, obs map[string]any) error {
				if err := e.kube.waitGone(e.ctx, "victim", 60*time.Second); err != nil {
					return err
				}
				return e.recreateVictim(e.ctx)
			}},
		{id: "d", name: "systemctl restart kubelet",
			do: func(e *scenarioEnv, obs map[string]any) error {
				out, err := e.kube.nodeExec(e.ctx, 120*time.Second, "systemctl", "restart", "kubelet")
				obs["fault_command"] = "docker exec " + e.kube.node + " systemctl restart kubelet"
				obs["fault_output"] = strings.TrimSpace(out)
				return err
			},
			recover: func(e *scenarioEnv, obs map[string]any) error {
				if _, err := e.kube.apiReady(e.ctx, 120*time.Second); err != nil {
					return err
				}
				return e.kube.waitReady(e.ctx, "victim", 120*time.Second)
			}},
		{id: "e", name: "systemctl restart containerd",
			do: func(e *scenarioEnv, obs map[string]any) error {
				out, err := e.kube.nodeExec(e.ctx, 180*time.Second, "systemctl", "restart", "containerd")
				obs["fault_command"] = "docker exec " + e.kube.node + " systemctl restart containerd"
				obs["fault_output"] = strings.TrimSpace(out)
				return err
			},
			recover: func(e *scenarioEnv, obs map[string]any) error {
				if _, err := e.kube.apiReady(e.ctx, 180*time.Second); err != nil {
					return err
				}
				_, err := e.kube.applyFixtures(e.ctx)
				if err != nil {
					// an ephemeral container is not restarted with its pod sandbox: recreate "three" and apply again
					e.rec.note("", 0, "fixtures_failed_after_containerd_restart", map[string]any{"error": err.Error()})
					_, _ = e.kube.kubectl(e.ctx, "-n", namespace, "delete", "pod", "three", "--force", "--grace-period=0", "--wait=false")
					_ = e.kube.waitGone(e.ctx, "three", 60*time.Second)
					_, err = e.kube.applyFixtures(e.ctx)
				}
				return err
			}},
	}
}

// waitExecable waits until `kubectl exec` into a container of pod works.
func (e *scenarioEnv) waitExecable(pod string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var last error
	for time.Now().Before(deadline) && e.ctx.Err() == nil {
		_, err := e.kube.inPod(e.ctx, pod, "main", "true")
		if err == nil {
			return nil
		}
		last = err
		time.Sleep(time.Second)
	}
	return last
}

func s5(e *scenarioEnv) error {
	kinds := []struct {
		name string
		s    spec
	}{
		{"tty-sh", spec{Pod: "victim", Container: "main", Mode: "exec", Argv: []string{"/bin/sh"}, TTY: true, Cols: 100, Rows: 30}},
		{"nontty-sleep600", spec{Pod: "victim", Container: "main", Mode: "exec", Argv: []string{"sh", "-c", "sleep 600"}}},
	}
	runs := 2
	if e.f.runs < runs {
		runs = e.f.runs
	}
	for _, f := range s5faults() {
		for _, k := range kinds {
			for run := 1; run <= runs; run++ {
				for attempt := 1; attempt <= 3; attempt++ {
					if e.ctx.Err() != nil {
						return e.ctx.Err()
					}
					if err := e.kube.waitReady(e.ctx, "victim", 120*time.Second); err != nil {
						e.rec.note("", 0, "victim_not_ready", map[string]any{"error": err.Error()})
						if rerr := e.recreateVictim(e.ctx); rerr != nil {
							return rerr
						}
					}
					// the pod being Ready is not enough right after a runtime or kubelet restart: wait until kubectl exec itself works
					if err := e.waitExecable("victim", 120*time.Second); err != nil {
						e.rec.note("", 0, "victim_not_execable", map[string]any{"error": err.Error()})
					}
					if err := e.rg.refresh(e.ctx); err != nil {
						return err
					}
					name := fmt.Sprintf("%s-%s/%s", f.id, strings.Fields(f.name)[0], k.name)
					f, k := f, k
					var faultErr error
					var faultObs map[string]any
					endedBeforeFault := false
					e.runCase(e.rg, name, run, k.s, recvOpts{Keep: true}, 200*time.Second, func(ss *session) map[string]any {
						obs := settleLive(ss, k.s.TTY)
						obs["fault"] = f.name
						obs["attempt"] = attempt
						if ss.isDone() {
							// the session ended by itself before the fault: not a measurement of the fault; the case is repeated
							obs["invalid_session_ended_before_the_fault"] = true
							endedBeforeFault = true
							faultObs = obs
							return obs
						}
						before, _ := e.kube.containerStates(e.ctx, "victim")
						obs["victim_states_before"] = before
						tf := ss.since()
						obs["fault_started_at_ms"] = ms(tf)
						ss.emit(line{Dir: "event", Kind: "fault_begin", F: map[string]any{"fault": f.name}})
						faultErr = f.do(e, obs)
						td := ss.since()
						obs["fault_command_returned_at_ms"] = ms(td)
						obs["fault_command_error"] = errText(faultErr)
						ss.emit(line{Dir: "event", Kind: "fault_done", F: map[string]any{"fault": f.name, "error": errText(faultErr)}})
						if !ss.waitEnd(160 * time.Second) {
							obs["no_end_within_160s_of_fault"] = true
						}
						if te, how, ok := ss.endTime(); ok {
							obs["end_arrived_at_ms"] = ms(te)
							obs["end_arrived_as"] = how
							obs["end_after_fault_start_ms"] = ms(te - tf)
							obs["end_after_fault_command_returned_ms"] = ms(te - td)
						}
						faultObs = obs
						return obs
					})
					// recover the fixture for the next case
					recoverErr := f.recover(e, faultObs)
					e.rec.note(name, run, "recovered", map[string]any{"attempt": attempt, "fault_error": errText(faultErr), "recover_error": errText(recoverErr), "invalid_attempt": endedBeforeFault})
					after, _ := e.kube.containerStates(e.ctx, "victim")
					e.rec.note(name, run, "victim_states_after_recovery", map[string]any{"states": after})
					if rerr := e.rg.refresh(e.ctx); rerr != nil {
						return rerr
					}
					if !endedBeforeFault {
						break
					}
				}
			}
		}
	}
	return nil
}

// ---------------------------------------------------------------------------------------------------------------
// S6: the connection to the API server is cut under a live session
// ---------------------------------------------------------------------------------------------------------------

const apiserverManifest = "/etc/kubernetes/manifests/kube-apiserver.yaml"
const apiserverAway = "/etc/kubernetes/kproof-away-kube-apiserver.yaml"

// restoreAPIServer puts the static pod manifest back if a scenario moved it away.
func (e *scenarioEnv) restoreAPIServer() {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if _, err := e.kube.nodeExec(ctx, 20*time.Second, "test", "-f", apiserverAway); err == nil {
		_, _ = e.kube.nodeExec(ctx, 20*time.Second, "mv", apiserverAway, apiserverManifest)
	}
}

func s6(e *scenarioEnv) error {
	defer e.restoreAPIServer()
	script := "while true; do date; sleep 1; done"
	cases := []struct {
		id, name string
		fault    func(e *scenarioEnv, ss *session, obs map[string]any) error
		after    func(e *scenarioEnv, obs map[string]any)
		wait     time.Duration
	}{
		{id: "a", name: "fin: the tap closes every connection with a clean TCP FIN", wait: 120 * time.Second,
			fault: func(e *scenarioEnv, ss *session, obs map[string]any) error {
				obs["tap_conns_faulted"] = e.tap.fault("fin")
				return nil
			}},
		{id: "b", name: "rst: the tap resets every connection (SetLinger(0) + close)", wait: 120 * time.Second,
			fault: func(e *scenarioEnv, ss *session, obs map[string]any) error {
				obs["tap_conns_faulted"] = e.tap.fault("rst")
				return nil
			}},
		{id: "c", name: "blackhole: the tap keeps the sockets open and forwards nothing", wait: 130 * time.Second,
			fault: func(e *scenarioEnv, ss *session, obs map[string]any) error {
				obs["tap_conns_faulted"] = e.tap.fault("blackhole")
				return nil
			},
			after: func(e *scenarioEnv, obs map[string]any) {
				e.tap.fault("passthrough")
				obs["tap_conns_reset_after_blackhole"] = e.tap.fault("rst")
			}},
		{id: "d", name: "the API server restarts (static pod manifest moved away and back)", wait: 200 * time.Second,
			fault: func(e *scenarioEnv, ss *session, obs map[string]any) error {
				out, err := e.kube.nodeExec(e.ctx, 30*time.Second, "mv", apiserverManifest, apiserverAway)
				obs["fault_command"] = "docker exec " + e.kube.node + " mv " + apiserverManifest + " " + apiserverAway
				obs["fault_output"] = strings.TrimSpace(out)
				return err
			},
			after: func(e *scenarioEnv, obs map[string]any) {
				// wait for the apiserver container to be gone, then put the manifest back
				gone := false
				t0 := time.Now()
				for time.Since(t0) < 90*time.Second && e.ctx.Err() == nil {
					out, _ := e.kube.nodeExec(e.ctx, 20*time.Second, "crictl", "ps", "--name", "kube-apiserver", "-q")
					if strings.TrimSpace(out) == "" {
						gone = true
						break
					}
					time.Sleep(time.Second)
				}
				obs["apiserver_container_gone"] = gone
				obs["apiserver_gone_after_ms"] = ms(time.Since(t0))
				time.Sleep(3 * time.Second)
				_, err := e.kube.nodeExec(e.ctx, 20*time.Second, "mv", apiserverAway, apiserverManifest)
				obs["manifest_restored_error"] = errText(err)
				d, err := e.kube.apiReady(e.ctx, 240*time.Second)
				obs["apiserver_ready_again_after_ms"] = ms(d)
				obs["apiserver_ready_error"] = errText(err)
			}},
	}
	for _, c := range cases {
		if e.ctx.Err() != nil {
			return e.ctx.Err()
		}
		if _, err := e.kube.apiReady(e.ctx, 60*time.Second); err != nil {
			return err
		}
		if err := e.kube.waitReady(e.ctx, "quiet", 60*time.Second); err != nil {
			return err
		}
		if err := e.rg.refresh(e.ctx); err != nil {
			e.rec.note(c.id, 0, "refresh_failed_before_case", map[string]any{"error": err.Error()})
			time.Sleep(5 * time.Second)
			if err := e.rg.refresh(e.ctx); err != nil {
				return err
			}
		}
		c := c
		name := fmt.Sprintf("%s-%s", c.id, strings.Fields(c.name)[0])
		e.runCase(e.rg, name, 1, spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: []string{"sh", "-c", script}, TTY: true, Cols: 100, Rows: 30},
			recvOpts{Keep: true}, c.wait+60*time.Second, func(ss *session) map[string]any {
				obs := map[string]any{"fault": c.name}
				m := ss.mark()
				_, ok := ss.waitFor(m, 20*time.Second, func(t string) bool { return strings.Count(t, "\n") >= 3 })
				obs["three_output_lines_before_fault"] = ok
				tf := ss.since()
				obs["fault_started_at_ms"] = ms(tf)
				ss.emit(line{Dir: "event", Kind: "fault_begin", F: map[string]any{"fault": c.name}})
				ferr := c.fault(e, ss, obs)
				td := ss.since()
				obs["fault_returned_at_ms"] = ms(td)
				obs["fault_error"] = errText(ferr)
				ss.emit(line{Dir: "event", Kind: "fault_done", F: map[string]any{"fault": c.name, "error": errText(ferr)}})
				if !ss.waitEnd(c.wait) {
					obs["no_end_within_wait"] = true
					obs["waited_s"] = c.wait.Seconds()
				}
				if te, how, ok := ss.endTime(); ok {
					obs["end_arrived_at_ms"] = ms(te)
					obs["end_arrived_as"] = how
					obs["end_after_fault_start_ms"] = ms(te - tf)
				}
				if c.after != nil {
					c.after(e, obs)
				}
				// is the connection still usable? the host's next Options on the same connection
				time.Sleep(2 * time.Second)
				if pod, perr := e.rg.pod("quiet"); perr == nil {
					t0 := time.Now()
					_, oerr := e.rg.options(e.ctx, pod)
					obs["options_probe_after_fault"] = errString(oerr)
					obs["options_probe_ok"] = oerr == nil
					obs["options_probe_ms"] = ms(time.Since(t0))
				}
				return obs
			})
		// wait for everything to be healthy before the next case
		if _, err := e.kube.apiReady(e.ctx, 240*time.Second); err != nil {
			return err
		}
	}
	return nil
}
