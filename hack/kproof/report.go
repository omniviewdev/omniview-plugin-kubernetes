package main

// kproof report: RESULTS.md from raw/*.summary.json. Tables only; the findings text is the author's (-findings FILE) and
// is placed at the top verbatim.

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
)

type jm = map[string]any

func gs(m jm, k string) string {
	if v, ok := m[k]; ok && v != nil {
		if s, ok := v.(string); ok {
			return s
		}
		return fmt.Sprint(v)
	}
	return ""
}

func gf(m jm, k string) float64 {
	if v, ok := m[k].(float64); ok {
		return v
	}
	return -1
}

func gm(m jm, k string) jm {
	if v, ok := m[k].(map[string]any); ok {
		return v
	}
	return nil
}

func ga(m jm, k string) []any {
	if v, ok := m[k].([]any); ok {
		return v
	}
	return nil
}

type sdoc struct {
	Name     string
	Title    string
	Facts    jm
	Sessions []jm
	Excluded []string // attempts that did not measure the fault (see loadDocs)
}

func loadDocs(raw string) (map[string]*sdoc, error) {
	files, err := filepath.Glob(filepath.Join(raw, "*.summary.json"))
	if err != nil {
		return nil, err
	}
	docs := map[string]*sdoc{}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			return nil, err
		}
		var raw jm
		if err := json.Unmarshal(b, &raw); err != nil {
			return nil, fmt.Errorf("%s: %w", f, err)
		}
		d := &sdoc{Name: gs(raw, "scenario"), Title: gs(raw, "title"), Facts: gm(raw, "facts")}
		for _, s := range ga(raw, "sessions") {
			m, ok := s.(map[string]any)
			if !ok {
				continue
			}
			if inv, _ := gm(gm(m, "extra"), "observed")["invalid_session_ended_before_the_fault"].(bool); inv {
				// a fault case whose session ended before the fault was applied measures nothing: kept in the raw files, counted here
				d.Excluded = append(d.Excluded, gs(m, "case")+" run "+gs(m, "run")+": "+endShort(m))
				continue
			}
			d.Sessions = append(d.Sessions, m)
		}
		docs[d.Name] = d
	}
	return docs, nil
}

var (
	hexRe     = regexp.MustCompile(`[0-9a-f]{16,}`)
	sessRe    = regexp.MustCompile(`kp-[0-9a-f]{20}`)
	podIPRe   = regexp.MustCompile(`10\.244\.\d+\.\d+`)
	elapsedRe = regexp.MustCompile(`elapsed_ms=\d+`)
	pidListRe = regexp.MustCompile(`\[\d{2,6}\]`)
)

// norm replaces what differs from run to run without meaning (ids, pids, elapsed times, byte counts of interactive output) so
// that runs with the same result are one row.
func norm(s string) string {
	s = hexRe.ReplaceAllString(s, "<hex>")
	s = sessRe.ReplaceAllString(s, "<session>")
	s = elapsedRe.ReplaceAllString(s, "elapsed_ms=<n>")
	s = pidListRe.ReplaceAllString(s, "[<pid>]")
	s = podIPRe.ReplaceAllString(s, "<podip>")
	return s
}

func cell(s string) string {
	s = strings.ReplaceAll(s, "|", `\|`)
	s = strings.ReplaceAll(s, "\n", "<br>")
	return s
}

func fnum(v float64) string {
	switch {
	case v < 0:
		return "-"
	case v >= 100:
		return strconv.FormatFloat(v, 'f', 0, 64)
	}
	return strconv.FormatFloat(v, 'f', 1, 64)
}

// stat is "median [min-max]" of the values >= 0.
func stat(vals []float64) string {
	var v []float64
	for _, x := range vals {
		if x >= 0 {
			v = append(v, x)
		}
	}
	if len(v) == 0 {
		return "-"
	}
	mn, mx := percentile(v, 0), percentile(v, 100)
	if len(v) == 1 {
		return fnum(v[0])
	}
	return fmt.Sprintf("%s [%s-%s]", fnum(median(v)), fnum(mn), fnum(mx))
}

