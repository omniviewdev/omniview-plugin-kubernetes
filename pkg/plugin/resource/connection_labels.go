package resource

import (
	"encoding/json"
	"net"
	"net/url"
	"regexp"
	"strings"

	"k8s.io/apimachinery/pkg/runtime"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
)

// The label keys of a discovered connection.
//
// A discovered connection carries what its kubeconfig states about it as labels, so the UI can show them without connecting. No label needs a network call, and none holds a credential. A
// key is absent when the kubeconfig does not state the fact: nothing is guessed, and nothing is inferred from a name unless the name's format is the documented one (see connectionPlatform).
//
// The keys follow the OpenTelemetry resource semantic conventions where one exists (`cloud.*`, `k8s.cluster.name`); the others are the plugin's: `kubeconfig.*` (what the kubeconfig says), `kubernetes.*`
// (the cluster and where it runs), `auth.*`, and the cloud's own (`aws.*`, `azure.*`).
//
// Set for every connection (connectionsFromKubeconfig):
//
//	kubeconfig.path        LabelKubeconfigPath       the kubeconfig file the context was read from
//	kubeconfig.cluster     LabelKubeconfigCluster    the cluster entry the context names
//	kubeconfig.user        LabelKubeconfigUser       the user entry the context names
//	kubernetes.server      LabelKubernetesServer     the API server URL, without userinfo, query or fragment (absent if it does not parse)
//	kubernetes.host        LabelKubernetesHost       the host name of the server, without the port
//	kubernetes.namespace   LabelKubernetesNamespace  the default namespace of the context, when it sets one
//	auth.method            LabelAuthMethod           `eks`, `gke` or `aks` for the credential commands of those clouds, the command of any other exec credential, `default` when the user has none
//
// Set only when the kubeconfig states them:
//
//	kubernetes.platform    LabelKubernetesPlatform   what the cluster runs on: `eks`, `gke`, `aks`, `kind`, `k3d`, `minikube`, `docker-desktop`, `rancher-desktop` or `orbstack` (see connectionPlatform)
//	cloud.provider         LabelCloudProvider        `aws`, `gcp` or `azure`, when the platform is `eks`, `gke` or `aks`
//	cloud.region           LabelCloudRegion          from the EKS cluster ARN, an EKS or AKS server host, a GKE context name, or the exec arguments
//	cloud.availability_zone LabelCloudAvailabilityZone from a GKE context name or the `--zone` exec argument
//	cloud.account.id       LabelCloudAccountID       the cloud account of the cluster: the account of an EKS cluster ARN, the GCP project of a GKE context name or gcloud arguments, the Azure subscription of az arguments.
//	                                                 The account of an exec role ARN is not it (a role may be in another account) and is not set
//	k8s.cluster.name       LabelK8sClusterName       the cloud's name for the cluster, from an EKS cluster ARN or a `gke_<project>_<location>_<cluster>` context name
//	aws.profile            LabelAWSProfile           the AWS_PROFILE of the exec credential
//	aws.role               LabelAWSRole              the role ARN of the aws exec credential
//	azure.resource_group   LabelAzureResourceGroup   the resource group of the az exec arguments
//
// `environment` is not set: a kubeconfig has no field that states one, and a name never says it. The context's name is not a label: the connection's Data carries it (connid.DataKeyContext).
const (
	LabelKubeconfigPath        = "kubeconfig.path"
	LabelKubeconfigCluster     = "kubeconfig.cluster"
	LabelKubeconfigUser        = "kubeconfig.user"
	LabelKubernetesServer      = "kubernetes.server"
	LabelKubernetesHost        = "kubernetes.host"
	LabelKubernetesNamespace   = "kubernetes.namespace"
	LabelKubernetesPlatform    = "kubernetes.platform"
	LabelAuthMethod            = "auth.method"
	LabelCloudProvider         = "cloud.provider"
	LabelCloudRegion           = "cloud.region"
	LabelCloudAvailabilityZone = "cloud.availability_zone"
	LabelCloudAccountID        = "cloud.account.id"
	LabelK8sClusterName        = "k8s.cluster.name"
	LabelAWSProfile            = "aws.profile"
	LabelAWSRole               = "aws.role"
	LabelAzureResourceGroup    = "azure.resource_group"
)

const loopbackName = "localhost"

// cloudOfPlatform is the cloud a managed platform is in (OpenTelemetry `cloud.provider` values).
var cloudOfPlatform = map[string]string{"eks": "aws", "gke": "gcp", "aks": "azure"}

var aksHCPHost = regexp.MustCompile(`^[a-z0-9-]+\.hcp\.([a-z0-9]+)\.azmk8s\.io$`)

// serverLabels is the API server a label may state: the URL without userinfo, query and fragment, and its host name. A URL that does not
// parse, or has no host, says nothing: it could hold a secret in a form that is not understood.
func serverLabels(server string) (clean, host string) {
	parsed, err := url.Parse(server)
	if err != nil || parsed.Hostname() == "" {
		return "", ""
	}
	parsed.User, parsed.RawQuery, parsed.Fragment = nil, "", ""
	return parsed.String(), parsed.Hostname()
}

