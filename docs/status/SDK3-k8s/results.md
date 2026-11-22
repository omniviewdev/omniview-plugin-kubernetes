# SDK3-k8s real-cluster proof: RESULTS

Index of this directory. Raw outputs are under `raw/`; every table below was produced by the tools in `bin/` (sources in `tools-src/hack/zz-proof/`).

## 0. Environment

| | |
|---|---|
| machine | macOS arm64 (Darwin 27.0.0), Docker Desktop 29.9.2 (18 CPUs, 32 GB), SHARED with other agents: load average 5 to 34 during the runs (every table says which load it was taken under) |
| cluster | kind v0.30.0 (go1.25.0), node `kindest/node:v1.35.0` (kube-apiserver v1.35.0, containerd 2.2.0), cluster `sdk3k8s-proof`, kubeconfig `kubeconfig` (never `~/.kube/config`, which was not touched: mtime unchanged) |
| kubelet | one change from the defaults: `containerLogMaxSize: 100Mi` (default 10Mi) so that a 15 MB log (`bigtail`) stays in the current log file; see `kind-config.yaml`. With the default the kubelet rotates a 15 MB log within 10 s and `kubectl logs` then serves only the new file |
| Go | go1.27.4 darwin/arm64, `GOWORK=off GOTOOLCHAIN=local` |
| kubectl | v1.33.0 client |
| BASE | `origin/feature/ui-next` 8af576f, SDK v0.20.0; `bin/base-plugin` sha256 `04b9895e637abbd1d91a8f17a86135cfb6b1b329ab2d167a8e0dbf4d2bed31e7` |
| BUMP | BASE + `go get github.com/omniviewdev/plugin-sdk@v0.22.0 && go mod tidy` (go.mod/go.sum byte-identical to the lead's two-file change; `lib/pq` moves to direct); SDK v0.22.0; `bin/bump-plugin` sha256 `7c9d4f62de6785db696ee2b82ac48fc1afc0d32fabff93e1985cef4bfea17753` |
| HEAD | the lead's commit 9ceb911 (`ui-next/sdk3-v0.22.0-replay-count`, clean tree), built from an rsync copy (no .git, no ui); SDK v0.22.0; `bin/head-plugin` sha256 `1bb30fe7c5aaa007cc69a482b0113646299c031702496406d81e7976f64f2b3e` |
| tools | built on SDK v0.22.0 from a module copy that has the HEAD module's `go.mod`/`go.sum` (sha256 `c97e4683...`/`f34aacab...`, the grpc-go replace included) |

`raw/env/environment.txt` has the full `go version -m` of BASE and BUMP.

### What was run, and how (the harness)

`harness` launches the plugin binary as the host does (`backend/pkg/plugin/loader.go createBackend`): go-plugin, `GenerateHandshakeConfig` (cookie `OMNIVIEW`=`kubernetes`), `VersionedPlugins{1: resource, exec, networker, log, metric, settings, tools, lifecycle}`, `AutoMTLS`, `GRPCBrokerMultiplex`, `SkipHostEnv`, `sdk.GRPCDialOptions()`, the host's child environment (`OMNIVIEW_STATE_DIR`, `OMNIVIEW_GENERATION`, `GOWORK=off`, ...), with a throwaway `HOME` that holds `.kube/config` and `.omniview/plugins/kubernetes/plugin.yaml` (nothing of the user's `~/.omniview` or `~/.kube` is read or written). Then `LoadConnections`, `StartConnection`. For logs it does what `controller.createSessionWithContext` does: it enumerates the record of the pod (or Deployment) through the plugin's own resource provider, pins the catalog revision on the context (the reference admission), puts the connection in the plugin context, and calls `PluginClient.CreateSession` with the request the plugin's UI sends for a Pod (`ui/src/pod/logs/target.ts`): `resource_key` `k8s:/pods`, `resource_id`, the record's body, its reference, the route, `follow=true`, `tail_lines=1000`, `include_timestamps`, `include_source_events`, `params.filter_labels=container`, a client-reserved session id. One log `Stream` is opened per plugin process, as the host does, on the raw `LogPluginClient` so that every `LogStreamOutput` frame is seen (and its protobuf bytes hashed).

