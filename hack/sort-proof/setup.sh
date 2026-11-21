#!/usr/bin/env bash
# A private kind cluster for the sort proof (K3a): three nodes (so that the Nodes list has rows to sort), the host's slice fixture and the plugin's fixtures of the cluster proofs
# (hack/kinds-capture): Pods in every state, Deployments in every state, Jobs, Services, PersistentVolumeClaims and the rest of the kinds the plugin lists.
#
#   HOST=<host checkout> WORK=<scratch directory> hack/sort-proof/setup.sh
#
# It reads and writes no kubeconfig but $WORK/kubeconfig. The cluster name goes to $WORK/cluster-name, and `kind delete cluster --name "$(cat $WORK/cluster-name)"` removes that cluster and no other.
set -euo pipefail

: "${HOST:?}" "${WORK:?}"
PLUGIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$WORK"
KUBECONFIG_PATH="$WORK/kubeconfig"
NAME="k3a-sort-$(date +%s)-$$"
echo "$NAME" >"$WORK/cluster-name"

if kind get clusters 2>/dev/null | grep -qx "$NAME"; then echo "cluster $NAME exists already: left alone" >&2; exit 1; fi

cat >"$WORK/kind-config.yaml" <<'YAML'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
  - role: worker
YAML

echo "== $(date +%T) cluster $NAME: kind v0.30.0, node v1.35.0 (the image the host's CI pins), three nodes"
(unset KUBECONFIG; kind create cluster --name "$NAME" --kubeconfig "$KUBECONFIG_PATH" --wait 240s --config "$WORK/kind-config.yaml" \
  --image 'kindest/node:v1.35.0@sha256:4613778f3cfcd10e615029370f5786704559103cf27bef934597ba562b269661' 2>&1 | tail -n 2)
export KUBECONFIG="$KUBECONFIG_PATH"
chmod 600 "$KUBECONFIG_PATH"
kind load docker-image busybox:1.37.0 --name "$NAME" >/dev/null 2>&1 || echo "(busybox not preloaded: pulled by the node)"

echo "== $(date +%T) nodes that differ: a worker role on the first worker, the second cordoned"
workers=($(kubectl get nodes -l '!node-role.kubernetes.io/control-plane' -o name | sort))
kubectl label "${workers[0]}" node-role.kubernetes.io/worker= >/dev/null
kubectl cordon "${workers[1]}" >/dev/null

echo "== $(date +%T) the host's slice fixture"
kubectl apply -f "$HOST/docs/ui-next/slices/1a-pods-list/fixture.yaml" >/dev/null
kubectl -n checkout rollout status deploy/cart-api deploy/payment-gateway --timeout=240s | tail -n 1
kubectl -n checkout rollout status sts/cart-cache --timeout=240s | tail -n 1
kubectl -n monitoring rollout status ds/node-agent deploy/alertmanager --timeout=240s | tail -n 1
kubectl -n batch wait --for=condition=complete job/nightly-report --timeout=240s | tail -n 1

echo "== $(date +%T) extra-states.yaml"
kubectl apply -f "$PLUGIN/hack/kinds-capture/extra-states.yaml" >/dev/null
kubectl -n states rollout status deploy/stuck-rollout deploy/paused --timeout=300s | tail -n 1
kubectl -n states patch deploy/stuck-rollout --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/image","value":"registry.invalid/stuck:2"}]'
kubectl -n states rollout pause deploy/paused

for script in more-kinds k2b2-kinds k2c1-kinds; do
  echo "== $(date +%T) $script.sh"
  "$PLUGIN/hack/kinds-capture/$script.sh" || echo "WARN $script.sh failed ($?)"
done

echo "== $(date +%T) settle"
sleep 40
kubectl get pods -A --no-headers | awk '{print $4}' | sort | uniq -c | sort -rn
kubectl get nodes
echo "== $(date +%T) READY $NAME"
touch "$WORK/setup.done"
