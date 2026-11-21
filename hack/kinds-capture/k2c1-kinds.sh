#!/usr/bin/env bash
# Makes the objects of k2c1-kinds.yaml on a cluster that already holds the slice fixture of the host, extra-states.yaml, more-kinds.yaml and k2b2-kinds.yaml (the headers of those files say how), and does what a
# manifest cannot say:
#
#   KUBECONFIG=<the cluster's kubeconfig> hack/kinds-capture/k2c1-kinds.sh
#
# It reads and writes the cluster of KUBECONFIG and no other. About two minutes: the rollouts of the Deployments, the Job that completes, and a Namespace that is made.
set -euo pipefail

: "${KUBECONFIG:?KUBECONFIG is required: the kubeconfig of the cluster to fill}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

kubectl apply --server-side -f "$HERE/k2c1-kinds.yaml" >/dev/null

kubectl -n detail rollout status deploy/annotated deploy/recreating --timeout=240s | tail -n 2
kubectl -n detail rollout status sts/ordered-db --timeout=240s | tail -n 1
kubectl -n detail rollout status ds/surging --timeout=240s | tail -n 1
# `rollout status` answers only for a rolling update: the DaemonSet that is replaced on delete is waited for by its status.
for _ in $(seq 1 48); do
  [ "$(kubectl -n detail get ds selective -o jsonpath='{.status.numberReady}')" = "1" ] && break
  sleep 5
done
test "$(kubectl -n detail get ds selective -o jsonpath='{.status.numberReady}')" = "1" || { echo "the DaemonSet selective was not ready in 240 s" >&2; exit 1; }
kubectl -n detail wait --for=condition=complete job/limited --timeout=240s | tail -n 1

# No controller gives a LoadBalancer Service its address here: the status a controller would write is written by hand, through the status subresource.
kubectl -n detail patch service sticky --subresource=status --type=merge -p '{"status":{"loadBalancer":{"ingress":[{"ip":"203.0.113.10"}]}}}' >/dev/null

# A cloud labels its Nodes with a zone and an instance type; kind does not. The Node page says both when the Node has them.
kubectl label node --all --overwrite topology.kubernetes.io/zone=eu-west-1a node.kubernetes.io/instance-type=m5.large >/dev/null
echo "k2c1 kinds: done"
