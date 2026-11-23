# SDK4-k8s: real-cluster exec proof, plugin-sdk v0.22.0 (BEFORE) vs v0.22.1 (AFTER)

Question: through the real plugin binary on kind, driven the way the host drives it, how many bytes of a short command's
output are lost before and after the pin moves v0.22.0 -> v0.22.1.

Everything below was measured; nothing here is inferred unless marked `[INFERENCE]`.
Two full runs: **run-1** (`raw/run-1`, tool v1) and **run-2** (`raw/run-2`, the final tool, started by `redo.sh`, also has M5).
The two runs are independent samples (new plugin processes, same cluster and pod).

## Result

Payload: 65,521 `x` + `ENDMARK-0123456` = exactly 65,536 bytes, the command exits at once after printing.
"Lost" = 65,536 - (attach snapshot + streamed frames). Rows add run-1 and run-2.

| leg | BEFORE (SDK v0.22.0) | AFTER (SDK v0.22.1) |
|---|---|---|
| M1 host-like, attach at once, sequential, 2 x 200 runs | **5 of 400 runs lost bytes** (3 + 2); 1,550 bytes lost in total; per lossy run 1 to 1,024 B | **0 of 400**, 0 bytes; 400 exact |
| M3 eight workers in parallel on one Stream, 2 x 200 runs | **22 of 400 runs lost bytes** (9 + 13), 5.5 %; 3,483 bytes lost; per lossy run 1 to 1,024 B | **0 of 400**, 0 bytes; 400 exact |
| M2 late attach (1.5 s after create), 2 x 100 runs | first attach **NotFound in 200 of 200**: all 65,536 bytes lost each time (13,107,200 B); the second attach NotFound; CloseSession NotFound | first attach returned **all 65,536 bytes, exact, in 200 of 200**; second attach NotFound 200/200; CloseSession NotFound 200/200 |
| M5 attach-delay sweep (run-2, 20 runs per build and delay) | first attach NotFound (= output lost): 0/20 at 10 and 20 ms, 1/20 at 30 ms, 10/20 at 40 ms, **20/20 at 60 ms and every longer delay** (to 400 ms); one 1,024 B tail loss at 0 ms | NotFound **0/20 at every delay**; 20/20 exact at every delay |
| M4 control, no plugin (run-1 + run-2) | client-go `remotecommand`, Tty, websocket, into memory: 0 bytes lost in 400 of 400 runs (all websocket, no SPDY fallback). `kubectl exec` without -t: 65,536 B in 100 of 100 runs | same cluster, same control |
| leaks (extra or other bytes) | 0 runs (M1, M3, M5) | **0 runs of 800 (M1 + M3), 200 (M2), 200 (M5)**: the SDK's end mark never reached a consumer |

What the numbers say:

* BEFORE loses the **tail** of the output at the end of a session. In all 27 lossy M1/M3 runs the delivered bytes are an exact prefix of the
  payload (`first_diff == total_bytes`; `tail_intact` false). Sizes: 14 runs lost 1 to 15 B, 11 runs 257 to 269 B, 2 runs 1,024 B.
* The rate depends on load and concurrency: sequential M1 5/400 = 1.25 %; eight sessions at once 22/400 = 5.5 %
  (Fisher exact, two-sided: M1 alone p = 0.06, not significant by itself; M3 alone p = 3.5e-7; M1 + M3 pooled 27/800 vs 0/800, p = 1.2e-8).
  AFTER: 0 of 800 pooled runs, exact 95 % upper bound on its per-run loss rate 0.37 %.
* The loss is not the cluster's or client-go's: the control (no plugin, same pod, same command) lost 0 bytes in 500 runs.
* **The bigger loss for BEFORE is the attach that comes after the session ended** (M2, M5): a command that prints and exits at once is over about
  40-60 ms after the create on this cluster (create to Close signal: median 42-129 ms across legs, with the machine at load 12-64); an attach later than that gets
  NotFound on v0.22.0 and the whole output is gone (65,536 of 65,536 bytes). v0.22.1 keeps it for the first attach and returns all of it, exact, every time.
