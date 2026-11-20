#!/usr/bin/env bash
# Makes the objects of more-kinds.yaml on a cluster that already holds the slice fixture of the host and extra-states.yaml (header of that file), and does what a manifest cannot say:
#
#   KUBECONFIG=<the cluster's kubeconfig> hack/kinds-capture/more-kinds.sh
#
# It reads and writes the cluster of KUBECONFIG and no other. About three minutes: a rollout, the first minute of two CronJobs, and a Namespace that is being deleted.
set -euo pipefail

: "${KUBECONFIG:?KUBECONFIG is required: the kubeconfig of the cluster to fill}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

kubectl apply --server-side -f "$HERE/more-kinds.yaml" >/dev/null

# A Deployment is rolled out once, and then its template changes: the ReplicaSet of the first template is left with no replica.
kubectl -n more rollout status deploy/rolled --timeout=240s | tail -n 1
kubectl -n more patch deploy/rolled --type=json -p '[{"op":"add","path":"/spec/template/metadata/annotations","value":{"k2b1.example.com/revision":"2"}}]' >/dev/null
kubectl -n more rollout status deploy/rolled --timeout=240s | tail -n 1

# No controller runs: the status a controller would write is written by hand, through the status subresource.
kubectl -n more patch ingress addressed --subresource=status --type=merge -p '{"status":{"loadBalancer":{"ingress":[{"ip":"10.0.0.7"}]}}}' >/dev/null

# The CronJobs that run every minute: wait for the first Job of each, then suspend `done` (it makes no second Job) and wait for its Job to finish (a last schedule, no active Job).
for _ in $(seq 1 40); do
  forbid="$(kubectl -n more get cronjob forbid -o jsonpath='{.status.lastScheduleTime}')"
  done_at="$(kubectl -n more get cronjob done -o jsonpath='{.status.lastScheduleTime}')"
  if [ -n "$forbid" ] && [ -n "$done_at" ]; then break; fi
  sleep 5
done
test -n "$forbid" && test -n "$done_at" || { echo "the CronJobs did not run in 200 s" >&2; exit 1; }
kubectl -n more patch cronjob done -p '{"spec":{"suspend":true}}' >/dev/null
for _ in $(seq 1 24); do
  [ -z "$(kubectl -n more get cronjob done -o jsonpath='{.status.active}')" ] && break
  sleep 5
done
test -z "$(kubectl -n more get cronjob done -o jsonpath='{.status.active}')" || { echo "the Job of the CronJob done was still active after 120 s" >&2; exit 1; }

# The finalizer of the one object in it holds the Namespace in Terminating for as long as the cluster lives.
kubectl delete namespace terminating --wait=false >/dev/null
echo "more kinds: done"
