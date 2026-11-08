# Local Kubernetes load lab

Real Kubernetes v1.35.0 on kind, with one control plane and multiple workers. Each synthetic application has one BusyBox 1.37.0 HTTP pod, Deployment, Service, 2 KiB ConfigMap, 1 KiB synthetic Secret, and three seed Events. Kubernetes additionally generates ReplicaSets, EndpointSlices, and lifecycle Events. No metrics/profiling stack is installed.

Both images are pinned by digest in the driver. Child processes have a six-minute timeout; cluster creation allows fifteen minutes. A process timeout exits with an explicit diagnostic; inspect cluster state before retrying because completed API mutations are not rolled back.

## Workspace

Created through the installed `omniview-dev` CLI:

```sh
omniview-dev workspace create kubernetes-load-lab \
  --root "$COLLECTION" \
  --plugin kubernetes --json
```

The workspace includes host and Kubernetes plugin feature worktrees. It was not launched: cluster setup does not need a running host. Lab source lives in this workspace's `kubernetes/hack/kind-lab`.

## Capacity

| Preset | Namespaces | Pods / Deployments / Services / Secrets / ConfigMaps, each | Seed Events | Suggested workers | Suggested Docker VM memory |
| --- | ---: | ---: | ---: | ---: | --- |
| smoke | 2 | 4 | 12 | 1 | 4 GiB |
| baseline | 10 | 300 | 900 | 3 | 8–12 GiB |
| medium | 20 | 600 | 1800 | 6 | 14–18 GiB |
| large | 20 | 1000 | 3000 | 10 | 20–24 GiB |
| xl | 40 | 2000 | 6000 | 20 | 32–48 GiB |

Memory figures are planning estimates, not measured guarantees; the `medium` row is interpolated between `baseline` and `large`. Docker reported 18 CPUs and 7.75 GiB during initial setup. A beefy Mac still needs an explicit Docker Desktop VM memory allocation. Keep enough RAM outside Docker for macOS and Omniview. Other running clusters share that VM.

Workers retain normal kubelet pod limits. Roughly 100 application pods per worker leaves room below the usual 110-pod limit for system pods and rollouts, so `seed` refuses a preset with more than 100 application Pods per Ready worker; a three-worker lab accepts `baseline` at most. Recreate a dedicated lab with the appropriate worker count first. More real nodes consume kubelet/containerd memory; fake nodes would be a separate API-only scenario, not equivalent runtime realism.

Pods request 1m CPU / 4 MiB and limit 50m CPU / 16 MiB. Requests are scheduler inputs, not total cluster memory. No service mesh, ingress, persistent volumes, or heavyweight application images.

## Create and seed

Requirements: Python 3, Docker, kind, kubectl; registry access for node and BusyBox images. Commands run from the Kubernetes plugin feature worktree:

Set `COLLECTION` to your initialized Omniview repository collection before using the workspace examples. For an existing standalone plugin checkout, run the Python commands from its repository root instead.

```sh
cd "$COLLECTION/workspaces/kubernetes-load-lab/kubernetes"
python3 hack/kind-lab/lab.py create --workers 3
python3 hack/kind-lab/lab.py seed --preset baseline
python3 hack/kind-lab/lab.py status
```

The baseline cluster already exists after initial setup. `create` refuses a cluster that already exists, before writing any state. Seed is repeatable; it does not prune a previous larger preset. Use a fresh cluster for exact comparative inventories. `render --preset large` emits manifests without contacting Kubernetes.