Recording: every frame of a session is one JSON line (`.jsonl.gz`): line frames with source id, labels, the kubelet timestamp as sent, content (length, SHA-256 and the text up to 256 bytes), origin, level, replay flag; events with type, source id, message; the create reply. The session id is replaced by the token `S`; that is the only normalisation. `meta` (arrival time, an event's wall clock, the create reply's status and source list, which race with the session's own start) is kept in each record and ignored by `logdiff`.

### How to re-run (one command each)

| what | command |
|---|---|
| everything for HEAD (rebuild, leg 3, diffs, leg 4, count cost) | `HEAD_SRC=<plugin tree> ./redo.sh` |
| cluster from nothing | `./setup.sh` |
| start time (BUMP) | `bin/startbench -plugin bin/bump-plugin -label bump -kubeconfig kubeconfig -plugin-yaml tools-src/plugin.yaml -out raw/start [-scenarios a,c,g] [-plugin-log-level debug]` |
| log proof of one build | `bin/logproof -plugin bin/<base\|bump\|head>-plugin -label <label> -kubeconfig kubeconfig -plugin-yaml tools-src/plugin.yaml -out raw/logproof [-cases rate5-t1000,web-t1000] [-modes ask]` |
| frame diffs | `./compare.sh` (uses `bin/logdiff [-by-source] [-overlap] [-strip-replay] [-skip-reply] A B`) |
| time to first line | `bin/ttfl -kubeconfig kubeconfig -plugin-yaml tools-src/plugin.yaml -out raw/ttfl/x -n 20 -proc base=bin/base-plugin -proc head=bin/head-plugin -leg base-noask=base:noask -leg head-noask=head:noask -leg head-ask=head:ask -case rate5:1000 -case bigtail:1000 -case bigtail:0` |
| the count request alone | `bin/countbench -kubeconfig kubeconfig -pod bigtail -tail 1000 [-limit-bytes N] -n 20` |
| the plugin's own count cost | `./countcost.sh head` |
| invalidation checks (item 5) | `./checks.sh` |

## 1. The tools, in short

- `bin/startbench` (leg 2), `bin/logproof` + `bin/logdiff` + `compare.sh` (leg 3), `bin/ttfl` + `bin/countbench` (leg 4), `checks.sh` (item 5). Harness and proxy: `tools-src/hack/zz-proof/harness`.
- The discovery proxy (`harness/proxy.go`) sits between the plugin and the kind API server on `127.0.0.1:18080`. Toggles: **legacy** (the `Accept` header of `GET /api` and `GET /apis` is rewritten to `application/json`, so the server answers the legacy lists and the plugin reads every group version with a request of its own: 25 per-version reads on this cluster) and **holds** (an exact path is held for N seconds before it is forwarded; a request whose client goes away meanwhile is dropped, and the time it was held is logged). The plugin's kubeconfig for the proxy scenarios is `http://127.0.0.1:18080` with a dummy token. A REAL aggregated API exists on the cluster whenever a group is "hung": namespace `proof-agg`, pod `blackhole` (a Go server that accepts TCP and never answers; image `sdk3k8s-blackhole:1`), a Service, and `APIService v1.hangN.proof.example.com` (`insecureSkipTLSVerify`). startbench waits until the API server itself says `Available=False FailedDiscoveryCheck ... context deadline exceeded` (a first check says `connection refused` while the pod starts; that state is not used).
- The per-version read of a hung group is held at the proxy (the real aggregator answers a flagged APIService with `503` at once, in 1 to 2 ms, so a read that hangs cannot be had from a real kube-apiserver; this is the one synthetic element, as in the PR 281 review). Everything else is real.

## 2. Leg 2: the start time (BUMP binary)

Time of `StartConnection` as the host sees it (the RPC, CreateClient and OnStart together), a fresh plugin process per run, default settings (`connection_acquisition_timeout_seconds` 60). Scenarios a-d were run with the plugin at its default log level, e-g with `OMNIVIEW_PLUGIN_LOG_LEVEL=debug`. `uptime` before and after every run is in `raw/start/bump/<id>/run-NN.json`.

| id | scenario | runs | median s | min s | max s | StartConnection returned | the held read, dropped by the plugin after (s) | index read (s) | Catalog() after start (s) |
|---|---|---|---|---|---|---|---|---|---|
| a | healthy, aggregated discovery (direct) | 10 | 0.013 | 0.012 | 0.032 | CONNECTED x10 | - | - | 0.0047..0.0074 |
| a1 | aggregated discovery, 1 real black-hole APIService (direct) | 5 | 0.012 | 0.012 | 0.015 | CONNECTED x5 | - | - | 0.0046..0.0057 |
| a5 | aggregated discovery, 5 real black-hole APIServices (direct) | 3 | 0.012 | 0.012 | 0.012 | CONNECTED x3 | - | - | 0.0046..0.0048 |
| b | healthy, legacy discovery (proxy) | 10 | 0.014 | 0.013 | 0.027 | CONNECTED x10 | - | 0.000..0.001 | 0.0043..0.0073 |
| c0 | legacy, 1 real black-hole APIService, nothing held | 5 | 0.380 | 0.330 | 0.407 | CONNECTED x5 | - | 0.001..0.001 | 0.0043..0.0059 |
| c | legacy, 1 hung group (real APIService + read held 120 s) | 5 | 5.013 | 5.012 | 5.017 | CONNECTED x5 | 5.00, 5.00, 5.00, 5.00, 5.00 | 0.001..0.001 | 0.0049..0.0065 |
| d | legacy, 5 hung groups (5 real APIServices + 5 reads held 120 s) | 5 | 5.013 | 5.011 | 5.018 | CONNECTED x5 | 5.00, 5.00, 5.00, 5.00, 5.00 | 0.001..0.001 | 0.0055..0.0079 |
| e20 | legacy, index delayed 20 s, 1 hung group | 3 | 25.025 | 25.023 | 25.040 | CONNECTED x3 | 5.00, 5.00, 5.00 | 20.004..20.004 | 0.0078..0.0091 |
| e40 | legacy, index delayed 40 s, 1 hung group | 3 | 45.021 | 45.016 | 45.030 | CONNECTED x3 | 5.00, 5.00, 5.00 | 40.003..40.005 | 0.0063..0.0148 |
| f55 | legacy, index delayed 55 s, 1 hung group | 3 | 57.523 | 57.512 | 57.524 | CONNECTED x3 | 2.49, 2.50, 2.50 | 55.003..55.007 | 0.0046..0.0105 |
| f57 | legacy, index delayed 57 s, 1 hung group | 3 | 58.518 | 58.516 | 58.527 | CONNECTED x3 | 1.50, 1.50, 1.50 | 57.003..57.004 | 0.0052..0.0143 |
| f59 | legacy, index delayed 59 s, 1 hung group | 3 | 59.522 | 59.521 | 59.523 | CONNECTED x3 | 0.50, 0.50, 0.50 | 59.004..59.005 | 0.0076..0.0088 |
| g | legacy, 1 hung group, connection kept open: the heal loop | 2 | 5.026 | 5.019 | 5.034 | CONNECTED x2 | 5.00, 5.00 | 0.002..0.002 | 0.0063..0.0491 |
| f61 | legacy, index delayed 61 s (beyond the 60 s bound), 1 hung group | 2 | 60.003 | 60.002 | 60.004 | ERROR/TIMEOUT x2 | - | 59.990..59.996 | - |
| h60 | legacy, a BUILT-IN group version (apps/v1) held 120 s, healthy otherwise | 2 | 60.002 | 60.001 | 60.002 | ERROR/TIMEOUT x2 | 59.99, 60.00 | 0.001..0.002 | - |

Toggles (proxy 127.0.0.1:<port>, held paths):

- **a**: no proxy: the plugin talks to the kind API server directly (aggregated discovery)
- **a1**: no proxy: the plugin talks to the kind API server directly (aggregated discovery)
- **a5**: no proxy: the plugin talks to the kind API server directly (aggregated discovery)
- **b**: proxy 127.0.0.1:18080, legacy discovery (Accept of GET /api and GET /apis rewritten to application/json)=true; held: nothing
- **c0**: proxy 127.0.0.1:18080, legacy discovery (Accept of GET /api and GET /apis rewritten to application/json)=true; held: nothing
- **c**: proxy 127.0.0.1:18080, legacy discovery (Accept of GET /api and GET /apis rewritten to application/json)=true; held: GET /apis/hang1.proof.example.com/v1 for 2m0s
- **d**: proxy 127.0.0.1:18080, legacy discovery (Accept of GET /api and GET /apis rewritten to application/json)=true; held: GET /apis/hang1.proof.example.com/v1 for 2m0s; held: GET /apis/hang2.proof.example.com/v1 for 2m0s; held: GET /apis/hang3.proof.example.com/v1 for 2m0s; held: GET /apis/hang4.proof.example.com/v1 for 2m0s; held: GET /apis/hang5.proof.example.com/v1 for 2m0s
- **e20**: proxy 127.0.0.1:18080, legacy discovery (Accept of GET /api and GET /apis rewritten to application/json)=true; held: GET /apis for 20s; held: GET /apis/hang1.proof.example.com/v1 for 2m0s
- **e40**: proxy 127.0.0.1:18080, legacy discovery (Accept of GET /api and GET /apis rewritten to application/json)=true; held: GET /apis for 40s; held: GET /apis/hang1.proof.example.com/v1 for 2m0s
- **f55**: proxy 127.0.0.1:18080, legacy discovery (Accept of GET /api and GET /apis rewritten to application/json)=true; held: GET /apis for 55s; held: GET /apis/hang1.proof.example.com/v1 for 2m0s
- **f57**: proxy 127.0.0.1:18080, legacy discovery (Accept of GET /api and GET /apis rewritten to application/json)=true; held: GET /apis for 57s; held: GET /apis/hang1.proof.example.com/v1 for 2m0s
- **f59**: proxy 127.0.0.1:18080, legacy discovery (Accept of GET /api and GET /apis rewritten to application/json)=true; held: GET /apis for 59s; held: GET /apis/hang1.proof.example.com/v1 for 2m0s
- **g**: proxy 127.0.0.1:18080, legacy discovery (Accept of GET /api and GET /apis rewritten to application/json)=true; held: GET /apis/hang1.proof.example.com/v1 for 2m0s
- **f61**: proxy 127.0.0.1:18080, legacy discovery (Accept of GET /api and GET /apis rewritten to application/json)=true; held: GET /apis for 1m1s; held: GET /apis/hang1.proof.example.com/v1 for 2m0s
- **h60**: proxy 127.0.0.1:18080, legacy discovery (Accept of GET /api and GET /apis rewritten to application/json)=true; held: GET /apis/apps/v1 for 2m0s

Load (uptime) at the first and last run of each scenario:

- a: before first run `16:57  up 12 days,  9:24, 2 users, load averages: 9.50 24.29 21.00`; after last run `16:57  up 12 days,  9:24, 2 users, load averages: 9.50 24.29 21.00`
- a1: before first run `16:57  up 12 days,  9:24, 2 users, load averages: 8.80 23.65 20.81`; after last run `16:57  up 12 days,  9:24, 2 users, load averages: 8.80 23.65 20.81`
- a5: before first run `16:57  up 12 days,  9:24, 2 users, load averages: 8.41 23.33 20.71`; after last run `16:57  up 12 days,  9:24, 2 users, load averages: 8.41 23.33 20.71`
- b: before first run `16:57  up 12 days,  9:24, 2 users, load averages: 8.41 23.33 20.71`; after last run `16:57  up 12 days,  9:24, 2 users, load averages: 8.41 23.33 20.71`
- c0: before first run `16:57  up 12 days,  9:24, 2 users, load averages: 7.50 22.64 20.50`; after last run `16:57  up 12 days,  9:24, 2 users, load averages: 7.50 22.64 20.50`
- c: before first run `16:57  up 12 days,  9:24, 2 users, load averages: 7.50 22.64 20.50`; after last run `16:57  up 12 days,  9:25, 2 users, load averages: 5.85 21.04 19.98`
- d: before first run `16:58  up 12 days,  9:25, 2 users, load averages: 5.46 20.71 19.87`; after last run `16:58  up 12 days,  9:25, 2 users, load averages: 5.23 19.42 19.43`
- e20: before first run `16:59  up 12 days,  9:26, 2 users, load averages: 10.23 18.64 19.13`; after last run `17:00  up 12 days,  9:27, 2 users, load averages: 8.64 16.22 18.17`
- e40: before first run `17:00  up 12 days,  9:27, 2 users, load averages: 8.64 16.22 18.17`; after last run `17:02  up 12 days,  9:30, 2 users, load averages: 17.80 15.09 17.29`
- f55: before first run `17:02  up 12 days,  9:30, 2 users, load averages: 17.80 15.09 17.29`; after last run `17:05  up 12 days,  9:33, 2 users, load averages: 17.62 16.69 17.66`
- f57: before first run `17:05  up 12 days,  9:33, 2 users, load averages: 17.62 16.69 17.66`; after last run `17:08  up 12 days,  9:35, 2 users, load averages: 17.71 18.80 18.40`
- f59: before first run `17:08  up 12 days,  9:35, 2 users, load averages: 17.71 18.80 18.40`; after last run `17:11  up 12 days,  9:38, 2 users, load averages: 11.79 16.18 17.40`
- g: before first run `17:11  up 12 days,  9:38, 2 users, load averages: 11.79 16.18 17.40`; after last run `17:15  up 12 days,  9:42, 2 users, load averages: 8.67 12.64 15.61`
- f61: before first run `17:28  up 12 days,  9:56, 2 users, load averages: 12.36 14.18 15.10`; after last run `17:30  up 12 days,  9:58, 2 users, load averages: 6.24 11.39 13.88`
- h60: before first run `17:26  up 12 days,  9:53, 2 users, load averages: 9.94 14.67 15.44`; after last run `17:28  up 12 days,  9:55, 2 users, load averages: 14.60 14.76 15.33`

Heal (scenario g):

- run 1: StartConnection returned 2026-11-22T17:11:38.994396-06:00 after 5.034 s (CONNECTED=True); the watch lasted 105 s
    - attempt 1: first request 30.006 s after StartConnection returned; the attempt lasted 5.051 s; 26 requests; held read dropped after 5.000 s
    - attempt 2: first request 95.071 s after StartConnection returned; the attempt lasted 5.017 s; 26 requests; held read dropped after 5.002 s
- run 2: StartConnection returned 2026-11-22T17:13:29.154324-06:00 after 5.019 s (CONNECTED=True); the watch lasted 105 s
    - attempt 1: first request 30.001 s after StartConnection returned; the attempt lasted 5.009 s; 26 requests; held read dropped after 5.001 s
    - attempt 2: first request 95.020 s after StartConnection returned; the attempt lasted 5.009 s; 26 requests; held read dropped after 5.001 s

Longest StartConnection of every run in every scenario: 60.004 s (f61 run 1); SDK acquisition bound: 60 s.


What the tables say:

- A healthy cluster starts in 13 ms (aggregated, direct) and 14 ms (legacy, 25 per-version reads); a real black-hole APIService costs nothing on aggregated discovery (a1, a5: 12 ms, the aggregator answers `/apis` at once with the group marked stale) and 0.38 s on legacy discovery when nothing is held (c0: the real aggregator answers the group's read with 503 in 1 to 2 ms and the plugin retries it twice).
- One hung group version costs one bound: **5.013 s** (c: 5.012 to 5.017, the plugin's client dropped the held read after 5.00 s). **Five hung groups at once cost the same 5.013 s** (d: five held reads, all dropped after 5.00 s). `StartConnection` returned CONNECTED every time; the plugin logs `native discovery partial ... failed_groups=1 groups=hang1.proof.example.com/v1` (Warn).
- A slow index shortens the bound exactly as the plugin says (half of what is left of the 60 s, at most 5 s): index 20 s -> start 25.03 s (bound 5.00 s); index 40 s -> 45.02 s (5.00 s); index 55 s -> 57.52 s (bound 2.49 to 2.50 s); index 57 s -> 58.52 s (1.50 s); index 59 s -> 59.52 s (0.50 s). All CONNECTED, none an error. The bound is not logged by the plugin; it is the time the proxy held the read before the plugin's client dropped it (column "dropped by the plugin after").
- **The edge beyond the bound** (f61: index delayed 61 s): the start fails with `TIMEOUT` after **60.002 to 60.004 s** ("Connecting did not finish within 60 seconds; the plugin's connection timeout setting can raise this limit."); the plugin's client dropped the held `/apis` read after 59.99 s. **A built-in group version that hangs** (h60: `/apis/apps/v1` held 120 s, everything else healthy): the same `TIMEOUT` after **60.001 to 60.002 s**, no catalog, no heal (the plugin logs `connection start failed error_code=TIMEOUT` and `native connection start failed ... duration_ms=60000 outcome=canceled error_class=deadline_exceeded`). Only an extension group's read has the short bound; the index and the built-in groups fail the start at the SDK's 60 s.
- Heal (g): StartConnection did not wait for the heal. The first heal attempt's first request reached the proxy **30.001 to 30.006 s after StartConnection returned**; one attempt costs **5.01 to 5.05 s** (one bound: the held read is dropped after 5.000 to 5.002 s; 26 requests on legacy discovery); the second attempt came 95.02 to 95.07 s after the start returned, i.e. 60 s after the first attempt ended (the schedule 30 s, then 1 min, ...). The plugin logs a Warn `native discovery partial` on every attempt and, at debug level, `native catalog refresh finished ... duration_ms=5029..5066`.
- The start never exceeded the SDK's 60 s bound with the plugin's own discovery in play: the longest successful start was 59.523 s (f59); the four runs that failed returned `TIMEOUT` at 60.001 to 60.004 s, i.e. the SDK's bound (60 s) plus 1 to 4 ms.

## 3. Leg 3: log proof

Every case ran twice per build (a client that does not ask, and one that asks with `omniview.log.replay-markers=1`), one session at a time, on live pods and on pods whose logs do not move. The cases (`logproof` `cases()`): rate5 (tail 1000, 0, 5000, finite), twoc (two containers), quiet, quiet3 (tail 1000, 0, 5000, finite), initc (init container source), crash (current, previous), waiting (the main container has not started), bigtail (10 KB lines: tail 1000 = 10 MB, tail 0, tail 5000), fixed6k and done (logs that have stopped growing: deterministic), partial, byte limits (rate5 4000 B and 64 KiB, bigtail 1 MiB), since_seconds (rate5 30 s, with and without tail), and the Deployment `web` (2 replicas x 2 containers, resource key `k8s:apps/deployments`, tail 1000, 0, 5000).

Per build:

| build | sessions | asking sessions | of them with reply `ReplayMarkers=true` | lines flagged replay (all sessions) | caught-up events (all sessions) | order violations | unknown proto bytes | flagged + events in NO-ASK sessions | per-source verdicts of the accepted sessions |
|---|---|---|---|---|---|---|---|---|---|
| base | 70 | 35 | 0 | 0 | 0 | 0 | 0 | 0 | 0 ok of 0 |
| bump | 70 | 35 | 0 | 0 | 0 | 0 | 0 | 0 | 0 ok of 0 |
| head | 70 | 35 | 35 | 88130 | 48 | 0 | 0 | 0 | 44 ok of 53 |

- BASE (SDK v0.20.0) and BUMP (SDK v0.22.0, no `ReplayCount`): asking is accepted by nobody (`ReplayMarkers=false` in every reply), no line is flagged, no event comes: the frames are the ones of a session that did not ask (compare table 2 below).
- HEAD: every source that opened got exactly one caught-up event, flagged lines equal `kubectl logs --tail=N` of the same container (count and first/last line number inside the range that the two kubectl reads, taken just before and just after the session, allow), no line after its source's event is flagged, no unflagged line comes before it, in all sessions that asked. The per-source table follows. Notes on its rows: (1) the four `*-finite` cases (follow=false) name their one source `pod/` (the finite canonical read leaves the container to the API server), so the tool cannot find the container's kubectl window and prints "source not in kubectl's list"; their facts are right: lines == flagged == kubectl's tail, one event at the end of the stream. Counted twice (one unexpected source `pod/`, one expected `pod/container` that delivered no frame under that name), they and `waiting/main` are the 9 per-source verdicts that are not `ok` in the per-build table above. (2) `waiting/main` never opened (kubectl: `waiting to start: PodInitializing`): 5 `Reconnecting` events and one `StreamError`, no flag, no caught-up event for it, exactly as BASE; the init container of the same pod got its event (0 lines). The plugin logged `failed to count log replay` (ERROR) with `native log operation failed` (WARN) on each of the 6 attempts. (3) the byte-limit rows: the stream ends at the limit and every delivered line, the fragment the limit cut included, is flagged (rate5 limit 4000: 31 lines delivered, 31 flagged, 1 event; bigtail 1 MiB: 105 and 105; rate5 64 KiB: 497 and 497), as the lead's brief expected. (4) the Deployment: one event per source (4 sources), `app` flagged == min(tail, lines) (1000 / 6199 / 5000), `side` 200 == min(tail, 200).

| case | mode | reply markers | source | lines | flagged | caught-up events | lines before first event | flagged after event | kubectl window before/after | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| rate5-t1000 | noask | false | rate5/rate5 | 1012 | 0 | 0 | -1 | 0 | 1000 / 1000 (#11710..#12709) | ok (no markers: nothing flagged, no event) |
| rate5-t1000 | ask | true | rate5/rate5 | 1013 | 1000 | 1 | 1000 | 0 | 1000 / 1000 (#11726..#12725) | ok |
| rate5-t0 | noask | false | rate5/rate5 | 12742 | 0 | 0 | -1 | 0 | 12728 / 12744 (#1..#12744) | ok (no markers: nothing flagged, no event) |
| rate5-t0 | ask | true | rate5/rate5 | 12763 | 12749 | 1 | 12749 | 0 | 12747 / 12764 (#1..#12764) | ok |
| rate5-t5000 | noask | false | rate5/rate5 | 5013 | 0 | 0 | -1 | 0 | 5000 / 5000 (#7781..#12780) | ok (no markers: nothing flagged, no event) |
| rate5-t5000 | ask | true | rate5/rate5 | 5012 | 5000 | 1 | 5000 | 0 | 5000 / 5000 (#7798..#12797) | ok |
| rate5-finite | noask | false | rate5/ | 1000 | 0 | 0 | -1 | 0 | - | source not in kubectl's list of the pod(s) |
| rate5-finite | ask | true | rate5/ | 1000 | 1000 | 1 | 1000 | 0 | - | source not in kubectl's list of the pod(s) |
| twoc-t1000 | noask | false | twoc/a | 1013 | 0 | 0 | -1 | 0 | 1000 / 1000 (#8821..#9820) | ok (no markers: nothing flagged, no event) |
| twoc-t1000 | noask | false | twoc/b | 1002 | 0 | 0 | -1 | 0 | 1000 / 1000 (#874..#1873) | ok (no markers: nothing flagged, no event) |
| twoc-t1000 | ask | true | twoc/a | 1013 | 1000 | 1 | 1000 | 0 | 1000 / 1000 (#8837..#9836) | ok |
| twoc-t1000 | ask | true | twoc/b | 1002 | 1000 | 1 | 1000 | 0 | 1000 / 1000 (#877..#1876) | ok |
| twoc-t0 | noask | false | twoc/a | 9854 | 0 | 0 | -1 | 0 | 9840 / 9855 (#1..#9855) | ok (no markers: nothing flagged, no event) |
| twoc-t0 | noask | false | twoc/b | 1880 | 0 | 0 | -1 | 0 | 1877 / 1880 (#1..#1880) | ok (no markers: nothing flagged, no event) |
| twoc-t0 | ask | true | twoc/a | 9874 | 9861 | 1 | 9861 | 0 | 9859 / 9875 (#1..#9875) | ok |
| twoc-t0 | ask | true | twoc/b | 1884 | 1881 | 1 | 1881 | 0 | 1881 / 1884 (#1..#1884) | ok |
| twoc-t5000 | noask | false | twoc/a | 5013 | 0 | 0 | -1 | 0 | 5000 / 5000 (#4893..#9892) | ok (no markers: nothing flagged, no event) |
| twoc-t5000 | noask | false | twoc/b | 1888 | 0 | 0 | -1 | 0 | 1885 / 1888 (#1..#1888) | ok (no markers: nothing flagged, no event) |
| twoc-t5000 | ask | true | twoc/a | 5013 | 5000 | 1 | 5000 | 0 | 5000 / 5000 (#4910..#9909) | ok |
| twoc-t5000 | ask | true | twoc/b | 1891 | 1888 | 1 | 1888 | 0 | 1888 / 1891 (#1..#1891) | ok |
| quiet-t1000 | noask | false | quiet/quiet | 0 | 0 | 0 | -1 | 0 | 0 / 0 (#-1..#-1) | ok (no markers: nothing flagged, no event) |
| quiet-t1000 | ask | true | quiet/quiet | 0 | 0 | 1 | 0 | 0 | 0 / 0 (#-1..#-1) | ok |
| quiet3-t1000 | noask | false | quiet3/quiet3 | 3 | 0 | 0 | -1 | 0 | 3 / 3 (#1..#3) | ok (no markers: nothing flagged, no event) |
| quiet3-t1000 | ask | true | quiet3/quiet3 | 3 | 3 | 1 | 3 | 0 | 3 / 3 (#1..#3) | ok |
| quiet3-t0 | noask | false | quiet3/quiet3 | 3 | 0 | 0 | -1 | 0 | 3 / 3 (#1..#3) | ok (no markers: nothing flagged, no event) |
| quiet3-t0 | ask | true | quiet3/quiet3 | 3 | 3 | 1 | 3 | 0 | 3 / 3 (#1..#3) | ok |
| quiet3-t5000 | noask | false | quiet3/quiet3 | 3 | 0 | 0 | -1 | 0 | 3 / 3 (#1..#3) | ok (no markers: nothing flagged, no event) |
| quiet3-t5000 | ask | true | quiet3/quiet3 | 3 | 3 | 1 | 3 | 0 | 3 / 3 (#1..#3) | ok |
| quiet3-finite | noask | false | quiet3/ | 3 | 0 | 0 | -1 | 0 | - | source not in kubectl's list of the pod(s) |
| quiet3-finite | ask | true | quiet3/ | 3 | 3 | 1 | 3 | 0 | - | source not in kubectl's list of the pod(s) |
| initc-t1000 | noask | false | initc/init | 50 | 0 | 0 | -1 | 0 | 50 / 50 (#1..#50) | ok (no markers: nothing flagged, no event) |
| initc-t1000 | noask | false | initc/main | 1012 | 0 | 0 | -1 | 0 | 1000 / 1000 (#6045..#7044) | ok (no markers: nothing flagged, no event) |
| initc-t1000 | ask | true | initc/init | 50 | 50 | 1 | 50 | 0 | 50 / 50 (#1..#50) | ok |
| initc-t1000 | ask | true | initc/main | 1012 | 1000 | 1 | 1000 | 0 | 1000 / 1000 (#6061..#7060) | ok |
| crash-t1000 | noask | false | crash/crash | 40 | 0 | 0 | -1 | 0 | 40 / 40 (#1..#40) | ok (no markers: nothing flagged, no event) |
| crash-t1000 | ask | true | crash/crash | 40 | 40 | 1 | 40 | 0 | 40 / 40 (#1..#40) | ok |
| crash-previous | noask | false | crash/crash | 40 | 0 | 0 | -1 | 0 | 40 / 40 (#1..#40) | ok (no markers: nothing flagged, no event) |
| crash-previous | ask | true | crash/crash | 40 | 40 | 1 | 40 | 0 | 40 / 40 (#1..#40) | ok |
| waiting-t1000 | noask | false | waiting/init | 0 | 0 | 0 | -1 | 0 | 0 / 0 (#-1..#-1) | ok (no markers: nothing flagged, no event) |
| waiting-t1000 | noask | false | waiting/main | 0 | 0 | 0 | -1 | 0 | kubectl: kubectl -n proof logs waiting --timestamps -c main --tail=10… | kubectl: kubectl -n proof logs waiting --timestamps -c main --tail=1000: exit status 1: Error from server (BadRequest): container "main" in pod "waiting" is waiting to start: PodInitializing |
| waiting-t1000 | ask | true | waiting/init | 0 | 0 | 1 | 0 | 0 | 0 / 0 (#-1..#-1) | ok |
| waiting-t1000 | ask | true | waiting/main | 0 | 0 | 0 | -1 | 0 | kubectl: kubectl -n proof logs waiting --timestamps -c main --tail=10… | kubectl: kubectl -n proof logs waiting --timestamps -c main --tail=1000: exit status 1: Error from server (BadRequest): container "main" in pod "waiting" is waiting to start: PodInitializing |
| bigtail-t1000 | noask | false | bigtail/bigtail | 1002 | 0 | 0 | -1 | 0 | 1000 / 1000 (#2001..#3000) | ok (no markers: nothing flagged, no event) |
| bigtail-t1000 | ask | true | bigtail/bigtail | 1003 | 1000 | 1 | 1000 | 0 | 1000 / 1000 (#2004..#3003) | ok |
| bigtail-t0 | noask | false | bigtail/bigtail | 3005 | 0 | 0 | -1 | 0 | 3003 / 3006 (#1..#3006) | ok (no markers: nothing flagged, no event) |
| bigtail-t0 | ask | true | bigtail/bigtail | 3009 | 3006 | 1 | 3006 | 0 | 3006 / 3009 (#1..#3009) | ok |
| bigtail-t5000 | noask | false | bigtail/bigtail | 3012 | 0 | 0 | -1 | 0 | 3009 / 3012 (#1..#3012) | ok (no markers: nothing flagged, no event) |
| bigtail-t5000 | ask | true | bigtail/bigtail | 3015 | 3012 | 1 | 3012 | 0 | 3012 / 3015 (#1..#3015) | ok |
| fixed6k-t1000 | noask | false | fixed6k/fixed6k | 1000 | 0 | 0 | -1 | 0 | 1000 / 1000 (#5001..#6000) | ok (no markers: nothing flagged, no event) |
| fixed6k-t1000 | ask | true | fixed6k/fixed6k | 1000 | 1000 | 1 | 1000 | 0 | 1000 / 1000 (#5001..#6000) | ok |
| fixed6k-t0 | noask | false | fixed6k/fixed6k | 6000 | 0 | 0 | -1 | 0 | 6000 / 6000 (#1..#6000) | ok (no markers: nothing flagged, no event) |
| fixed6k-t0 | ask | true | fixed6k/fixed6k | 6000 | 6000 | 1 | 6000 | 0 | 6000 / 6000 (#1..#6000) | ok |
| fixed6k-t5000 | noask | false | fixed6k/fixed6k | 5000 | 0 | 0 | -1 | 0 | 5000 / 5000 (#1001..#6000) | ok (no markers: nothing flagged, no event) |
| fixed6k-t5000 | ask | true | fixed6k/fixed6k | 5000 | 5000 | 1 | 5000 | 0 | 5000 / 5000 (#1001..#6000) | ok |
| fixed6k-finite | noask | false | fixed6k/ | 1000 | 0 | 0 | -1 | 0 | - | source not in kubectl's list of the pod(s) |
| fixed6k-finite | ask | true | fixed6k/ | 1000 | 1000 | 1 | 1000 | 0 | - | source not in kubectl's list of the pod(s) |
| done-t1000 | noask | false | done/done | 50 | 0 | 0 | -1 | 0 | 50 / 50 (#1..#50) | ok (no markers: nothing flagged, no event) |
| done-t1000 | ask | true | done/done | 50 | 50 | 1 | 50 | 0 | 50 / 50 (#1..#50) | ok |
| done-t0 | noask | false | done/done | 50 | 0 | 0 | -1 | 0 | 50 / 50 (#1..#50) | ok (no markers: nothing flagged, no event) |
| done-t0 | ask | true | done/done | 50 | 50 | 1 | 50 | 0 | 50 / 50 (#1..#50) | ok |
| done-finite | noask | false | done/ | 50 | 0 | 0 | -1 | 0 | - | source not in kubectl's list of the pod(s) |
| done-finite | ask | true | done/ | 50 | 50 | 1 | 50 | 0 | - | source not in kubectl's list of the pod(s) |
| partial-t1000 | noask | false | partial/partial | 10 | 0 | 0 | -1 | 0 | 10 / 10 (#1..#10) | ok (no markers: nothing flagged, no event) |
| partial-t1000 | ask | true | partial/partial | 10 | 10 | 1 | 10 | 0 | 10 / 10 (#1..#10) | ok |
| rate5-limit64k | noask | false | rate5/rate5 | 497 | 0 | 0 | -1 | 0 | 497 / 497 (#12708..#13204) | ok (no markers: nothing flagged, no event) |
| rate5-limit64k | ask | true | rate5/rate5 | 497 | 497 | 1 | 497 | 0 | 497 / 497 (#12723..#13219) | ok |
| bigtail-limit1m | noask | false | bigtail/bigtail | 105 | 0 | 0 | -1 | 0 | 105 / 105 (#2058..#2162) | ok (no markers: nothing flagged, no event) |
| bigtail-limit1m | ask | true | bigtail/bigtail | 105 | 105 | 1 | 105 | 0 | 105 / 105 (#2062..#2166) | ok |
| rate5-since30 | noask | false | rate5/rate5 | 162 | 0 | 0 | -1 | 0 | 149 / 149 (#13619..#13767) | ok (no markers: nothing flagged, no event) |
| rate5-since30 | ask | true | rate5/rate5 | 162 | 149 | 1 | 149 | 0 | 149 / 149 (#13634..#13782) | ok |
| rate5-since30-t50 | noask | false | rate5/rate5 | 63 | 0 | 0 | -1 | 0 | 50 / 50 (#13748..#13797) | ok (no markers: nothing flagged, no event) |
| rate5-since30-t50 | ask | true | rate5/rate5 | 62 | 50 | 1 | 50 | 0 | 50 / 50 (#13764..#13813) | ok |
| rate5-limit4000 | noask | false | rate5/rate5 | 31 | 0 | 0 | -1 | 0 | 31 / 31 (#12828..#12) | ok (no markers: nothing flagged, no event) |
| rate5-limit4000 | ask | true | rate5/rate5 | 31 | 31 | 1 | 31 | 0 | 31 / 31 (#12843..#12) | ok |
| web-t1000 | noask | false | web-8c455f76f-97lmf/app | 1012 | 0 | 0 | -1 | 0 | 1000 / 1000 (#5155..#6154) | ok (no markers: nothing flagged, no event) |
| web-t1000 | noask | false | web-8c455f76f-97lmf/side | 200 | 0 | 0 | -1 | 0 | 200 / 200 (#1..#200) | ok (no markers: nothing flagged, no event) |
| web-t1000 | noask | false | web-8c455f76f-qjx8k/app | 1012 | 0 | 0 | -1 | 0 | 1000 / 1000 (#5156..#6155) | ok (no markers: nothing flagged, no event) |
| web-t1000 | noask | false | web-8c455f76f-qjx8k/side | 200 | 0 | 0 | -1 | 0 | 200 / 200 (#1..#200) | ok (no markers: nothing flagged, no event) |
| web-t1000 | ask | true | web-8c455f76f-97lmf/app | 1013 | 1000 | 1 | 1000 | 0 | 1000 / 1000 (#5171..#6170) | ok |
| web-t1000 | ask | true | web-8c455f76f-97lmf/side | 200 | 200 | 1 | 200 | 0 | 200 / 200 (#1..#200) | ok |
| web-t1000 | ask | true | web-8c455f76f-qjx8k/app | 1013 | 1000 | 1 | 1000 | 0 | 1000 / 1000 (#5173..#6172) | ok |
| web-t1000 | ask | true | web-8c455f76f-qjx8k/side | 200 | 200 | 1 | 200 | 0 | 200 / 200 (#1..#200) | ok |
| web-t0 | noask | false | web-8c455f76f-97lmf/app | 6192 | 0 | 0 | -1 | 0 | 6176 / 6192 (#1..#6192) | ok (no markers: nothing flagged, no event) |
| web-t0 | noask | false | web-8c455f76f-97lmf/side | 200 | 0 | 0 | -1 | 0 | 200 / 200 (#1..#200) | ok (no markers: nothing flagged, no event) |
| web-t0 | noask | false | web-8c455f76f-qjx8k/app | 6193 | 0 | 0 | -1 | 0 | 6179 / 6194 (#1..#6194) | ok (no markers: nothing flagged, no event) |
| web-t0 | noask | false | web-8c455f76f-qjx8k/side | 200 | 0 | 0 | -1 | 0 | 200 / 200 (#1..#200) | ok (no markers: nothing flagged, no event) |
| web-t0 | ask | true | web-8c455f76f-97lmf/app | 6212 | 6199 | 1 | 6199 | 0 | 6197 / 6213 (#1..#6213) | ok |
| web-t0 | ask | true | web-8c455f76f-97lmf/side | 200 | 200 | 1 | 200 | 0 | 200 / 200 (#1..#200) | ok |
| web-t0 | ask | true | web-8c455f76f-qjx8k/app | 6213 | 6200 | 1 | 6200 | 0 | 6199 / 6214 (#1..#6214) | ok |
| web-t0 | ask | true | web-8c455f76f-qjx8k/side | 200 | 200 | 1 | 200 | 0 | 200 / 200 (#1..#200) | ok |
| web-t5000 | noask | false | web-8c455f76f-97lmf/app | 5013 | 0 | 0 | -1 | 0 | 5000 / 5000 (#1231..#6230) | ok (no markers: nothing flagged, no event) |
| web-t5000 | noask | false | web-8c455f76f-97lmf/side | 200 | 0 | 0 | -1 | 0 | 200 / 200 (#1..#200) | ok (no markers: nothing flagged, no event) |
| web-t5000 | noask | false | web-8c455f76f-qjx8k/app | 5013 | 0 | 0 | -1 | 0 | 5000 / 5000 (#1233..#6232) | ok (no markers: nothing flagged, no event) |
| web-t5000 | noask | false | web-8c455f76f-qjx8k/side | 200 | 0 | 0 | -1 | 0 | 200 / 200 (#1..#200) | ok (no markers: nothing flagged, no event) |
| web-t5000 | ask | true | web-8c455f76f-97lmf/app | 5014 | 5000 | 1 | 5000 | 0 | 5000 / 5000 (#1250..#6249) | ok |
| web-t5000 | ask | true | web-8c455f76f-97lmf/side | 200 | 200 | 1 | 200 | 0 | 200 / 200 (#1..#200) | ok |
| web-t5000 | ask | true | web-8c455f76f-qjx8k/app | 5014 | 5000 | 1 | 5000 | 0 | 5000 / 5000 (#1251..#6250) | ok |
| web-t5000 | ask | true | web-8c455f76f-qjx8k/side | 200 | 200 | 1 | 200 | 0 | 200 / 200 (#1..#200) | ok |
# uptime at end: 17:18  up 12 days,  9:45, 2 users, load averages: 15.48 13.07 15.14


### Frame comparisons (`compare.sh`, `bin/logdiff`; the session id is the only thing normalised)

| comparison | cases | identical | not identical |
|---|---|---|---|
| no-ask, deterministic sources, in order, reply included: base vs bump | 13 | 13 | - |
| no-ask, deterministic sources, in order, reply included: base vs head | 13 | 13 | - |
| no-ask, deterministic sources, in order, reply included: bump vs head | 13 | 13 | - |
| no-ask, live pods, the lines both runs hold (matched by number), field by field: base vs bump | 19 | 9 | rate5-t1000, rate5-finite, rate5-limit4000, rate5-limit64k, rate5-since30, rate5-since30-t50, twoc-t1000, web-t1000, initc-t1000, bigtail-limit1m |
| no-ask, live pods, the lines both runs hold (matched by number), field by field: base vs head | 19 | 16 | rate5-limit4000, rate5-limit64k, bigtail-limit1m |
| base: ask vs no-ask, deterministic sources, frames in order (reply left out: it echoes the parameter) | 13 | 13 | - |
| base: ask vs no-ask, live pods, overlapping lines | 19 | 16 | rate5-limit4000, rate5-limit64k, bigtail-limit1m |
| bump: ask vs no-ask, deterministic sources, frames in order (reply left out: it echoes the parameter) | 13 | 13 | - |
| bump: ask vs no-ask, live pods, overlapping lines | 19 | 16 | rate5-limit4000, rate5-limit64k, bigtail-limit1m |
| head: ask vs no-ask, deterministic sources, replay markers stripped (caught-up events dropped, replay flag/wire ignored), in order | 13 | 13 | - |
| head: ask vs no-ask, live pods, replay markers stripped, overlapping lines | 19 | 16 | rate5-limit4000, rate5-limit64k, bigtail-limit1m |

- **No-ask frames are identical between BASE and HEAD for every deterministic source** (13 cases: quiet, quiet3 x4, done x3, fixed6k x4, partial; reply included; frames in order, with their kubelet timestamps, labels, content SHA-256 and a SHA-256 of the frame's protobuf bytes), and identical for BASE and BUMP, and for BUMP and HEAD. For the live pods, the lines both runs hold (matched by the number the workload wrote) are identical in all cases whose windows overlap. The not-identical rows of the live-pod tables are not plugin differences: (a) no overlap: a live pod moved between the two recordings (BASE and HEAD ran at the same time, BUMP five minutes later, hence BASE-vs-BUMP has the most rows); (b) the three byte-limit cases: the last line of a limited read is a fragment cut at a byte offset, which is a different place when the window has moved (e.g. `content_len 33 != 100`). Nothing else differs; no frame of a no-ask session carries a replay flag or a caught-up event on any build.
- Asking an older plugin (BASE, BUMP): frames identical to not asking (the create reply differs only by the echoed parameter, left out of that comparison); HEAD asking against HEAD not asking, with the markers stripped: same lines in the same order (so the flag and the event add, remove and reorder nothing).
- `raw/logproof/compare.txt` has every row with its first difference.


## 4. Leg 4: time to first line

20 opens per leg per case, legs interleaved in a rotating order (base-noask, head-noask, head-ask; then head-noask, head-ask, base-noask; ...), one plugin process per build, default plugin log level, `uptime` at the start and end of every case (and per iteration in `raw/ttfl/main/ttfl-*.json`). Machine load average 15 to 22 during this run (shared).


### rate5:1000 (pod rate5, tail 1000), 20 opens per leg

uptime at start: 2026-11-22 17:22:54.089 :: 17:22  up 12 days,  9:50, 2 users, load averages: 21.64 17.00 16.18
uptime at end:   2026-11-22 17:23:10.591 :: 17:23  up 12 days,  9:50, 2 users, load averages: 18.30 16.54 16.04

| leg | metric | n | median ms | min ms | p90 ms | max ms | errors |
|---|---|---|---|---|---|---|---|
| base-noask | create -> reply | 20 | 1.8 | 1.4 | 2.4 | 3.2 | 0 |
| base-noask | create -> first line | 20 | 5.9 | 4.3 | 8.6 | 13.5 | 0 |
| base-noask | create -> first caught-up | 0 | - | - | - | - | 0 |
| head-noask | create -> reply | 20 | 2.0 | 1.5 | 2.6 | 3.3 | 0 |
| head-noask | create -> first line | 20 | 6.2 | 4.8 | 11.2 | 23.8 | 0 |
| head-noask | create -> first caught-up | 0 | - | - | - | - | 0 |
| head-ask | create -> reply | 20 | 1.7 | 1.3 | 2.2 | 3.3 | 0 |
| head-ask | create -> first line | 20 | 22.0 | 17.2 | 29.5 | 34.0 | 0 |
| head-ask | create -> first caught-up | 20 | 37.3 | 31.3 | 48.7 | 53.5 | 0 |

### bigtail:1000 (pod bigtail, tail 1000), 20 opens per leg

uptime at start: 2026-11-22 17:23:10.603 :: 17:23  up 12 days,  9:50, 2 users, load averages: 18.30 16.54 16.04
uptime at end:   2026-11-22 17:23:30.031 :: 17:23  up 12 days,  9:50, 2 users, load averages: 15.50 16.02 15.86

| leg | metric | n | median ms | min ms | p90 ms | max ms | errors |
|---|---|---|---|---|---|---|---|
| base-noask | create -> reply | 20 | 2.0 | 1.7 | 2.3 | 2.9 | 0 |
| base-noask | create -> first line | 20 | 15.1 | 13.6 | 18.9 | 27.0 | 0 |
| base-noask | create -> first caught-up | 0 | - | - | - | - | 0 |
| head-noask | create -> reply | 20 | 2.2 | 1.6 | 2.4 | 2.5 | 0 |
| head-noask | create -> first line | 20 | 15.7 | 13.8 | 19.2 | 25.7 | 0 |
| head-noask | create -> first caught-up | 0 | - | - | - | - | 0 |
| head-ask | create -> reply | 20 | 2.0 | 1.7 | 2.2 | 3.2 | 0 |
| head-ask | create -> first line | 20 | 87.8 | 82.1 | 103.8 | 107.3 | 0 |
| head-ask | create -> first caught-up | 20 | 160.7 | 152.9 | 193.5 | 198.4 | 0 |

### bigtail:0 (pod bigtail, tail 0), 20 opens per leg

uptime at start: 2026-11-22 17:23:30.039 :: 17:23  up 12 days,  9:50, 2 users, load averages: 15.50 16.02 15.86
uptime at end:   2026-11-22 17:23:58.483 :: 17:23  up 12 days,  9:51, 2 users, load averages: 17.99 16.59 16.07

| leg | metric | n | median ms | min ms | p90 ms | max ms | errors |
|---|---|---|---|---|---|---|---|
| base-noask | create -> reply | 20 | 2.2 | 1.5 | 2.5 | 3.2 | 0 |
| base-noask | create -> first line | 20 | 8.3 | 6.4 | 13.0 | 18.1 | 0 |
| base-noask | create -> first caught-up | 0 | - | - | - | - | 0 |
| head-noask | create -> reply | 20 | 2.2 | 1.8 | 2.9 | 3.6 | 0 |
| head-noask | create -> first line | 20 | 8.8 | 6.4 | 12.9 | 15.0 | 0 |
| head-noask | create -> first caught-up | 0 | - | - | - | - | 0 |
| head-ask | create -> reply | 20 | 2.2 | 1.6 | 3.1 | 4.2 | 0 |
| head-ask | create -> first line | 20 | 267.9 | 186.5 | 457.8 | 535.0 | 0 |
| head-ask | create -> first caught-up | 20 | 571.8 | 417.2 | 859.1 | 1102.5 | 0 |

ORPHAN FRAMES on head: 1438

ORPHAN FRAMES on base: 1433


`ORPHAN FRAMES` are frames of already closed sessions that arrive after the close (the harness closes a session as soon as it has what it waits for); equal on both builds (1438, 1433): not a plugin effect.

### The cost of the count

Client alone (client-go `GetLogs`, follow=false, timestamps, same tail; no plugin; 20 reads each; the machine was shared, load average about 15):

```
count read pod=rate5 tail=1000 limitBytes=0 previous=false follow=false timestamps=true, n=20
  bytes=132000 newline-terminated lines=1000 last line unterminated=0
  time to first byte: median 5.5  min 4.0  p90 12.0  max 24.3 ms
  time to end:        median 16.6  min 13.3  p90 19.8  max 36.4 ms
count read pod=bigtail tail=1000 limitBytes=0 previous=false follow=false timestamps=true, n=20
  bytes=10047000 newline-terminated lines=1000 last line unterminated=0
  time to first byte: median 15.2  min 13.5  p90 19.2  max 21.4 ms
  time to end:        median 125.3  min 94.5  p90 146.8  max 174.0 ms
count read pod=bigtail tail=1000 limitBytes=1048576 previous=false follow=false timestamps=true, n=20
  bytes=1048576 newline-terminated lines=104 last line unterminated=1
  time to first byte: median 15.3  min 13.1  p90 16.8  max 20.5 ms
  time to end:        median 24.8  min 20.9  p90 28.4  max 35.8 ms
count read pod=bigtail tail=0 limitBytes=0 previous=false follow=false timestamps=true, n=20
  bytes=34953513 newline-terminated lines=3479 last line unterminated=0
  time to first byte: median 6.0  min 4.4  p90 9.9  max 11.0 ms
  time to end:        median 383.5  min 265.4  p90 435.1  max 504.5 ms
count read pod=fixed6k tail=0 limitBytes=0 previous=false follow=false timestamps=true, n=20
  bytes=804000 newline-terminated lines=6000 last line unterminated=0
  time to first byte: median 5.4  min 4.1  p90 7.7  max 10.7 ms
  time to end:        median 76.5  min 60.9  p90 82.0  max 86.9 ms

```

Inside the plugin (HEAD, debug line `native log replay counted`: lines, bytes, duration of the count, from the log proof run, where HEAD and BASE ran at the same time on a loaded machine):

| case | source | lines counted | bytes read | count ms (plugin's clock) |
|---|---|---|---|---|
| bigtail-limit1m | bigtail/bigtail | 105 | 1048576 | 15 |
| bigtail-t0 | bigtail/bigtail | 3006 | 30201282 | 146 |
| bigtail-t1000 | bigtail/bigtail | 1000 | 10047000 | 62 |
| bigtail-t5000 | bigtail/bigtail | 3012 | 30261564 | 159 |
| crash-previous | crash/crash | 40 | 2320 | 3 |
| crash-t1000 | crash/crash | 40 | 2320 | 2 |
| done-t0 | done/done | 50 | 3100 | 3 |
| done-t1000 | done/done | 50 | 3100 | 3 |
| fixed6k-t0 | fixed6k/fixed6k | 6000 | 804000 | 76 |
| fixed6k-t1000 | fixed6k/fixed6k | 1000 | 134000 | 14 |
| fixed6k-t5000 | fixed6k/fixed6k | 5000 | 670000 | 63 |
| initc-t1000 | initc/init | 50 | 2950 | 5 |
| initc-t1000 | initc/main | 1000 | 59000 | 20 |
| partial-t1000 | partial/partial | 10 | 600 | 3 |
| quiet-t1000 | quiet/quiet | 0 | 0 | 5 |
| quiet3-t0 | quiet3/quiet3 | 3 | 168 | 3 |
| quiet3-t1000 | quiet3/quiet3 | 3 | 168 | 3 |
| quiet3-t5000 | quiet3/quiet3 | 3 | 168 | 3 |
| rate5-limit4000 | rate5/rate5 | 31 | 4000 | 2 |
| rate5-limit64k | rate5/rate5 | 497 | 65536 | 10 |
| rate5-since30 | rate5/rate5 | 149 | 19668 | 8 |
| rate5-since30-t50 | rate5/rate5 | 50 | 6600 | 3 |
| rate5-t0 | rate5/rate5 | 12749 | 1682868 | 323 |
| rate5-t1000 | rate5/rate5 | 1000 | 132000 | 32 |
| rate5-t5000 | rate5/rate5 | 5000 | 660000 | 68 |
| twoc-t0 | twoc/b | 1881 | 250173 | 49 |
| twoc-t0 | twoc/a | 9861 | 1311513 | 210 |
| twoc-t1000 | twoc/a | 1000 | 133000 | 25 |
| twoc-t1000 | twoc/b | 1000 | 133000 | 26 |
| twoc-t5000 | twoc/b | 1888 | 251104 | 38 |
| twoc-t5000 | twoc/a | 5000 | 665000 | 104 |
| waiting-t1000 | waiting/init | 0 | 0 | 2 |
| web-t0 | web-8c455f76f-qjx8k/side | 200 | 11400 | 9 |
| web-t0 | web-8c455f76f-97lmf/side | 200 | 11400 | 9 |
| web-t0 | web-8c455f76f-qjx8k/app | 6200 | 830800 | 127 |
| web-t0 | web-8c455f76f-97lmf/app | 6199 | 830666 | 130 |
| web-t1000 | web-8c455f76f-qjx8k/side | 200 | 11400 | 9 |
| web-t1000 | web-8c455f76f-97lmf/side | 200 | 11400 | 9 |
| web-t1000 | web-8c455f76f-qjx8k/app | 1000 | 134000 | 30 |
| web-t1000 | web-8c455f76f-97lmf/app | 1000 | 134000 | 30 |
| web-t5000 | web-8c455f76f-qjx8k/side | 200 | 11400 | 7 |
| web-t5000 | web-8c455f76f-97lmf/side | 200 | 11400 | 8 |
| web-t5000 | web-8c455f76f-97lmf/app | 5000 | 670000 | 78 |
| web-t5000 | web-8c455f76f-qjx8k/app | 5000 | 670000 | 79 |

counts over the bound / errors:
2026-11-22T23:15:54.400618Z | 2026-11-22T17:15:54.400-0600 [WARN]  kubernetes.runtime: native log operation failed: timestamp=2026-11-22T17:15:54.400596-06:00 plugin_id=kubernetes session_id=S source_id=waiting/main request_id=88865e06-85a9-4088-8a16-5de1f2329
2026-11-22T23:15:54.400670Z | 2026-11-22T17:15:54.400-0600 [ERROR] kubernetes.runtime: failed to count log replay: timestamp=2026-11-22T17:15:54.400606-06:00 plugin_id=kubernetes session_id=S source_id=waiting/main request_id=88865e06-85a9-4088-8a16-5de1f23298
2026-11-22T23:15:55.404590Z | 2026-11-22T17:15:55.404-0600 [WARN]  kubernetes.runtime: native log operation failed: timestamp=2026-11-22T17:15:55.404548-06:00 plugin_id=kubernetes session_id=S source_id=waiting/main request_id=88865e06-85a9-4088-8a16-5de1f2329
2026-11-22T23:15:55.404658Z | 2026-11-22T17:15:55.404-0600 [ERROR] kubernetes.runtime: failed to count log replay: timestamp=2026-11-22T17:15:55.404563-06:00 plugin_id=kubernetes session_id=S source_id=waiting/main request_id=88865e06-85a9-4088-8a16-5de1f23298
2026-11-22T23:15:57.408750Z | 2026-11-22T17:15:57.408-0600 [WARN]  kubernetes.runtime: native log operation failed: timestamp=2026-11-22T17:15:57.40872-06:00 plugin_id=kubernetes session_id=S source_id=waiting/main request_id=88865e06-85a9-4088-8a16-5de1f23298
2026-11-22T23:15:57.408812Z | 2026-11-22T17:15:57.408-0600 [ERROR] kubernetes.runtime: failed to count log replay: timestamp=2026-11-22T17:15:57.408734-06:00 plugin_id=kubernetes session_id=S source_id=waiting/main request_id=88865e06-85a9-4088-8a16-5de1f23298
2026-11-22T23:16:01.413112Z | 2026-11-22T17:16:01.413-0600 [WARN]  kubernetes.runtime: native log operation failed: timestamp=2026-11-22T17:16:01.413085-06:00 plugin_id=kubernetes session_id=S source_id=waiting/main request_id=88865e06-85a9-4088-8a16-5de1f2329
2026-11-22T23:16:01.413189Z | 2026-11-22T17:16:01.413-0600 [ERROR] kubernetes.runtime: failed to count log replay: timestamp=2026-11-22T17:16:01.413097-06:00 plugin_id=kubernetes session_id=S source_id=waiting/main request_id=88865e06-85a9-4088-8a16-5de1f23298
2026-11-22T23:16:09.417955Z | 2026-11-22T17:16:09.417-0600 [WARN]  kubernetes.runtime: native log operation failed: timestamp=2026-11-22T17:16:09.417914-06:00 plugin_id=kubernetes session_id=S source_id=waiting/main request_id=88865e06-85a9-4088-8a16-5de1f2329
2026-11-22T23:16:09.418082Z | 2026-11-22T17:16:09.417-0600 [ERROR] kubernetes.runtime: failed to count log replay: timestamp=2026-11-22T17:16:09.417934-06:00 plugin_id=kubernetes session_id=S source_id=waiting/main request_id=88865e06-85a9-4088-8a16-5de1f23298
2026-11-22T23:16:25.421923Z | 2026-11-22T17:16:25.421-0600 [WARN]  kubernetes.runtime: native log operation failed: timestamp=2026-11-22T17:16:25.421892-06:00 plugin_id=kubernetes session_id=S source_id=waiting/main request_id=88865e06-85a9-4088-8a16-5de1f2329
2026-11-22T23:16:25.421992Z | 2026-11-22T17:16:25.421-0600 [ERROR] kubernetes.runtime: failed to count log replay: timestamp=2026-11-22T17:16:25.421907-06:00 plugin_id=kubernetes session_id=S source_id=waiting/main request_id=88865e06-85a9-4088-8a16-5de1f23298


Reading: the count costs one more read of the tail: about +16 ms for the host's default (rate5, 1000 lines of 100 bytes: first line 22.0 ms against 5.9 ms), +72 ms for the 10 MB tail (bigtail tail 1000: 87.8 ms against 15.1 ms, 10,047,000 bytes read by the count), and +260 ms for the whole 35 MB current log of bigtail with no tail (267.9 ms against 8.3 ms; count 146 to 383 ms). The first caught-up event follows the first line by the time it takes to deliver the replay (37 ms, 161 ms, 572 ms).

## 5. Item 5: what could invalidate the proof, checked

(`checks.sh`, raw output `raw/checks.txt`.)

- **follow=false against follow=true, same options (tailLines, timestamps=true)**: the kubelet returns the same bytes, in every case on a log that does not move: fixed6k tail 1000, 0, 5000, done, quiet3 tail 5000, partial. The count of a follow=false read is the number of lines the follow=true stream delivers first.
- **limitBytes cutting a line**: follow=false and follow=true both stop at exactly limitBytes bytes, in the middle of a line (fixed6k limit 4000: 4000 bytes = 29 complete lines + 1 fragment; bigtail limit 1 MiB: 104 + 1), and the two reads are byte-equal. The SDK's reader delivers the fragment as a line; HEAD counted it (rate5 limit 4000: 31 lines counted and flagged) and the caught-up event came.
- **An incomplete (unterminated) last record**: containerd holds a write without a line feed back (the `partial` pod: 10 lines and a fragment; `kubectl logs` with and without `-f` return the 10 lines, 600 bytes, and never the fragment), so on kind neither read ever sees an unterminated record: the count (10) equals the lines delivered (10). The path where the kubelet itself ends a read in the middle of a record is not reachable here.
- **No tail**: with `tail_lines=0` the stream delivers the whole current log file and so does the count (HEAD does not clamp it as the finite read does: rate5 12,749 counted, 12,749 flagged). The cost grows with the log (see leg 4).
- **A moving log between the count and the open**: on live pods the flagged count equals the kubectl window, never more (the stream window moves forward by the few lines written in between; their number is still the counted one).
- **kubelet log rotation**: the cluster was configured so that nothing rotates (`containerLogMaxSize 100Mi`; the default rotates a 15 MB log within 10 s and `kubectl logs` then serves only the new file). The rotation-between-count-and-open case of the SDK README was NOT run.
- **previous of a crash-looping container** returned, when `checks.sh` ran, a 115-byte body with no line feed (the kubelet's text for a previous instance it no longer has) for both follow modes: `countbench` reports 0 newline-terminated lines and one unterminated record, and the stream delivers that text once. At that commit the plugin counted 0; since then it counts the last record of a previous instance's stream (`mutation-run-2.txt`, M18 and M19), so it counts 1 here. During the log proof (17:15) `previous` returned the 40 real lines on every build and HEAD flagged 40 with one event.

## 6. What was NOT run

- A rotation of the kubelet's log between the count and the open (cluster configured not to rotate).
- A count over its 5 s bound (HEAD's `native log replay not counted within its bound`): no read on this cluster is slow enough; the largest count took 0.4 s (35 MB).
- Windows/Linux, EKS/GKE, the host itself: the harness is the host's client code path, not the host.
- Pods with more than 20 sources, a deployment fan-out beyond the 2x2 `web` leg, a pod that restarts during a session (reopen: count again), `UpdateSessionOptions` (source disable/enable).
- A rotation-free cluster only: see the first bullet. (The edge beyond 60 s and a hung built-in group WERE run: f61 and h60 above.)
- The BASE and BUMP binaries were not run through the start-time scenarios (only BUMP was, as briefed); HEAD was not run through them either (its start path is BUMP's).

## 7. Things that surprised me

- The machine is shared and was busy (load average 5 to 34): millisecond numbers move by tens of percent between minutes; interleaving (leg 4) and the bounded-wait nature of leg 2 (seconds) are what to trust. The log-proof session timings (not a benchmark) were taken with HEAD and BASE running at the same time.
- Aggregated discovery (what every current kube-apiserver answers) makes the whole hung-group question moot on a real cluster: 12 ms with five black-hole APIServices (a5). The bound matters for legacy discovery only, and a hung per-version read cannot be had from a real aggregator (it answers 503 at once after its availability check flagged the backend), only at a proxy.
- `rate5` with tail 0 and the 35 MB `bigtail` with tail 0 show the cost that matters for HEAD: the count reads the whole log before the source opens (first line +260 ms on 35 MB; it would be the 5 s bound on a log of about 10 MB/s x 5 s = 50 MB at this link speed, then `replayUnknown`).
- Each heal attempt logs a Warn (`native discovery partial`); the `waiting` pod makes HEAD log 12 lines (6 WARN, 6 ERROR) over the 31 s of reconnects.
