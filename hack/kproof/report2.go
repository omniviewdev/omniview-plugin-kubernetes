package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

var what = map[string]string{
	"s0":  "`Describe` through the SDK client, then `Options` for `three`, `states`, `states2` (3 snapshots, 6 s apart: container states change), `quiet`, `victim`, `tty` through the SDK client and, for the full message, through the raw gRPC stub (protojson in `raw/s0-describe.jsonl`, kind `options`). The kubelet's own state of each container is read with kubectl at the same moment.",
	"s1":  "Open `[\"/bin/sh\"]` tty, 100x30, `quiet/main`, mode exec. Typed `echo hello-k`, `stty size` before any resize, `resize` 120x40 (seq 1), `stty size`, `exit 3`. 3 runs.",
	"s2":  "Open without a terminal (and four tty variants) for each command and container of the list, 3 runs each; the plugin reaches the API server through the tap, so the status channel is observed independently. The `KPROOF_NIL` rows run the exit-0 cases with the provider's other two endings of a nil client-go result.",
	"s3":  "Non-TTY `cat` and `sh -c \"cat \\| wc -c\"`: input `abc\\n`, `close_input`, 10 s of waiting for the end, then `Close{KILL}`, `Close{GRACEFUL}` or a cancelled stream.",
	"s4":  "`sh -c \"yes \\| head -c 67108864\"` (64 MiB) non-TTY and TTY through the plugin, `kubectl exec \\| shasum` and direct client-go (WebSocket v5 and SPDY) on the same pod, a slow consumer (20 ms per frame; 5 s without reading after 8 MiB), and the same flood through the tap.",
	"s5":  "A live session on `victim/main` (TTY `/bin/sh`, and non-TTY `sleep 600`); then (a) the container's PID 1 is killed with SIGKILL from the node, (b) the pod is force-deleted, (c) the pod is deleted normally (grace 1 s), (d) the kubelet is restarted, (e) containerd is restarted. The plugin reaches the API server through the tap.",
	"s6":  "A live TTY session printing a line per second on `quiet/main`; the tap (a) closes every connection with a clean FIN, (b) resets them, (c) keeps them open and forwards nothing (blackhole), and (d) the kube-apiserver static pod is moved away and back.",
	"s7":  "A session running `sleep 600` (non-TTY argv, and typed into a TTY shell) ended by `Close{GRACEFUL}`, `Close{KILL}` or a cancelled stream; 5 s later `kubectl exec` lists the processes of the container.",
	"s8":  "Attach to `tty/main` (`stdin: true, tty: true`, `sh` as PID 1): typed `echo attached`, then `exit` (PID 1 exits and the container restarts). Opened capabilities of exec and attach compared.",
	"s9":  "For `three`, `states`, `states2` (twice) every choice of the `container` option, with `Open [\"true\"]` on it: what Options claimed against what the API server did.",
	"s10": "Refusals: stale reference, wrong reference type, selections and requests the SDK refuses, and an RBAC-limited connection (ServiceAccount `noexec`: get and list on pods only).",
	"s11": "200 resize frames (alternating 80x24 / 132x43) as fast as `Send` allows while a TTY `cat` echoes pings; then `stty size`.",
	"s12": "20 sequential opens on `quiet`: Open() to Opened, Started, first output and Ended.",
}

// endShort is the End arm in a few words.
func endShort(s jm) string {
	if r := gs(s, "refused"); r != "" {
		return "REFUSED " + shortErr(r)
	}
	e := gm(s, "end")
	if e == nil {
		return "(no Ended)"
	}
	switch gs(e, "end") {
	case "exited":
		return fmt.Sprintf("Exited %s/%s", gs(e, "exit_code"), gs(e, "source"))
	case "signaled":
		return fmt.Sprintf("Signaled %s/%s", gs(e, "signal"), gs(e, "source"))
	case "closed":
		return "Closed/" + gs(e, "closed_by")
	case "failed":
		return fmt.Sprintf("Failed %s/%s@%s", gs(e, "failed_class"), gs(e, "failed_reason"), gs(e, "failed_stage"))
	case "lost":
		return "Lost/" + gs(e, "lost_cause")
	}
	return "unset arm"
}

func shortErr(r string) string {
	r = strings.TrimPrefix(r, "exec.Error{")
	if i := strings.Index(r, ", facts="); i > 0 {
		r = r[:i]
	}
	return r
}

