<p align="center">
  <img src="https://raw.githubusercontent.com/kubernetes/kubernetes/master/logo/logo.svg" width="100" alt="Kubernetes" />
</p>

<h1 align="center">Kubernetes Plugin for Omniview</h1>

<p align="center">
  <strong>A full-featured Kubernetes management experience, built natively into Omniview.</strong>
</p>

<p align="center">
  <a href="https://omniview.dev"><img src="https://img.shields.io/badge/omniview-plugin-326CE5?style=flat-square&logo=kubernetes&logoColor=white" alt="Omniview Plugin" /></a>
  <img src="https://img.shields.io/badge/version-0.3.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/license-Apache--2.0-green?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/category-cloud-326CE5?style=flat-square" alt="Category" />
</p>

---

Browse, inspect, edit, and manage Kubernetes clusters without leaving Omniview. The Kubernetes plugin provides real-time resource tables, an integrated terminal, log streaming, port forwarding, Helm chart management, cluster metrics, and full YAML editing — all from a single, unified interface.

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

### Invocation SDK contract

The backend consumes the published SDK pinned in `go.mod`. Restart streams emit `ready` only after the native patch succeeds and the rollout watch is established. Native failures return through the SDK classifier; unsupported stream actions return typed `UNSUPPORTED` errors. An open failure does not roll back a Kubernetes mutation already committed before watch establishment.

These action semantics require a compatible host/runtime cohort. Coordinate changes with [the host invocation contract](https://github.com/omniviewdev/omniview/issues/83); source integration does not publish a plugin release.

### Prerequisites

- Go 1.25+
- Node.js 22+
- pnpm 12.14.0 (pinned by `ui/package.json`)

Registry installs retain pnpm's 24-hour release-age protection. Only coordinated
`@omniviewdev/*` packages are exempted; linked source worktrees resolve locally.
The current UI cohort is `@omniviewdev/base-ui` 0.5.0 and
`@omniviewdev/editors` 4.0.0, paired with host runtime/Vite packages 0.5.0.

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

The reusable marketplace workflow uses Go 1.25, Node.js 22 and native pnpm
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
