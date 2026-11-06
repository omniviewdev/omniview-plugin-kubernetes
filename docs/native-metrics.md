# Native Pod metrics

The Kubernetes plugin implements the SDK's optional finite resource metrics capability. The host selects the active Kubernetes connection, admits actual resource-v2 references and routes, and owns polling, shared in-flight work, result reuse and observation publication. The provider executes bounded reads only. It never schedules background metric collection or fetches resource bodies to repair missing context.

## Catalog and units

`GetResourceMetricsCatalog(ctx, "k8s:/pods")` returns these descriptors:

| Metric ID | Unit | Measurement | Shapes |
| --- | --- | --- | --- |
| `kubernetes.pod.cpu.usage` | `cores` | Sum of container CPU usage averaged over the source measurement window | `current` |
| `kubernetes.pod.memory.working_set` | `bytes` | Sum of container working-set memory | `current` |

CPU quantities retain sub-millicore precision. One core is `1`, not `1000`. Memory is physical bytes, not formatted MiB. Neither descriptor is utilization, a resource request, a limit, capacity, or a per-container series. UI capacity requires real resource requests/limits obtained through the owning resource view.

The selected source is `MetricSourceRef{PluginID: "kubernetes", ConnectionID: <selected configured connection>, DatasourceKind: "metrics-server", DatasourceUID: ""}`. `PluginID` is the plugin's manifest/routing ID, not the legacy metric provider ID `k8s-metrics`. Other resource keys return an empty finite catalog. This does not remove genuine legacy Node, cluster or Prometheus operations.

The catalog advertises `MaxSampleAge: 2 * time.Minute` (120,000,000,000 nanoseconds in JSON). A current sample becomes delayed after its actual `ObservedAt` plus two minutes. This source policy does not expire host cache entries, prescribe polling, or classify historical range points. A zero policy means freshness is unknown; it does not mean immediate expiry.

## API migration

Native Pod callers must replace legacy `cpu_usage`/`memory_usage` requests with the finite IDs above and use `QueryResources` through the host coordinator. CPU changes from legacy millicores to physical cores. The old Pod-native descriptors, empty-ID metrics-server LIST expansion, per-Pod GET helper and receipt-time response builder are removed. A Pod legacy request containing non-Prometheus metric IDs fails with `UNSUPPORTED`; there is no compatibility alias, automatic unit guessing or per-resource fallback.

The finite regression cases replace the retired Pod response-builder tests with physical-unit aggregation, source-time/window retention, missing-versus-zero, incarnation provenance, exact namespace matching, bounded unpaginated scans and retirement cancellation cases. Genuine legacy Node `cpu_usage`/`memory_usage`, Pod `prom_*` and cluster/namespace Prometheus requests remain unchanged.

## Finite query example

Use actual references and routes from admitted resource observations. Do not create authority IDs, reconstruct a reference from a row name, pass resource bodies, or use caller tokens as cache identities. The following example assumes `admittedPodReference`, `admittedPodRoute` and `selectedSource` came from the host admission/source-resolution path:

```go
query := metric.ResourceMetricsQuery{
    Source: selectedSource,
    Targets: []metric.ResourceMetricTarget{{
        Token: "visible-row-7", // Correlation only; no authority.
        Reference: admittedPodReference,
        Route: admittedPodRoute,
    }},
    MetricIDs: []string{
        "kubernetes.pod.cpu.usage",
        "kubernetes.pod.memory.working_set",
    },
    Shape: "current", // No StartTime, EndTime or Step for current.
}
response, err := finiteProvider.QueryResources(callerPluginContext, query)
```

`finiteProvider` is the SDK `FiniteQueryProvider`. In production the host coordinator invokes it through the SDK transport, not from an additional UI scheduler. `callerPluginContext.Context` must be non-nil and cancellable; `Connection` contains the selected source credentials only. The SDK keeps target admission leases and selected connection generation valid throughout dispatch. The provider checks selected source/route equality and native reference shape again; it does not grant authority from the request itself.

The callback is registered through `PluginOpts.ResourceMetricsCatalogFunc` and `PluginOpts.QueryResourcesFunc`. Catalog units and shapes are authoritative. Old processes without finite support fail explicitly; no per-object legacy query adapter exists. Native range queries return unsupported at catalog/SDK admission, or explicit `unsupported` results when invoking the provider callback directly. No local polling history is represented as source history.

