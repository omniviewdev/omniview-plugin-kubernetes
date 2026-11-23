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