func writeScenario(b *strings.Builder, def scenarioDef, d *sdoc, docs map[string]*sdoc) {
	own := strings.HasSuffix(d.Name, "-own")
	fmt.Fprintf(b, "## %s: %s\n\n", strings.ToUpper(def.id)+map[bool]string{true: " (own executor)", false: ""}[own], strings.TrimSuffix(d.Title, " [own]"))
	if !own {
		if w := what[def.id]; w != "" {
			b.WriteString(w + "\n\n")
		}
	} else {
		b.WriteString("Same scenario with `KPROOF_EXECUTOR=own`: the provider's spike executor speaks WebSocket v5 itself and reads the status channel.\n\n")
	}
	if len(d.Excluded) > 0 {
		fmt.Fprintf(b, "%d attempt(s) are left out of the tables because the session ended before the fault was applied (the exec path was not ready yet after the previous fault; the case was repeated): %s. They stay in the raw files (`invalid_session_ended_before_the_fault`).\n\n", len(d.Excluded), strings.Join(d.Excluded, "; "))
	}
	switch def.id {
	case "s0":
		writeS0(b, d)
	case "s1", "s3", "s8", "s10", "s11":
		genericTable(b, d, true)
		if def.id == "s8" {
			writeFactsList(b, d, "opened_capabilities_diff_exec_vs_attach", "Opened.capabilities that differ between exec and attach on the same pod")
		}
		if def.id == "s1" && len(d.Sessions) > 0 {
			s := d.Sessions[0]
			fmt.Fprintf(b, "Frames of run 1 (all runs have the same shape): `Opened.facts` = `%s`\n\n`Started.facts` = `%s` (arrived %s ms after Open(), %s ms before the first output)\n\n", gs(s, "opened_facts"), gs(s, "started_facts"),
				fnum(gf(s, "started_at_ms")), fnum(gf(s, "first_output_ms")-gf(s, "started_at_ms")))
		}
	case "s2":
		genericTable(b, d, false)
		if !own {
			if o := docs[def.name+"-own"]; o != nil {
				sideBySide(b, d, o, "client-go (default executor)", "own executor", false)
			}
		}
	case "s4":
		writeS4(b, d)
	case "s5", "s6":
		if own {
			genericTable(b, d, true)
		} else {
			genericTable(b, d, true)
			if o := docs[def.name+"-own"]; o != nil {
				sideBySide(b, d, o, "client-go (default executor)", "own executor", true)
			}
		}
	case "s7":
		writeS7(b, d)
	case "s9":
		writeS9(b, d)
	case "s12":
		writeS12(b, d)
	default:
		genericTable(b, d, true)
	}
}

func writeFactsList(b *strings.Builder, d *sdoc, key, title string) {
	if v, ok := d.Facts[key].([]any); ok {
		fmt.Fprintf(b, "**%s:**\n\n", title)
		for _, x := range v {
			fmt.Fprintf(b, "- `%v`\n", x)
		}
		b.WriteString("\n")
	}
}

// sideBySide puts the two executors' results of each case next to each other, with the tap's reading of the status channel.
func sideBySide(b *strings.Builder, a, o *sdoc, an, on string, timing bool) {
	fmt.Fprintf(b, "### %s versus %s, case by case\n\n", an, on)
	head := fmt.Sprintf("| case | %s: End | %s: End | tap status channel (%s run) | tap status channel (%s run) |", an, on, an, on)
	sep := "|---|---|---|---|---|"
	if timing {
		head += " End after fault start, ms (client-go / own) |"
		sep += "---|"
	}
	b.WriteString(head + "\n" + sep + "\n")
	og := map[string]*group{}
	for _, g := range groups(o) {
		og[g.Case] = g
	}
	for _, g := range groups(a) {
		var ar, or, at, ot []string
		var atm, otm []float64
		for _, s := range g.Runs {
			ar = append(ar, norm(endShort(s)))
			at = append(at, norm(tapShort(s)))
			atm = append(atm, afterFault(s))
		}
		if h := og[g.Case]; h != nil {
			for _, s := range h.Runs {
				or = append(or, norm(endShort(s)))
				ot = append(ot, norm(tapShort(s)))
				otm = append(otm, afterFault(s))
			}
		}
		row := fmt.Sprintf("| %s | %s | %s | %s | %s |", cell(g.Case), cell(tally(ar)), cell(tally(or)), cell(tally(at)), cell(tally(ot)))
		if timing {
			row += fmt.Sprintf(" %s / %s |", stat(atm), stat(otm))
		}
		b.WriteString(row + "\n")
	}
	b.WriteString("\n")
}