* Close signal (M2): it arrives on the Stream whether or not anyone attached (200/200 on both builds, before the 1.5 s attach, median 49-55 ms after the create);
  nobody was attached, so the Stream carried 0 data frames. On v0.22.0 an attach to the plugin after the end finds no session and no output; on v0.22.1 the first attach to the plugin returns the output (the plugin's own attach, called directly: the host's attach after the Close signal answers NotFound before it asks the plugin until the host changes, see section 5 of `docs/status/SDK4-k8s.md`).
  After the first attach the retained output is consumed: the second attach is NotFound (200/200), and CloseSession of the ended session is NotFound (200/200) on both builds.
* AFTER's cost: CLOSE can follow the exit by up to ~500 ms by design; observed none. Create-to-Close medians, BEFORE vs AFTER:
  M1 run-1 115.1 vs 129.0 ms (load 28 to 64), M1 run-2 43.0 vs 42.0 ms (load ~20), M3 run-1 69.0 vs 67.0, M3 run-2 67.0 vs 68.0; maxima in the tables below.
  M1 run-1's 14 ms median gap sits inside that leg's load swing (load average 28 -> 64); run-2's M1 and every M3/M5 row show no gap. `[INFERENCE]` the end mark is read
  within the same milliseconds as the data, so the wait is only paid when the reader is behind.

## Checks that could have invalidated the proof (all clean)

* Exec itself failed: 0 runs with a create error, an error signal or a timeout (30 s) on either build, in either run, in every leg (the NotFound attaches of BEFORE in M2/M5 are the measured result: in M5 all 111 recorded errors are `attach: NotFound`). 0 sequence gaps in the streamed frames of any session in any run (no frame lost in transit).
* Harness: 0 frames of unregistered sessions, 0 data frames after a Close signal, 0 repeated Close signals, 0 sessions left in either plugin at the end (`ListSessions`).
* Same cluster state: both builds ran at the same time, against the same pod `proof/execproof` (uid `e4aabc68-3eb8-48c8-97d8-2bdf727adabe`, restarts 0, one node) which was
  identical at the start and the end of both runs (`Pod at the start/end` lines below). Block order alternated (B A, A B, ...) so neither build always went first.
