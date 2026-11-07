# Plugin diagnostics

The plugin reports a fixed set of measurements through plugin-sdk diagnostics (`pkg/diag`). The host pulls them and labels them with the plugin ID; they appear in the Performance views, captures and comparison.

| Metric | Kind | Attributes |
|---|---|---|
| `omniview.plugin.self.api.calls` | counter | `operation` (read, watch, write, delete, other), `outcome` (ok, client_error, throttled, server_error, failed) |
| `omniview.plugin.self.api.duration` | histogram (s) | `operation` (not recorded for watch) |
| `omniview.plugin.self.watch.streams` | gauge | `state` = open |
| `omniview.plugin.self.connection.checks` | counter | `state` (connected, unauthorized, forbidden, not_found, error, timeout, unavailable, failed, unknown) |
| `omniview.plugin.self.portforward.sessions` | counter | `state` (started, failed, ended) |

Attribute values come from these closed sets. Never record cluster, namespace, resource or path names, queries or error text. The plugin has no watch event queue of its own; open watch streams are reported instead. API calls are counted at the HTTP transport of the resource and legacy client bundles.