func afterFault(s jm) float64 {
	ex := gm(s, "extra")
	if ex == nil {
		return -1
	}
	ob := gm(ex, "observed")
	if ob == nil {
		return -1
	}
	return gf(ob, "end_after_fault_start_ms")
}

func tapShort(s jm) string {
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
			parts = append(parts, fmt.Sprintf("upgrade refused HTTP %.0f", ds))
			continue
		}
		st := gs(tm, "status_view")
		if len(st) > 90 {
			st = st[:90] + "..."
		}
		parts = append(parts, st+" | "+gs(tm, "close_view"))
	}
	return strings.Join(parts, " // ")
}

func writeS0(b *strings.Builder, d *sdoc) {
	if e := gs(d.Facts, "describe_error"); e != "" {
		fmt.Fprintf(b, "Describe failed: `%s`\n\n", e)
	}
	if js := gs(d.Facts, "describe_json"); js != "" {
		var m jm
		if json.Unmarshal([]byte(js), &m) == nil {
			fmt.Fprintf(b, "Describe: `contract_version` %v, `features` %v, %d target(s).\n\n", m["contract_version"], m["features"], len(ga(m, "targets")))
			for _, t := range ga(m, "targets") {
				tm, _ := t.(map[string]any)
				fmt.Fprintf(b, "Target `%s` / `%s` (display `%s`, default argv %v)\n\n", gs(tm, "provider"), gs(tm, "type"), gs(tm, "display_name"), tm["default_argv"])
				b.WriteString("| capability (upper bound of the kind) | value |\n|---|---|\n")
				caps := gm(tm, "capabilities")
				keys := make([]string, 0, len(caps))
				for k := range caps {
					keys = append(keys, k)
				}
				sort.Strings(keys)
				for _, k := range keys {
					fmt.Fprintf(b, "| %s | %s |\n", k, cell(flat(caps[k])))
				}
				b.WriteString("\n")
				if s := gm(tm, "session"); s != nil {
					fmt.Fprintf(b, "Session limits: `%s`; run limits: `%s`\n\n", flat(s), flat(tm["run"]))
				}
			}
			pretty, _ := json.MarshalIndent(m, "", "  ")
			fmt.Fprintf(b, "<details><summary>Describe, full protojson</summary>\n\n```json\n%s\n```\n</details>\n\n", pretty)
		}
	}
	snaps, _ := d.Facts["options_snapshots"].([]any)
	if len(snaps) > 0 {
		b.WriteString("Options, container option (as the SDK client returns it) next to the kubelet's own state at that moment. \"claimed exec-able\" is `state == READY`; S9 measures what really runs.\n\n")
		b.WriteString("| pod | snapshot | container | kind | state | detail | default | kubelet state | claimed exec-able |\n|---|---|---|---|---|---|---|---|---|\n")
		for _, s := range snaps {
			sm, _ := s.(map[string]any)
			if e := gs(sm, "error"); e != "" {
				fmt.Fprintf(b, "| %s | %s | Options failed: %s | | | | | | |\n", gs(sm, "pod"), gs(sm, "snapshot"), cell(e))
				continue
			}
			actual := gm(sm, "kubelet_states")
			for _, r := range ga(sm, "choices") {
				rm, _ := r.(map[string]any)
				fmt.Fprintf(b, "| %s | %s | %s | %s | %s | %s | %v | %s | %v |\n", gs(sm, "pod"), gs(sm, "snapshot"), gs(rm, "container"), gs(rm, "kind"), gs(rm, "state"),
					gs(rm, "detail"), rm["default"], cell(gs(actual, gs(rm, "container"))), rm["claimed_exec_able"])
			}
		}
		b.WriteString("\nThe `mode` option of every pod (same each time):\n\n| choice | state | default | capabilities of that mode |\n|---|---|---|---|\n")
		seen := map[string]bool{}
		for _, s := range snaps {
			sm, _ := s.(map[string]any)
			for _, r := range ga(sm, "modes") {
				rm, _ := r.(map[string]any)
				key := gs(rm, "choice")
				if seen[key] {
					continue
				}
				seen[key] = true
				fmt.Fprintf(b, "| %s | %s | %v | `%s` |\n", key, gs(rm, "state"), rm["default"], cell(gs(rm, "capabilities")))
			}
		}
		b.WriteString("\n")
	}
}

