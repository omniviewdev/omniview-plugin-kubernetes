# SDK3-k8s proof, HEAD2 leg

Asked by the step lead: HEAD2 = a snapshot of the plugin tree (no .git) at `/tmp/sdk3-head-snapshot`, with (1) a relative window `sinceSeconds=N` of an ASKING opening resolved once to an absolute `sinceTime` (floored to the second) used by the count and the stream, and (2) with `limitBytes=L` the count asking the kubelet for L+32 KiB and applying L itself, counting the record the limit cuts only if it is whole in the log.

## Environment

| | |
|---|---|
| cluster | NEW `sdk3k8s-proof` from `./setup.sh` (kind v0.30.0, `kindest/node:v1.35.0`, kubelet `containerLogMaxSize 100Mi`), same workloads; DELETED at the end of this leg |
| HEAD2 | `bin/head2-plugin`, sha256 `5f6eacf1521e161a4b47198fd7671e3e271502c4bcfe133bce328ceed9f31c71`, built (`go build ./pkg`, go1.27.4, `GOWORK=off GOTOOLCHAIN=local`) from an rsync copy of the snapshot without `.git` and `ui`; the copy's `pkg/`, `go.mod`, `go.sum` have the same sha256 as the snapshot's; SDK v0.22.0 |
| BASE | `bin/base-plugin` (8af576f, SDK v0.20.0), sha256 `04b9895e...`, re-run on this cluster for the no-ask diff |
| OLD HEAD | `bin/head-plugin` (9ceb911, the build of the first HEAD leg), sha256 `1bb30fe7...`, used only as the old side of the dense case |
| load | shared machine, load average 44 / 36 / 27 during the log proof (18:22), about 10 to 20 during the dense runs |

## 1. Log proof of HEAD2 (`run-head2.sh`: head2 ask and no-ask on the 23 cases, base no-ask on the 13 deterministic ones, at the same time)

Every asking session of HEAD2: reply `ReplayMarkers=true`, exactly one caught-up event per source that opened, flagged lines equal to `kubectl logs` of the same container (before/after windows), no flagged line after the event and no unflagged line before it. Every no-ask session: nothing flagged, no event. Full per-source table (both modes): `raw/logproof2/head2-table.md`; the asking rows:

| case | mode | source | lines delivered | flagged | caught-up events | flagged after the event | kubectl window before/after (lines) | verdict |
|---|---|---|---|---|---|---|---|---|
| rate5-t1000 | ask | rate5/rate5 | 1012 | 1000 | 1 | 0 | 1000 / 1000 | ok |
| twoc-t1000 | ask | twoc/a | 1013 | 1000 | 1 | 0 | 1000 / 1000 | ok |
| twoc-t1000 | ask | twoc/b | 598 | 596 | 1 | 0 | 595 / 598 | ok |
| quiet-t1000 | ask | quiet/quiet | 0 | 0 | 1 | 0 | 0 / 0 | ok |
| quiet3-t1000 | ask | quiet3/quiet3 | 3 | 3 | 1 | 0 | 3 / 3 | ok |
| quiet3-t0 | ask | quiet3/quiet3 | 3 | 3 | 1 | 0 | 3 / 3 | ok |
| quiet3-t5000 | ask | quiet3/quiet3 | 3 | 3 | 1 | 0 | 3 / 3 | ok |
| quiet3-finite | ask | quiet3/ | 3 | 3 | 1 | 0 | - | source not in kubectl's list of the pod(s) |
| initc-t1000 | ask | initc/init | 50 | 50 | 1 | 0 | 50 / 50 | ok |
| initc-t1000 | ask | initc/main | 653 | 640 | 1 | 0 | 640 / 654 | ok |
| crash-previous | ask | crash/crash | 1 | 1 | 1 | 0 | 1 / 1 | ok |
| fixed6k-t1000 | ask | fixed6k/fixed6k | 1000 | 1000 | 1 | 0 | 1000 / 1000 | ok |
| fixed6k-t0 | ask | fixed6k/fixed6k | 6000 | 6000 | 1 | 0 | 6000 / 6000 | ok |
| fixed6k-t5000 | ask | fixed6k/fixed6k | 5000 | 5000 | 1 | 0 | 5000 / 5000 | ok |
| fixed6k-finite | ask | fixed6k/ | 1000 | 1000 | 1 | 0 | - | source not in kubectl's list of the pod(s) |
| done-t1000 | ask | done/done | 50 | 50 | 1 | 0 | 50 / 50 | ok |
| done-t0 | ask | done/done | 50 | 50 | 1 | 0 | 50 / 50 | ok |
| done-finite | ask | done/ | 50 | 50 | 1 | 0 | - | source not in kubectl's list of the pod(s) |
| partial-t1000 | ask | partial/partial | 10 | 10 | 1 | 0 | 10 / 10 | ok |
| rate5-limit64k | ask | rate5/rate5 | 497 | 497 | 1 | 0 | 497 / 497 | ok |
| bigtail-limit1m | ask | bigtail/bigtail | 105 | 105 | 1 | 0 | 105 / 105 | ok |
| rate5-since30 | ask | rate5/rate5 | 162 | 150 | 1 | 0 | 149 / 149 | ok |
| rate5-since30-t50 | ask | rate5/rate5 | 62 | 50 | 1 | 0 | 50 / 50 | ok |
| rate5-limit4000 | ask | rate5/rate5 | 31 | 31 | 1 | 0 | 31 / 31 | ok |
| web-t1000 | ask | web-8c455f76f-jmcv8/app | 1012 | 1000 | 1 | 0 | 1000 / 1000 | ok |
| web-t1000 | ask | web-8c455f76f-jmcv8/side | 200 | 200 | 1 | 0 | 200 / 200 | ok |
| web-t1000 | ask | web-8c455f76f-pww44/app | 1012 | 1000 | 1 | 0 | 1000 / 1000 | ok |
| web-t1000 | ask | web-8c455f76f-pww44/side | 200 | 200 | 1 | 0 | 200 / 200 | ok |

