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

// Connection labels.
//
// A discovered connection carries what its kubeconfig states about it as labels, so the UI can show
// them without connecting. No label needs a network call, and none holds a credential. A key is
// absent when the kubeconfig does not state the fact: nothing is guessed.
//
// Set for every connection (connectionsFromKubeconfig):
//
//	kubeconfig   the kubeconfig file the context was read from
//	cluster      the cluster entry the context names
//	user         the user entry the context names
//	server       the API server URL of the cluster, without userinfo, query or fragment (absent if it does not parse)
//	host         the host name of server, without the port
//	namespace    the default namespace of the context, when it sets one
//	auth_method  `eks`, `gke` or `aks` for the credential commands of those clouds, the command of any other
//	             exec credential, and `default` when the user has no exec credential
//
// Set only when the kubeconfig states them:
//
//	platform       what the cluster runs on: `eks`, `gke`, `aks`, `kind`, `k3d`, `minikube`, `docker-desktop`,
//	               `rancher-desktop` or `orbstack` (see connectionPlatform); absent if it is not told for sure
//	cluster_name   the cluster's own name, from an EKS cluster ARN or a `gke_<project>_<location>_<cluster>` context name
//	region         from the EKS cluster ARN, an EKS or AKS server host, a GKE context name, or the exec arguments
//	zone           from a GKE context name or the `--zone` exec argument
//	account        from the EKS cluster ARN, else the account of the exec role ARN (a role's account is not always the cluster's)
//	project        from a GKE context name or the gcloud exec arguments
//	subscription   from the az exec arguments
//	resource_group from the az exec arguments
//	profile        the AWS_PROFILE of the exec credential
//	role           the role ARN of the aws exec credential
//
// `environment` is not set: a kubeconfig has no field that states one, and a name never says it.

const loopbackName = "localhost"

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
		labels["namespace"] = context.Namespace
	}
	host := ""
	if cluster := config.Clusters[context.Cluster]; cluster != nil {
		_, host = serverLabels(cluster.Server)
	}
	lowerHost := strings.ToLower(host)
	if match := eksHost.FindStringSubmatch(lowerHost); match != nil {
		labels["region"] = match[1]
	}
	if match := aksHCPHost.FindStringSubmatch(lowerHost); match != nil {
		labels["region"] = match[1]
	}
	for _, name := range []string{contextName, context.Cluster} {
		if cluster, ok := parseEKSClusterARN(name); ok {
			labels["cluster_name"], labels["region"], labels["account"] = cluster.Cluster, cluster.Region, cluster.Account
			break
		}
		if match := gkeClusterID.FindStringSubmatch(name); match != nil {
			labels["project"], labels["cluster_name"] = match[1], match[3]
			if gcpZone.MatchString(match[2]) {
				labels["zone"] = match[2]
			} else {
				labels["region"] = match[2]
			}
			break
		}
	}
	if platform := connectionPlatform(config, contextName, context, lowerHost); platform != "" {
		labels["platform"] = platform
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