func writeS7(b *strings.Builder, d *sdoc) {
	b.WriteString("| session | ended by | End the host saw | `sleep 600` pids before / 5 s after | remote process survives? | tap: how the API-server leg ended | client-go raw error |\n|---|---|---|---|---|---|---|\n")
	for _, g := range groups(d) {
		var res, surv, taps, trs, pids []string
		for _, s := range g.Runs {
			ob := gm(gm(s, "extra"), "observed")
			res = append(res, norm(endShort(s)+" ("+gs(s, "stream_end")+")"))
			surv = append(surv, gs(ob, "remote_process_survives"))
			pids = append(pids, fmt.Sprintf("%v / %v", ob["sleep600_pids_before_end"], ob["sleep600_pids_5s_after_end"]))
			taps = append(taps, norm(tapShort(s)))
			trs = append(trs, norm(traceOf(s)))
		}
		parts := strings.SplitN(g.Case, "/", 2)
		end := ""
		if len(parts) == 2 {
			end = parts[1]
		}
		fmt.Fprintf(b, "| %s | %s | %s | %s | %s | %s | %s |\n", cell(parts[0]), cell(end), cell(tally(res)), cell(tally(pids)), cell(tally(surv)), cell(tally(taps)), cell(tally(trs)))
	}
	b.WriteString("\nThe `ps` listing before and after is in `raw/s7-kill-behaviour.summary.json` (`ps_before_end`, `ps_5s_after_end`).\n\n")
}

func writeS9(b *strings.Builder, d *sdoc) {
	rows, _ := d.Facts["picker"].([]any)
	b.WriteString("| pod | pass | container | kind | Options state | detail | default | kubelet state | claimed exec-able | Open [\"true\"] outcome | tap: what the API server answered | measured exec-able |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n")
	for _, r := range rows {
		m, _ := r.(map[string]any)
		fmt.Fprintf(b, "| %s | %s | %s | %s | %s | %s | %v | %s | %v | %s | %s | %s |\n", gs(m, "pod"), gs(m, "pass"), gs(m, "container"), gs(m, "kind"), gs(m, "state"), gs(m, "detail"),
			m["default"], cell(gs(m, "kubelet_state")), m["claimed_exec_able"], cell(norm(gs(m, "open_outcome"))), cell(norm(gs(m, "tap_status_channel"))), cell(gs(m, "measured_exec_able")))
	}
	b.WriteString("\n")
}

func writeS12(b *strings.Builder, d *sdoc) {
	lat, _ := d.Facts["open_latency"].(map[string]any)
	names := make([]string, 0, len(lat))
	for k := range lat {
		names = append(names, k)
	}
	sort.Strings(names)
	b.WriteString("| series | measure | n | median ms | p95 ms | min | max |\n|---|---|---|---|---|---|---|\n")
	for _, n := range names {
		sm, _ := lat[n].(map[string]any)
		for _, m := range []string{"open_to_opened", "open_to_started", "open_to_first_output", "open_to_ended"} {
			r := gm(sm, m)
			fmt.Fprintf(b, "| %s | %s | %.0f | %s | %s | %s | %s |\n", cell(n), m, gf(r, "n"), fnum(gf(r, "median_ms")), fnum(gf(r, "p95_ms")), fnum(gf(r, "min_ms")), fnum(gf(r, "max_ms")))
		}
	}
	b.WriteString("\n")
}

