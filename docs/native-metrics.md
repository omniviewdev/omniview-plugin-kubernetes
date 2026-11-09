# Kubernetes-owned metrics

The Kubernetes plugin implements the SDK's optional finite resource metrics capability. The host selects the active Kubernetes connection, admits actual resource-v2 references and routes, and owns polling, shared in-flight work, result reuse and observation publication. The provider executes bounded reads only. It never schedules background metric collection or fetches resource bodies to repair missing context.

## Catalog and units

For the logical native source, `GetResourceMetricsCatalog(ctx, request)` returns these Pod and Node descriptors, filtered by `request.ResourceKey`:

| Metric ID | Unit | Measurement | Shapes |
| --- | --- | --- | --- |
| `kubernetes.pod.cpu.usage` | `cores` | Sum of container CPU usage averaged over the source measurement window | `current` |
| `kubernetes.pod.memory.working_set` | `bytes` | Sum of container working-set memory | `current` |
| `kubernetes.node.cpu.usage` | `cores` | Node CPU usage averaged over the source measurement window | `current` |
| `kubernetes.node.memory.working_set` | `bytes` | Node working-set memory | `current` |

CPU quantities retain sub-millicore precision. One core is `1`, not `1000`. Memory is physical bytes, not formatted MiB. Neither descriptor is utilization, a resource request, a limit, capacity, or a per-container series. UI capacity requires real resource requests/limits obtained through the owning resource view.

The selected source is `MetricSourceRef{PluginID: "kubernetes", ConnectionID: <selected configured connection>, Native: true}`. Native sources have empty `DatasourceKind` and `DatasourceUID`; metrics-server remains an internal Kubernetes implementation detail, not a datasource identity. `PluginID` is the plugin's manifest/routing ID, not the legacy metric provider ID `k8s-metrics`. Native source plugin and connection must match the resource owner. Other resource keys return an empty finite catalog. This does not remove genuine legacy Node, cluster or Prometheus operations.

The catalog advertises `MaxSampleAge: 2 * time.Minute` (120,000,000,000 nanoseconds in JSON). A current sample becomes delayed after its actual `ObservedAt` plus two minutes. This source policy does not expire host cache entries, prescribe polling, or classify historical range points. A zero policy means freshness is unknown; it does not mean immediate expiry.

## Owner catalog and external mappings

`GetMetricOwnerCatalog` is Kubernetes' optional owner-metadata capability. It returns 26 definitions: 24 Pod definitions and two native-only Node definitions. The host discovers definitions from the resource owner, not from Grafana. Grafana remains a generic PromQL executor. Catalog discovery does not open a Kubernetes metrics client or query a datasource.

The Pod CPU and memory IDs above retain their canonical IDs and native capability. Their mapped PromQL recipes support `current` and `range`; the native metrics-server implementation still supports only `current`. The other 22 Pod recipes use these IDs:

| IDs, each prefixed with `kubernetes.pod.` | Unit |
| --- | --- |
| `memory_rss`, `memory_cache`, `memory_total_usage`, `filesystem_usage` | `bytes` |
| `network_receive`, `network_transmit`, `disk_read`, `disk_write` | `bytes_per_second` |
| `cpu_throttling` | `percent` |
| `restarts`, `processes`, `threads` | `count` |
| `cpu_requests`, `cpu_limits` | `cores` |
| `memory_requests`, `memory_limits` | `bytes` |
| `network_receive_packets`, `network_transmit_packets`, `network_receive_drops`, `network_transmit_drops`, `network_receive_errors`, `network_transmit_errors` | `count_per_second` |

These recipes preserve the cAdvisor and kube-state-metrics aggregation, exporter units, rate windows, network-interface deduplication, and zero-denominator throttle guard. All mapped Pod results identify `cluster`, `namespace`, and `pod`. There are no unprefixed finite aliases. Genuine legacy `prom_*` consumers keep their separate IDs and execution paths.

The catalog declares public scope key `cluster`, named **Cluster label value**. This is the actual exporter label value, not the connection ID or resource authority. Required scope derives from required scope bindings on the effective mappings. Namespace and Pod bindings explicitly approve `/metadata/namespace` and `/metadata/name`. The host projects those scalars from admitted observed resource bodies through the owning schema's body guard; Grafana reads only host-provided public projections. Neither provider adds per-object GETs or reconstructs authority from row names. The two native-only Node definitions have no PromQL recipe, resource projections, or invented history.

