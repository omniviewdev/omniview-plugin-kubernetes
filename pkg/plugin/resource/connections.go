package resource

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/omniview/kubernetes/pkg/connid"
	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/utils"
)

const (
	// Estimated size of a the number of contexts in a kubeconfig.
	EstimatedContexts = 10
)

// eksContextARN is the name of a context that `aws eks update-kubeconfig` writes: the ARN of the cluster, `arn:<partition>:eks:<region>:<account>:cluster/<cluster>`. The partition is
// aws, aws-cn or aws-us-gov, the account is 12 digits, and a cluster name is 1 to 100 characters that start with a letter or a digit and go on with letters, digits, `-` or `_`.
// The whole text must match: anything else is not such an ARN. It reads the display name and only that; the environment inference (eksClusterARN) keeps its own, stricter rule.
var eksContextARN = regexp.MustCompile(`^arn:(?:aws|aws-cn|aws-us-gov):eks:([a-z0-9-]+):([0-9]{12}):cluster/([A-Za-z0-9][A-Za-z0-9_-]{0,99})$`)

// eksCluster is what the name of a context that is an EKS cluster ARN says about the cluster.
type eksCluster struct {
	Cluster string
	Region  string
	Account string
}

// parseEKSClusterARN reads the name of a context as an EKS cluster ARN. It reports false for a name that is not exactly one.
func parseEKSClusterARN(contextName string) (eksCluster, bool) {
	match := eksContextARN.FindStringSubmatch(contextName)
	if match == nil {
		return eksCluster{}, false
	}
	return eksCluster{Region: match[1], Account: match[2], Cluster: match[3]}, true
}

// description is the secondary text of the cluster's connection: `EKS · <region> · <account>`, with a space, a middle dot (U+00B7) and a space between the parts.
func (c eksCluster) description() string {
	return "EKS \u00B7 " + c.Region + " \u00B7 " + c.Account
}

// connectionDisplay is the Name and the Description of the connection made from one context. The host prints them and parses neither, so the plugin says them: the name of a context that
// is an EKS cluster ARN reads as the cluster's name, with the region and the account as the description; any other context name is the Name as it is, with no Description.
func connectionDisplay(contextName string) (name, description string) {
	if cluster, ok := parseEKSClusterARN(contextName); ok {
		return cluster.Cluster, cluster.description()
	}
	return contextName, ""
}

// connectionsFromKubeconfig reads the contexts of one kubeconfig file as connections.
//
// The Name of a connection is the name of its context, except for a context that is named by an EKS
// cluster ARN: its Name is the cluster's name and its Description is `EKS · <region> · <account>`
// (see connectionDisplay). The Name is for reading and the user may edit it. Its public data carries
// the exact context name, the full ARN included, under connid.DataKeyContext, which is what selects
// the context wherever clients are built. Its ID is derived from the file and the exact context name
// (see package connid), so that two files that define a context of the same name give two IDs, and
// two clusters of one name in two regions give two IDs.
//
// It also returns the target of the file, the key under which one file that is reached by two
// paths is recognized (see kubeconfigIdentity).
func connectionsFromKubeconfig(kubeconfigPath string) ([]types.Connection, string, error) {
	// if the path has a ~ in it, expand it to the home directory
	kubeconfigPath, err := utils.ExpandTilde(kubeconfigPath)
	if err != nil {
		return nil, "", err
	}

	// Load the kubeconfig file to get the configuration.
	config, err := clientcmd.LoadFromFile(kubeconfigPath)
	if err != nil {
		return nil, "", fmt.Errorf("failed to load kubeconfig from path %s: %w", kubeconfigPath, err)
	}
	locator, target, err := kubeconfigIdentity(kubeconfigPath)
	if err != nil {
		return nil, "", fmt.Errorf("failed to identify the kubeconfig: %w", err)
	}

	connections := make([]types.Connection, 0, len(config.Contexts))

	for contextName, context := range config.Contexts {
		name, description := connectionDisplay(contextName)
		labels := map[string]interface{}{
			"kubeconfig": utils.DeexpandTilde(kubeconfigPath),
			"cluster":    context.Cluster,
			"user":       context.AuthInfo,
		}
		enrichConnectionLabels(labels, config, context)

		connections = append(connections, types.Connection{
			ID:          connid.ID(connid.KindFile, locator, contextName),
			Name:        name,
			Description: description,
			Avatar:      "",
			Labels:      labels,
			Data: map[string]interface{}{
				"kubeconfig":          kubeconfigPath,
				connid.DataKeyContext: contextName,
				"cluster":             context.Cluster,
				"namespace":           context.Namespace,
				"user":                context.AuthInfo,
			},
		})
	}

	return connections, target, nil
}

