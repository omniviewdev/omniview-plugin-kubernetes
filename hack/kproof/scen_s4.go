package main

import (
	"time"
)

// patternChecker counts the bytes of a chunk that differ from an endless repetition of pat, given the chunk's offset in
// the stream (a Dropped range leaves the offsets of the later bytes untouched, so the check holds across drops).
func patternChecker(pat string) func(stream string, off uint64, data []byte) int {
	p := []byte(pat)
	n := uint64(len(p))
	return func(stream string, off uint64, data []byte) int {
		bad := 0
		for i, b := range data {
			if b != p[(off+uint64(i))%n] {
				bad++
			}
		}
		return bad
	}
}

func matchValue(skipped, match bool) any {
	if skipped {
		return "not computed"
	}
	return match
}

func patternValue(skipped bool, errs int) any {
	if skipped {
		return "not computed"
	}
	return errs
}

// flood runs the 64 MiB command in one session and records what arrived against what the command wrote.
func (e *scenarioEnv) flood(rg *rig, caseName string, run int, tty bool, opts recvOpts, endWait time.Duration) summary {
	return e.floodRing(rg, caseName, run, tty, opts, endWait, 0)
}

// floodRing is flood with Start.replay_bytes set (0: the target's default, 1 MiB).
func (e *scenarioEnv) floodRing(rg *rig, caseName string, run int, tty bool, opts recvOpts, endWait time.Duration, replay uint32) summary {
	pat, stream, expectedBytes := "y\n", "STDOUT", int64(floodBytes)
	if tty {
		pat, stream, expectedBytes = "y\r\n", "TTY", floodBytes/2*3
	}
	if tty && opts.OutputSample == 0 {
		opts.OutputSample = 200 // a TTY flood is ~230,000 frames of ~440 bytes: write the first 64 and every 200th
	}
	if !opts.SkipVerify {
		opts.Hash = true
		opts.Pattern = patternChecker(pat)
	}
	before := e.kube.uptime()
	return e.runCaseEx(rg, caseName, run, spec{Pod: "quiet", Container: "main", Mode: "exec", Argv: []string{"sh", "-c", floodScript}, TTY: tty, Cols: 100, Rows: 30, ReplayBytes: replay},
		opts, endWait, nil, func(ss *session, sm *summary) {
			received := int64(sm.OutBytes[stream])
			var other uint64
			for k, v := range sm.OutBytes {
				if k != stream {
					other += v
				}
			}
			// Opened -> Ended, as the lead asked; and first output -> last output, the stream's own rate
			opened := sm.OpenToOpenedMs
			wall := sm.EndedAtMs - opened
			if sm.EndedAtMs < 0 {
				wall = sm.StreamEndMs - opened
			}
			streamMs := sm.LastOutputMs - sm.FirstOutputMs
			f := map[string]any{
				"uptime_before": before, "uptime_after": e.kube.uptime(),
				"expected_bytes": expectedBytes, "received_bytes": received, "received_on_other_streams": other,
				"dropped_bytes": sm.DroppedBytes, "dropped_ranges": sm.DropRanges, "output_frames": sm.OutFrames[stream],
				"opened_to_ended_ms": wall, "first_to_last_output_ms": streamMs,
				"sha256_received": sm.SHA256[stream], "sha256_expected": expectedFloodSHA(tty),
				"sha256_match": matchValue(opts.SkipVerify, sm.SHA256[stream] == expectedFloodSHA(tty)), "bytes_match": received == expectedBytes,
				"pattern_errors": patternValue(opts.SkipVerify, sm.PatternErrors),
			}
			if wall > 0 {
				f["mb_per_s_opened_to_ended"] = float64(received) / (wall / 1000) / 1e6
				f["mib_per_s_opened_to_ended"] = float64(received) / (wall / 1000) / (1 << 20)
			}
			if streamMs > 0 {
				f["mb_per_s_first_to_last_output"] = float64(received) / (streamMs / 1000) / 1e6
			}
			sm.Extra["flood"] = f
		})
}

