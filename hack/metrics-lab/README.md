# Real metrics lab

Manual fixture for an **existing, disposable local Docker Kind cluster** named `kind` (context `kind-kind`). It installs pinned kube-prometheus-stack **92.18.0**, Grafana, and **two** real application Pods: CPU/memory work, bounded file writes, and Pod-to-Pod HTTP. It does not fabricate samples or install metrics-server.

## Safety and prerequisites

Install Python 3 with PyYAML (`python3 -m pip install PyYAML`), Docker, Kind, kubectl, and Helm 3. Kubernetes must be >=1.25. Internet access and roughly 4 GiB of free Docker VM memory beyond existing workloads are required; Prometheus alone has a 1536 MiB memory limit. The runner never changes Docker settings, creates/deletes clusters, or stops other labs.

If no cluster named `kind` exists, create a fresh disposable cluster explicitly:

```sh
kind create cluster --name kind --kubeconfig /dev/null
```

Do not run this against a shared cluster or reset an existing cluster. Setup requires a Unix-socket Docker endpoint (including Docker Desktop), verifies running Docker Kind nodes, a loopback API endpoint, and matching API node identities. Remote SSH/TCP Docker contexts are rejected before accessing Kind. It derives credentials directly from Kind, not the ambient kubeconfig. Every Kubernetes/Helm command uses its private config. Existing releases and workload manifest names must carry the fixture ownership label.

Setup renders chart resources, including CRDs, before installation. Existing chart resources require an already-confirmed owned release and exact Helm ownership; subcharts need not repeat the fixture label. Existing shared CRDs are checked for the chart's served API versions, not adopted or upgraded; CRD upgrade jobs are disabled. Operator instance selectors restrict reconciliation to fixture-labeled Prometheus, Alertmanager, and ThanosRuler instances, avoiding takeover of unrelated instances using these shared APIs. The chart creates cluster-scoped CRDs/RBAC and discovery resources, so namespace isolation alone is insufficient.

## Setup

From the plugin repository root:

```sh
python3 hack/metrics-lab/setup.py up --context kind-kind
kubectl --kubeconfig "$PWD/hack/metrics-lab/.state/kubeconfig" --context kind-kind -n metrics-workloads rollout status deployment/metrics-cpu --timeout=180s
kubectl --kubeconfig "$PWD/hack/metrics-lab/.state/kubeconfig" --context kind-kind -n metrics-workloads rollout status deployment/metrics-io --timeout=180s
```

Setup has bounded process/request deadlines and waits up to ten minutes for Helm. Source ConfigMap content hashes enter Deployment Pod templates, so source changes trigger rollout while unchanged sources do not restart Pods. Inspect actual Pod/events or Helm history on failure before retrying. Pending Helm operations require explicit recovery; retries do not clear them.

`.state/` is mode 0700 and its kubeconfig is mode 0600. This ignored directory contains cluster-admin credentials: never commit, serve, screenshot, or copy it. To regenerate the private config without deployment:

```sh
python3 hack/metrics-lab/setup.py kubeconfig --context kind-kind
```

Run each forward in its own terminal; keep it running until finished. Do not replace an existing forward or broaden its address. Choose unused local ports if these are occupied, and adjust verification/IDE URLs accordingly.

```sh
kubectl --kubeconfig "$PWD/hack/metrics-lab/.state/kubeconfig" --context kind-kind -n observability port-forward --address 127.0.0.1 service/omniview-metrics-prometheus 48572:9090
```

```sh
kubectl --kubeconfig "$PWD/hack/metrics-lab/.state/kubeconfig" --context kind-kind -n observability port-forward --address 127.0.0.1 service/omniview-metrics-grafana 48573:80
```

Both services remain ClusterIP. Prometheus has no HTTP authentication: keep `http://127.0.0.1:48572` loopback-only. Grafana is `http://127.0.0.1:48573`; anonymous access is disabled. Log in as `admin` using the locally generated password:

```sh
kubectl --kubeconfig "$PWD/hack/metrics-lab/.state/kubeconfig" --context kind-kind -n observability get secret omniview-metrics-grafana -o jsonpath='{.data.admin-password}' | base64 --decode
```

Create a short-lived Grafana Viewer service-account token with datasource query access. Store it only in the IDE credential form. Never paste it into repository files, logs, or screenshots.

## Verify

Wait at least two minutes after rollout for rate samples, then run this read-only verifier with the Prometheus forward active:

```sh
python3 hack/metrics-lab/verify.py --context kind-kind --kubeconfig "$PWD/hack/metrics-lab/.state/kubeconfig" --prometheus-url http://127.0.0.1:48572
```

It checks Ready Nodes, exactly two Ready application Pods, positive CPU/memory/network samples, configured requests/limits, restart counts, and healthy kubelet cAdvisor/KSM scrape provenance. KSM freshness checks use source sample timestamps, not instant-query evaluation timestamps. Each family queries the complete Pod set. Filesystem and throttling samples are optional: present Pods still receive value/provenance checks, and missing Pods are reported unavailable without failing required CPU/memory checks. This verifies Prometheus directly, not the IDE/Grafana route.

Offline setup safety tests, when desired:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s hack/metrics-lab -p test_setup.py -v
```

## Connect the IDE

1. Add the printed absolute kubeconfig path to Kubernetes **Kubeconfigs**, apply the required plugin restart, and connect **kind-kind**. An already-running host does not inherit another shell's environment.
2. In global **Settings → Metrics**, open the Grafana provider settings and **Connect Grafana**. Select **Self-hosted Grafana gateway**, URL `http://127.0.0.1:48573`, allow HTTP only for this loopback endpoint, enter the private token, then **Save and test**. Global Grafana settings own provider connections and datasource discovery. Kubernetes owns its 24 Pod mapping definitions; global settings can store shared overrides.
3. Open the owning Kubernetes connection's **Cluster Settings → Metrics**. Bind that Grafana connection and datasource **Prometheus**, UID **`prometheus`**. Set **Use for → Replace mapped metrics** and public **Cluster label value → `kind-kind`**. Keep the Kubernetes-owned Pod mappings inherited, then **Save connection metrics**. This binding belongs to the Kubernetes connection, not a Pod or global default. Ancillary finite IDs use the `kubernetes.pod.` prefix; CPU and memory retain `kubernetes.pod.cpu.usage` and `kubernetes.pod.memory.working_set`.
4. Open namespace **metrics-workloads**, then either real Pod's **Metrics** tab. Select panels and a range with actual retained samples. Check source details and errors; a connection health test does not prove datasource query access.

The IDE host must reach the same loopback endpoints. A container's loopback is not the workstation's loopback; do not expose unauthenticated Prometheus publicly to work around this.

## Sources and limits

The default ScrapeClass adds public `cluster="kind-kind"` labels to real scrape targets and local samples. External labels alone would not label local PromQL results. Kubelet cAdvisor supplies usage/counters; kube-state-metrics supplies requests, limits, and restarts. No application metrics exporter exists in these workloads.

Native metrics-server provides current Pod/Node CPU and memory only, not range history. The logical native source uses the Kubernetes owner tuple with `native: true`, not a metrics-server datasource kind. This fixture does not install metrics-server: native metrics may remain unavailable. Finite host-owned Pod observations use the explicit Grafana binding and Kubernetes-owned recipes for mapped Prometheus series; global mappings alone do not select an owner connection. Native unsupported history and absent counters are not replaced with synthetic data. Legacy cluster/namespace Prometheus consumers remain separate paths.

Allow several scrape intervals (15 seconds each), typically five minutes for longer rate windows. Filesystem, throttling, and network series depend on the runtime/cgroups; missing or zero counters are honest results. Node-exporter describes the Linux Docker/Kind node, not macOS hardware. Host-root filesystem mounting is disabled. Kind's loopback-only scheduler/controller-manager/etcd/kube-proxy scrape endpoints and corresponding rules are disabled; other genuine failures remain visible. Alertmanager is disabled.

Prometheus retains six hours in ephemeral storage. Grafana is also ephemeral; Pod replacement can lose dashboards, history, service accounts, and tokens. Recreate credentials and update the IDE if necessary. This is not a durable monitoring deployment.

## Cleanup

Stop only your own forwards with Ctrl-C. Explicitly remove the owned fixture:

```sh
python3 hack/metrics-lab/setup.py down --context kind-kind --confirm-down
```

Ownership checks precede deletion. Cleanup removes non-Namespace manifest objects and the owned Helm release. It retains namespaces, unrelated resources, the cluster, private kubeconfig, and Helm-retained CRDs. Inspect retained discovery resources before manual removal; never delete shared CRDs or run `kind delete cluster` as routine fixture cleanup. Remove private `.state/` only after disconnecting its IDE connection.
