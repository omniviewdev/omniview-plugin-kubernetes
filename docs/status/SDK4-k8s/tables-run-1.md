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
