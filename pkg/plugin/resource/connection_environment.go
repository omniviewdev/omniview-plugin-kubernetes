package resource

import (
	"net/url"
	"regexp"
	"strings"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

var environmentMetadataKeys = []string{
	"kubernetes.provider", "kubernetes.provider_source", "kubernetes.distribution", "kubernetes.distribution_source", "cloud.provider",
	"aws.region", "aws.account_id", "gcp.region", "gcp.zone", "gcp.project_id", "azure.subscription_id", "azure.resource_group",
}

var (
	eksClusterARN      = regexp.MustCompile(`^arn:(aws|aws-us-gov|aws-cn):eks:([a-z]{2}(?:-[a-z]+)+-[0-9]+):([0-9]{12}):cluster/[A-Za-z0-9][A-Za-z0-9_-]{0,99}$`)
	localClusterID     = regexp.MustCompile(`^(kind|k3d)-[A-Za-z0-9][A-Za-z0-9_.-]*$`)
	gkeClusterID       = regexp.MustCompile(`^gke_([a-z][a-z0-9-]{4,61}[a-z0-9])_([a-z]+-[a-z]+[0-9]+(?:-[a-z])?)_([A-Za-z0-9][A-Za-z0-9-]*)$`)
	awsRegion          = regexp.MustCompile(`^[a-z]{2}(?:-[a-z]+)+-[0-9]+$`)
	gcpRegion          = regexp.MustCompile(`^[a-z]+-[a-z]+[0-9]+$`)
	gcpZone            = regexp.MustCompile(`^([a-z]+-[a-z]+[0-9]+)-[a-z]$`)
	gcpProject         = regexp.MustCompile(`^[a-z][a-z0-9-]{4,61}[a-z0-9]$`)
	azureSubscription  = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	azureResourceGroup = regexp.MustCompile(`^[A-Za-z0-9_()][A-Za-z0-9_.()-]{0,89}$`)
	eksHost            = regexp.MustCompile(`^[a-z0-9]+\.(?:[a-z0-9]+\.)?([a-z]{2}(?:-[a-z]+)+-[0-9]+)\.eks\.amazonaws\.com(?:\.cn)?$`)
	aksHost            = regexp.MustCompile(`^[a-z0-9-]+\.[a-z0-9-]+\.azmk8s\.io$`)
	providerVersion    = regexp.MustCompile(`^v[0-9]+\.[0-9]+\.[0-9]+(?:-(eks)-[a-f0-9]{6,40}|-(gke)\.[0-9]+|\+(k3s)[0-9]+|\+(rke2)r[0-9]+|[-+](openshift)[.-][0-9]+(?:[.-][0-9]+)*)$`)
)

// inferConnectionEnvironment consumes only existing configuration and the admitted
// server observation. Configuration labels are hints, not infrastructure proof.
func inferConnectionEnvironment(connection types.Connection, endpoint, version string) map[string]string {
	facts := make(map[string]string)
	label := func(key string) string { value, _ := connection.Labels[key].(string); return value }
	data := func(key string) string { value, _ := connection.Data[key].(string); return value }
	provider, source := "", ""
	var arn []string
	var gke []string
	for _, id := range []string{connection.ID, data("cluster"), label("cluster")} {
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
		switch label("auth_method") {
		case "eks", "gke", "aks":
			provider = label("auth_method")
		}
	}
	if provider != "" {
		source = "connection_config"
	}
	configProvider := provider
	endpointRegion := ""
	if parsed, err := url.Parse(endpoint); err == nil && parsed.Host != "" {
		host := strings.ToLower(parsed.Hostname())
		if match := eksHost.FindStringSubmatch(host); match != nil {
			provider, source, endpointRegion = "eks", "server_endpoint", match[1]
		}
		if aksHost.MatchString(host) {
			provider, source = "aks", "server_endpoint"
		}
	}
	if match := providerVersion.FindStringSubmatch(version); match != nil {
		distribution := ""
		for _, candidate := range match[1:] {
			if candidate != "" {
				distribution = candidate
				break
			}
		}
		facts["kubernetes.distribution"] = distribution
		facts["kubernetes.distribution_source"] = "server_version"
		// A distribution need not describe hosting (for example, k3s in kind).
		if distribution == "eks" || distribution == "gke" || provider == "" {
			provider, source = distribution, "server_version"
		}
	}
	if provider == "" {
		return facts
	}
	facts["kubernetes.provider"], facts["kubernetes.provider_source"] = provider, source
	copyLabel := func(key, target string, valid *regexp.Regexp) {
		if configProvider != provider && label("auth_method") != provider {
			return
		}
		if value := label(key); valid.MatchString(value) {
			facts[target] = value
		}
	}
	switch provider {
	case "eks":
		facts["cloud.provider"] = "aws"
		copyLabel("region", "aws.region", awsRegion)
		if arn != nil {
			facts["aws.region"], facts["aws.account_id"] = arn[2], arn[3]
		}
		if endpointRegion != "" {
			facts["aws.region"] = endpointRegion
		}
	case "gke":
		facts["cloud.provider"] = "gcp"
		copyLabel("project", "gcp.project_id", gcpProject)
		copyLabel("region", "gcp.region", gcpRegion)
		copyLabel("zone", "gcp.zone", gcpZone)
		if gke != nil {
			facts["gcp.project_id"] = gke[1]
			if gcpZone.MatchString(gke[2]) {
				facts["gcp.zone"] = gke[2]
			} else {
				facts["gcp.region"] = gke[2]
			}
		}
		if zone := facts["gcp.zone"]; zone != "" && facts["gcp.region"] == "" {
			facts["gcp.region"] = gcpZone.FindStringSubmatch(zone)[1]
		}
	case "aks":
		facts["cloud.provider"] = "azure"
		copyLabel("subscription", "azure.subscription_id", azureSubscription)
		copyLabel("resource_group", "azure.resource_group", azureResourceGroup)
	}
	return facts
}