func s4(e *scenarioEnv) error {
	runs := e.f.runs
	const endWait = 5 * time.Minute
	e.fact("expected_sha256_nontty", expectedFloodSHA(false))
	e.fact("expected_sha256_tty", expectedFloodSHA(true))
	e.fact("expected_bytes_nontty", floodBytes)
	e.fact("expected_bytes_tty", floodBytes/2*3)

	// 1. the plugin, direct, non-TTY then TTY
	for _, tty := range []bool{false, true} {
		name := "flood-nontty"
		if tty {
			name = "flood-tty"
		}
		for run := 1; run <= runs; run++ {
			if e.ctx.Err() != nil {
				return e.ctx.Err()
			}
			e.flood(e.rg, name, run, tty, recvOpts{}, endWait)
		}
	}

	// 1b. the same without hashing and pattern-checking: the rate without the cost of the verification
	for _, tty := range []bool{false, true} {
		name := "flood-nontty-no-verify"
		if tty {
			name = "flood-tty-no-verify"
		}
		for run := 1; run <= runs; run++ {
			if e.ctx.Err() != nil {
				return e.ctx.Err()
			}
			e.flood(e.rg, name, run, tty, recvOpts{SkipVerify: true, OutputSample: 1000}, endWait)
		}
	}
	// 2. baselines on the same cluster without the plugin
	var base []baseRes
	for _, tty := range []bool{false, true} {
		for run := 1; run <= runs; run++ {
			for _, proto := range []string{"ws", "spdy"} {
				if e.ctx.Err() != nil {
					return e.ctx.Err()
				}
				r := clientGoRun(e.ctx, e.f.kubeconfig, "quiet", "main", tty, proto)
				base = append(base, r)
				e.rec.note("baseline-"+r.Tool, run, "baseline", map[string]any{"result": r})
			}
			if !tty {
				r := kubectlRun(e.ctx, e.f.kubeconfig, "quiet", "main", tty)
				base = append(base, r)
				e.rec.note("baseline-kubectl", run, "baseline", map[string]any{"result": r})
			}
		}
	}
	e.fact("baselines", base)

	// 3. a slow consumer: 20 ms per frame, and a reader that stops for 5 s mid-flood
	slowRuns := runs
	for run := 1; run <= slowRuns; run++ {
		e.flood(e.rg, "flood-nontty-slow-20ms-per-frame", run, false, recvOpts{FrameDelay: 20 * time.Millisecond}, endWait)
	}
	for run := 1; run <= slowRuns; run++ {
		e.flood(e.rg, "flood-nontty-stall-5s-after-8MiB", run, false, recvOpts{PauseAfter: 8 << 20, PauseFor: 5 * time.Second}, endWait)
	}
	for run := 1; run <= 2; run++ {
		e.flood(e.rg, "flood-tty-slow-20ms-per-frame", run, true, recvOpts{FrameDelay: 20 * time.Millisecond}, endWait)
	}
	// the ring a host may ask for: Start.replay_bytes = 4 MiB (the target's maximum); the default is 1 MiB
	for run := 1; run <= runs; run++ {
		e.floodRing(e.rg, "flood-nontty-replay-4MiB", run, false, recvOpts{}, endWait, 4<<20)
	}
	for run := 1; run <= runs; run++ {
		e.floodRing(e.rg, "flood-nontty-slow-20ms-per-frame-replay-4MiB", run, false, recvOpts{FrameDelay: 20 * time.Millisecond}, endWait, 4<<20)
	}

	// 4. through the tap (full logging, then sampled logging): the tap's overhead
	rgTap, err := e.launchViaTap("tap")
	if err != nil {
		e.rec.note("", 0, "tap_variant_launch_failed", map[string]any{"error": err.Error()})
		return nil
	}
	for run := 1; run <= runs; run++ {
		e.flood(rgTap, "flood-nontty-via-tap-full-log", run, false, recvOpts{}, endWait)
	}
	e.tap.sampleData.Store(true)
	for run := 1; run <= runs; run++ {
		e.flood(rgTap, "flood-nontty-via-tap-sampled-log", run, false, recvOpts{}, endWait)
	}
	for run := 1; run <= runs; run++ {
		// a TTY flood is 245,000 messages: the tap logs the first 8 and every 64th of the data messages
		e.flood(rgTap, "flood-tty-via-tap-sampled-log", run, true, recvOpts{}, endWait)
	}
	e.tap.sampleData.Store(false)
	return nil
}
