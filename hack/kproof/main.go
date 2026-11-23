// Command kproof is the measurement rig of the K-proof: it launches the REAL Kubernetes plugin binary the way the
// Omniview host does, drives its exec v2 lane through the SDK's own client (Client.Describe, Options, Open), and records
// every frame. Scenarios S0..S12 are in scen_*.go; the tap proxy (tap.go) is the independent oracle of what the API
// server put on the exec status channel; baseline.go measures client-go and kubectl without the plugin.
//
// This is test tooling (hack/), not part of the plugin.
//
//	kproof run -plugin BIN -kubeconfig KC -out DIR [-scenarios s0,s1,...] [-runs 3] [-env KEY=VAL ...]
//	kproof baseline -kubeconfig KC -out DIR
//	kproof report -out DIR
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type multiFlag []string

func (m *multiFlag) String() string     { return strings.Join(*m, ",") }
func (m *multiFlag) Set(v string) error { *m = append(*m, v); return nil }

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: kproof run|baseline|report|list [flags]")
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "run":
		err = cmdRun(os.Args[2:])
	case "baseline":
		err = cmdBaseline(os.Args[2:])
	case "report":
		err = cmdReport(os.Args[2:])
	case "list":
		for _, d := range registry() {
			fmt.Printf("%-4s %-22s %s\n", d.id, d.name, d.title)
		}
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "kproof:", err)
		os.Exit(1)
	}
}

func cmdRun(args []string) error {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	f := &flags{}
	var env multiFlag
	fs.StringVar(&f.plugin, "plugin", "", "the plugin binary")
	fs.StringVar(&f.pluginYAML, "plugin-yaml", "", "the plugin's plugin.yaml (default: ../../plugin.yaml next to the tool source)")
	fs.StringVar(&f.kubeconfig, "kubeconfig", "", "kubeconfig of the kind cluster kproof-exec-v2 (admin)")
	fs.StringVar(&f.out, "out", "", "output directory (raw/ is created in it)")
	fs.StringVar(&f.node, "node", "kproof-exec-v2-control-plane", "the kind node's docker container")
	fs.StringVar(&f.connName, "context", "kind-kproof-exec-v2", "the kubeconfig context = the plugin connection name")
	fs.StringVar(&f.logLevel, "plugin-log-level", "info", "OMNIVIEW_PLUGIN_LOG_LEVEL of the plugin")
	fs.StringVar(&f.fixtures, "fixtures", "", "fixtures.sh (default: <out>/fixtures/fixtures.sh)")
	fs.IntVar(&f.runs, "runs", 3, "runs of each cheap case")
	fs.StringVar(&f.scen, "scenarios", "all", "comma-separated scenario ids (s0,s1,...) or all")
	fs.Var(&env, "env", "extra plugin environment KEY=VAL (repeatable); recorded in every scenario")
	fs.StringVar(&f.suffix, "suffix", "", "appended to every scenario's file names (raw/<scenario>-<suffix>.*): a second run with another plugin binary next to the first")
	if err := fs.Parse(args); err != nil {
		return err
	}
	f.extraEnv = env
	if f.plugin == "" || f.kubeconfig == "" || f.out == "" {
		return errors.New("-plugin, -kubeconfig and -out are required")
	}
	var err error
	for _, p := range []*string{&f.plugin, &f.kubeconfig, &f.out} {
		if *p, err = filepath.Abs(*p); err != nil {
			return err
		}
	}
	if f.fixtures == "" {
		f.fixtures = filepath.Join(f.out, "fixtures", "fixtures.sh")
	}
	if f.pluginYAML == "" {
		return errors.New("-plugin-yaml is required")
	}
	f.runID = time.Now().Format("20060102-150405")
	kb := &kube{kubeconfig: f.kubeconfig, node: f.node, fixtures: f.fixtures}
	if err := writeEnvInfo(f, kb); err != nil {
		fmt.Fprintln(os.Stderr, "env info:", err)
	}

	want := map[string]bool{}
	if f.scen != "all" {
		for _, s := range strings.Split(f.scen, ",") {
			want[strings.TrimSpace(s)] = true
		}
	}
	var failed []string
	for _, def := range registry() {
		if len(want) > 0 && !want[def.id] && !want[def.name] {
			continue
		}
		vars := def.variants
		if len(vars) == 0 {
			vars = []variant{{}}
		}
		for _, v := range vars {
			d := def
			if v.suffix != "" {
				d.name += "-" + v.suffix
				d.title += " [" + v.suffix + "]"
			}
			if f.suffix != "" {
				d.name += "-" + f.suffix
				d.title += " [" + f.suffix + "]"
			}
			fmt.Printf("== %s: %s\n", d.name, d.title)
			t0 := time.Now()
			if err := runScenario(f, d, v, kb); err != nil {
				fmt.Printf("== %s FAILED after %v: %v\n", d.name, time.Since(t0).Round(time.Millisecond), err)
				failed = append(failed, d.name)
			} else {
				fmt.Printf("== %s done in %v\n", d.name, time.Since(t0).Round(time.Millisecond))
			}
		}
	}
	if len(failed) > 0 {
		return fmt.Errorf("scenarios with a harness failure: %s", strings.Join(failed, ", "))
	}
	return nil
}

