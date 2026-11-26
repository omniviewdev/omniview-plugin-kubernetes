package resource

import (
	"maps"
	"slices"
	"strings"
)

// capabilityGroups is the one table of the notable API groups a cluster may have installed, and the short name each is given in the fact kubernetes.capabilities. A group is one API group, which under
// widens to every group below it (`istio.io` is `networking.istio.io`, `security.istio.io`, ...); several groups of a name are one capability. A group that is not here says nothing of the cluster:
// there are thousands, and the fact is a list a person reads, not an inventory.
var capabilityGroups = []struct {
	group string
	under bool
	name  string
}{
	{"metrics.k8s.io", false, "metrics"},
	{"gateway.networking.k8s.io", false, "gateway-api"},
	{"argoproj.io", false, "argo"},
	{"toolkit.fluxcd.io", true, "flux"},
	{"istio.io", true, "istio"},
	{"cert-manager.io", true, "cert-manager"},
	{"monitoring.coreos.com", false, "prometheus-operator"},
	{"karpenter.sh", false, "karpenter"},
	{"keda.sh", true, "keda"},
	{"kyverno.io", true, "kyverno"},
	{"velero.io", false, "velero"},
	{"tekton.dev", true, "tekton"},
	{"knative.dev", true, "knative"},
	{"external-secrets.io", true, "external-secrets"},
	{"crossplane.io", true, "crossplane"},
}

// capabilitiesOf is the value of the fact kubernetes.capabilities: the short names (capabilityGroups) of the notable groups among those installed, each once, sorted and separated by a comma
// (`argo,cert-manager,istio,metrics`). It is empty when none is.
func capabilitiesOf(groups []string) string {
	found := make(map[string]struct{})
	for _, group := range groups {
		for _, rule := range capabilityGroups {
			if group == rule.group || (rule.under && strings.HasSuffix(group, "."+rule.group)) {
				found[rule.name] = struct{}{}
				break
			}
		}
	}
	return strings.Join(slices.Sorted(maps.Keys(found)), ",")
}