type group struct {
	Case string
	Runs []jm
}

// groups collects the sessions of a doc by case, in first-seen order.
func groups(d *sdoc) []*group {
	var out []*group
	idx := map[string]*group{}
	for _, s := range d.Sessions {
		c := gs(s, "case")
		g := idx[c]
		if g == nil {
			g = &group{Case: c}
			idx[c] = g
			out = append(out, g)
		}
		g.Runs = append(g.Runs, s)
	}
	return out
}

// tally renders the distinct values with their counts: "3x A" or "2x A / 1x B".
func tally(vals []string) string {
	count := map[string]int{}
	var order []string
	for _, v := range vals {
		if _, ok := count[v]; !ok {
			order = append(order, v)
		}
		count[v]++
	}
	if len(order) == 1 {
		if count[order[0]] == 1 {
			return order[0]
		}
		return fmt.Sprintf("%dx %s", count[order[0]], order[0])
	}
	var parts []string
	for _, v := range order {
		parts = append(parts, fmt.Sprintf("%dx %s", count[v], v))
	}
	return strings.Join(parts, "<br>")
}

// resultText is the End arm with all its fields, or the refusal.
func resultText(s jm) string {
	if r := gs(s, "refused"); r != "" {
		return "Open refused: " + r
	}
	el := gs(s, "end_line")
	if el == "" {
		return "no Ended frame; stream: " + gs(s, "stream_end")
	}
	// one field per line
	el = strings.Replace(el, " remote_may_survive=", "<br>remote_may_survive=", 1)
	el = strings.Replace(el, " start_observed=", " start_observed=", 1)
	if se := gs(s, "stream_end"); se != "" && !strings.HasPrefix(se, "EOF") {
		el += "<br>stream: " + se
	}
	return el
}

func traceOf(s jm) string {
	ex := gm(s, "extra")
	if ex == nil {
		return ""
	}
	return gs(ex, "trace_text")
}

func tapOf(s jm) string {
	ex := gm(s, "extra")
	if ex == nil {
		return ""
	}
	var parts []string
	for _, t := range ga(ex, "tap") {
		tm, _ := t.(map[string]any)
		if tm == nil {
			continue
		}
		if ds := gf(tm, "dial_status"); ds > 0 {
			parts = append(parts, fmt.Sprintf("upgrade refused: HTTP %.0f %s", ds, gs(tm, "dial_body")))
			continue
		}
		parts = append(parts, gs(tm, "status_view")+" | "+gs(tm, "close_view"))
	}
	return strings.Join(parts, " // ")
}

func observedOf(s jm) string {
	ex := gm(s, "extra")
	if ex == nil {
		return ""
	}
	ob := gm(ex, "observed")
	if ob == nil {
		return ""
	}
	keys := make([]string, 0, len(ob))
	for k := range ob {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		parts = append(parts, k+"="+flat(ob[k]))
	}
	return strings.Join(parts, "<br>")
}

func flat(v any) string {
	switch x := v.(type) {
	case float64:
		return fnum(x)
	case []any:
		if len(x) > 8 {
			var nums []float64
			allNum := true
			for _, e := range x {
				f, ok := e.(float64)
				if !ok {
					allNum = false
					break
				}
				nums = append(nums, f)
			}
			if allNum {
				return fmt.Sprintf("n=%d median=%s max=%s", len(nums), fnum(median(nums)), fnum(percentile(nums, 100)))
			}
		}
		var parts []string
		for _, e := range x {
			parts = append(parts, flat(e))
		}
		return "[" + strings.Join(parts, ", ") + "]"
	case map[string]any:
		b, _ := json.Marshal(x)
		return string(b)
	case string:
		if len(x) > 220 {
			return x[:220] + "..."
		}
		return x
	}
	return fmt.Sprint(v)
}

