# Plugin diagnostics

The plugin reports a fixed set of measurements through plugin-sdk diagnostics (`pkg/diag`). The host pulls them and labels them with the plugin ID; they appear in the Performance views, captures and comparison.

| Metric | Kind | Attributes |
|---|---|---|
| `omniview.plugin.self.api.calls` | counter | `operation` (read, watch, write, delete, other), `outcome` (ok, client_error, throttled, server_error, failed) |
| `omniview.plugin.self.api.duration` | histogram (s) | `operation` (not recorded for watch) |
| `omniview.plugin.self.watch.streams` | gauge | `state` = open |
| `omniview.plugin.self.connection.checks` | counter | `state` (connected, unauthorized, forbidden, not_found, error, timeout, unavailable, failed, unknown) |
| `omniview.plugin.self.portforward.sessions` | counter | `state` (started, failed, ended) |
| `omniview.plugin.self.native_scan.api_calls` | counter | `operation` (namespace, node) |
| `omniview.plugin.self.native_scan.pages` | counter | `operation` (namespace, node) |
| `omniview.plugin.self.native_scan.objects` | counter | `operation` (namespace, node) |
| `omniview.plugin.self.native_scan.bytes` | counter (bytes) | `operation` (namespace, node) |
| `omniview.plugin.self.native_scan.scans` | counter | `outcome` (ok, denied, budget, canceled, timeout, failed) |
| `omniview.plugin.self.native_scan.cancellations` | counter | `reason` (caller, deadline, retired) |
| `omniview.plugin.self.auth.token_refreshes` | counter | `outcome` (success, failure, canceled, other) |
| `omniview.plugin.self.client.builds` | counter | `operation` (detect, rest_config, clientset, dynamic, discovery, complete, other), `outcome` (success, failure, canceled, other) |
| `omniview.plugin.self.informer.sources` | gauge | none |
| `omniview.plugin.self.source.sync.duration` | histogram (s) | `outcome` (success, failure, canceled, other) |
| `omniview.plugin.self.catalog.refreshes` | counter | `outcome` (success, failure, canceled, other) |
| `omniview.plugin.self.logs.watch.restarts` | counter | `reason` (watch_create_failed, watch_closed, watch_closed_empty, watch_error_event, other) |

Attribute values come from these closed sets. Never record cluster, namespace, resource or path names, queries or error text. Resource sources use a bounded live-change queue; this metric set reports open watch streams, not queue occupancy. API calls are counted at the HTTP transport of the resource and legacy client bundles.

## Initial resource inventory

Informer initial adds are accumulated by namespace/name until every source
handler has synchronized. They retain pointers to informer-owned objects rather
than copying bodies into the live-change queue. Initial inventories larger than
4,096 objects therefore do not overflow that queue merely by loading.

The 4,096-event limit still applies to live adds, updates, and deletes, including
changes arriving during initial synchronization or snapshot delivery. Overflow
still resets the source rather than publishing an incomplete snapshot. Initial
delivery remains best-effort, not a point-in-time Kubernetes snapshot.

## Native metric scans

A native metrics query reads PodMetrics (one list per namespace) or NodeMetrics (one list) from the cluster's metrics API. The host times that provider call as a whole; the `native_scan` counters show what it cost, so a change to how scans are issued can be judged by counter deltas instead of inferred from latency. All six are cumulative since the plugin process started.

