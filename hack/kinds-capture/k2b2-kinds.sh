#!/usr/bin/env bash
# Makes the objects of k2b2-kinds.yaml on a cluster that already holds the slice fixture of the host, extra-states.yaml and more-kinds.yaml (more-kinds.sh), and does what a manifest cannot say:
#
#   KUBECONFIG=<the cluster's kubeconfig> hack/kinds-capture/k2b2-kinds.sh
#
# It reads and writes the cluster of KUBECONFIG and no other. About four minutes: claims that bind, volumes that are released, fail and are lost, metrics-server, and the autoscalers' first readings.
set -euo pipefail

: "${KUBECONFIG:?KUBECONFIG is required: the kubeconfig of the cluster to fill}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# until_ok <seconds> <what> <expression>: evaluates the expression every 3 s until it holds, and stops the script when it does not in time. The expression is a string, evaluated each time:
# a command substitution in it must be read again, not once when the call is made.
until_ok() {
  local seconds="$1" what="$2" expression="$3"
  local waited=0
  until eval "$expression" >/dev/null 2>&1; do
    waited=$((waited + 3))
    if [ "$waited" -gt "$seconds" ]; then echo "k2b2: $what did not happen in $seconds s" >&2; exit 1; fi
    sleep 3
  done
}
# phase_is <phase> <kubectl get arguments...>: the object is in the phase.
phase_is() { [ "$(kubectl "${@:2}" -o jsonpath='{.status.phase}')" = "$1" ]; }
# condition_is <hpa> <type> <status>: the autoscaler's condition has the status.
condition_is() { [ "$(kubectl -n autoscale get hpa "$1" -o jsonpath="{.status.conditions[?(@.type=='$2')].status}")" = "$3" ]; }

kubectl apply --server-side --force-conflicts -f "$HERE/k2b2-kinds.yaml" >/dev/null

# ---- Storage: claims bind (the ones that name their volume at once, the ones of `standard` when their Pod is scheduled) ----
for claim in claim-bound claim-released claim-failed claim-lost claim-terminating claim-no-class; do
  until_ok 120 "$claim is Bound" "phase_is Bound -n storage get pvc $claim"
done
until_ok 180 "uses-data runs" "phase_is Running -n storage get pod uses-data"
until_ok 180 "uses-held runs" "phase_is Running -n storage get pod uses-held"
until_ok 120 "data is Bound" "phase_is Bound -n storage get pvc data"
until_ok 120 "held is Bound" "phase_is Bound -n storage get pvc held"

# Released and Failed: the claim goes. Retain keeps pv-released with its claim reference; Delete asks the hostPath deleter to remove pv-failed, which only removes what is under /tmp.
kubectl -n storage delete pvc claim-released claim-failed --wait=true >/dev/null
until_ok 120 "pv-released is Released" "phase_is Released get pv pv-released"
until_ok 180 "pv-failed is Failed" "phase_is Failed get pv pv-failed"

# Lost: the volume goes under its claim. It is deleted first, which only marks it (the protection finalizer holds it while a claim is bound to it), and the finalizer is taken off after: the other way
# round, the protection controller puts it back before the deletion comes.
kubectl delete pv pv-lost --wait=false >/dev/null
kubectl patch pv pv-lost --type=merge -p '{"metadata":{"finalizers":null}}' >/dev/null
until_ok 180 "claim-lost is Lost" "phase_is Lost -n storage get pvc claim-lost"

# Terminating: a volume that a claim is bound to is deleted and cannot go until the claim does, and a claim that a Pod uses is deleted and cannot go until the Pod does.
kubectl delete pv pv-terminating --wait=false >/dev/null
until_ok 60 "pv-terminating is Terminating" "[ -n \"\$(kubectl get pv pv-terminating -o jsonpath='{.metadata.deletionTimestamp}')\" ]"
kubectl -n storage delete pvc held --wait=false >/dev/null
until_ok 60 "held is Terminating" "[ -n \"\$(kubectl -n storage get pvc held -o jsonpath='{.metadata.deletionTimestamp}')\" ]"

# ---- Network: the Pods behind the Services, and the objects the controllers make of what was written by hand ----
kubectl -n network rollout status deploy/web --timeout=240s | tail -n 1
until_ok 120 "the Endpoints of web say four addresses" "[ \"\$(kubectl -n network get endpoints web -o jsonpath='{.subsets[0].addresses[*].ip}' | wc -w | tr -d ' ')\" = 4 ]"
until_ok 120 "the Endpoints of flaky say a not-ready address" "[ -n \"\$(kubectl -n network get endpoints flaky -o jsonpath='{.subsets[0].notReadyAddresses[0].ip}')\" ]"
until_ok 120 "the mirroring controller made the EndpointSlice of no-selector" "[ -n \"\$(kubectl -n network get endpointslices -l endpointslice.kubernetes.io/managed-by=endpointslicemirroring-controller.k8s.io -o name)\" ]"

# ---- Config: the Pods that use the quota, then metrics-server for the autoscalers ----
kubectl -n quotas rollout status deploy/consumer --timeout=240s | tail -n 1
until_ok 180 "defaulted runs" "phase_is Running -n quotas get pod defaulted"
until_ok 120 "the quota compute counts the Pods" "[ -n \"\$(kubectl -n quotas get resourcequota compute -o jsonpath='{.status.used.pods}')\" ]"
kubectl apply -f "$HERE/metrics-server.yaml" >/dev/null
kubectl -n kube-system rollout status deploy/metrics-server --timeout=240s | tail -n 1
until_ok 240 "the metrics API is available" "[ \"\$(kubectl get apiservice v1beta1.metrics.k8s.io -o jsonpath='{.status.conditions[?(@.type==\"Available\")].status}')\" = True ]"
for target in web floor no-request multi zero; do
  kubectl -n autoscale rollout status "deploy/$target" --timeout=240s >/dev/null 2>&1 || true
done
# The first readings: the autoscalers say Scaling active (multi), Limited (web and floor: idle, held at their floors), Unable to scale (no-request, zero).
until_ok 300 "hpa/web: ScalingActive True" "condition_is web ScalingActive True"
until_ok 300 "hpa/web: ScalingLimited True" "condition_is web ScalingLimited True"
until_ok 300 "hpa/multi: ScalingActive True" "condition_is multi ScalingActive True"
until_ok 300 "hpa/floor: ScalingLimited True" "condition_is floor ScalingLimited True"
until_ok 300 "hpa/no-request: ScalingActive False" "condition_is no-request ScalingActive False"
until_ok 300 "hpa/zero: ScalingActive False" "condition_is zero ScalingActive False"
until_ok 300 "the disruption budgets have a status" "[ -n \"\$(kubectl -n autoscale get pdb strict -o jsonpath='{.status.expectedPods}')\" ]"
echo "k2b2 kinds: done"
