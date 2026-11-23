package main

// The scenario environment: one launched plugin (with its own KPROOF_TRACE file), the recorder of the scenario, the
// summaries it collected, and the hard timeout every scenario runs under.

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type flags struct {
	plugin     string
	pluginYAML string
	kubeconfig string
	out        string
	node       string
	connName   string
	logLevel   string
	fixtures   string
	runs       int
	scen       string
	runID      string
	extraEnv   []string
	suffix     string // appended to the scenario names (file names) of this invocation
}

// variant is one way to run a scenario: a file-name suffix and extra plugin environment (for example the executor that
// reads the status channel itself).
type variant struct {
	suffix string
	env    []string
}

type scenarioDef struct {
	id       string // s0, s1, ...
	name     string // the file stem: s0-describe
	title    string
	timeout  time.Duration
	viaTap   bool      // the scenario's plugin reaches the API server through the tap
	variants []variant // empty: one run with the plugin's default environment
	fn       func(*scenarioEnv) error
}

type scenarioEnv struct {
	f       *flags
	def     scenarioDef
	ctx     context.Context
	rec     *recorder
	rg      *rig
	kube    *kube
	tap     *tap // non-nil once startTap ran
	rawDir  string
	workDir string

	mu       sync.Mutex
	sums     []summary
	facts    map[string]any
	rigs     []*rig
	traceOff map[string]int64
	taps     []*tap
}

func (e *scenarioEnv) tracePath(variant string) string {
	stem := e.def.name
	if variant != "" {
		stem += "-" + variant
	}
	return filepath.Join(e.rawDir, stem+".trace.jsonl")
}

// launchRig starts a plugin process (a fresh throwaway HOME holding kubeconfig as ~/.kube/config) with KPROOF_TRACE set
// to this scenario's trace file, loads and starts the connection connName, and reads the pods of the fixtures namespace.
func (e *scenarioEnv) launchRig(variant, kubeconfig, connName string, extra ...string) (*rig, error) {
	name := e.def.name
	if variant != "" {
		name += "-" + variant
	}
	dir := filepath.Join(e.workDir, fmt.Sprintf("%s-%d", name, time.Now().UnixNano()))
	env := append([]string{"KPROOF_TRACE=" + e.tracePath(variant)}, e.f.extraEnv...)
	env = append(env, extra...)
	p, err := launch(launchOpts{Name: name, Binary: e.f.plugin, PluginYAML: e.f.pluginYAML, Kubeconfig: kubeconfig, Dir: dir,
		LogLevel: e.f.logLevel, ExtraEnv: env})
	if err != nil {
		return nil, err
	}
	rg, err := newRig(e.ctx, p, connName)
	if err != nil {
		p.close()
		return nil, err
	}
	rg.Variant = variant
	if err := rg.refresh(e.ctx); err != nil {
		p.close()
		return nil, err
	}
	e.mu.Lock()
	e.rigs = append(e.rigs, rg)
	e.mu.Unlock()
	e.rec.note("", 0, "plugin_launched", map[string]any{"variant": variant, "dir": dir, "binary": p.Binary, "kubeconfig": kubeconfig,
		"connection_name": connName, "connection_id": rg.Conn.ID, "connection_status": string(rg.Status.Status), "launch_ms": ms(p.Ready.Sub(p.Launched)),
		"extra_env": env, "pods": e.podNames(rg)})
	return rg, nil
}

func (e *scenarioEnv) podNames(rg *rig) []string {
	rg.mu.Lock()
	defer rg.mu.Unlock()
	var out []string
	for n := range rg.pods {
		out = append(out, n)
	}
	return out
}

func (e *scenarioEnv) addSummary(s summary) {
	e.mu.Lock()
	e.sums = append(e.sums, s)
	e.mu.Unlock()
	e.rec.emit(line{Case: s.Case, Run: s.Run, Session: s.Session, Dir: "summary", Kind: "session_summary", F: map[string]any{"summary": s}})
}

func (e *scenarioEnv) fact(k string, v any) {
	e.mu.Lock()
	if e.facts == nil {
		e.facts = map[string]any{}
	}
	e.facts[k] = v
	e.mu.Unlock()
}

// newTrace returns the lines the plugin appended to the trace file of variant since the last call; it waits up to wait
// for at least want lines (the provider writes its line when its stream returns, which can be a moment after the host
// stopped listening).
func (e *scenarioEnv) newTrace(variant string, want int, wait time.Duration) []string {
	path := e.tracePath(variant)
	deadline := time.Now().Add(wait)
	for {
		e.mu.Lock()
		if e.traceOff == nil {
			e.traceOff = map[string]int64{}
		}
		off := e.traceOff[path]
		e.mu.Unlock()
		lines, newOff := readLinesFrom(path, off)
		if len(lines) >= want || !time.Now().Before(deadline) {
			e.mu.Lock()
			e.traceOff[path] = newOff
			e.mu.Unlock()
			return lines
		}
		select {
		case <-e.ctx.Done():
			return lines
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func readLinesFrom(path string, off int64) ([]string, int64) {
	f, err := os.Open(path)
	if err != nil {
		return nil, off
	}
	defer f.Close()
	if _, err := f.Seek(off, io.SeekStart); err != nil {
		return nil, off
	}
	var out []string
	r := bufio.NewReader(f)
	pos := off
	for {
		s, err := r.ReadString('\n')
		if err != nil {
			break // a partial last line is left for the next call
		}
		pos += int64(len(s))
		out = append(out, strings.TrimRight(s, "\n"))
	}
	return out, pos
}

// traceSummary is the trace lines of one session in one short string (error text, protocol, exit chosen).
func traceSummary(lines []string) string {
	var parts []string
	for _, l := range lines {
		var m map[string]any
		if json.Unmarshal([]byte(l), &m) != nil {
			parts = append(parts, l)
			continue
		}
		if ev, _ := m["event"].(string); ev != "stream-end" {
			delete(m, "ts")
			parts = append(parts, "event "+jsonStr(m))
			continue
		}
		exec := ""
		if v, ok := m["executor"].(string); ok && v != "" {
			exec = " executor=" + v
		}
		parts = append(parts, fmt.Sprintf("protocol=%v%s exit=%v stream_err=%s stream_err_chain=%v returned_err=%s elapsed_ms=%v", m["protocol"], exec, jsonStr(m["exit"]), jsonStr(m["stream_err"]), m["stream_err_chain"], jsonStr(m["returned_err"]), m["elapsed_ms"]))
	}
	return strings.Join(parts, " || ")
}

func jsonStr(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func sha256File(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return "unreadable: " + err.Error()
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "unreadable: " + err.Error()
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}

func (e *scenarioEnv) writeSummary() error {
	e.mu.Lock()
	doc := map[string]any{"scenario": e.def.name, "title": e.def.title, "facts": e.facts, "sessions": e.sums}
	e.mu.Unlock()
	b, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(e.rawDir, e.def.name+".summary.json"), b, 0o644)
}

// sleep waits for d or the end of the scenario's context.
func (e *scenarioEnv) sleep(d time.Duration) bool {
	select {
	case <-time.After(d):
		return true
	case <-e.ctx.Done():
		return false
	}
}
