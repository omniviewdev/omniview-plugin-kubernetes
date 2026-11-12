# Profiling the plugin

Counters and spans are described in [diagnostics.md](diagnostics.md). This page covers pprof profiling of the plugin process, and the two benchmarks that reproduce its hot paths without a cluster.

Steps are marked **verified** when they were executed while writing this page, and **needs a running host** when they depend on the desktop app and were checked against the source only.

## Profiling a running plugin

### 1. Enable the profiler (needs a running host)

Set `developer.plugin_pprof_enabled` to `true` in the host settings (Settings, Developer), or from the CLI:

```bash
omniview-dev settings set-many --workspace W --values '{"developer.plugin_pprof_enabled":true}'
```

The host reads the setting once when it starts, so restart the host or workspace afterwards. The host then starts the plugin with `OMNIVIEW_PLUGIN_PPROF_ENABLED=true`. Only the exact value `true` enables it.

With that variable set, the plugin:

- starts the SDK profiling server on `127.0.0.1` with a random port,
- samples contended mutexes (`runtime.SetMutexProfileFraction(10)`) and blocking events (`runtime.SetBlockProfileRate(100000)`, one sample per 100 µs blocked), so the `mutex` and `block` profiles are populated,
- tags CPU profile samples with the `phase` and `connection` labels described below.

Without the variable none of this is active: the mutex and block profiles stay empty, labels are not applied, and there is no listener.

### 2. Find the port (needs a running host)

The port changes on every plugin start. Read it from the pprof popover in the host footer, or from the host's plugin profiling status. As an alternative, list the plugin's listening socket:

```bash
lsof -nP -iTCP -sTCP:LISTEN -p <plugin pid>
```

### 3. Request restrictions (verified in the SDK source `pkg/profiling/service.go`)

- The `Host` header must be exactly `127.0.0.1:<port>`. `localhost` is rejected with 403.
- Only `GET` is accepted. `HEAD` and other methods are rejected.
- A request with an `Origin` header is rejected with 403, so browser pages cannot use it.
- `profile?seconds=` is capped at 120 and `trace?seconds=` at 15.

### 4. Capture (needs a running host; endpoint set verified in the SDK source)

Use the port from step 2 as `PORT`. Start the capture, then use the cluster in the app while it runs.

```bash
# CPU, 15 s
curl --fail -o cpu.pprof "http://127.0.0.1:PORT/debug/pprof/profile?seconds=15"
# Heap in use, and allocations since start
curl --fail -o heap.pprof   "http://127.0.0.1:PORT/debug/pprof/heap"
curl --fail -o allocs.pprof "http://127.0.0.1:PORT/debug/pprof/allocs"
# Goroutines: grouped, and every stack
curl --fail -o goroutine.pprof "http://127.0.0.1:PORT/debug/pprof/goroutine"
curl --fail -o goroutines.txt  "http://127.0.0.1:PORT/debug/pprof/goroutine?debug=2"
# Lock contention and blocking (populated because profiling is enabled)
curl --fail -o mutex.pprof "http://127.0.0.1:PORT/debug/pprof/mutex"
curl --fail -o block.pprof "http://127.0.0.1:PORT/debug/pprof/block"
# Execution trace, 5 s
curl --fail -o trace.out "http://127.0.0.1:PORT/debug/pprof/trace?seconds=5"
```

Read them with:

```bash
go tool pprof -top cpu.pprof
go tool pprof -sample_index=alloc_space -top allocs.pprof
go tool pprof -sample_index=inuse_space -top heap.pprof
go tool pprof -top mutex.pprof
go tool pprof -top block.pprof
go tool trace trace.out
```

Profile a development build (`go build -o bin/plugin ./pkg`): release builds use `-trimpath -s -w`, which keeps function names but drops source listings.

### 5. Split a CPU profile by phase (label mechanics verified; capture needs a running host)

Samples carry these labels while the plugin does the named work:

