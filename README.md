<p align="center">
  <img src="https://raw.githubusercontent.com/kubernetes/kubernetes/master/logo/logo.svg" width="100" alt="Kubernetes" />
</p>

<h1 align="center">Kubernetes Plugin for Omniview</h1>

<p align="center">
  <strong>A full-featured Kubernetes management experience, built natively into Omniview.</strong>
</p>

<p align="center">
  <a href="https://omniview.dev"><img src="https://img.shields.io/badge/omniview-plugin-326CE5?style=flat-square&logo=kubernetes&logoColor=white" alt="Omniview Plugin" /></a>
  <img src="https://img.shields.io/badge/version-0.7.1-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/license-Apache--2.0-green?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/category-cloud-326CE5?style=flat-square" alt="Category" />
</p>

---

Browse, inspect, edit, and manage Kubernetes clusters without leaving Omniview. The Kubernetes plugin provides real-time resource tables, an integrated terminal, log streaming, port forwarding, Helm chart management, cluster metrics, and full YAML editing — all from a single, unified interface.

Resource icons come from the upstream [Kubernetes Icons Set](https://github.com/kubernetes/community/tree/aeee117fa02e25b68298999d699fb45bdc91acb7/icons), bundled under Apache-2.0. Source attribution and license live in `ui/src/icons/kubernetes/NOTICE` and `LICENSE`. The plugin registers one `ResourceIconSetV1` at `omniview/resource/icons`; both sidebar layouts and the host search palette reuse it. Kubernetes API versions share artwork within the same native API group and kind; unknown resources use the host fallback. Custom API groups cannot impersonate native kinds.

Native artwork is adapted to monochrome resource glyphs without blue badges and uses inherited `currentColor` in every theme. Trusted bundled SVG geometry is imported inline, so sidebar and search icons need no image requests or cross-origin asset URLs. Sanitized assets contain no scripts, embedded HTML, external references, or style URLs; regression tests enforce the geometry and attribute allowlists. Modification details remain in `NOTICE`.

## Local audit evidence fixture

`hack/history-audit.mjs` creates a separate, randomly named local kind sandbox.
It does not connect Omniview history, provide historical reads, or resolve the
blocked production query/evaluator gates.

Requirements: Node.js 26.13.0, `kubectl` compatible with Kubernetes 1.32, kind
**v0.27.0**, and a running local Docker engine using a Unix-socket Docker context.
Unset `DOCKER_HOST` and `DOCKER_CONTEXT`; remote Docker endpoints are refused.
Docker must permit bind mounts from the chosen directory. The node image is
`kindest/node:v1.32.2@sha256:f226345927d7e348497136874b6d207e0b32cc52154ad8323129352923a3142f`,
published for amd64 and arm64 in the
[kind v0.27.0 release](https://github.com/kubernetes-sigs/kind/releases/tag/v0.27.0).
Initial setup may download this image and kind's standard system images.
No fixture workload or external application image is needed.

Run from this repository. Choose an absolute, canonical path whose final directory
does **not** exist; do not use a symlinked parent (`/tmp` is symlinked on macOS).
For example, use a new directory below your real home directory:

```bash
SANDBOX="$HOME/omniview-history-audit-smoke"
node hack/history-audit.mjs create "$SANDBOX"
node hack/history-audit.mjs exercise "$SANDBOX"
node hack/history-audit.mjs inspect "$SANDBOX"
node hack/history-audit.mjs delete "$SANDBOX"
node --test hack/history-audit.test.mjs
```

Creation prints the generated name, private kubeconfig path, and explicit context.
Every cluster operation uses that kubeconfig/context, never the user's kubeconfig
or current cluster. Existing directories/clusters are never adopted. Ownership
checks require the exact kind label, sandbox host mount, and recorded container ID.
The private directory contains credentials: do not upload or commit it.

Exercise runs once per fresh sandbox. It performs ConfigMap create, patch, server
dry-run, RBAC-denied create, delete, and recreate, and asserts distinct incarnation
UIDs. It also creates a core Event, a namespaced custom resource with an explicit
CRD, and a status-subresource patch. Synthetic Secret and TokenReview probes check
the metadata-only boundary. CRD creation itself is metadata-only.

The mounted `audit/audit.jsonl` contains actual API-server audit events. The policy
captures RequestResponse only for fixture-namespace ConfigMap, Event, and Sample
writes. Secret, authentication, authorization, other namespaces, and other resources
remain metadata-only. `RequestReceived` is omitted. Inspect rejects malformed JSONL,
unexpected RequestReceived events, and bodies outside the allowlist; its evidence
lists audit IDs, stages, HTTP outcomes, request URIs (including dry-run), and UIDs.
Compare completed ConfigMap create UIDs with `exercise.json`; look for a 403 denied
request, a `dryRun=All` URI, and the Sample status patch. Synthetic unit-test audit
records are not real-cluster evidence.

Subprocess deadlines, output caps, and a 24 MiB inspection limit bound local work.
The audit log rotates at 20 MiB with one backup; inspect reads only the active file,
so run it promptly after exercise. This fixture does not prove durable retention,
watch ingestion, historical authorization, numeric query safety, or host history.
An interrupted create retains its sandbox and any partial cluster for explicit
cleanup. Run `delete` with the same directory; it refuses unknown/replaced containers
and retains evidence. A failure before a container exists leaves only local files.
After deletion, archive desired evidence, then remove the private directory yourself.

## Highlights

- **70+ resource types** across every major Kubernetes API group, with automatic discovery of Custom Resource Definitions
- **Real-time sync** via Kubernetes informers — resources update live as your cluster changes
- **Integrated terminal** — exec into any pod container, with intelligent shell detection for distroless images
- **Log streaming** — tail container logs with follow mode, timestamps, and multi-container support
- **Port forwarding** — forward pod ports to your local machine in one click
- **Helm management** — browse charts, install releases, manage repositories, and upgrade deployments
- **Cluster dashboard** — health overview, live CPU/memory metrics, workload summaries, and event feeds
- **YAML editor** — Monaco-powered editor with schema validation for creating and editing resources
- **CIS benchmarks** — built-in security compliance scoring for your clusters

## Capabilities

| Capability | Description |
|---|---|
| **Resource** | Browse, create, edit, and delete any Kubernetes resource |
| **Exec** | Open an interactive shell in pod or node containers |
| **Logs** | Stream and inspect container logs with filtering |
| **Networking** | Port-forward from pods to localhost |
| **Metrics** | CPU, memory, network, and disk metrics from metrics-server and Prometheus |
| **UI** | Custom tables, sidebars, dashboards, and dialogs |

## Supported Resources

<details>
<summary><strong>Core API</strong> <code>v1</code></summary>

Pod, Service, Namespace, Node, ConfigMap, Secret, PersistentVolume, PersistentVolumeClaim, ServiceAccount, Endpoints, Event, LimitRange, ResourceQuota, ReplicationController, PodTemplate, ComponentStatus

</details>

<details>
<summary><strong>Workloads</strong> <code>apps/v1</code> <code>batch/v1</code></summary>

Deployment, StatefulSet, DaemonSet, ReplicaSet, ControllerRevision, Job, CronJob

</details>

<details>
<summary><strong>Networking</strong> <code>networking.k8s.io/v1</code></summary>

Ingress, IngressClass, NetworkPolicy

</details>

<details>
<summary><strong>RBAC</strong> <code>rbac.authorization.k8s.io/v1</code></summary>

Role, ClusterRole, RoleBinding, ClusterRoleBinding

</details>

<details>
<summary><strong>Storage</strong> <code>storage.k8s.io/v1</code></summary>

StorageClass, VolumeAttachment, CSIDriver, CSINode, CSIStorageCapacity

</details>

<details>
<summary><strong>Policy &amp; Scheduling</strong></summary>

PodDisruptionBudget, PriorityClass, HorizontalPodAutoscaler (v1, v2, v2beta2)

</details>

<details>
<summary><strong>Admission, Auth &amp; Discovery</strong></summary>

MutatingWebhookConfiguration, ValidatingWebhookConfiguration, ValidatingAdmissionPolicy, TokenRequest, TokenReview, SubjectAccessReview, EndpointSlice, Lease, FlowSchema, PriorityLevelConfiguration

</details>

<details>
<summary><strong>Extensions</strong></summary>

CustomResourceDefinition, APIService, RuntimeClass, CertificateSigningRequest

</details>

<details>
<summary><strong>Helm</strong> <code>helm/v1</code></summary>

Chart, Release, Repository

</details>

## Feature Overview

### Resource Management

Every resource type gets a dedicated, sortable table with:

- **Global search** across all visible columns
- **Namespace filtering** shared across resource views per connection
- **Column visibility** controls with persistent preferences
- **Resizable columns** with saved widths
- **Dynamic label/annotation columns** — promote any label or annotation to a first-class column
- **Inline create** — open a YAML editor pre-populated with a template for the resource kind
- **Row actions** — click any row to open a detail sidebar with tabs for overview, YAML, events, and more

### Scoped Command Search

Requires Omniview 0.7.4 or later in the compatible 0.7.x cohort for the shared search and resource-icon runtime contracts.

Cmd/Ctrl-K opens Omniview's single global search surface, including on Kubernetes pages. Type a connection name and press Tab to scope it, then scope a resource type and resource. Enter opens the selected destination or existing action. The sidebar's **Find in this connection** control opens that same surface with a visible connection chip.

Kubernetes routes automatically scope global search to the active connection only, including on Pod and other resource lists. Deeper scopes require explicit Tab selection or an explicit `openGlobalSearch` scope.

Empty-input Backspace selects the final chip; another Backspace removes it. Removing a parent also removes dependent scopes and restores the parent search. Resource results show namespaces and retain UID identity so replaced objects cannot inherit stale actions.

Search reuses the sidebar's destinations and eight connection-scoped recent resource types. **Open list matching …** transfers text into the resource table without changing its namespace, node/controller, or other structured filters. Search scans at most the first 200 objects and reports incomplete results; use the list for broader filtering.

Disconnected connections require explicit connection. Authentication, permission, loading, and source failures remain visible. Logs, container choices, and destructive-action confirmations use the same action inventory as resource menus and drawers, even when no table is mounted.

Resource scopes acquire native live-update subscriptions even when no table is open. Failed acquisition keeps current results visible and offers **Retry live updates**; closing or removing scopes releases their subscriptions. Event bursts preserve rows and selection, including updates received during an in-flight read.

Search and resource views share the runtime's `resourceQueryKeys` snapshots. Query refinements reuse resource data for 15 seconds and readiness for 2 seconds. Action execution still reads and validates the current object instead of trusting the discovery snapshot. A deleted or replaced object is an object failure, not a reconnect suggestion.

### Detail Sidebars

Click any resource row to open a rich sidebar panel with contextual information:

| Resource | Sidebar Highlights |
|---|---|
| **Pod** | Container statuses, ports, volumes, environment, probes, resource requests/limits, live metrics graphs |
| **Deployment / StatefulSet / DaemonSet** | Replica status, rollout progress, selector details |
| **Service** | Port mappings, endpoint resolution |
| **Ingress** | Rule table with host, path, and backend mapping |
| **Job / CronJob** | Completion status, schedule, parallelism |
| **Node** | System info, capacity, images, topology, conditions, live metrics |
| **Namespace** | Resource quotas, pod counts, events |
| **ConfigMap / Secret** | Key-value viewer |
| **PV / PVC** | Binding status, storage details, access modes |

All sidebars include a **YAML editor** tab with diff view and schema-validated editing.

### Integrated Terminal

Exec into any running container directly from the resource table. The plugin handles:

- Multi-container pods with container selection
- Intelligent shell detection (`bash` > `sh` > `ash`)
- Distroless image fallback with debug containers
- Node-level shell access via ephemeral debug pods
- Terminal resize support
- SPDY and WebSocket protocol fallback

### Log Viewer

Stream container logs with full control:

- **Follow mode** for real-time tailing
- **Previous container** logs for crash debugging
- **Tail lines** and time-based filtering
- **Multi-container** log merging with timestamps
- Support for init, sidecar, and ephemeral containers

### Port Forwarding

Forward pod ports to your local machine:

- Configurable local and remote port mapping
- Active connection management
- Automatic cleanup on disconnect

### Helm Integration

Full Helm workflow without leaving Omniview:

- **Charts** — browse available charts from configured repositories
- **Releases** — view installed releases with status, chart version, and revision history
- **Repositories** — add, remove, and refresh chart repositories
- **Install** — install new releases with a YAML values editor and dry-run preview
- **Upgrade** — upgrade existing releases to new chart versions

### Cluster Dashboard

A dedicated dashboard view per cluster with:

- **Health banner** — at-a-glance cluster status
- **Resource gauges** — visual CPU, memory, and pod utilization
- **Workload summary** — running, pending, and failed pod counts
- **Live metrics** — CPU, memory, network, and disk usage over time (requires metrics-server or Prometheus)
- **Event feed** — real-time cluster events
- **CIS benchmarks** — security compliance scoring against CIS Kubernetes benchmarks

### Metrics

The plugin supports two metrics backends:

| Source | Data |
|---|---|
| **metrics-server** | Pod and node CPU/memory usage |
| **Prometheus** | Time-series metrics: CPU throttle rate, memory working set, network I/O, disk throughput, IOPS, filesystem usage, OOM kills, restart counts, probe latency, and more |

Metrics are displayed in the dashboard, node sidebars, and pod sidebars as interactive time-series graphs.

## Installation

Install directly from the Omniview plugin marketplace:

```
Omniview > Settings > Plugins > Browse > Kubernetes
```

Or install via the Omniview CLI:

```sh
omniview plugin install kubernetes
```

## Configuration

### Cluster Connections

The plugin automatically discovers clusters from your `~/.kube/config` file. You can also:

- Add clusters manually with custom kubeconfig paths
- Configure per-cluster display preferences (name, color, avatar)
- Set namespace restrictions per connection
- Configure node shell image and command overrides

### Prometheus Integration

To enable advanced metrics, configure a Prometheus endpoint in the cluster settings. The plugin will query Prometheus for time-series data and display it alongside metrics-server data.

## Development

Resource-toolbar Create, search, filter and settings controls should consistently request `size="sm"` and rely on the shared density scale rather than fixed pixel heights. The host supplies shared `@omniviewdev/base-ui`, so shared styling fixes reach the plugin through the host's library release.

Resource tables set horizontal cell padding on the table root so header checkboxes, body checkboxes, and loading skeletons share the same inset. Keep the 30px row height and zero vertical cell padding scoped to the body; the header retains the shared library's height and interactions. The shared `@omniviewdev/base-ui` DataTable owns sticky selection and action column behavior.

### Invocation SDK contract

The backend consumes the published SDK pinned in `go.mod`. Restart streams emit `ready` only after the native patch succeeds and the rollout watch is established. Native failures return through the SDK classifier; unsupported stream actions return typed `UNSUPPORTED` errors. An open failure does not roll back a Kubernetes mutation already committed before watch establishment.

These action semantics require a compatible host/runtime cohort. Coordinate changes with [the host invocation contract](https://github.com/omniviewdev/omniview/issues/83); source integration does not publish a plugin release.

Resource watch streams acknowledge actual SDK listener registration before the host admits connections. Build the plugin and host from the same reviewed SDK cohort; the host rejects streams without that acknowledgement.

### Settings and shared dependency migration

Rebuild both the backend and UI when upgrading to this release. Older plugin
archives are not compatible with the host's current shared dependency contract:
the host shares React 19 and `@omniviewdev/base-ui`, not MUI, Emotion, or the
legacy `@omniviewdev/ui` package.

Settings validation uses the SDK's single structured
`Validator func(interface{}) settings.ValidationResult` callback. Kubernetes
currently registers no custom validators; host-managed settings use the SDK's
standard validation and draft-validation RPC. Do not add an error-returning
validator or a separate `ValidateValue` callback.

The plugin manifest schema has no minimum-host-version field. Keep the host,
backend SDK, runtime, and Vite plugin on the coordinated release cohort below
rather than adding unsupported manifest fields.

### Prerequisites

- Go 1.25+
- Node.js 26.13.0
- pnpm 12.14.0 (pinned by `ui/package.json`)

Registry installs retain pnpm's 24-hour release-age protection. Only coordinated
`@omniviewdev/*` packages are exempted; linked source worktrees resolve locally.
The current UI cohort is `@omniviewdev/base-ui` 0.7.1 and
`@omniviewdev/editors` 6.0.1, paired with host/runtime/Vite plugin 0.7.4 and Go SDK v0.7.1.

### Building

```sh
# Build the backend and UI (Make forces GOWORK=off)
make build

# Build the UI
cd ui && pnpm install && pnpm build
```

`make package` always builds into `ui/dist` before archiving its assets, even
when the environment contains a workspace-owned Vite output directory. Direct
workspace UI builds continue to honor `OMNIVIEW_BUILD_OUTPUT_DIRECTORY`.

### Tests

```sh
GOWORK=off GOFLAGS= go test ./... -count=1
node --test hack/cluster-config.test.mjs
cd ui && pnpm test
```

UI persistence tests use the test document's real JSDOM storage, including on
Node versions that also expose process-global Web Storage.

### Frontend lint contract

ESLint 10 retains type-aware typescript-eslint checks through the JavaScript
TypeScript 6 API (`typescript` aliases `@typescript/typescript6`), while `tsc`
uses the native TypeScript 7 compiler. Do not suppress unsupported-version warnings.
React checks map explicitly to `@eslint-react`; import and accessibility checks
use `import-x` and `jsx-a11y-x`. Current React Hooks/compiler diagnostics cover
compiled sources without enabling a broader React preset.

React Compiler owns value and component memoization. The obsolete react-perf
allocation heuristic is not retained; it would recommend manual memoization and
legacy `sx` workarounds in compiler-optimized code. Correctness and compiler lints
remain enabled. The local nested-component adapter preserves `allowAsProps: true`
for table render callbacks; the JSX text check retains unescaped-entity diagnostics.
TypeScript handles duplicate/undefined JSX props, string refs, removed `isMounted`,
and invalid class render return types. Existing prop-types/display-name allowances
remain unchanged.

Run local rule regressions from the plugin root:

```sh
node --test ui/scripts/eslint/*.test.mjs
```


### Isolated workspace development

Select this plugin in an Omniview feature workspace and start its host with the
host-owned `omniview-dev workspace up` command. The workspace owns package/SDK
links, plugin generations, Vite ports and rebuilds. Use `workspace paths` for the
resolved state root; never infer it from a custom directory or copy production
plugin executables into it.

`make install` delegates the actual source transaction to the live host:

```sh
OMNIVIEW_WORKSPACE_FILE="$FEATURE/workspace.json" \
OMNIVIEW_STATE_DIR="$RESOLVED_STATE_ROOT" \
OMNIVIEW_DEV_CLI="$ABSOLUTE_OMNIVIEW_DEV_CLI" make install
```

All three values are required. No production fallback, direct state-tree copy,
independent build/install runner or `installui` shortcut remains. The canonical
host validates the selected source, builds with its verified SDK and returns the
operation result. UI edits use the managed Vite feedback loop.

Optional local tools need their own explicit assignments when used concurrently:

```sh
make storybook STORYBOOK_PORT=26061
make cluster CLUSTER_NAME=my-feature CLUSTER_HTTP_PORT=28080 \
  CLUSTER_HTTPS_PORT=28443 CLUSTER_KUBECONFIG="$FEATURE/.local/kubeconfig"
```

The kind ports bind loopback; the explicit kubeconfig avoids changing the human
current context. Existing clusters are checked against the requested ingress
ports before reuse; changing those ports requires deliberate deletion/recreation
or a different cluster name. `KIND_EXPERIMENTAL_PROVIDER` defaults to `docker`;
set it to `podman` or `nerdctl` to use the same provider for kind and port inspection.
Generated configurations are published atomically. Cluster creation/seeding is a
separate deliberate operation, not a workspace-start prerequisite or permission
to use a production cluster.


### Project Structure

```
.
├── pkg/                    # Go backend
│   ├── resourcers/         # Resource CRUD implementations
│   ├── exec/               # Terminal exec handlers
│   ├── logs/               # Log streaming
│   ├── portforward/        # Port forwarding
│   ├── metrics/            # Metrics collection
│   └── helm/               # Helm integration
├── ui/                     # React frontend
│   └── src/
│       ├── components/
│       │   ├── kubernetes/ # Resource tables, sidebars, actions
│       │   ├── helm/       # Helm UI components
│       │   └── shared/     # Reusable components
│       ├── pages/          # Route pages (dashboard, clusters, resources)
│       ├── hooks/          # Custom React hooks
│       └── utils/          # Utilities
├── plugin.yaml             # Plugin manifest
└── plugin.json             # Plugin metadata & component registry
```

### Releasing

Commit matching versions in `plugin.yaml`, `plugin.json`, `.package/plugin.yaml`
and `ui/package.json` before creating a `vX.Y.Z` tag (or dispatching the release
workflow with `X.Y.Z`).
The release workflow checks those committed values; it never pushes version
changes back to `main`. The Go module and UI lockfile must resolve published
dependencies without a sibling checkout or workspace replacements. Local
`go.work` files are not release inputs: development SDK selection belongs to the
host's isolated workspace, and direct Go commands must use `GOWORK=off GOFLAGS=`.

The reusable marketplace workflow uses Go 1.25, Node.js 26.13.0 and native pnpm
12.14.0, then builds five platform archives. `OMNIVIEW_API_KEY` must authorize
publisher `omniview` on `https://api.omniview.dev`.
The publisher action submits the version for review; a successful workflow does
not establish marketplace approval. Confirm approval and installability in the
target registry before announcing availability. GitHub release notes are only
created after the build/submission job succeeds.

## License

[Apache-2.0](LICENSE)

---

<p align="center">
  Built by <a href="https://omniview.dev">Omniview</a>
</p>