// observedMerged shows each observed key once when every run agrees, and the per-run values (separated by " ; ") when they differ.
func observedMerged(runs []jm) string {
	keys := map[string]bool{}
	per := make([]jm, 0, len(runs))
	for _, s := range runs {
		ob := gm(gm(s, "extra"), "observed")
		per = append(per, ob)
		for k := range ob {
			keys[k] = true
		}
	}
	names := make([]string, 0, len(keys))
	for k := range keys {
		names = append(names, k)
	}
	sort.Strings(names)
	var parts []string
	for _, k := range names {
		var vals []string
		same := true
		for i, ob := range per {
			v := norm(flat(ob[k]))
			vals = append(vals, v)
			if i > 0 && v != vals[0] {
				same = false
			}
		}
		if same {
			parts = append(parts, k+"="+vals[0])
		} else {
			parts = append(parts, k+"="+strings.Join(vals, " ; "))
		}
	}
	return strings.Join(parts, "<br>")
}

// anomalyText lists the anomalies and the consistency checks that failed, or "none".
func anomalyText(s jm) string {
	var parts []string
	for _, a := range ga(s, "anomalies") {
		parts = append(parts, fmt.Sprint(a))
	}
	var bad []string
	for k, v := range gm(s, "checks") {
		if ok, _ := v.(bool); !ok {
			bad = append(bad, k)
		}
	}
	sort.Strings(bad)
	for _, k := range bad {
		parts = append(parts, "check failed: "+k)
	}
	if len(parts) == 0 {
		return "none"
	}
	return strings.Join(parts, "; ")
}

// genericTable is one row per case: result, raw error of client-go (the plugin's trace), what the tap saw, timings.
func genericTable(b *strings.Builder, d *sdoc, withObserved bool) {
	head := "| case | runs | result: End arm and fields, or the Open refusal | client-go raw error and exit chosen (plugin trace) | tap: status channel / close | Open→Opened, Started, 1st output, Ended (ms, median [min-max]) | frame-order anomalies, failed checks |"
	sep := "|---|---|---|---|---|---|---|"
	if withObserved {
		head += " observed |"
		sep += "---|"
	}
	b.WriteString(head + "\n" + sep + "\n")
	for _, g := range groups(d) {
		var res, tr, tp, an []string
		var op, st, fo, en []float64
		for _, s := range g.Runs {
			res = append(res, norm(resultText(s)))
			if t := traceOf(s); t != "" {
				tr = append(tr, norm(t))
			}
			if t := tapOf(s); t != "" {
				tp = append(tp, norm(t))
			}
			an = append(an, anomalyText(s))
			op = append(op, gf(s, "open_to_opened_ms"))
			st = append(st, gf(s, "started_at_ms"))
			fo = append(fo, gf(s, "first_output_ms"))
			en = append(en, gf(s, "ended_at_ms"))
		}
		row := fmt.Sprintf("| %s | %d | %s | %s | %s | %s, %s, %s, %s | %s |", cell(g.Case), len(g.Runs), cell(tally(res)), cell(tally(tr)), cell(tally(tp)),
			stat(op), stat(st), stat(fo), stat(en), cell(tally(an)))
		if withObserved {
			row += " " + cell(observedMerged(g.Runs)) + " |"
		}
		b.WriteString(row + "\n")
	}
	b.WriteString("\n")
}