Notes on rows:
- `rate5-since30`: flagged 150 against kubectl's 149/149: the window of an asking opening is floored to the second, so it is up to 1 s longer than asked (up to 5 lines at 5 lines/s here, about 490 on the dense pod below); delivered 162 = 150 replay + 12 live lines in the 2.5 s the session stayed open. `rate5-since30-t50`: tail 50 within the 30 s window: 50.
- Byte limits (`rate5-limit4000`, `rate5-limit64k`, `bigtail-limit1m`): the stream ends at the limit, the last line is the fragment the limit cuts (the record is whole in the log, so HEAD2 counts it): flagged = delivered = kubectl's lines (31, 497, 105), one event, nothing after it.
- `*-finite` (follow=false): the SDK names the source `pod/` (the finite canonical read leaves the container to the API server), so the tool cannot pair it with a kubectl window ("source not in kubectl's list"); lines = flagged = kubectl's tail (3, 1000, 50), one event at the end of the stream.
- `crash-previous` on the `crash` pod: the kubelet answered `unable to retrieve container logs for containerd://...` (115 bytes, no line feed; the loop's previous instance had been garbage collected, as `kubectl logs --previous` also says): 1 line delivered, 1 flagged, 1 event (HEAD2 counts the last record of a previous instance, which ends where its stream ends). A previous instance that still has its log, `crash2-previous` (`crash2.yaml`: 40 lines, lives 20 s; run while its second instance was up; `raw/logproof2/head2-crash2-table.md`): 40 delivered, 40 flagged, 1 event, kubectl 40/40. `crash-t1000` (the current instance): 40/40 (`raw/logproof2/head2-crash-table.md`).

## 2. Frame comparisons (`compare2.sh`, `bin/logdiff`; the session id is the only thing normalised; raw rows in `raw/logproof2/compare2.txt`)

| comparison | cases | identical | not identical |
|---|---|---|---|
| no-ask, the 13 deterministic cases, in order, create reply included: base vs head2 | 13 | 13 | - |
| head2: ask vs no-ask, the 13 deterministic cases, in order, replay markers stripped (caught-up events dropped, replay flag and wire hash ignored) | 13 | 13 | - |
| head2: ask vs no-ask, the three byte-limited sessions on the moving window: overlapping lines, markers stripped, the last line (the fragment the limit cuts, at an offset  | 3 | 3 | - |
| head2: ask vs no-ask, live pods, overlapping lines (matched by number), replay markers stripped | 6 | 6 | - |

- **No-ask, 13 deterministic cases, base vs head2: 13 of 13 identical** (create reply, kubelet timestamps, labels, content SHA-256, and a SHA-256 of each frame's protobuf bytes with the session id emptied).
- **head2 ask vs head2 no-ask, markers stripped (caught-up events dropped, replay flag and wire hash ignored): 13 of 13 identical in order**, and identical on the overlapping lines of the live pods (6 of 6). The three byte-limited sessions run on a window that moves between the two sessions, so the cut fragment (the last line) differs; with that last line dropped (`-drop-cut`) the overlapping lines are identical (14, 481 and 101 lines compared). The earlier table 'not identical' rows for these three were the fragment (`logdiff` keyed it by the garbled number the cut left in it; it now reads the number only when it has all six digits).

## 3. The dense case: a pod writing about 490 lines/s, since_seconds=10, no tail, asking

Pod `dense` (`dense.yaml`: a 2000-line burst, then 6 lines every ~12 ms; measured 480 to 504 lines/s per second). The session is created on OLD HEAD (9ceb911) and on HEAD2 in turn (head, head2, head2, head, ...), 8 per build, `bin/dense`. For each session: F = lines flagged replay; R = lines delivered before the first line whose kubelet stamp is later than the session's create time (harness clock plus the skew below); FL = flagged lines stamped after the create time (F-R); FC = flagged lines stamped after the plugin's count had finished (the plugin's debug line `native log replay counted`), lines the count cannot have seen.

Node clock: `docker exec <node> date` bracketed by the host clock says the node is 20.0 ms ahead (best round trip 55 ms: good to about 27 ms; the first run measured 25.4 ms). The fastest live line of all sessions reached the harness 1.1 ms after its stamp (delay minus skew), so the real skew is a few milliseconds at most; R, FL and FC use +20.0 ms. A millisecond of skew moves F-R and FL by about 0.5 line on both builds alike; FC of HEAD2 stays 0 for any skew of -1.4 ms or more (the tightest session), and that of the old build only grows if the skew is smaller.

| leg | n | F-R median (min..max) | FL median (min..max) | F median | R median | plugin count ms median (min..max) | FC median (min..max) | last flagged ms after create, median | flagged after an unflagged line |
|---|---|---|---|---|---|---|---|---|---|
| head | 8 | 63 (30..96) | 63 (30..96) | 5142 | 5103 | 68 (42..103) | 24 (6..42) | 107.1 | 0 |
| head2 | 8 | 30 (18..48) | 30 (18..48) | 5616 | 5595 | 72 (56..107) | 0 (0..0) | 48.8 | 0 |


Per session (second run, the one above; the pod was 57 to 97 s old):

| leg | iteration | F flagged | R lines before the first line later than the create time | F-R | FL flagged lines later than the create time | last flagged, ms after create | first unflagged, ms after create | caught-up events | plugin's count (lines, ms; ends ms after create) | FC flagged lines stamped after the count finished | min arrival-stamp ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| head | 1 | 5142 | 5112 | 30 | 30 | 51.5 | 62.9 | 1 | 5142, 42 ms, ends 46.7 | 6 | 1.3 |
| head2 | 1 | 5622 | 5604 | 18 | 18 | 26.6 | 37.5 | 1 | 5622, 56 ms, ends 58.3 | 0 | 1.4 |
| head2 | 2 | 5640 | 5610 | 30 | 30 | 48.6 | 59.5 | 1 | 5640, 71 ms, ends 72.8 | 0 | 1.4 |
| head | 2 | 5202 | 5136 | 66 | 66 | 110.6 | 121.6 | 1 | 5202, 71 ms, ends 73.1 | 24 | 1.3 |
| head | 3 | 5196 | 5142 | 54 | 54 | 94.5 | 105.8 | 1 | 5196, 66 ms, ends 69.1 | 18 | 1.3 |
| head2 | 3 | 5634 | 5604 | 30 | 30 | 49.0 | 60.1 | 1 | 5634, 73 ms, ends 74.8 | 0 | 1.3 |
| head2 | 4 | 5652 | 5628 | 24 | 24 | 36.4 | 47.6 | 1 | 5652, 61 ms, ends 63.4 | 0 | 1.5 |
| head | 4 | 5172 | 5112 | 60 | 60 | 103.5 | 114.3 | 1 | 5172, 59 ms, ends 60.8 | 24 | 1.4 |
| head | 5 | 5142 | 5094 | 48 | 48 | 86.4 | 97.9 | 1 | 5142, 58 ms, ends 60.1 | 18 | 1.2 |
| head2 | 5 | 5610 | 5586 | 24 | 24 | 39.6 | 51.3 | 1 | 5610, 61 ms, ends 64.6 | 0 | 1.1 |
| head2 | 6 | 5610 | 5562 | 48 | 48 | 85.2 | 96.8 | 1 | 5610, 104 ms, ends 106.6 | 0 | 1.2 |
| head | 6 | 5076 | 4980 | 96 | 96 | 183.2 | 195.2 | 1 | 5076, 103 ms, ends 106.8 | 42 | 1.3 |
| head | 7 | 4968 | 4896 | 72 | 72 | 151.1 | 169.9 | 1 | 4968, 76 ms, ends 79.4 | 30 | 1.4 |
| head2 | 7 | 5058 | 5010 | 48 | 48 | 82.5 | 93.5 | 1 | 5058, 107 ms, ends 110.1 | 0 | 1.2 |
| head2 | 8 | 5124 | 5082 | 42 | 42 | 75.6 | 88.5 | 1 | 5124, 104 ms, ends 106.3 | 0 | 1.3 |
| head | 8 | 4968 | 4884 | 84 | 84 | 164.4 | 175.6 | 1 | 4968, 89 ms, ends 91.7 | 36 | 1.2 |


Reading: both builds flag exactly the lines they counted (F = the plugin's count in every session), send one event and never flag after an unflagged line. On the old build the flagged lines run on to the stream's own snapshot: the last flagged line is 107 ms after the create time (median) against a count that ended 47 to 107 ms after it, so a median of 24 flagged lines (6 to 42; the number grows with the time the count takes, 343 ms and 168 lines in the first run) were written after the count had finished. On HEAD2 the last flagged line is 49 ms after the create time (median), every flagged line is one the count could have seen (FC 0 in 8 of 8), and the lines the stream delivered in its first read after the count's snapshot are unflagged, live. What is left in F-R of HEAD2 (median 30, 18 to 48) is the lines written between the create time and the count's read, which are replay by the count's own definition. HEAD2's replay is longer: F is 5058 to 5652 lines (5616 at the median) against 4968 to 5202 (5142) for the old build, because its window starts at the floor of the second, up to 1 s earlier than the 10 s asked (at about 500 lines/s).

The first run (`raw/dense-run1/`, tool without the FC column, pod 27 to 65 s old): old HEAD F-R median 69 (42..168), HEAD2 30 (18..42); same picture.

## 4. Not run

The burst falling out of the window between the count and the open (the old build's worst case: thousands of live lines flagged; needs a hit of a window of one count duration), a limit that falls in a record that is not whole (containerd never leaves an unterminated record in the log on kind: see the `partial` pod), ttfl and the start legs (skipped as asked).

## Files

`raw/logproof2/{head2,base,head2-crash,head2-crash2}/` (recordings `*.jsonl.gz`, `results.json`, the plugin's debug lines per session `*.plugin-log.txt`), `raw/logproof2/{head2,base}-stdout.txt`, `raw/logproof2/compare2.txt`, `raw/logproof2/head2-table.md`, `raw/dense/` (second run: `stdout.txt`, `dense.json`, recordings), `raw/dense-run1/`. Commands: `./setup.sh`; `./run-head2.sh`; `bin/logproof -plugin bin/head2-plugin -label head2-crash2 -kubeconfig kubeconfig -plugin-yaml tools-src/plugin.yaml -out raw/logproof2 -cases crash2-previous -modes noask,ask` (with `crash2.yaml` applied 30 s earlier); `kubectl apply -f dense.yaml` then `bin/dense -kubeconfig kubeconfig -plugin-yaml tools-src/plugin.yaml -out raw/dense -proc head=bin/head-plugin -proc head2=bin/head2-plugin -pod dense -since 10 -n 8`; `./compare2.sh`; `python3 report-head2.py head2`.