// enrichConnectionLabels extracts cloud metadata from kubeconfig into connection labels
// so they can be used for dynamic grouping, filtering, and display in the frontend.
func enrichConnectionLabels(
	labels map[string]interface{},
	config *clientcmdapi.Config,
	context *clientcmdapi.Context,
) {
	if cluster := config.Clusters[context.Cluster]; cluster != nil {
		labels["server"] = cluster.Server
	}

	authInfo := config.AuthInfos[context.AuthInfo]
	if authInfo == nil || authInfo.Exec == nil {
		labels["auth_method"] = "default"
		return
	}

	switch {
	case kubeauth.IsEKSAuth(authInfo):
		labels["auth_method"] = "eks"
		enrichEKSLabels(labels, authInfo)
	case kubeauth.IsGCPAuth(authInfo):
		labels["auth_method"] = "gke"
		enrichGKELabels(labels, authInfo)
	case kubeauth.IsAKSAuth(authInfo):
		labels["auth_method"] = "aks"
		enrichAKSLabels(labels, authInfo)
	default:
		labels["auth_method"] = authInfo.Exec.Command
	}
}

// enrichEKSLabels extracts region, account, profile, and role from EKS auth config.
func enrichEKSLabels(labels map[string]interface{}, authInfo *clientcmdapi.AuthInfo) {
	var region, profile, roleArn string

	// Parse args for both aws CLI and aws-iam-authenticator
	for i := 0; i < len(authInfo.Exec.Args)-1; i++ {
		switch authInfo.Exec.Args[i] {
		case "--region":
			region = authInfo.Exec.Args[i+1]
		case "--role-arn", "--role", "-r":
			roleArn = authInfo.Exec.Args[i+1]
		}
	}

	// Parse env vars
	for _, entry := range authInfo.Exec.Env {
		switch entry.Name {
		case "AWS_PROFILE":
			profile = entry.Value
		case "AWS_REGION":
			if region == "" {
				region = entry.Value
			}
		case "AWS_DEFAULT_REGION":
			if region == "" {
				region = entry.Value
			}
		}
	}

	if region != "" {
		labels["region"] = region
	}
	if profile != "" {
		labels["profile"] = profile
	}
	if roleArn != "" {
		labels["role"] = roleArn
		// Extract account ID from ARN: arn:aws:iam::ACCOUNT_ID:...
		if parts := strings.SplitN(roleArn, ":", 6); len(parts) >= 5 {
			labels["account"] = parts[4]
		}
	}
}

// enrichGKELabels extracts project, zone/region from GKE gcloud exec config.
func enrichGKELabels(labels map[string]interface{}, authInfo *clientcmdapi.AuthInfo) {
	for i := 0; i < len(authInfo.Exec.Args)-1; i++ {
		switch authInfo.Exec.Args[i] {
		case "--project":
			labels["project"] = authInfo.Exec.Args[i+1]
		case "--zone":
			labels["zone"] = authInfo.Exec.Args[i+1]
		case "--region":
			labels["region"] = authInfo.Exec.Args[i+1]
		}
	}

	// Check env vars as fallback
	for _, entry := range authInfo.Exec.Env {
		if entry.Name == "CLOUDSDK_CORE_PROJECT" {
			if _, ok := labels["project"]; !ok {
				labels["project"] = entry.Value
			}
		}
	}
}

// enrichAKSLabels extracts subscription and resource group from Azure CLI exec config.
func enrichAKSLabels(labels map[string]interface{}, authInfo *clientcmdapi.AuthInfo) {
	for i := 0; i < len(authInfo.Exec.Args)-1; i++ {
		switch authInfo.Exec.Args[i] {
		case "--subscription":
			labels["subscription"] = authInfo.Exec.Args[i+1]
		case "--resource-group":
			labels["resource_group"] = authInfo.Exec.Args[i+1]
		}
	}
}