func cmdReport(args []string) error {
	fs := flag.NewFlagSet("report", flag.ExitOnError)
	out := fs.String("out", "", "output directory (raw/ inside it)")
	findings := fs.String("findings", "", "text file placed at the top of RESULTS.md (default <out>/work/findings.txt)")
	dest := fs.String("o", "", "destination (default <out>/RESULTS.md)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *out == "" {
		return errors.New("-out is required")
	}
	if *dest == "" {
		*dest = filepath.Join(*out, "RESULTS.md")
	}
	if *findings == "" {
		*findings = filepath.Join(*out, "work", "findings.txt")
	}
	docs, err := loadDocs(filepath.Join(*out, "raw"))
	if err != nil {
		return err
	}
	var b strings.Builder
	b.WriteString("# K-proof: exec v2 on the Kubernetes Pod provider (client-go remotecommand), real plugin binary, kind\n\n")
	if data, err := os.ReadFile(*findings); err == nil {
		b.Write(data)
		b.WriteString("\n\n")
	}
	writeEnvSection(&b, *out)
	for _, def := range registry() {
		names := []string{def.name}
		for _, v := range def.variants {
			if v.suffix != "" {
				names = append(names, def.name+"-"+v.suffix)
			}
		}
		// runs made with -suffix (another plugin binary next to the first): every doc named <scenario>-<something> not listed yet
		var extra []string
		for n := range docs {
			if strings.HasPrefix(n, def.name+"-") && !slices.Contains(names, n) {
				extra = append(extra, n)
			}
		}
		sort.Strings(extra)
		names = append(names, extra...)
		for _, n := range names {
			d := docs[n]
			if d == nil {
				if n == def.name {
					fmt.Fprintf(&b, "## %s: %s\n\nNot run (no raw/%s.summary.json).\n\n", strings.ToUpper(def.id), def.title, n)
				}
				continue
			}
			writeScenario(&b, def, d, docs)
		}
	}
	return os.WriteFile(*dest, []byte(b.String()), 0o644)
}

func writeEnvSection(b *strings.Builder, out string) {
	files, _ := filepath.Glob(filepath.Join(out, "raw", "env-*.json"))
	sort.Strings(files)
	if len(files) == 0 {
		return
	}
	data, err := os.ReadFile(files[0])
	if err != nil {
		return
	}
	var m jm
	if json.Unmarshal(data, &m) != nil {
		return
	}
	b.WriteString("## Environment\n\n| | |\n|---|---|\n")
	for _, k := range []string{"date", "host", "hw_ncpu", "hw_memsize", "docker_info_ncpu_mem", "kind_version", "node_image", "containerd_version",
		"go_mod: github.com/omniviewdev/plugin-sdk", "go_mod: k8s.io/client-go", "go_mod: k8s.io/streaming", "go_mod: github.com/gorilla/websocket", "uptime"} {
		if v, ok := m[k]; ok {
			fmt.Fprintf(b, "| %s | %s |\n", k, cell(flat(v)))
		}
	}
	cv := gs(m, "cluster_version")
	var ver jm
	if json.Unmarshal([]byte(cv), &ver) == nil {
		fmt.Fprintf(b, "| kubectl client / cluster server | %s / %s |\n", gs(gm(ver, "clientVersion"), "gitVersion"), gs(gm(ver, "serverVersion"), "gitVersion"))
	}
	b.WriteString("\nEvery invocation of the tool and the plugin build it ran (a scenario's own `scenario_begin` line in its jsonl repeats the sha256 of the binary it launched):\n\n| env file | date | plugin binary | sha256 (12) | binary mtime | arguments |\n|---|---|---|---|---|---|\n")
	for _, f := range files {
		d, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var e jm
		if json.Unmarshal(d, &e) != nil {
			continue
		}
		sum := gs(e, "plugin_sha256")
		if len(sum) > 12 {
			sum = sum[:12]
		}
		fmt.Fprintf(b, "| %s | %s | %s | %s | %s | %s |\n", filepath.Base(f), gs(e, "date"), filepath.Base(gs(e, "plugin_binary")), sum, gs(e, "plugin_mtime"), cell(flat(e["tool_args"])))
	}
	fmt.Fprintf(b, "\nEvery file name under raw/ starts with the scenario: `<scenario>.jsonl` (every frame sent and received, with ms since the Open call), `<scenario>.summary.json` (what the tables are made of), `<scenario>.trace.jsonl` (the provider's KPROOF_TRACE), `<scenario>.tap.jsonl` (the tap proxy: every WebSocket message, control frame and connection event), `<scenario>*.plugin.log` (the plugin's stderr). Plugin environment of each run is in the `scenario_begin` line of its jsonl.\n\n")
}