// enrichClusterLabels adds the facts the context, the cluster entry and the names state about the cluster. It runs after enrichConnectionLabels.
func enrichClusterLabels(labels map[string]interface{}, config *clientcmdapi.Config, contextName string, context *clientcmdapi.Context) {
	if context.Namespace != "" {
		labels[LabelKubernetesNamespace] = context.Namespace
	}
	host := ""
	if cluster := config.Clusters[context.Cluster]; cluster != nil {
		_, host = serverLabels(cluster.Server)
	}
	lowerHost := strings.ToLower(host)
	if match := eksHost.FindStringSubmatch(lowerHost); match != nil {
		labels[LabelCloudRegion] = match[1]
	}
	if match := aksHCPHost.FindStringSubmatch(lowerHost); match != nil {
		labels[LabelCloudRegion] = match[1]
	}
	for _, name := range []string{contextName, context.Cluster} {
		if cluster, ok := parseEKSClusterARN(name); ok {
			labels[LabelK8sClusterName], labels[LabelCloudRegion], labels[LabelCloudAccountID] = cluster.Cluster, cluster.Region, cluster.Account
			break
		}
		if match := gkeClusterID.FindStringSubmatch(name); match != nil {
			labels[LabelCloudAccountID], labels[LabelK8sClusterName] = match[1], match[3]
			if gcpZone.MatchString(match[2]) {
				labels[LabelCloudAvailabilityZone] = match[2]
			} else {
				labels[LabelCloudRegion] = match[2]
			}
			break
		}
	}
	if platform := connectionPlatform(config, contextName, context, lowerHost); platform != "" {
		labels[LabelKubernetesPlatform] = platform
		if cloud, ok := cloudOfPlatform[platform]; ok {
			labels[LabelCloudProvider] = cloud
		}
	}
}

// connectionPlatform tells what the cluster runs on from the kubeconfig alone, or says "" when it cannot tell for sure. Each rule is a documented
// naming or address convention; the platform is set only when the rules that apply agree on one:
//
//	eks             the aws eks / aws-iam-authenticator exec credential, an EKS cluster ARN as context or cluster name, or an *.eks.amazonaws.com host
//	gke             the gcloud or gke-gcloud-auth-plugin exec credential, or a gke_<project>_<location>_<cluster> context or cluster name
//	aks             the az exec credential, or an *.azmk8s.io host
//	kind, k3d       context and cluster are both named kind-<name> / k3d-<name>, and the server is a loopback or unspecified address
//	minikube        the minikube.sigs.k8s.io provider extension of the cluster or context, or context, cluster and user all named `minikube`
//	docker-desktop, rancher-desktop, orbstack
//	                context and cluster are both named docker-desktop / rancher-desktop / orbstack
func connectionPlatform(config *clientcmdapi.Config, contextName string, context *clientcmdapi.Context, lowerHost string) string {
	found := map[string]struct{}{}
	add := func(platform string) { found[platform] = struct{}{} }

	if auth := config.AuthInfos[context.AuthInfo]; auth != nil && auth.Exec != nil {
		switch {
		case kubeauth.IsEKSAuth(auth):
			add("eks")
		case kubeauth.IsGCPAuth(auth), auth.Exec.Command == "gke-gcloud-auth-plugin":
			add("gke")
		case kubeauth.IsAKSAuth(auth):
			add("aks")
		}
	}
	for _, name := range []string{contextName, context.Cluster} {
		if _, ok := parseEKSClusterARN(name); ok {
			add("eks")
		}
		if gkeClusterID.MatchString(name) {
			add("gke")
		}
	}
	if eksHost.MatchString(lowerHost) {
		add("eks")
	}
	if strings.HasSuffix(lowerHost, ".azmk8s.io") {
		add("aks")
	}

	sameName := contextName == context.Cluster
	local := isLocalHost(lowerHost)
	for _, prefix := range []string{"kind", "k3d"} {
		if sameName && local && strings.HasPrefix(contextName, prefix+"-") && len(contextName) > len(prefix)+1 {
			add(prefix)
		}
	}
	if (sameName && contextName == "minikube" && context.AuthInfo == "minikube") || isMinikube(config.Clusters[context.Cluster], context) {
		add("minikube")
	}
	if sameName {
		switch contextName {
		case "docker-desktop", "rancher-desktop", "orbstack":
			add(contextName)
		}
	}

	if len(found) != 1 {
		return ""
	}
	for platform := range found {
		return platform
	}
	return ""
}

func isLocalHost(host string) bool {
	if host == loopbackName {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsUnspecified())
}

// isMinikube reports whether minikube wrote the context or its cluster: it adds an extension named context_info / cluster_info whose provider is minikube.sigs.k8s.io.
func isMinikube(cluster *clientcmdapi.Cluster, context *clientcmdapi.Context) bool {
	return extensionProvider(context.Extensions, "context_info") == "minikube.sigs.k8s.io" ||
		cluster != nil && extensionProvider(cluster.Extensions, "cluster_info") == "minikube.sigs.k8s.io"
}

func extensionProvider(extensions map[string]runtime.Object, name string) string {
	unknown, ok := extensions[name].(*runtime.Unknown)
	if !ok {
		return ""
	}
	var body struct {
		Provider string `json:"provider"`
	}
	if json.Unmarshal(unknown.Raw, &body) != nil {
		return ""
	}
	return body.Provider
}