Without `--name`, kubeconfig is `hack/kind-lab/.state/kubeconfig` and context is `kind-omniview-load-lab`; `--name NAME` uses separate state ([Named benchmark clusters](#named-benchmark-clusters)). All lab mutations explicitly select both. Creation never modifies `~/.kube/config`. The API binds loopback, and no application ports are published to the host. State is ignored by Git and contains cluster administrator credentials; do not share it.

If the cluster exists but this checkout has no private kubeconfig, recover it
without merging the default kubeconfig or recreating the cluster:

```sh
install -d -m 700 hack/kind-lab/.state
kind export kubeconfig --name omniview-load-lab \
  --kubeconfig "$PWD/hack/kind-lab/.state/kubeconfig"
chmod 600 hack/kind-lab/.state/kubeconfig
```

Before `seed`, `churn`, or `delete`, inspect the target without mutation:

```sh
kind get clusters
docker ps --filter label=io.x-k8s.kind.cluster=omniview-load-lab \
  --format '{{.ID}}\t{{.Names}}\t{{.CreatedAt}}\t{{.Labels}}'
kubectl --kubeconfig "$PWD/hack/kind-lab/.state/kubeconfig" \
  --context kind-omniview-load-lab config view --minify
kubectl --kubeconfig "$PWD/hack/kind-lab/.state/kubeconfig" \
  --context kind-omniview-load-lab get nodes -o wide
```

Compare container creation times, node names, and the loopback API endpoint with
your own lab creation records. These checks identify the target; neither the kind
name nor its labels prove ownership. The default lab has no ownership receipt
([#86](https://github.com/omniviewdev/omniview-plugin-kubernetes/issues/86));
only clusters made with `create --name` get one.
If you cannot establish that you created this disposable cluster, stop without
seeding, churning, or deleting it; confirm ownership with its creator first.

A successful seed waits for Deployment Available, not a settled rollout: verify
actual desired/current/ready Pods and deleting Pods before benchmarking; `status`
prints the labeled, Ready, and deleting Pod counts.
Reseeding after churn or source changes can replace Pods and generate many
additional controller Events. Count total Events separately from the 900 baseline
seed Events; presets do not prune a previous larger inventory.

To connect Omniview later, select this kubeconfig explicitly in the Kubernetes plugin. Workspace profiles do not isolate HOME or kubeconfig automatically. No production configuration was merged or replaced.

## Named benchmark clusters

`--name NAME` runs any command against a separate kind cluster, so a benchmark never touches the default `omniview-load-lab` or its state. A name is 1–40 lowercase letters, digits, or hyphens, beginning and ending with a letter or digit; anything else is rejected before a path is built. Without `--name`, every command keeps the default cluster and its original `.state` files.

| Cluster | Private state under `hack/kind-lab/.state` | Context |
| --- | --- | --- |
| `omniview-load-lab` (default) | `kubeconfig`, `kind.json` | `kind-omniview-load-lab` |
| `NAME` | `clusters/NAME/kubeconfig`, `kind.json`, `owner.json` | `kind-NAME` |

Every kubectl call selects its own kubeconfig and context explicitly, and kind writes or removes entries only in that kubeconfig. `~/.kube/config`, another cluster's kubeconfig, other kind clusters, and Docker settings are never modified; the existence check only reads names from `kind get clusters`. The named state directory is mode 0700 and its kubeconfig 0600. Seeded objects, Pod templates, and Events carry `app.kubernetes.io/part-of=NAME`, and `status`/`churn` select on it. Secrets stay 1 KiB synthetic filler (`synthetic: xxx…`), never real credentials.

`create` refuses, before writing anything, when `kind get clusters` already lists the name or, for a named cluster, when `clusters/NAME` already exists. It never overwrites an existing cluster's `kind.json` or kubeconfig; the default lab's flat `.state` is reused after `delete`, as before. A named `create` writes `owner.json` before kind runs. Every `create` then waits up to three minutes for all workers to be Ready. If kind fails and no cluster with that name exists, a named `create` removes only the state it just made so the name can be retried. After a timeout, or any failure that leaves the cluster present, the state is kept for inspection and cleanup is manual.

Named `seed`, `churn`, `delete`, and `native_metrics.py install` require that `owner.json` receipt, so they refuse a kind cluster this checkout did not create; the receipt is checkout-local, and adopting a cluster from another checkout remains [#86](https://github.com/omniviewdev/omniview-plugin-kubernetes/issues/86). `status`, `render`, and `native_metrics.py verify` do not need it. `delete --name NAME --confirm-delete` removes the cluster and the files `create` wrote, and keeps any other file in the directory. The default lab has no receipt and behaves as before.

### Pod stages

Each application is one Deployment with one Pod, so a preset's application Pod count is namespaces × applications per namespace. System Pods are extra.

| Stage | Preset | Application Pods | Minimum Ready workers |
| ---: | --- | ---: | ---: |
| 300 | `baseline` | 300 | 3 |
| 600 | `medium` | 600 | 6 |
| 1000 | `large` | 1000 | 10 |

Each stage is a strict superset of the previous one with identical names and specs, so seeding the next preset on the same cluster adds objects instead of replacing them. `seed` refuses a preset with more than 100 application Pods per Ready worker before applying anything, then waits only for Deployment Available. A stage is settled only when `status` reports the stage's count for `pods:`, `ready pods:`, and `deployments:` and `deleting pods: 0`.

```sh
python3 hack/kind-lab/lab.py create --name omniview-bench --workers 10

python3 hack/kind-lab/lab.py seed --name omniview-bench --preset baseline
python3 hack/kind-lab/lab.py status --name omniview-bench
python3 hack/kind-lab/lab.py seed --name omniview-bench --preset medium
python3 hack/kind-lab/lab.py status --name omniview-bench
python3 hack/kind-lab/lab.py seed --name omniview-bench --preset large
python3 hack/kind-lab/lab.py status --name omniview-bench
```

Decide the Docker VM memory allocation before `create`: running clusters share it, kind nodes have no per-cluster memory limit (`docker stats` shows the whole VM as every container's limit), so a full VM can disrupt every cluster on it. Every real worker and Pod consumes memory, and this driver never changes Docker settings. Read the VM total, what each running cluster already uses, and what the kernel still has available before `create` and again after each stage; none of these changes anything:

```sh
docker info --format 'CPUs={{.NCPU}} MemTotal={{.MemTotal}}'
docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}'
docker exec NAME-control-plane grep -E 'MemTotal|MemAvailable' /proc/meminfo   # VM-wide view, after create
```

Divide the growth in used memory between two stages by the Pods it added to project the next one, and leave several GiB unused after it. One observation, not a guarantee: the existing 3-worker lab (316 Pods, 98–109 per worker, kindest/node v1.35.0) showed 2.23–2.32 GiB per worker and 1.35 GiB for the control plane after three days running, and 1.35–1.56 GiB per worker three minutes after a Docker restart. The 10-worker, 1000-Pod stage is the `large` row above. To use the cluster from Omniview, select `hack/kind-lab/.state/clusters/omniview-bench/kubeconfig` explicitly in the Kubernetes plugin. Remove it with `delete --name omniview-bench --confirm-delete`.

The driver's tests run offline, without Docker or kind: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s hack/kind-lab -p 'test_*.py' -v`.

## Activity scenarios

Quiet inventory isolates initial list/load behavior. Churn adds ConfigMap and Secret updates plus bounded Event create/update traffic. Optional rolling updates add real Pod deletion/creation, status changes, EndpointSlice changes, and controller-generated Events.

```sh
# Steady activity: target three direct writes/second for 30 minutes.
python3 hack/kind-lab/lab.py churn --interval 1 --duration 1800

# Active cluster: target fifteen direct writes/second, one rollout per 25 cycles.
python3 hack/kind-lab/lab.py churn --interval 0.2 --duration 1800 --rollout-every 25

# Check inventory and readiness after activity.
python3 hack/kind-lab/lab.py status
```

These rates are targets, not guarantees: kubectl process startup and API latency limit achieved throughput. The final JSON reports completed cycles, direct writes, and rollout requests. Controller writes are additional. Churn runs in the foreground; Ctrl-C stops it. No background load remains after completion. Keep one driver per cluster for comparable runs.

Activity Events use a fixed ring of at most 100 names per namespace. API server event TTL is one hour. Seed Events expire too; rerun seed immediately before an event-heavy comparison. Event names remain bounded even over long runs. ReplicaSet history is limited to one old revision per Deployment. Rollouts can temporarily exceed the steady pod count.

Secrets are synthetic. No cloud accounts, external services, or credentials are required. The HTTP containers are mostly idle; this stresses Kubernetes inventory/watch paths, not application compute or network throughput.

## Reset

Without `--name`, deletion is explicit and destroys only the dedicated `omniview-load-lab` cluster:

```sh
python3 hack/kind-lab/lab.py delete --confirm-delete
python3 hack/kind-lab/lab.py create --workers 10
python3 hack/kind-lab/lab.py seed --preset large
```

Stop churn before reset. Existing unrelated kind clusters are not touched. Larger presets require separate capacity validation before performance conclusions.

With `--name NAME`, `delete` destroys only that cluster, and only when this checkout holds its `owner.json` receipt; it also removes the files `create` wrote under `.state/clusters/NAME`.

## Initial smoke evidence

Created four real nodes, all Ready. Observed 300/300 ready application pods and 300 each of Deployments, Services, Secrets, and ConfigMaps. Seeded 900 synthetic Events; status reported 910 labeled Events after activity. Exercised ten churn cycles: 32 direct writes and two deployment rollouts. An HTTP request from app-000 through the app-001 Service returned `load-lab`. Large/xl remain unexercised capacity presets.

## Native Pod metrics

Native CPU and memory require real metrics-server; no Prometheus installation,
fake exporter, or fabricated samples are used by this path. Installation is a
separate explicit operation and has **not** been run merely by adding these files.

After creating and seeding the dedicated lab above:

```sh
# Explicit cluster mutation: version-pinned upstream metrics-server v0.8.0.
python3 hack/kind-lab/native_metrics.py install --confirm-install --confirm-owner-permission

# Read-only: wait for real measurements from at least two Ready seeded Pods.
python3 hack/kind-lab/native_metrics.py verify --namespace load-000 --timeout 120
```

For a named benchmark cluster, pass the same `--name`; `install` additionally requires that cluster's `owner.json` receipt:

```sh
python3 hack/kind-lab/native_metrics.py install --name omniview-bench --confirm-install --confirm-owner-permission
python3 hack/kind-lab/native_metrics.py verify --name omniview-bench --namespace load-000 --timeout 120
```

Before installation, establish that you created this disposable cluster or obtain
its creator's permission to install cluster-wide RBAC. Names, Docker labels, and
loopback ports identify a target; they do not prove ownership on shared Docker.
`--confirm-owner-permission` explicitly attests to that permission. If uncertain,
stop without installing anything.


Both commands require the selected cluster's private kubeconfig
(`hack/kind-lab/.state/kubeconfig`, or `.state/clusters/NAME/kubeconfig` with
`--name NAME`), its fixed `kind-NAME` context, actual Kind cluster membership,
Docker Kind ownership labels, and a loopback API port matching that
control-plane container.
They refuse arbitrary contexts, ambient kubeconfigs, remote endpoints, or another
cluster. They never merge kubeconfigs or change an ambient current context.
The installation adds `--kubelet-insecure-tls` only for this verified local Kind
cluster's self-signed kubelet serving certificates. Never copy that exception to
a production installation. The release/image is pinned to v0.8.0; this is a
version pin, not an image-digest or manifest-checksum claim.

Verification reads actual Pod readiness and the namespaced metrics API. It
checks real source timestamps/windows and container CPU/memory quantities,
prints up to four sample summaries without credentials, and rejects missing,
negative, invalid, stale or duplicate measurements. CPU is cores; memory is
working-set bytes. Measured zero CPU is valid. A missing quantity is not zero.
The verifier follows APIService → Service → serving endpoint Pods → ReplicaSet →
pinned Deployment ownership, and checks the actual serving Pod images. Samples
must cover every running container, including running init sidecars. One deadline
covers identity checks and all verification requests; each request uses only the
remaining time, and expired verification cannot succeed.
It neither deploys a workload nor changes cluster state. The seeded HTTP
containers provide real idle workloads; this is not a compute-load benchmark.

Use the same private kubeconfig explicitly when connecting Omniview. Native
metrics support current only, retain actual metrics-server time/window, and
report unsupported history rather than drawing local polling history.
See [native API, bounds and attribution](../../docs/native-metrics.md).
This backend verification does not prove host/table/sidebar sharing or UI
integration; those require separate integrated runtime evidence.