| Counter | Counts |
|---|---|
| `api_calls` | List requests issued, including ones that failed or were canceled. `operation=namespace` is one namespace's PodMetrics list; `node` is the NodeMetrics list. These requests also appear in `api.calls` (`operation=read`), mixed with every other read. |
| `pages` | List pages that decoded and validated. `api_calls` minus `pages` is requests that produced no usable page. |
| `objects` | Metric objects decoded against the 20,000-object budget, including objects on a page that later failed validation or hit the budget. |
| `bytes` | Response bytes read against the 8 MiB budget, including bytes of a page that later failed. An error response body is read by the Kubernetes client, not by the scan, and is not counted. |
| `scans` | Finished scans, one per list sequence including its continuation pages. `ok`; `denied` (HTTP 401 or 403); `budget` (the 64-page, 20,000-object or 8 MiB budget stopped it, so unseen targets are not proven missing); `canceled`; `timeout`; `failed` (anything else, including an invalid page). A scan refused by an exhausted page budget before any request counts as `budget` with no `api_calls`. |
| `cancellations` | Queries that ended without delivering because the caller canceled (`caller`), a deadline expired (`deadline`: the caller's, or the 15 s scan timeout) or the source generation was retired (`retired`). Counted once per query and independently of `scans`: a retirement can discard a query whose scans all finished `ok`. |

Every series exists at zero from the moment the provider starts, so a capture that begins before the first scan, denial, budget stop or cancellation still has a start value for each counter. Zero means that event has not happened since this process started; an absent series means the plugin predates the instrument or the host could not read it. A plugin restart changes the process start time, and a capture or comparison across it is reported as a reset rather than as a drop to zero.

Attribute values are the sets listed above. A namespace, Pod or node name, a continuation token, a URL or an error message is never a label.

## Singleton namespace selection

When a namespace group has exactly one admitted Pod target, the native collector
adds `fieldSelector=metadata.name=<name>` to its LIST, including continuation
requests. Groups with multiple targets keep one unfiltered namespace LIST.
This does not add per-target requests. An aggregated metrics API may ignore the
selector; client-side identity checks, streaming validation, cancellation, and
all page/object/byte budgets still apply.

### Real 1,000-Pod comparison

An isolated Kind lab with ten workers and one control plane supplied 1,000
Running application Pods across 20 namespaces. Metrics-server v0.8.0 returned
genuine CPU and memory usage for all 1,000, plus 30 system Pods. Readiness probes
were unstable: the inventory observation recorded 367/1,000 Ready, and seed
commands timed out waiting for Deployment availability. This is not a healthy
1,000-Ready-Pod or a 20,000-Pod result.

Both private captures used `native1000-fixed-viewport3x4-120s`: 45 seconds idle
on Dashboard, then three Pod-table returns with four 800px scrolls per return
inside a 120-second capture. Fixed dwell was 2 seconds after return and 1.2
seconds after scrolling. Pending cells were not treated as zero or missing.
The candidate used a bounded native browser locator after the browser helper
timed out in an earlier attempt; action count, dwell, viewport and inventory
were unchanged. These driver timings are not render-latency measurements.

Baseline: `0c3397a506fc1f9cb918ac927bca843b`.
Candidate: `6a36557c1384820c62cbc31298c07463`.
The existing `diagnostics compare` reported compatible, valid measurements.
Both captures had complete collection coverage without errors, drops or gaps.
The host session was unchanged, and the plugin was rebuilt/restarted between
builds. Source provenance was `unknown`; comparison warned that revision alone
was not a complete source fingerprint.

| Observation | Baseline | Singleton selection |
|---|---:|---:|
| Provider queries, successful / error | 13 / 1 | 16 / 1 |
| Native API calls | 276 | 284 |
| Validated pages | 276 | 283 |
| Decoded objects | 13,800 | 6,310 |
| Response-body bytes | 4,694,594 | 2,161,316 |
| Plugin-reported caller cancellations | 0 | 1 |
| Host-wide reader/provider cancellation requests | 5 / 5 | 2 / 2 |
| Native scans, ok / canceled | 276 / 0 | 283 / 1 |
| Successful provider-query mean, ms | 74.46 | 84.32 |
| Plugin CPU time, seconds | 9.30 | 9.27 |
| Mean plugin RSS, bytes | 452,260,713 | 528,688,850 |
| Mean finite cache, bytes | 61,855 | 62,441 |
| Mean finite snapshots, bytes | 12,576 | 22,588 |
| End-of-window finite cache / snapshots, bytes | 38,524 / 38,980 | 37,306 / 37,656 |

The measured win is less collector work: 54.3% fewer objects and 54.0% fewer
response-body bytes in this workload. Request count did not improve; successful
provider-query latency and mean RSS increased. CPU was effectively unchanged.
These observations do not establish a latency, CPU, retained-memory or
metrics-server-internal scan-complexity improvement.
Host cancellation requests and plugin-reported canceled queries are different
events. A request does not prove that a provider stopped; neither series is a
cancellation-efficiency claim.

Earlier candidate captures are not comparison evidence: one workload stopped
after a browser navigation timeout; another completed its actions but diagnostics
marked the capture reset. Neither was substituted for the complete repeat.
