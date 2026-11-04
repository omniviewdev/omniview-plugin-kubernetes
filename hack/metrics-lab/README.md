# Real metrics lab

This fixture adds standard kube-prometheus-stack and real CPU/HTTP/I/O workloads to an **existing** local Docker Kind cluster named `kind` (context `kind-kind`). It never creates or deletes a cluster, changes the global kubeconfig, generates metrics, or fabricates Kubernetes state.

## Prerequisites and safety

Install Python 3, Docker, Kind, kubectl, and Helm 3. The existing cluster must run Kubernetes >=1.25; the integration target is Kubernetes 1.34 on an arm64 Docker Kind node. Reserve roughly 4 GiB Docker VM headroom beyond existing clusters, plus image space; Prometheus alone has a 1536 MiB memory limit. With several Kind labs running, 16 GiB VM RAM is a reasonable starting point. Host RAM does not enlarge the VM automatically. Severe VM memory pressure can appear as Kubernetes TLS/API timeouts. The runner never resizes Docker or stops other clusters. Internet access is required for chart and image pulls. No tools are installed by the runner.

The runner accepts only `--context kind-kind`. It derives a private kubeconfig from `kind get kubeconfig --name kind`, verifies local Docker node ownership/running state, requires a loopback API endpoint, and compares API nodes against local Kind nodes. It does not trust an ambient context with the same name. Do not use this fixture against shared or production clusters. Helm creates cluster-scoped monitoring CRDs/RBAC and kubelet discovery resources, so this is not namespace-only isolation.