The built-in fixed-query Pod recipes declare `RangeReuse` for their pointwise range evaluations. This owner hint does not authorize caching: the executing provider must separately opt in. Edited or overridden definitions do not inherit the declaration. Native metrics-server remains current-only; no history or range-to-current equivalence is inferred from it.


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

The callbacks are registered through `PluginOpts.GetMetricOwnerCatalogFunc`, `PluginOpts.ResourceMetricsCatalogFunc`, and `PluginOpts.QueryResourcesFunc`. Catalog units and shapes are authoritative. Old processes without finite support fail explicitly; no per-object legacy query adapter exists. Native range queries return unsupported at catalog/SDK admission, or explicit `unsupported` results when invoking the provider callback directly. No local polling history is represented as source history.

## Result meaning and provenance

Every accepted target/metric pair receives its original correlation token and explicit status. Results are joined by exact namespace/name and admitted source connection, never position or Pod name alone. Extra scanned Pods are discarded. Duplicate source Pod/container identities are `ambiguous`. Missing quantities, containers, timestamps or measurement windows are `missing`, with no numeric value. Negative/nonfinite quantities are invalid measurements. An explicit measured zero is valid; absence is never zero.

`ObservedAt` is the metrics-server `PodMetrics.timestamp`. `Window` is its `PodMetrics.window`, carried as a Go duration (nanoseconds in JSON). Neither value is the request completion, receipt, or evaluation time. An old source timestamp stays old through refresh and cache reuse; neither operation renews its freshness deadline. Missing source timestamps never receive a replacement timestamp. Current results do not contain invented chart points.

`IdentityScope` is source provenance, not an aggregation dimension:

- `incarnation`: the source actually returned a UID matching the admitted reference.
- `name`: source attribution is namespace/name only. Metrics-server commonly omits UID.

A returned nonempty UID that differs from the admitted incarnation produces `invalid_context`, not a sample. Host/SDK incarnation and connection-generation fences prevent cache or in-flight delivery to a different admitted resource incarnation. Those fences do **not** prove that a name-only backend sample was measured from the newly created Pod. This finite contract does not carry authoritative creation time, and the provider does not add per-Pod GETs. Do not claim UID-bound sample attribution or historical continuity when `IdentityScope` is `name`.

`Complete` is separate from result status. A fully scanned namespace can prove a target `missing`. An interrupted/budget-limited scan cannot: unseen targets remain `failed`, `Complete` is false, and warnings explain incomplete collection. Already decoded target samples can survive budget-only truncation with their original source times. Invalid pages and authorization failures clear measurements from the affected namespace. Forbidden/unauthorized access is `denied`; missing metrics-server or failed API reads is `failed`, never a fallback to Prometheus or a fabricated zero. No API error body, connection secret or credential is copied into result messages.

## Bounds and lifecycle

One execution accepts at most 256 unique resource targets and two distinct metric IDs. Pod namespaces share the execution's scan budget; there is no separate namespace admission cap. Tokens are unique and contain 1–256 bytes. Duplicate namespace/name targets are rejected. Unknown metric IDs receive `unsupported` within the metric-count bound. Source/route mismatch, malformed references/ranges and invalid native names fail before collection.

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

Each Pod query rotates the starting namespace within its source generation. Repeated identical batches therefore do not always exclude the same trailing namespaces when the shared scan budget is exhausted. Retirement resets this cursor. It stores no samples and schedules no polling.

Clients reuse the Kubernetes connection's actual authenticated transport, including custom authentication strategies. Finite requests use their caller context, not `context.Background()`. A source lane has its own lifecycle cancellation and opaque generation-specific cache key. Connection retirement cancels its in-flight reads, evicts its clients and fences late publication. Reconnect cannot reuse the retired lane. Legacy Prometheus/Node caches remain independent and retire through the same registered connection callback.

Failed native scan endpoints have a 30-second negative availability window per
source generation, resource type, and namespace (Node scans use their cluster
endpoint). Scrolling to different row tokens does not bypass this window. Cache
hits do not extend it. At most 256 failures are retained per lane; expired entries
are removed on subsequent failures. No metric samples are cached by the provider.
Caller cancellation and scan-budget exhaustion do not create negative entries.
Expiry or connection retirement permits a new read; absent metrics remain failed
or denied, never zero or proven missing.

## Metric views