func writeS4(b *strings.Builder, d *sdoc) {
	fmt.Fprintf(b, "Expected: non-TTY `%v` bytes of `y\\n` (sha256 `%v`); TTY `%v` bytes of `y\\r\\n` (sha256 `%v`).\n\n", d.Facts["expected_bytes_nontty"], d.Facts["expected_sha256_nontty"], d.Facts["expected_bytes_tty"], d.Facts["expected_sha256_tty"])
	b.WriteString("Through the plugin (`Opened`→`Ended` is the lead's definition of the rate; first→last output is the stream's own rate):\n\n")
	b.WriteString("| case | run | received / expected bytes | sha256 matches | pattern errors | Dropped ranges / bytes | Opened→Ended ms | MB/s (Opened→Ended) | MB/s (first→last output) | output frames | End (all fields) | consistency checks |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n")
	byCase := map[string][]float64{}
	var order []string
	for _, s := range d.Sessions {
		f := gm(gm(s, "extra"), "flood")
		if f == nil {
			fmt.Fprintf(b, "| %s | %v | %s | | | | | | | | | |\n", cell(gs(s, "case")), s["run"], cell(resultText(s)))
			continue
		}
		var bad []string
		for k, v := range gm(s, "checks") {
			if ok, _ := v.(bool); !ok {
				bad = append(bad, k)
			}
		}
		sort.Strings(bad)
		chk := "all hold"
		if len(bad) > 0 {
			chk = "FAIL: " + strings.Join(bad, "; ")
		}
		if an := ga(s, "anomalies"); len(an) > 0 {
			chk += "; anomalies: " + flat(an)
		}
		fmt.Fprintf(b, "| %s | %v | %s / %s | %v | %s | %s / %s | %s | %s | %s | %s | %s | %s |\n", cell(gs(s, "case")), s["run"], flat(f["received_bytes"]), flat(f["expected_bytes"]), f["sha256_match"], flat(f["pattern_errors"]),
			flat(f["dropped_ranges"]), flat(f["dropped_bytes"]), fnum(gf(f, "opened_to_ended_ms")), fnum(gf(f, "mb_per_s_opened_to_ended")), fnum(gf(f, "mb_per_s_first_to_last_output")),
			flat(f["output_frames"]), cell(resultText(s)), cell(chk))
		c := gs(s, "case")
		if _, ok := byCase[c]; !ok {
			order = append(order, c)
		}
		byCase[c] = append(byCase[c], gf(f, "mb_per_s_opened_to_ended"))
	}
	b.WriteString("\nMedian MB/s (Opened→Ended) per case:\n\n| case | runs | MB/s median [min-max] |\n|---|---|---|\n")
	for _, c := range order {
		fmt.Fprintf(b, "| %s | %d | %s |\n", cell(c), len(byCase[c]), stat(byCase[c]))
	}
	b.WriteString("\nBaselines on the same pod and command, without the plugin:\n\n| tool | tty | bytes | wall ms | MB/s | sha256 matches | error | load at start |\n|---|---|---|---|---|---|---|---|\n")
	base, _ := d.Facts["baselines"].([]any)
	byTool := map[string][]float64{}
	var tools []string
	for _, r := range base {
		m, _ := r.(map[string]any)
		fmt.Fprintf(b, "| %s | %v | %s | %s | %s | %v | %s | %s |\n", gs(m, "tool"), m["tty"], flat(m["bytes"]), fnum(gf(m, "wall_ms")), fnum(gf(m, "mb_per_s")), m["sha256_matches_expected"], cell(gs(m, "stream_error")), cell(gs(m, "uptime")))
		k := fmt.Sprintf("%s tty=%v", gs(m, "tool"), m["tty"])
		if _, ok := byTool[k]; !ok {
			tools = append(tools, k)
		}
		byTool[k] = append(byTool[k], gf(m, "mb_per_s"))
	}
	b.WriteString("\nMedian MB/s per baseline:\n\n| tool | MB/s median [min-max] |\n|---|---|\n")
	for _, k := range tools {
		fmt.Fprintf(b, "| %s | %s |\n", k, stat(byTool[k]))
	}
	// Dropped ranges of the slow-consumer runs
	b.WriteString("\nDropped ranges seen by the slow consumers (first 4 of each run; all in the jsonl):\n\n| case | run | ranges | first ranges (stream, from_offset, bytes, reason) |\n|---|---|---|---|\n")
	for _, s := range d.Sessions {
		if !strings.Contains(gs(s, "case"), "slow") && !strings.Contains(gs(s, "case"), "stall") {
			continue
		}
		var parts []string
		for i, r := range ga(s, "drops") {
			if i >= 4 {
				break
			}
			m, _ := r.(map[string]any)
			parts = append(parts, fmt.Sprintf("%s, %s, %s, %s", gs(m, "stream"), strconv.FormatFloat(gf(m, "from_offset"), 'f', 0, 64), strconv.FormatFloat(gf(m, "bytes"), 'f', 0, 64), gs(m, "reason")))
		}
		fmt.Fprintf(b, "| %s | %v | %v | %s |\n", cell(gs(s, "case")), s["run"], s["drop_ranges"], cell(strings.Join(parts, "<br>")))
	}
	b.WriteString("\n")
}
