package resource

import (
	"net/url"
	"regexp"
	"slices"
	"strings"

	"github.com/omniview/kubernetes/pkg/connid"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

var (
	eksClusterARN       = regexp.MustCompile(`^arn:(aws|aws-us-gov|aws-cn):eks:([a-z]{2}(?:-[a-z]+)+-[0-9]+):([0-9]{12}):cluster/([A-Za-z0-9][A-Za-z0-9_-]{0,99})$`)
	localClusterID      = regexp.MustCompile(`^(kind|k3d)-[A-Za-z0-9][A-Za-z0-9_.-]*$`)
	gkeClusterID        = regexp.MustCompile(`^gke_([a-z][a-z0-9-]{4,61}[a-z0-9])_([a-z]+-[a-z]+[0-9]+(?:-[a-z])?)_([A-Za-z0-9][A-Za-z0-9-]*)$`)
	awsRegion           = regexp.MustCompile(`^[a-z]{2}(?:-[a-z]+)+-[0-9]+$`)
	gcpRegion           = regexp.MustCompile(`^[a-z]+-[a-z]+[0-9]+$`)
	gcpZone             = regexp.MustCompile(`^([a-z]+-[a-z]+[0-9]+)-[a-z]$`)
	gcpProject          = regexp.MustCompile(`^[a-z][a-z0-9-]{4,61}[a-z0-9]$`)
	azureSubscription   = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	azureResourceGroup  = regexp.MustCompile(`^[A-Za-z0-9_()][A-Za-z0-9_.()-]{0,89}$`)
	eksHost             = regexp.MustCompile(`^[a-z0-9]+\.(?:[a-z0-9]+\.)?([a-z]{2}(?:-[a-z]+)+-[0-9]+)\.eks\.amazonaws\.com(?:\.cn)?$`)
	aksHost             = regexp.MustCompile(`^[a-z0-9-]+\.[a-z0-9-]+\.azmk8s\.io$`)
	distributionVersion = regexp.MustCompile(`^v[0-9]+\.[0-9]+\.[0-9]+(?:-(eks)-[a-f0-9]{6,40}|-(gke)\.[0-9]+|\+(k3s)[0-9]+|\+(rke2)r[0-9]+|\+(k0s)(?:\.[0-9]+)?|[-+](openshift)[.-][0-9]+(?:[.-][0-9]+)*)$`)
)

// openShiftGroup is the API group of the cluster configuration, which every OpenShift cluster serves and no other does.
const openShiftGroup = "config.openshift.io"

// clusterEvidence is what the cluster states, which the hints of the configuration are weighed against and which fills what they leave out.
type clusterEvidence struct {
	// version is the version string of the server, empty when it was not read.
	version string
	// groups are the API groups that are installed and answer (nativeCatalogSnapshot.answeredGroups).
	groups []string
	// nodes is what the Nodes that were read say.
	nodes nodeSummary
}

// distributionOf says which Kubernetes distribution the cluster is, and what said it. It takes what the cluster states and never a name from the kubeconfig: the version string of the server (`-eks-`,
// `-gke.`, `+k3s`, `+rke2`, `+k0s`), an API group only that distribution serves, the address of the API server when it is a cloud's own, then what the Nodes say (distributionOf in nodeFactsOf). It
// is empty when nothing says so: a vanilla build, which kubeadm, Docker Desktop and many others are, says nothing.
func distributionOf(host string, cluster clusterEvidence) (distribution, source string) {
	if match := distributionVersion.FindStringSubmatch(cluster.version); match != nil {
		for _, candidate := range match[1:] {
			if candidate != "" {
				return candidate, "server_version"
			}
		}
	}
	if slices.Contains(cluster.groups, openShiftGroup) {
		return "openshift", "api_group"
	}
	switch {
	case eksHost.MatchString(host):
		return "eks", "server_endpoint"
	case isAKSHost(host):
		return "aks", "server_endpoint"
	}
	if cluster.nodes.distribution != "" {
		return cluster.nodes.distribution, "node"
	}
	return "", ""
}

// inferConnectionEnvironment consumes the existing configuration, the admitted server observation and what the cluster says. Configuration labels are hints, not infrastructure proof: what the cluster
// says is weighed against them, and fills what they leave out (the cloud, its region and its zones from the Nodes), but never replaces what the configuration stated.
func inferConnectionEnvironment(connection types.Connection, endpoint string, cluster clusterEvidence) map[string]string {
	facts := make(map[string]string)
	label := func(key string) string { value, _ := connection.Labels[key].(string); return value }
	data := func(key string) string { value, _ := connection.Data[key].(string); return value }
	provider, source := "", ""
	var arn []string
	var gke []string
	// The hints are read from the context name, which the data carries. The ID of a connection is derived and
	// says nothing about the cluster, and Name is a display name that the user may edit.
	kubeContext, _ := connid.ContextFromData(connection.Data)
	for _, id := range []string{kubeContext, data("cluster"), label(LabelKubeconfigCluster)} {
		if match := eksClusterARN.FindStringSubmatch(id); match != nil {
			partition := "aws"
			if strings.HasPrefix(match[2], "cn-") {
				partition = "aws-cn"
			}
			if strings.HasPrefix(match[2], "us-gov-") {
				partition = "aws-us-gov"
			}
			if match[1] == partition {
				provider, arn = "eks", match
				break
			}
		}
		if match := gkeClusterID.FindStringSubmatch(id); match != nil {
			provider, gke = "gke", match
			continue
		}
		if match := localClusterID.FindStringSubmatch(id); match != nil {
			provider = match[1]
			continue
		}
		switch id {
		case "minikube", "docker-desktop":
			provider = id
		}
	}
	if provider == "" {
		switch label(LabelAuthMethod) {
		case "eks", "gke", "aks":
			provider = label(LabelAuthMethod)
		}
	}
	if provider != "" {
		source = "connection_config"
	}
	configProvider := provider
	endpointRegion, host := "", ""
	if parsed, err := url.Parse(endpoint); err == nil && parsed.Host != "" {
		host = strings.ToLower(parsed.Hostname())
		if match := eksHost.FindStringSubmatch(host); match != nil {
			provider, source, endpointRegion = "eks", "server_endpoint", match[1]
		}
		if isAKSHost(host) {
			provider, source = "aks", "server_endpoint"
		}
	}
	if distribution, how := distributionOf(host, cluster); distribution != "" {
		facts[FactDistribution], facts[FactDistributionSource] = distribution, how
		// A distribution need not describe hosting (for example, k3s in kind): only a cloud's own is also the platform, so that the platform keeps the words the labels give it.
		if distribution == "eks" || distribution == "gke" {
			provider, source = distribution, how
		}
	}
	if provider != "" {
		facts[FactPlatform], facts[FactPlatformSource] = provider, source
		copyLabel := func(key, target string, valid *regexp.Regexp) {
			if configProvider != provider && label(LabelAuthMethod) != provider {
				return
			}
			if value := label(key); valid.MatchString(value) {
				facts[target] = value
			}
		}
		switch provider {
		case "eks":
			facts[FactCloudProvider] = "aws"
			copyLabel(LabelCloudRegion, FactCloudRegion, awsRegion)
			if arn != nil {
				facts[FactCloudRegion], facts[FactCloudAccountID], facts[FactClusterName] = arn[2], arn[3], arn[4]
			}
			if endpointRegion != "" {
				facts[FactCloudRegion] = endpointRegion
			}
		case "gke":
			facts[FactCloudProvider] = "gcp"
			copyLabel(LabelCloudAccountID, FactCloudAccountID, gcpProject)
			copyLabel(LabelCloudRegion, FactCloudRegion, gcpRegion)
			copyLabel(LabelCloudAvailabilityZone, FactCloudAvailabilityZone, gcpZone)
			if gke != nil {
				facts[FactCloudAccountID], facts[FactClusterName] = gke[1], gke[3]
				if gcpZone.MatchString(gke[2]) {
					facts[FactCloudAvailabilityZone] = gke[2]
				} else {
					facts[FactCloudRegion] = gke[2]
				}
			}
			if zone := facts[FactCloudAvailabilityZone]; zone != "" && facts[FactCloudRegion] == "" {
				facts[FactCloudRegion] = gcpZone.FindStringSubmatch(zone)[1]
			}
		case "aks":
			facts[FactCloudProvider] = "azure"
			copyLabel(LabelCloudAccountID, FactCloudAccountID, azureSubscription)
			copyLabel(LabelAzureResourceGroup, FactAzureResourceGroup, azureResourceGroup)
		}
	}
	// The Nodes say what the configuration did not.
	for key, value := range map[string]string{FactCloudProvider: cluster.nodes.cloud, FactCloudRegion: cluster.nodes.region, FactCloudAvailabilityZone: cluster.nodes.zones} {
		if value != "" && facts[key] == "" {
			facts[key] = value
		}
	}
	return facts
}

// isAKSHost reports whether an address is an AKS API server's own: <name>.<region>.azmk8s.io, or <name>.hcp.<region>.azmk8s.io.
func isAKSHost(host string) bool {
	return aksHost.MatchString(host) || aksHCPHost.MatchString(host)
}