* Exec start time (create to first streamed frame), M1 median: run-1 105 ms (BEFORE) / 115 ms (AFTER) at load 28 -> 64; run-2 39 / 39 ms at load ~20. M3 56-59 ms.
* The attach always came before the first byte in M1/M3 (attach 0.3-0.5 ms median, first frame 39-115 ms): `snapshot_bytes` is 0 in all 1,600 M1/M3 runs, so those legs measure the end-of-session loss, not the attach race.
* The shared machine was heavily loaded (every leg's `uptime` load averages are in the tables); BEFORE's rate is a function of that load, not a constant. AFTER lost nothing at any load seen.
* Tool versions: run-1 used the tool at sha256 `3ea3eabb...` (`work/execproof-main-run.go.txt`; m1-m4); run-2 used the final logic (`work/execproof-final.go.txt`, sha256 `9cf547f1...`) which adds M5 and stops the legs on an interrupt;
  the delivered `execproof/main.go` (sha256 `451d905a...`) differs from the run-2 source by two doc-comment lines only. m1-m4 code paths are unchanged except `hostRun` taking a `runSpec`.

## Environment

* Host: Apple M5 Max, 18 cores, 128 GiB, macOS 27.0.1 (Darwin 27.0.0 arm64). The plugin and the tool run natively on it, so the pty is macOS's. Go go1.27.4 (`GOWORK=off GOTOOLCHAIN=local`).
* Docker Desktop 29.9.2 (VM 18 CPUs, 31.3 GiB, kernel 7.0.14-linuxkit); kind v0.30.0; node image `kindest/node:v1.34.0` (Kubernetes v1.34.0, containerd 2.1.3, Debian 12); kubectl client v1.33.0, server v1.34.0.
  Cluster `sdk4k8s-proof` (one control-plane node, default kubelet config), kubeconfig `kubeconfig` in this directory; `~/.kube/config` and the other clusters were never touched.
* Pod: namespace `proof`, pod `execproof`, one container `main`, `busybox:1.37.0`, `sleep 3600` (`pod.yaml`; image loaded with `docker save --platform linux/arm64` + `kind load image-archive`).
* BEFORE = `origin/feature/ui-next` @ 15cf335 (detached worktree `~/Repos/omniviewdev/worktrees/sdk4-k8s-before`; go.mod pins plugin-sdk v0.22.0).
  AFTER = `rsync -a --exclude .git --exclude ui` copy of the lead's `sdk4-k8s-v0221` worktree (`~/Repos/omniviewdev/worktrees/sdk4-k8s-after`; go.mod/go.sum pin v0.22.1).
  `diff -rq` of the two trees (excluding .git and ui): only README.md, go.mod, go.sum differ; the go.mod difference is the one line `plugin-sdk v0.22.0 -> v0.22.1` (go.sum: its two lines).
* Binaries (`bin/`), `go build -o <out>/bin/<name>-plugin ./pkg`:
  * `before-plugin` sha256 `57c04c34b93bb3eb971a292d48d1b4346e1e8270ae86033d5f469984ca75c649`; `go version -m`: `dep github.com/omniviewdev/plugin-sdk v0.22.0 h1:jfutXTmy7tksyJiB3sb7jp0Kja3PcmSRXL4a9SOKuxg=`
  * `after-plugin` sha256 `77fbee211f77b881d79b114f199138db8ac524c74f26cfab3608daa4c807ada0`; `go version -m`: `dep github.com/omniviewdev/plugin-sdk v0.22.1 h1:bRg6mPfIkccKYqNlyrDrQLoZSypzI9e20aaEE8T+CQ0=`
  * both: `google.golang.org/grpc v1.85.0 => github.com/omniviewdev/grpc-go v1.85.1-0.20261107225428-6ba964c95af2`, `k8s.io/client-go v0.37.2`, `go-plugin v1.8.0` (full lines in `work/pins.txt`).
* The tool `execproof/main.go` is built in `tools-src/` (the plugin's go.mod/go.sum with plugin-sdk **v0.22.1**, so the client side of the RPCs is v0.22.1 for both plugins); `go version -m bin/execproof` shows `plugin-sdk v0.22.1`.
* Machine load (`uptime`) at the start of my session 02:06:55 `load average: 8.08, 15.50, 14.61`; run-1 02:17:33 `27.92, 18.36, 17.79` to 02:21:20 `29.00, 30.59, 24.03`; run-2 02:21:41 `21.88, 28.88, 23.57` to 02:25:38 `11.66, 19.74, 20.80`.
  Per-leg start/end loads are in every table below.

## How it was measured

Each plugin binary is started as the host starts it (go-plugin, SDK handshake, AutoMTLS, broker multiplex, a throwaway HOME holding a copy of the kubeconfig and the plugin.yaml, fresh `OMNIVIEW_STATE_DIR`),
`LoadConnections` + `StartConnection`, then the pod's record is read the way the pod page does (catalog, enumerate) and **one** exec `Stream` is opened per plugin process.
A run is: `CreateSession` (resource intent: reference, route, body, `sh -c <script>`, TTY, container `main`), `AttachSession`, then frames for the session on the one Stream until the Close signal
(frames with no signal carry the output; the Close frame's "Session closed" text is not counted). 3 warm-up runs per build come first; they are in `warmup-*.jsonl`, not in the tables (BEFORE lost 1,024 B in 1 of its 6 warm-up runs, AFTER 0 of 6).
M1 = 200 sequential runs per build in blocks of 10 with the builds alternating; M2 = attach 1.5 s after create, then a second attach, then CloseSession (both builds at the same time, 100 runs each);
M3 = 8 workers x 25 runs per build in 5 rounds (each worker 5 runs per round) that alternate the builds; M4 = client-go `remotecommand` (websocket with SPDY fallback as `streamPod`, Tty, stdin that never has input, stdout and stderr into memory) 200 runs
and `kubectl exec` without -t 50 runs, bytes counted in the tool (same as `wc -c`; 5 literal `kubectl exec ... | wc -c` runs also printed 65536 each, `work/kubectl-wc-c.txt`); M5 = M1-style runs with the first attach after 0/10/20/30/40/60/80/120/200/400 ms.

## Commands that were run (in this order)

```
kind create cluster --name sdk4k8s-proof --config kind-config.yaml --kubeconfig $OUT/kubeconfig --wait 180s     # kindest/node:v1.34.0
docker save --platform linux/arm64 busybox:1.37.0 -o work/busybox.tar && kind load image-archive work/busybox.tar --name sdk4k8s-proof
kubectl --kubeconfig $OUT/kubeconfig apply -f pod.yaml && kubectl ... -n proof wait --for=condition=Ready pod/execproof
git -C ~/Repos/omniviewdev/omniview-plugin-kubernetes fetch origin
git -C ~/Repos/omniviewdev/omniview-plugin-kubernetes worktree add --detach ~/Repos/omniviewdev/worktrees/sdk4-k8s-before origin/feature/ui-next
rsync -a --exclude .git --exclude ui ~/Repos/omniviewdev/worktrees/sdk4-k8s-v0221/ ~/Repos/omniviewdev/worktrees/sdk4-k8s-after/
GOWORK=off GOTOOLCHAIN=local go build -o $OUT/bin/before-plugin ./pkg      # in sdk4-k8s-before
GOWORK=off GOTOOLCHAIN=local go build -o $OUT/bin/after-plugin  ./pkg      # in sdk4-k8s-after
(cd tools-src && GOWORK=off GOTOOLCHAIN=local go vet ./hack/zz-proof/execproof && go build -o ../bin/execproof ./hack/zz-proof/execproof)
# run-1 (tool v1; legs m1,m2,m3,m4):
./bin/execproof -before bin/before-plugin -after bin/after-plugin -kubeconfig $OUT/kubeconfig -plugin-yaml tools-src/plugin.yaml -out raw/run-1
# run-2 (final tool, through redo.sh; legs m1..m5):
BEFORE_BIN=$OUT/bin/before-plugin AFTER_BIN=$OUT/bin/after-plugin KUBECONFIG=$OUT/kubeconfig PLUGIN_YAML=$OUT/tools-src/plugin.yaml OUT_DIR=$OUT/raw/run-2 LEGS=m1,m2,m3,m4,m5 ./redo.sh
kind delete cluster --name sdk4k8s-proof --kubeconfig $OUT/kubeconfig     # at the end (exact name)
```

Redo: `BEFORE_BIN=... AFTER_BIN=... KUBECONFIG=... PLUGIN_YAML=... ./redo.sh` (default legs m1-m4, prints the tables, keeps JSONL and `tables.md` under `runs/<timestamp>/`).
In the repository the tool, the script and the configs are under `tools/` with a `.txt` suffix, and the paths in this file are those of the helper's output directory: "Dev tools" in `docs/status/SDK4-k8s.md` says how to stage a re-run from the committed files.
The tool itself: `execproof -h`.

## What I did NOT run

* Linux: the pty is macOS's. The SDK says Linux can drop a chunk under load; not tested here.
* The host application or its UI (no real Wails attach latency; M5 stands in for it with fixed delays); no consumer slower than the tool's (the tool drains its Stream at once; `[INFERENCE]` a slower consumer would make BEFORE's tail loss more likely).
* Other payloads: no newline/ANSI (tty translation), no payloads other than 64 KiB, no long-lived or interactive sessions, no resize, no stdin writes, no node exec, no `attach` mode.
* The retention limits of v0.22.1 (32 sessions, one minute, lazy expiry): never reached (one retained session at a time, consumed at once).
* A CloseSession that races the process's own end; the plugin's debug logs (`-plugin-log-level` exists, not used); SPDY transport (all 400 control runs used websocket; the plugin's own transport was not instrumented).
* Loads other than what the shared machine had (no load generation, no run on an idle machine); other Kubernetes versions; kubelet changes.
* Nothing was pushed, no PR; the lead's worktree and the plugin's owner clone were not modified (only `git fetch` and `git worktree add` in the owner clone, as allowed).

## Files

* `RESULTS.md` (this index), `redo.sh`, `execproof/main.go` (the tool), `tools-src/` (module copy: AFTER's go.mod/go.sum + plugin.yaml + the tool), `pod.yaml`, `kind-config.yaml`, `kubeconfig` (emptied by `kind delete cluster`).
* `raw/run-1/`, `raw/run-2/`: `<leg>-<build>.jsonl` (one line per run), `warmup-*.jsonl`, `tables.md`, `plugin-<build>/plugin-stderr.log` (the plugin's stderr).
* `bin/` the two plugin binaries (+ sha256 files), the tool binaries; `work/` logs: `pins.txt`, `env.txt`, `run-*.stderr` (progress with load per leg), `run-*.stdout`, tool sources of each run.

# Tables

## run-1 (tool v1, legs m1-m4) - `raw/run-1/tables.md`

Payload: 65521 x 'x' + "ENDMARK-0123456" = 65536 bytes. Pod proof/execproof container main.

Pod at the start: uid=e4aabc68-3eb8-48c8-97d8-2bdf727adabe restarts=0 started=2026-11-23T08:09:07Z node=sdk4k8s-proof-control-plane

Pod at the end: uid=e4aabc68-3eb8-48c8-97d8-2bdf727adabe restarts=0 started=2026-11-23T08:09:07Z node=sdk4k8s-proof-control-plane

### M1 host-like (one Stream per plugin, attach at once, sequential, builds interleaved in blocks)

| build | runs | runs with loss | bytes lost (total) | lost per run: min / median / p90 / max | runs with 0 bytes | tail intact | exact match | runs with extra bytes | runs with errors | timeouts | seq gaps |
|---|---|---|---|---|---|---|---|---|---|---|---|
| before | 200 | 3 | 1543 | 0 / 0 / 0 / 1024 | 0 | 197 | 197 | 0 (0 bytes) | 0 runs: - | 0 | 0 |
| after | 200 | 0 | 0 | 0 / 0 / 0 / 0 | 0 | 200 | 200 | 0 (0 bytes) | 0 runs: - | 0 | 0 |

| build | create ms: median / p90 / max | attach ms | create to first frame ms | create to Close signal ms | load (uptime) at the leg's start / end |
|---|---|---|---|---|---|
| before | 5.6 / 10.6 / 24.7 | 0.5 / 2.3 / 9.8 | 104.9 / 178.7 / 290.5 | 115.1 / 194.0 / 314.0 | start: load 27.92 18.36 17.79; end: load 63.90 30.03 22.17 |
| after | 6.5 / 12.7 / 32.8 | 0.5 / 2.9 / 7.3 | 115.0 / 177.6 / 266.6 | 129.0 / 205.6 / 294.6 | start: load 27.92 18.36 17.79; end: load 63.90 30.03 22.17 |

### M3 concurrency (8 workers in parallel per build, host-like, rounds alternate the builds)

| build | runs | runs with loss | bytes lost (total) | lost per run: min / median / p90 / max | runs with 0 bytes | tail intact | exact match | runs with extra bytes | runs with errors | timeouts | seq gaps |
|---|---|---|---|---|---|---|---|---|---|---|---|
| before | 200 | 9 | 1599 | 0 / 0 / 0 / 1024 | 0 | 191 | 191 | 0 (0 bytes) | 0 runs: - | 0 | 0 |
| after | 200 | 0 | 0 | 0 / 0 / 0 / 0 | 0 | 200 | 200 | 0 (0 bytes) | 0 runs: - | 0 | 0 |

| build | create ms: median / p90 / max | attach ms | create to first frame ms | create to Close signal ms | load (uptime) at the leg's start / end |
|---|---|---|---|---|---|
| before | 6.4 / 16.7 / 67.8 | 0.5 / 1.0 / 4.0 | 57.1 / 75.3 / 142.1 | 69.0 / 84.7 / 152.6 | start: load 28.18 30.48 23.83; end: load 30.17 30.85 24.00 |
| after | 6.4 / 13.1 / 70.1 | 0.4 / 0.8 / 2.4 | 55.6 / 69.0 / 120.9 | 67.0 / 77.9 / 134.9 | start: load 28.18 30.48 23.83; end: load 30.17 30.85 24.00 |

### M2 late attach (first attach 1.5s after the create, after the session ended; load start: load 63.90 30.03 22.17; end: load 28.18 30.48 23.83)

| build | runs | first attach | first attach bytes: min / median / p90 / max | first attach exact 65,536 | second attach | CloseSession after both | Close signal on the Stream: runs, create to Close ms median / p90 / max | Close before the attach | data frames on the Stream | runs with errors |
|---|---|---|---|---|---|---|---|---|---|---|
| before | 100 | NotFound x100 | 0 / 0 / 0 / 0 | 0 | NotFound x100 | NotFound x100 | 100 of 100, 54.5 / 103.2 / 301.9 | 100 | 0 | 0 |
| after | 100 | ok x100 | 65536 / 65536 / 65536 / 65536 | 100 | NotFound x100 | NotFound x100 | 100 of 100, 53.3 / 116.9 / 257.2 | 100 | 0 | 0 |

### M4 control (no plugin; load start: load 30.17 30.85 24.00; end: load 29.00 30.59 24.03)

| control | runs | runs with loss | bytes lost (total) | lost per run: min / median / p90 / max | tail intact | exact match | transport | runs with errors | duration ms: median / p90 / max |
|---|---|---|---|---|---|---|---|---|---|
| client-go | 200 | 0 | 0 | 0 / 0 / 0 / 0 | 200 | 200 | websocket x200 | 0: - | 49.8 / 57.9 / 103.5 |
| kubectl | 50 | 0 | 0 | 0 / 0 / 0 / 0 | 50 | 50 | - | 0: - | 98.4 / 107.2 / 130.2 |

### Harness checks (frames no run saw, sessions left behind)

| build | frames of unregistered sessions | data frames after the Close signal | repeated Close signals | sessions left in the plugin |
|---|---|---|---|---|
| before | 0 | 0 (0 bytes) | 0 | 0 |
| after | 0 | 0 (0 bytes) | 0 | 0 |

Load at each leg:

- warmup: start `load 27.92 18.36 17.79`; end `load 27.92 18.36 17.79`
- m1: start `load 27.92 18.36 17.79`; end `load 63.90 30.03 22.17`
- m2: start `load 63.90 30.03 22.17`; end `load 28.18 30.48 23.83`
- m3: start `load 28.18 30.48 23.83`; end `load 30.17 30.85 24.00`
- m4: start `load 30.17 30.85 24.00`; end `load 29.00 30.59 24.03`

## run-2 (final tool through `redo.sh`, legs m1-m5) - `raw/run-2/tables.md`

Payload: 65521 x 'x' + "ENDMARK-0123456" = 65536 bytes. Pod proof/execproof container main.

Pod at the start: uid=e4aabc68-3eb8-48c8-97d8-2bdf727adabe restarts=0 started=2026-11-23T08:09:07Z node=sdk4k8s-proof-control-plane

Pod at the end: uid=e4aabc68-3eb8-48c8-97d8-2bdf727adabe restarts=0 started=2026-11-23T08:09:07Z node=sdk4k8s-proof-control-plane

### M1 host-like (one Stream per plugin, attach at once, sequential, builds interleaved in blocks)

| build | runs | runs with loss | bytes lost (total) | lost per run: min / median / p90 / max | runs with 0 bytes | tail intact | exact match | runs with extra bytes | runs with errors | timeouts | seq gaps |
|---|---|---|---|---|---|---|---|---|---|---|---|
| before | 200 | 2 | 7 | 0 / 0 / 0 / 5 | 0 | 198 | 198 | 0 (0 bytes) | 0 runs: - | 0 | 0 |
| after | 200 | 0 | 0 | 0 / 0 / 0 / 0 | 0 | 200 | 200 | 0 (0 bytes) | 0 runs: - | 0 | 0 |

| build | create ms: median / p90 / max | attach ms | create to first frame ms | create to Close signal ms | load (uptime) at the leg's start / end |
|---|---|---|---|---|---|
| before | 4.2 / 5.8 / 16.5 | 0.3 / 0.8 / 1.5 | 39.0 / 49.3 / 78.6 | 43.0 / 55.5 / 86.5 | start: load 20.61 28.50 23.46; end: load 19.62 27.73 23.30 |
| after | 4.2 / 5.5 / 8.9 | 0.3 / 0.8 / 2.0 | 38.6 / 49.1 / 79.2 | 42.0 / 54.6 / 87.5 | start: load 20.61 28.50 23.46; end: load 19.62 27.73 23.30 |

### M3 concurrency (8 workers in parallel per build, host-like, rounds alternate the builds)

| build | runs | runs with loss | bytes lost (total) | lost per run: min / median / p90 / max | runs with 0 bytes | tail intact | exact match | runs with extra bytes | runs with errors | timeouts | seq gaps |
|---|---|---|---|---|---|---|---|---|---|---|---|
| before | 200 | 13 | 1884 | 0 / 0 / 0 / 269 | 0 | 187 | 187 | 0 (0 bytes) | 0 runs: - | 0 | 0 |
| after | 200 | 0 | 0 | 0 / 0 / 0 / 0 | 0 | 200 | 200 | 0 (0 bytes) | 0 runs: - | 0 | 0 |

| build | create ms: median / p90 / max | attach ms | create to first frame ms | create to Close signal ms | load (uptime) at the leg's start / end |
|---|---|---|---|---|---|
| before | 7.7 / 10.5 / 219.9 | 0.4 / 1.3 / 7.6 | 58.1 / 68.3 / 267.7 | 67.0 / 77.4 / 269.2 | start: load 11.97 21.06 21.28; end: load 14.22 21.38 21.39 |
| after | 7.1 / 9.1 / 147.9 | 0.4 / 1.2 / 9.1 | 59.3 / 74.4 / 201.4 | 68.0 / 83.0 / 214.4 | start: load 11.97 21.06 21.28; end: load 14.22 21.38 21.39 |

### M2 late attach (first attach 1.5s after the create, after the session ended; load start: load 19.62 27.73 23.30; end: load 11.97 21.06 21.28)

| build | runs | first attach | first attach bytes: min / median / p90 / max | first attach exact 65,536 | second attach | CloseSession after both | Close signal on the Stream: runs, create to Close ms median / p90 / max | Close before the attach | data frames on the Stream | runs with errors |
|---|---|---|---|---|---|---|---|---|---|---|
| before | 100 | NotFound x100 | 0 / 0 / 0 / 0 | 0 | NotFound x100 | NotFound x100 | 100 of 100, 51.2 / 62.3 / 85.4 | 100 | 0 | 0 |
| after | 100 | ok x100 | 65536 / 65536 / 65536 / 65536 | 100 | NotFound x100 | NotFound x100 | 100 of 100, 48.6 / 57.5 / 74.9 | 100 | 0 | 0 |

### M5 attach-delay sweep (host-like; the first attach comes after the delay; load start: load 19.56 22.21 21.68; end: load 11.66 19.74 20.80)

| attach delay | build | runs | first attach NotFound | runs with loss | bytes lost (total) | runs with 0 bytes | exact match | create to Close signal ms: median / p90 / max |
|---|---|---|---|---|---|---|---|---|
| 0s | before | 20 | 0 | 1 | 1024 | 0 | 19 | 46.9 / 52.9 / 55.4 |
| 0s | after | 20 | 0 | 0 | 0 | 0 | 20 | 41.8 / 46.6 / 49.9 |
| 10ms | before | 20 | 0 | 0 | 0 | 0 | 20 | 43.3 / 50.2 / 64.1 |
| 10ms | after | 20 | 0 | 0 | 0 | 0 | 20 | 41.9 / 47.5 / 50.5 |
| 20ms | before | 20 | 0 | 0 | 0 | 0 | 20 | 45.2 / 50.8 / 53.0 |
| 20ms | after | 20 | 0 | 0 | 0 | 0 | 20 | 43.3 / 49.6 / 52.9 |
| 30ms | before | 20 | 1 | 1 | 65536 | 1 | 19 | 38.7 / 44.3 / 45.5 |
| 30ms | after | 20 | 0 | 0 | 0 | 0 | 20 | 41.8 / 46.1 / 58.0 |
| 40ms | before | 20 | 10 | 10 | 655360 | 10 | 10 | 40.8 / 47.5 / 50.1 |
| 40ms | after | 20 | 0 | 0 | 0 | 0 | 20 | 38.6 / 47.1 / 49.2 |
| 60ms | before | 20 | 20 | 20 | 1310720 | 20 | 0 | 38.9 / 45.3 / 51.7 |
| 60ms | after | 20 | 0 | 0 | 0 | 0 | 20 | 35.4 / 40.5 / 41.5 |
| 80ms | before | 20 | 20 | 20 | 1310720 | 20 | 0 | 37.4 / 42.6 / 48.0 |
| 80ms | after | 20 | 0 | 0 | 0 | 0 | 20 | 37.3 / 47.2 / 48.7 |
| 120ms | before | 20 | 20 | 20 | 1310720 | 20 | 0 | 39.6 / 42.7 / 48.3 |
| 120ms | after | 20 | 0 | 0 | 0 | 0 | 20 | 41.2 / 47.0 / 50.5 |
| 200ms | before | 20 | 20 | 20 | 1310720 | 20 | 0 | 38.0 / 46.7 / 52.4 |
| 200ms | after | 20 | 0 | 0 | 0 | 0 | 20 | 38.9 / 45.7 / 48.2 |
| 400ms | before | 20 | 20 | 20 | 1310720 | 20 | 0 | 38.6 / 42.7 / 46.6 |
| 400ms | after | 20 | 0 | 0 | 0 | 0 | 20 | 40.4 / 44.5 / 47.7 |

### M4 control (no plugin; load start: load 14.22 21.38 21.39; end: load 19.56 22.21 21.68)

| control | runs | runs with loss | bytes lost (total) | lost per run: min / median / p90 / max | tail intact | exact match | transport | runs with errors | duration ms: median / p90 / max |
|---|---|---|---|---|---|---|---|---|---|
| client-go | 200 | 0 | 0 | 0 / 0 / 0 / 0 | 200 | 200 | websocket x200 | 0: - | 50.0 / 107.1 / 154.2 |
| kubectl | 50 | 0 | 0 | 0 / 0 / 0 / 0 | 50 | 50 | - | 0: - | 96.3 / 121.2 / 241.6 |

### Harness checks (frames no run saw, sessions left behind)

| build | frames of unregistered sessions | data frames after the Close signal | repeated Close signals | sessions left in the plugin |
|---|---|---|---|---|
| before | 0 | 0 (0 bytes) | 0 | 0 |
| after | 0 | 0 (0 bytes) | 0 | 0 |

Load at each leg:

- warmup: start `load 20.61 28.50 23.46`; end `load 20.61 28.50 23.46`
- m1: start `load 20.61 28.50 23.46`; end `load 19.62 27.73 23.30`
- m2: start `load 19.62 27.73 23.30`; end `load 11.97 21.06 21.28`
- m3: start `load 11.97 21.06 21.28`; end `load 14.22 21.38 21.39`
- m4: start `load 14.22 21.38 21.39`; end `load 19.56 22.21 21.68`
- m5: start `load 19.56 22.21 21.68`; end `load 11.66 19.74 20.80`

Machine load at the end of the session, before the cluster was deleted: `02:28:15 load average: 12.54, 17.32, 19.64`. Cluster `sdk4k8s-proof` deleted at 02:28 by exact name (`kind delete cluster --name sdk4k8s-proof`); `kind get clusters` afterwards lists only `kind`, `omniview-arch-20261110`, `omniview-load-lab`. No plugin process of mine is left (`pgrep -fl sdk4-k8s-proof-out/bin`: none).