// runScenario runs one scenario (one variant of it): a fresh plugin process, the scenario function under its hard
// timeout, then the summary and the evidence files.
func runScenario(f *flags, def scenarioDef, v variant, kb *kube) (err error) {
	rawDir := filepath.Join(f.out, "raw")
	workDir := filepath.Join(f.out, "work", "runs", f.runID)
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return err
	}
	rec, err := newRecorder(filepath.Join(rawDir, def.name+".jsonl"), def.name)
	if err != nil {
		return err
	}
	defer rec.close()
	// each variant carries its own plugin environment on top of the run's
	ff := *f
	ff.extraEnv = append(append([]string(nil), f.extraEnv...), v.env...)
	ctx, cancel := context.WithTimeout(context.Background(), def.timeout)
	defer cancel()
	e := &scenarioEnv{f: &ff, def: def, ctx: ctx, rec: rec, kube: kb, rawDir: rawDir, workDir: workDir}
	rec.note("", 0, "scenario_begin", map[string]any{"scenario": def.name, "title": def.title, "timeout_s": def.timeout.Seconds(),
		"plugin": f.plugin, "plugin_sha256": sha256File(f.plugin), "plugin_env": ff.extraEnv, "uptime": kb.uptime(), "via_tap": def.viaTap, "runs": f.runs})

	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic: %v", r)
			rec.note("", 0, "scenario_panic", map[string]any{"panic": fmt.Sprint(r)})
		}
		e.teardown()
	}()

	if def.viaTap {
		if e.rg, err = e.launchViaTap(""); err != nil {
			rec.note("", 0, "scenario_setup_failed", map[string]any{"error": err.Error()})
			return err
		}
	} else if e.rg, err = e.launchRig("", f.kubeconfig, f.connName); err != nil {
		rec.note("", 0, "scenario_setup_failed", map[string]any{"error": err.Error()})
		return err
	}
	done := make(chan error, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				done <- fmt.Errorf("panic: %v", r)
			}
		}()
		done <- def.fn(e)
	}()
	select {
	case err = <-done:
	case <-time.After(def.timeout + 45*time.Second):
		err = fmt.Errorf("scenario hard timeout (%v) passed; the scenario function did not return", def.timeout)
		rec.note("", 0, "scenario_hard_timeout", map[string]any{"timeout_s": def.timeout.Seconds()})
	}
	if ctx.Err() != nil {
		rec.note("", 0, "scenario_context_ended", map[string]any{"error": ctx.Err().Error()})
	}
	return err
}

// teardown writes the summary, copies the plugin's stderr next to the raw files, and kills the plugin and the tap.
func (e *scenarioEnv) teardown() {
	e.rec.note("", 0, "scenario_end", map[string]any{"uptime": e.kube.uptime()})
	e.mu.Lock()
	rigs := append([]*rig(nil), e.rigs...)
	taps := append([]*tap(nil), e.taps...)
	e.mu.Unlock()
	for i, rg := range rigs {
		rg.P.close()
		suffix := ""
		if i > 0 {
			suffix = fmt.Sprintf("-%d", i)
		}
		if data, err := os.ReadFile(rg.P.StderrPath); err == nil {
			_ = os.WriteFile(filepath.Join(e.rawDir, e.def.name+suffix+".plugin.log"), data, 0o644)
		}
	}
	for _, t := range taps {
		t.close()
	}
	if err := e.writeSummary(); err != nil {
		fmt.Fprintln(os.Stderr, "summary:", err)
	}
}

// launchViaTap starts a tap in front of the cluster and a plugin whose kubeconfig points at it.
func (e *scenarioEnv) launchViaTap(variant string, extra ...string) (*rig, error) {
	stem := e.def.name
	if variant != "" {
		stem += "-" + variant
	}
	tp, err := startTap(e.f.kubeconfig, filepath.Join(e.rawDir, stem+".tap.jsonl"))
	if err != nil {
		return nil, err
	}
	e.mu.Lock()
	e.taps = append(e.taps, tp)
	e.tap = tp
	e.mu.Unlock()
	kc := filepath.Join(e.workDir, fmt.Sprintf("tap-%s-%d.kubeconfig", stem, time.Now().UnixNano()))
	if err := tp.writeKubeconfig(kc, e.f.connName); err != nil {
		return nil, err
	}
	e.rec.note("", 0, "tap_started", map[string]any{"url": tp.URL, "kubeconfig": kc, "log": stem + ".tap.jsonl"})
	return e.launchRig(variant, kc, e.f.connName, extra...)
}