| `phase` | Covers |
|---|---|
| `client_build` | Building the Kubernetes clients for a connection (`LoadResourceKubeClients`) |
| `connect` | Connection start and catalog acquisition |
| `source` | A resource source session: informer attach, snapshot delivery, live loop |
| `convert` | Converting one informer object into the record the SDK emitter sends (nested in `source`, so it replaces the `source` label on those samples) |
| `metrics_scan` | A native metrics query |

`connection` is the connection ID and is bounded by the number of kubeconfig contexts. Resource names are never used as label values.

```bash
go tool pprof -tags cpu.pprof                      # which labels and values exist
go tool pprof -top -tagfocus=phase=convert cpu.pprof
go tool pprof -top -tagfocus=phase=source cpu.pprof
go tool pprof -top -tagfocus=connection=my-context cpu.pprof
go tool pprof -top -tagignore=phase=source cpu.pprof
```

Work done by SDK goroutines (for example the gRPC send loop) is not labeled; it appears without a `phase`.

## Deterministic benchmarks (verified)

Neither needs a cluster, a host or the network.

### Connection and source profile

`BenchmarkNativeClusterProfile` runs the real provider, SDK controller, clients and informer source against an isolated TLS API with a synthetic inventory. It is skipped unless `-native-profile` is passed. The harness turns the phase labels on, so `-tagfocus` works on its CPU profile, in addition to its own `native-profile-phase` label.

```bash
GOWORK=off go test ./pkg/plugin/resource -run '^$' -bench BenchmarkNativeClusterProfile -benchtime=1x \
  -cpuprofile cpu.out -memprofile mem.out -mutexprofile mutex.out -blockprofile block.out \
  -args -native-profile -native-profile-pods=1000 -native-profile-namespaces=20 -native-profile-get-latency=10ms
```

Add `-native-profile-retained-heap=heap.out` for a heap profile taken at the end of the snapshot (requires `-benchtime=1x`). Read the results with the commands above, for example:

```bash
go tool pprof -tags cpu.out
go tool pprof -top -tagfocus=phase=convert cpu.out
go tool pprof -sample_index=alloc_space -top mem.out
```

The flags are defined in `pkg/plugin/resource/cluster_profile_benchmark_test.go`.

### Snapshot and change encoding

`BenchmarkSourceEncoding` measures 256 representative Pods (the shared fixture of `base_benchmark_test.go`, with managed fields) at the point where the plugin hands records to the SDK emitter. `Convert` is the plugin's conversion to the SDK `Value`/record form, `Encode` is what the emitter does with it (size, protobuf form, marshaled frame), `Total` is both. `Snapshot256` is one full snapshot page; `Changes256` is 256 single-change live events.

```bash
GOWORK=off go test ./pkg/plugin/resource/resourcers -run '^$' -bench BenchmarkSourceEncoding -benchmem \
  -benchtime=30x -cpuprofile cpu.out -memprofile mem.out
go tool pprof -sample_index=alloc_space -top mem.out
```

Use `-benchtime=1x` for a quick smoke run. The benchmark reports `ns/op`, `B/op`, `allocs/op`, `records/op` and, for the encode and total cases, `wire-bytes/op`. Run it before and after a change and compare with `benchstat`.

Example, Apple M5 Max, 30 iterations (one iteration is 256 records):

| Case | ns/op | B/op | allocs/op | wire-bytes/op |
|---|---|---|---|---|
| `Snapshot256/Convert` | 20.3 ms | 23.9 MB | 60,160 | |
| `Snapshot256/Encode` | 34.4 ms | 14.3 MB | 259,845 | 1,489,193 |
| `Snapshot256/Total` | 56.4 ms | 38.3 MB | 320,006 | 1,489,193 |
| `Changes256/Encode` | 40.5 ms | 14.5 MB | 262,912 | 1,500,160 |
| `Changes256/Total` | 59.9 ms | 38.4 MB | 323,072 | 1,500,160 |

## Cluster-backed load

`hack/kind-lab/lab.py` creates and seeds a kind cluster for a realistic load (`create`, `seed`, `churn`); select its kubeconfig in the plugin settings and profile the running plugin as above. This path needs Docker and a running host and was not run for this page.