- Tables use base-ui `MetricCell`: a fixed-density bar beside a compact value. Pod limits/requests and Node capacity come from their owning resources, in the catalog's physical units. Unknown bounds remain unknown.
- Panels use `MetricPanel.value` and the shared segmented Area / Line / Bars / Value controls. Chart spacing and control styling belong to base-ui.
- One current observation covers all selected current-capable metrics; one range observation covers history. Details show both samples without inventing historical expiry.
- Range progress uses the shared partial/updating states. An absent pair in an incomplete frame stays pending, not missing. Charts use `maxGapMs` from the displayed step and preserve source null gaps. Compatible displayed history remains visible when progress would discard loaded samples; its domain and step are not relabeled as the pending request.
- Identity chips use the admitted reference and owner-approved cluster scope, not series labels or source connection IDs. Owner scope survives external provider switches; native sources omit external owner scope.
- Provider selection keeps `inherit`, `native`, and `external` routing separate from display preferences. Inherited selections show the resolved provider's icon without changing the saved mode.
- Linked Pod and Node drawers expose the same Metrics view as their table-row drawers.
- Current Pod requests and limits are neutral references: dashed **Request**, dotted **Limit**, with source **Current resource configuration**. Limit markers do not imply an alarm. Tables retain owner-supplied usage coloring at 0%, 70%, and 90% of a complete positive effective limit; missing, partial, or unlimited limits do not supply those thresholds. CPU references use cores and memory references use bytes; formatting never changes these inputs.

Effective resources come from the admitted Pod spec, not an additional resource read or a historical metric query. The same owner calculation supplies table cells and metric cards. It follows the [Kubernetes v1.35 resource helpers](https://github.com/kubernetes/kubernetes/blob/v1.35.0/staging/src/k8s.io/component-helpers/resource/helpers.go): sum regular containers plus restartable init containers, compare with each sequential init peak including earlier restartable init containers, apply Pod-level overrides per resource and request/limit field, then add overhead. Overhead contributes to requests, including otherwise absent requests; it contributes to limits only when a positive limit exists. Resize status is not represented as current spec configuration.

Missing container requests contribute zero to that scheduling sum, but all-unset requests without overhead remain unknown in the UI. An incomplete request configuration is explicitly labeled **Request (partial)** and is not used as a capacity bound. A real zero request remains visible. The view does not recreate admission defaults from limits; it reads the admitted requests. Missing, malformed, nonfinite or negative quantities never become fabricated zero values.

The v1.35 aggregation helper can return a partial limit sum. That sum is not a complete Pod cap: [kubelet resource configuration](https://github.com/kubernetes/kubernetes/blob/v1.35.0/pkg/kubelet/cm/helpers_linux.go) checks whether CPU and memory limits are declared. The UI conservatively omits the limit reference and bound if any regular/init container lacks a positive limit, unless a positive Pod-level limit supplies the cap. Zero limits, including Pod-level zero, mean unlimited and are omitted. Current object changes update references without refetching metric history; these overlays do not claim to show configuration at each historical sample.

Panel presentation maps and table cell callbacks are private Kubernetes UI composition, not public SDK APIs. Shared metrics components receive only typed bounds, references and optional thresholds; they do not inspect Kubernetes kinds or object paths. Node capacity remains an explicit positive bound from the current Node object. Existing shared table batching still owns all visible rows and selected metrics; references add no per-row network reads.

Tables consume the runtime's headless `useTableMetricObservation` hook. The runtime
publishes mounted metric targets after 120 milliseconds without target changes,
deduplicates per-cell registrations, pauses hidden-document collection, and indexes
results by admitted host token and metric ID. A background refresh does not restart
loading animations for settled cells;
unavailable values render a static gap. Ordinary resource rows retain decoded
body identity across sparse source updates. Tables share one tooltip popup and
one row-action menu; action lists and dependency subscriptions are prepared only
for the selected menu trigger, with its admitted row context.

Kubernetes retains source preferences, current-capable column selection, headers,
Pod/Node physical bounds, and rendering. The shared batching hook contains no
Kubernetes IDs or table-framework dependency. Native endpoint failure cooldowns
remain in the Kubernetes provider, not in this frontend hook or the Go SDK.

Publish the runtime release containing `useTableMetricObservation` and its matching
Vite-plugin shim before shipping this consumer. Then update published consumer
dependency pins to that actual release. A managed source build verifies the local
contract, not availability in an older published runtime.

## Real local prerequisite

Use [`hack/kind-lab/README.md`](../hack/kind-lab/README.md) for explicit installation and read-only verification of pinned metrics-server in the dedicated local Kind lab. Setup is opt-in, modifies no ambient kubeconfig, and creates no fake exporter or synthetic metric samples. Backend verification is not proof of SDK/host/UI sharing; integrated proof must additionally record host executions, provider RPCs and actual namespace LISTs.