The chart is pinned to **92.18.0**, published 2026-11-04, with Prometheus Operator **v0.94.2** and chart Kubernetes constraint `>=1.25.0-0`. Sources: [official chart index](https://prometheus-community.github.io/helm-charts/index.yaml), [pinned values](https://github.com/prometheus-community/helm-charts/blob/kube-prometheus-stack-92.18.0/charts/kube-prometheus-stack/values.yaml), [ScrapeClass API](https://github.com/prometheus-operator/prometheus-operator/blob/v0.94.2/pkg/apis/monitoring/v1/prometheus_types.go). No Helm repository registration is needed.

## Launch

From the plugin repository root:

```sh
python3 hack/metrics-lab/setup.py up --context kind-kind
export KUBECONFIG="$PWD/hack/metrics-lab/.state/kubeconfig"
kubectl --context kind-kind -n metrics-workloads rollout status deployment/metrics-cpu --timeout=180s
kubectl --context kind-kind -n metrics-workloads rollout status deployment/metrics-io --timeout=180s
```

`up` uses `helm upgrade --install --wait --timeout 10m`, then applies `workloads.yaml`. Commands have process/request deadlines. Retry `up` after fixing a real failure; inspect failed pods/events rather than suppressing errors. It refuses to adopt an existing release or manifest object without the fixture ownership label `app.kubernetes.io/part-of=omniview-metrics-lab`. A release stuck in `pending-install` or `pending-upgrade` needs explicit Helm recovery; rerunning `up` cannot clear that state. Inspect `helm history`, then roll back to a known revision, or remove this owned fixture with `down` before reinstalling.

The generated `.state/` directory is mode 0700; kubeconfig is mode 0600. It contains cluster-admin client credentials: do not commit, copy into screenshots, or expose it through a server. To regenerate without deployment:

```sh
python3 hack/metrics-lab/setup.py kubeconfig --context kind-kind
```

In the IDE Kubernetes connection/import flow, select the absolute path printed by this command and context `kind-kind`. The IDE host must access that file and the same loopback API endpoint. A host started before `export KUBECONFIG` may need explicit connection import; exporting in another shell does not change an existing process's environment.

## Local endpoints and authentication

Run each port-forward in its own terminal. These commands intentionally bind only loopback, and remain running until interrupted:

```sh
export KUBECONFIG="$PWD/hack/metrics-lab/.state/kubeconfig"
kubectl --context kind-kind -n observability port-forward --address 127.0.0.1 service/omniview-metrics-prometheus 48572:9090
```

```sh
export KUBECONFIG="$PWD/hack/metrics-lab/.state/kubeconfig"
kubectl --context kind-kind -n observability port-forward --address 127.0.0.1 service/omniview-metrics-grafana 48573:80
```

Prometheus: `http://127.0.0.1:48572`. Grafana: `http://127.0.0.1:48573`. Both Kubernetes services remain ClusterIP; no ingress or public endpoint is created. Prometheus has no HTTP authentication and must stay loopback-only.

Grafana anonymous access is disabled. Log in as `admin`; retrieve its generated password locally:

```sh
kubectl --kubeconfig "$PWD/hack/metrics-lab/.state/kubeconfig" --context kind-kind -n observability get secret omniview-metrics-grafana -o jsonpath='{.data.admin-password}' | base64 --decode
```

No password or API token is committed. Create a Grafana Viewer service account with query access to the Prometheus datasource. Use a short token lifetime, such as seven days, and rotate it when needed. Store the token through the IDE credential form, not a checked-in file. A provider running in a container cannot reach the host through container loopback; use an explicitly secured host-accessible path instead of broadening these forwards.

## Connect the IDE

1. Add the generated absolute kubeconfig path to the Kubernetes plugin's **Kubeconfigs** setting. Apply its required plugin restart, then open **kind-kind**.
2. Open **Grafana → Connect Grafana**. Choose **Self-hosted Grafana gateway**, URL `http://127.0.0.1:48573`, and allow unencrypted HTTP **only for this loopback endpoint**. Enter the service account token, then **Save and test**.
3. Open **kind-kind → Cluster Settings → Metrics**. Select that Grafana connection and datasource **Prometheus** (UID `prometheus`).
4. Set **Use for → Replace mapped metrics** and **Cluster label value → kind-kind**. Keep standard global Pod mappings inherited; save with **Save connection metrics**.
5. Open Pods in namespace **metrics-workloads**. Both application Pods should be Running with Ready containers. Open a Pod's Metrics tab and select the desired panels.

The lab does not install metrics-server. Pod CPU/memory use the Grafana binding; resource kinds without mappings may still report unavailable native metrics. Grafana Pod replacement can invalidate service accounts because this lab uses ephemeral storage; recreate the token and update the IDE credential when that happens.

## Real series and limitations

Prometheus scrapes the API server, CoreDNS, kubelet including `/metrics/cadvisor`, kube-state-metrics, node-exporter, and the monitoring components. The default ScrapeClass adds `cluster="kind-kind"` to actual scrape targets and therefore locally queried samples. `externalLabels` also sets this value for outbound telemetry; external labels alone would not fix local PromQL. Upstream kubelet `job`, `metrics_path`, real `namespace`, `pod`, and non-`POD` container labels remain intact.

Wait at least two scrape intervals (15 seconds each), and longer for rate windows (typically five minutes). Pod CPU requires `container_cpu_usage_seconds_total`; working-set memory requires `container_memory_working_set_bytes`; filesystem and network panels require their respective cAdvisor counters. Resource request/limit panels require kube-state-metrics `kube_pod_container_resource_requests` and `kube_pod_container_resource_limits`. Real workloads do not export application-level custom metrics. Filesystem, throttling, or network counters may be absent or zero depending on the container runtime, cgroup configuration, and traffic. Absence is unavailable data, not a reason to invent series.

Node-exporter runs against the Linux Kind/Docker node, **not macOS hardware**. Host-root filesystem mounting is disabled because Docker Desktop/Kind mount propagation is not reliable. Node filesystem details may therefore differ from a bare-metal deployment. Do not treat them as workstation disk capacity.

Kind's default scheduler, controller-manager, and etcd metrics bind to node loopback; the chart's ServiceMonitor endpoints cannot reach them. kube-proxy metrics also default to loopback. Their scrapes and matching rule groups are disabled explicitly. Alertmanager is not deployed, and its rules are disabled. Other default rules remain enabled: genuine scrape and workload failures are not hidden. Prometheus rules can still be inspected without an alert delivery service.

Prometheus and Grafana use ephemeral storage. Pod replacement can lose history or Grafana state; this fixture is not a durable monitoring deployment. The chart includes default Grafana dashboards and its Prometheus datasource. Dashboard queries must use actual workload namespace/pod values and `cluster="kind-kind"`.

## Verify actual telemetry

With both workloads Ready and the Prometheus port-forward running:

```sh
make metrics-lab-verify
```

The verifier checks actual Ready Nodes and application Pods, positive CPU/memory/network samples, exact resource requests/limits, and kubelet cAdvisor/KSM scrape provenance. Each metric family queries the complete Pod set rather than issuing one query per Pod. Filesystem writes and CPU throttling are optional and report absence honestly.

This command queries Prometheus directly. Opening the same real Pod metrics in the IDE separately verifies Grafana datasource proxy access. No fixture metric exporter or synthetic Kubernetes API is involved.

Offline credential-path safety checks need only Python:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s hack/metrics-lab -p test_setup.py -v
```

## Cleanup

Stop both port-forwards with Ctrl-C, then:

```sh
python3 hack/metrics-lab/setup.py down --context kind-kind --confirm-down
```

Before any deletion, the runner checks ownership for the Helm release and every object named by `workloads.yaml`. It deletes only the non-Namespace objects in that manifest, then uninstalls release `omniview-metrics` from `observability`. Helm removes its release-managed namespaced and cluster-scoped objects. It does **not** delete either namespace, other workloads/releases, the cluster, or monitoring CRDs retained by Helm. Operator-generated discovery resources or resources marked for retention may remain; inspect ownership before manual removal. Never delete shared CRDs as routine cleanup.

The private kubeconfig remains for IDE use. Remove `hack/metrics-lab/.state/` manually only after disconnecting the IDE if credentials are no longer needed. Do not run `kind delete cluster` as fixture cleanup.