## Result meaning and provenance

Every accepted target/metric pair receives its original correlation token and explicit status. Results are joined by exact namespace/name and admitted source connection, never position or Pod name alone. Extra scanned Pods are discarded. Duplicate source Pod/container identities are `ambiguous`. Missing quantities, containers, timestamps or measurement windows are `missing`, with no numeric value. Negative/nonfinite quantities are invalid measurements. An explicit measured zero is valid; absence is never zero.

`ObservedAt` is the metrics-server `PodMetrics.timestamp`. `Window` is its `PodMetrics.window`, carried as a Go duration (nanoseconds in JSON). Neither value is the request completion, receipt, or evaluation time. An old source timestamp stays old through refresh and cache reuse; neither operation renews its freshness deadline. Missing source timestamps never receive a replacement timestamp. Current results do not contain invented chart points.

`IdentityScope` is source provenance, not an aggregation dimension:

- `incarnation`: the source actually returned a UID matching the admitted reference.
- `name`: source attribution is namespace/name only. Metrics-server commonly omits UID.

A returned nonempty UID that differs from the admitted incarnation produces `invalid_context`, not a sample. Host/SDK incarnation and connection-generation fences prevent cache or in-flight delivery to a different admitted resource incarnation. Those fences do **not** prove that a name-only backend sample was measured from the newly created Pod. This finite contract does not carry authoritative creation time, and the provider does not add per-Pod GETs. Do not claim UID-bound sample attribution or historical continuity when `IdentityScope` is `name`.

`Complete` is separate from result status. A fully scanned namespace can prove a target `missing`. An interrupted/budget-limited scan cannot: unseen targets remain `failed`, `Complete` is false, and warnings explain incomplete collection. Already decoded target samples can survive budget-only truncation with their original source times. Invalid pages and authorization failures clear measurements from the affected namespace. Forbidden/unauthorized access is `denied`; missing metrics-server or failed API reads is `failed`, never a fallback to Prometheus or a fabricated zero. No API error body, connection secret or credential is copied into result messages.

## Bounds and lifecycle

One execution accepts at most 256 unique Pods, two distinct metric IDs and 64 namespaces. Tokens are unique and contain 1–256 bytes. Duplicate namespace/name targets are rejected. Unknown metric IDs receive `unsupported` within the metric-count bound. Source/route mismatch, malformed references/ranges and invalid native names fail before collection.

Budgets are shared across all namespaces and continuation pages in one execution:

| Budget | Limit |
| --- | --- |
| Decoded response bytes | 8 MiB |
| Scanned metric objects | 20,000 |
| API pages | 64 |
| Execution deadline | 15 seconds, or earlier caller cancellation |
| Retained source connection lanes | 128; disconnected lanes retire |
| Authenticated client idle TTL | 10 minutes |

Targets are grouped by namespace. The provider performs namespace LISTs and streams one object at a time, filtering exact requested identities. It requests `limit=1000` but **does not assume metrics-server implements pagination**. It follows `continue` only when the server returns it, and rejects repeated/oversized continuation tokens. An unpaginated namespace is still bounded by decoded byte and scanned-object budgets. A namespace can cost a full inventory scan even for one selected Pod; these bounds are not constant-cost or throughput claims. There are no per-Pod GET fallbacks and no target chunker that repeats the same namespace scan inside one execution.

Clients reuse the Kubernetes connection's actual authenticated transport, including custom authentication strategies. Finite requests use their caller context, not `context.Background()`. A source lane has its own lifecycle cancellation and opaque generation-specific cache key. Connection retirement cancels its in-flight reads, evicts its clients and fences late publication. Reconnect cannot reuse the retired lane. Legacy Prometheus/Node caches remain independent and retire through the same registered connection callback.

## Real local prerequisite

Use [`hack/kind-lab/README.md`](../hack/kind-lab/README.md) for explicit installation and read-only verification of pinned metrics-server in the dedicated local Kind lab. Setup is opt-in, modifies no ambient kubeconfig, and creates no fake exporter or synthetic metric samples. Backend verification is not proof of SDK/host/UI sharing; integrated proof must additionally record host executions, provider RPCs and actual namespace LISTs.
