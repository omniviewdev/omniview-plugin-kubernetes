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

Attribute values come from these closed sets. Never record cluster, namespace, resource or path names, queries or error text. The plugin has no watch event queue of its own; open watch streams are reported instead. API calls are counted at the HTTP transport of the resource and legacy client bundles.

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
