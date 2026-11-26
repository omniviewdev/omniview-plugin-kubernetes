package resource

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// --- enrichConnectionLabels ---

func TestEnrichConnectionLabels_DefaultAuth(t *testing.T) {
	labels := make(map[string]interface{})
	config := &clientcmdapi.Config{
		Clusters: map[string]*clientcmdapi.Cluster{
			"my-cluster": {Server: "https://10.0.0.1:6443"},
		},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{
			"my-user": {}, // no Exec
		},
	}
	ctx := &clientcmdapi.Context{
		Cluster:  "my-cluster",
		AuthInfo: "my-user",
	}

	enrichConnectionLabels(labels, config, ctx)

	assert.Equal(t, "https://10.0.0.1:6443", labels["server"])
	assert.Equal(t, "default", labels["auth_method"])
}

func TestEnrichConnectionLabels_EKSAuth(t *testing.T) {
	labels := make(map[string]interface{})
	config := &clientcmdapi.Config{
		Clusters: map[string]*clientcmdapi.Cluster{
			"eks-cluster": {Server: "https://ABC.eks.amazonaws.com"},
		},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{
			"eks-user": {
				Exec: &clientcmdapi.ExecConfig{
					Command: "aws",
					Args:    []string{"eks", "get-token", "--region", "us-west-2", "--cluster-name", "my-cluster"},
					Env: []clientcmdapi.ExecEnvVar{
						{Name: "AWS_PROFILE", Value: "staging"},
					},
				},
			},
		},
	}
	ctx := &clientcmdapi.Context{
		Cluster:  "eks-cluster",
		AuthInfo: "eks-user",
	}

	enrichConnectionLabels(labels, config, ctx)

	assert.Equal(t, "eks", labels["auth_method"])
	assert.Equal(t, "us-west-2", labels["region"])
	assert.Equal(t, "staging", labels["profile"])
}

func TestEnrichConnectionLabels_GKEAuth(t *testing.T) {
	labels := make(map[string]interface{})
	config := &clientcmdapi.Config{
		Clusters: map[string]*clientcmdapi.Cluster{
			"gke-cluster": {Server: "https://gke.example.com"},
		},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{
			"gke-user": {
				Exec: &clientcmdapi.ExecConfig{
					Command: "gcloud",
					Args:    []string{"container", "clusters", "get-credentials", "--project", "my-project", "--zone", "us-central1-a"},
				},
			},
		},
	}
	ctx := &clientcmdapi.Context{
		Cluster:  "gke-cluster",
		AuthInfo: "gke-user",
	}

	enrichConnectionLabels(labels, config, ctx)

	assert.Equal(t, "gke", labels["auth_method"])
	assert.Equal(t, "my-project", labels["project"])
	assert.Equal(t, "us-central1-a", labels["zone"])
}

func TestEnrichConnectionLabels_AKSAuth(t *testing.T) {
	labels := make(map[string]interface{})
	config := &clientcmdapi.Config{
		Clusters: map[string]*clientcmdapi.Cluster{
			"aks-cluster": {Server: "https://aks.example.com"},
		},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{
			"aks-user": {
				Exec: &clientcmdapi.ExecConfig{
					Command: "az",
					Args:    []string{"aks", "get-credentials", "--subscription", "sub-123", "--resource-group", "rg-prod"},
				},
			},
		},
	}
	ctx := &clientcmdapi.Context{
		Cluster:  "aks-cluster",
		AuthInfo: "aks-user",
	}

	enrichConnectionLabels(labels, config, ctx)

	assert.Equal(t, "aks", labels["auth_method"])
	assert.Equal(t, "sub-123", labels["subscription"])
	assert.Equal(t, "rg-prod", labels["resource_group"])
}

func TestEnrichConnectionLabels_UnknownExecCommand(t *testing.T) {
	labels := make(map[string]interface{})
	config := &clientcmdapi.Config{
		Clusters: map[string]*clientcmdapi.Cluster{
			"cluster": {Server: "https://cluster.example.com"},
		},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{
			"user": {
				Exec: &clientcmdapi.ExecConfig{
					Command: "custom-auth-tool",
				},
			},
		},
	}
	ctx := &clientcmdapi.Context{
		Cluster:  "cluster",
		AuthInfo: "user",
	}

	enrichConnectionLabels(labels, config, ctx)

	assert.Equal(t, "custom-auth-tool", labels["auth_method"])
}

func TestEnrichConnectionLabels_MissingCluster(t *testing.T) {
	labels := make(map[string]interface{})
	config := &clientcmdapi.Config{
		Clusters:  map[string]*clientcmdapi.Cluster{},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{"user": {}},
	}
	ctx := &clientcmdapi.Context{
		Cluster:  "nonexistent",
		AuthInfo: "user",
	}

	enrichConnectionLabels(labels, config, ctx)

	_, hasServer := labels["server"]
	assert.False(t, hasServer, "missing cluster should not set server")
	assert.Equal(t, "default", labels["auth_method"])
}

func TestEnrichConnectionLabels_NilAuthInfo(t *testing.T) {
	labels := make(map[string]interface{})
	config := &clientcmdapi.Config{
		Clusters:  map[string]*clientcmdapi.Cluster{"c": {Server: "https://x"}},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{},
	}
	ctx := &clientcmdapi.Context{
		Cluster:  "c",
		AuthInfo: "nonexistent",
	}

	enrichConnectionLabels(labels, config, ctx)
	assert.Equal(t, "default", labels["auth_method"])
}

// --- enrichEKSLabels ---

func TestEnrichEKSLabels_RegionFromArgs(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "aws",
			Args:    []string{"eks", "get-token", "--region", "eu-west-1"},
		},
	}

	enrichEKSLabels(labels, auth)
	assert.Equal(t, "eu-west-1", labels["region"])
}

func TestEnrichEKSLabels_RegionFromEnv(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "aws",
			Args:    []string{"eks", "get-token"},
			Env: []clientcmdapi.ExecEnvVar{
				{Name: "AWS_REGION", Value: "ap-southeast-1"},
			},
		},
	}

	enrichEKSLabels(labels, auth)
	assert.Equal(t, "ap-southeast-1", labels["region"])
}

func TestEnrichEKSLabels_ArgsRegionTakesPrecedence(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "aws",
			Args:    []string{"--region", "from-args"},
			Env: []clientcmdapi.ExecEnvVar{
				{Name: "AWS_REGION", Value: "from-env"},
			},
		},
	}

	enrichEKSLabels(labels, auth)
	assert.Equal(t, "from-args", labels["region"])
}

func TestEnrichEKSLabels_DefaultRegionFallback(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "aws",
			Args:    []string{"eks", "get-token"},
			Env: []clientcmdapi.ExecEnvVar{
				{Name: "AWS_DEFAULT_REGION", Value: "us-east-1"},
			},
		},
	}

	enrichEKSLabels(labels, auth)
	assert.Equal(t, "us-east-1", labels["region"])
}

func TestEnrichEKSLabels_RoleArn(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "aws",
			Args:    []string{"--role-arn", "arn:aws:iam::123456789012:role/my-role"},
		},
	}

	enrichEKSLabels(labels, auth)
	assert.Equal(t, "arn:aws:iam::123456789012:role/my-role", labels["role"])
	assert.Equal(t, "123456789012", labels["account"])
}

func TestEnrichEKSLabels_ShortRoleFlag(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "aws-iam-authenticator",
			Args:    []string{"-r", "arn:aws:iam::999888777666:role/admin"},
		},
	}

	enrichEKSLabels(labels, auth)
	assert.Equal(t, "999888777666", labels["account"])
}

func TestEnrichEKSLabels_NoRoleNoAccount(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "aws",
			Args:    []string{"eks", "get-token"},
		},
	}

	enrichEKSLabels(labels, auth)
	_, hasRole := labels["role"]
	_, hasAccount := labels["account"]
	assert.False(t, hasRole)
	assert.False(t, hasAccount)
}

// --- enrichGKELabels ---

func TestEnrichGKELabels_AllFields(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "gcloud",
			Args:    []string{"container", "clusters", "get-credentials", "--project", "my-project", "--region", "us-east1"},
		},
	}

	enrichGKELabels(labels, auth)
	assert.Equal(t, "my-project", labels["project"])
	assert.Equal(t, "us-east1", labels["region"])
}

func TestEnrichGKELabels_ProjectFromEnv(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "gcloud",
			Args:    []string{"container", "clusters", "get-credentials"},
			Env: []clientcmdapi.ExecEnvVar{
				{Name: "CLOUDSDK_CORE_PROJECT", Value: "env-project"},
			},
		},
	}

	enrichGKELabels(labels, auth)
	assert.Equal(t, "env-project", labels["project"])
}

func TestEnrichGKELabels_ArgsProjectTakesPrecedence(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "gcloud",
			Args:    []string{"--project", "from-args"},
			Env: []clientcmdapi.ExecEnvVar{
				{Name: "CLOUDSDK_CORE_PROJECT", Value: "from-env"},
			},
		},
	}

	enrichGKELabels(labels, auth)
	assert.Equal(t, "from-args", labels["project"])
}

func TestEnrichGKELabels_Zone(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "gcloud",
			Args:    []string{"--zone", "us-central1-a"},
		},
	}

	enrichGKELabels(labels, auth)
	assert.Equal(t, "us-central1-a", labels["zone"])
}

// --- enrichAKSLabels ---

func TestEnrichAKSLabels_AllFields(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "az",
			Args:    []string{"aks", "get-credentials", "--subscription", "sub-abc", "--resource-group", "rg-1"},
		},
	}

	enrichAKSLabels(labels, auth)
	assert.Equal(t, "sub-abc", labels["subscription"])
	assert.Equal(t, "rg-1", labels["resource_group"])
}

func TestEnrichAKSLabels_NoArgs(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "az",
			Args:    []string{"aks", "get-credentials"},
		},
	}

	enrichAKSLabels(labels, auth)
	_, hasSub := labels["subscription"]
	_, hasRG := labels["resource_group"]
	assert.False(t, hasSub)
	assert.False(t, hasRG)
}

// --- connectionsFromKubeconfig ---

func TestConnectionsFromKubeconfig_ValidFile(t *testing.T) {
	// Create a temporary kubeconfig.
	dir := t.TempDir()
	kubeconfigPath := filepath.Join(dir, "config")

	content := `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://10.0.0.1:6443
  name: cluster-a
- cluster:
    server: https://10.0.0.2:6443
  name: cluster-b
contexts:
- context:
    cluster: cluster-a
    user: user-a
  name: context-a
- context:
    cluster: cluster-b
    user: user-b
    namespace: kube-system
  name: context-b
users:
- name: user-a
  user: {}
- name: user-b
  user: {}
current-context: context-a
`
	require.NoError(t, os.WriteFile(kubeconfigPath, []byte(content), 0644))

	conns, _, err := connectionsFromKubeconfig(kubeconfigPath)
	require.NoError(t, err)
	require.Len(t, conns, 2)

	// Build a lookup map by name: an ID is derived, and no longer the name of the context.
	byName := make(map[string]types.Connection)
	for _, c := range conns {
		byName[c.Name] = c
	}

	a := byName["context-a"]
	assert.Equal(t, "context-a", a.Name)
	assert.Equal(t, "context-a", a.Data["context"])
	assert.Equal(t, "cluster-a", a.Labels["cluster"])
	assert.Equal(t, "user-a", a.Labels["user"])
	assert.Equal(t, "https://10.0.0.1:6443", a.Labels["server"])
	assert.Equal(t, "default", a.Labels["auth_method"])

	b := byName["context-b"]
	assert.Equal(t, "kube-system", b.Data["namespace"])
}

func TestConnectionsFromKubeconfig_InvalidPath(t *testing.T) {
	_, _, err := connectionsFromKubeconfig("/nonexistent/path/config")
	require.Error(t, err)
}

func TestConnectionsFromKubeconfig_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	kubeconfigPath := filepath.Join(dir, "config")

	// A valid but empty kubeconfig.
	content := `apiVersion: v1
kind: Config
clusters: []
contexts: []
users: []
`
	require.NoError(t, os.WriteFile(kubeconfigPath, []byte(content), 0644))

	conns, _, err := connectionsFromKubeconfig(kubeconfigPath)
	require.NoError(t, err)
	assert.Empty(t, conns)
}

func TestConnectionsFromKubeconfig_EKSContext(t *testing.T) {
	dir := t.TempDir()
	kubeconfigPath := filepath.Join(dir, "config")

	content := `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://ABC.eks.amazonaws.com
  name: eks-cluster
contexts:
- context:
    cluster: eks-cluster
    user: eks-user
  name: eks-context
users:
- name: eks-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: aws
      args:
      - eks
      - get-token
      - --region
      - us-west-2
      - --cluster-name
      - my-cluster
      env:
      - name: AWS_PROFILE
        value: production
`
	require.NoError(t, os.WriteFile(kubeconfigPath, []byte(content), 0644))

	conns, _, err := connectionsFromKubeconfig(kubeconfigPath)
	require.NoError(t, err)
	require.Len(t, conns, 1)

	c := conns[0]
	assert.Equal(t, "eks", c.Labels["auth_method"])
	assert.Equal(t, "us-west-2", c.Labels["region"])
	assert.Equal(t, "production", c.Labels["profile"])
}

func TestConnectionsFromKubeconfig_GKEContext(t *testing.T) {
	dir := t.TempDir()
	kubeconfigPath := filepath.Join(dir, "config")

	content := `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://gke.example.com
  name: gke-cluster
contexts:
- context:
    cluster: gke-cluster
    user: gke-user
  name: gke-context
users:
- name: gke-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: gcloud
      args:
      - container
      - clusters
      - get-credentials
      - --project
      - my-gcp-project
      - --zone
      - us-central1-a
`
	require.NoError(t, os.WriteFile(kubeconfigPath, []byte(content), 0644))

	conns, _, err := connectionsFromKubeconfig(kubeconfigPath)
	require.NoError(t, err)
	require.Len(t, conns, 1)

	c := conns[0]
	assert.Equal(t, "gke", c.Labels["auth_method"])
	assert.Equal(t, "my-gcp-project", c.Labels["project"])
	assert.Equal(t, "us-central1-a", c.Labels["zone"])
}

// --- enrichClusterLabels ---

// clusterLabels is the labels of a context made from one cluster, user and context of a kubeconfig, as discovery builds them.
func clusterLabels(contextName string, cluster *clientcmdapi.Cluster, user *clientcmdapi.AuthInfo, context *clientcmdapi.Context) map[string]interface{} {
	config := &clientcmdapi.Config{
		Clusters:  map[string]*clientcmdapi.Cluster{context.Cluster: cluster},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{context.AuthInfo: user},
	}
	labels := map[string]interface{}{}
	enrichConnectionLabels(labels, config, context)
	enrichClusterLabels(labels, config, contextName, context)
	return labels
}

func execUser(command string, args ...string) *clientcmdapi.AuthInfo {
	return &clientcmdapi.AuthInfo{Exec: &clientcmdapi.ExecConfig{Command: command, Args: args}}
}

func TestClusterLabels_Platform(t *testing.T) {
	const eksARN = "arn:aws:eks:us-east-1:123456789012:cluster/prod"
	const gkeName = "gke_my-project_europe-west1-b_prod"
	minikubeCluster := &clientcmdapi.Cluster{Server: "https://192.168.49.2:8443", Extensions: map[string]runtime.Object{"cluster_info": &runtime.Unknown{Raw: []byte(`{"provider":"minikube.sigs.k8s.io"}`)}}}

	tests := []struct {
		name    string
		context string // the context name; the cluster is named the same unless cluster is set
		cluster string
		user    string
		server  string
		auth    *clientcmdapi.AuthInfo
		entry   *clientcmdapi.Cluster
		want    string
	}{
		{name: "aws eks exec", context: "a", server: "https://10.0.0.1", auth: execUser("aws", "eks", "get-token"), want: "eks"},
		{name: "aws-iam-authenticator exec", context: "a", server: "https://10.0.0.1", auth: execUser("aws-iam-authenticator"), want: "eks"},
		{name: "eks cluster ARN", context: eksARN, server: "https://10.0.0.1", want: "eks"},
		{name: "eks host", context: "a", server: "https://ABCDEF.gr7.us-west-2.eks.amazonaws.com", want: "eks"},
		{name: "gcloud exec", context: "a", server: "https://10.0.0.1", auth: execUser("gcloud", "config", "config-helper"), want: "gke"},
		{name: "gke auth plugin exec", context: "a", server: "https://10.0.0.1", auth: execUser("gke-gcloud-auth-plugin"), want: "gke"},
		{name: "gke context name", context: gkeName, server: "https://10.0.0.1", want: "gke"},
		{name: "az exec", context: "a", server: "https://10.0.0.1", auth: execUser("az", "account", "get-access-token"), want: "aks"},
		{name: "aks host", context: "a", server: "https://dns-1a2b.hcp.eastus.azmk8s.io:443", want: "aks"},
		{name: "kind", context: "kind-dev", server: "https://127.0.0.1:34567", want: "kind"},
		{name: "kind name on a remote server", context: "kind-dev", server: "https://10.1.2.3:6443"},
		{name: "kind name alone", context: "kind-", server: "https://127.0.0.1:34567"},
		{name: "kind name on another cluster", context: "kind-dev", cluster: "other", server: "https://127.0.0.1:34567"},
		{name: "k3d", context: "k3d-dev", server: "https://0.0.0.0:6550", want: "k3d"},
		{name: "minikube provider extension", context: "profile-1", entry: minikubeCluster, want: "minikube"},
		{name: "minikube default profile", context: "minikube", user: "minikube", server: "https://192.168.49.2:8443", want: "minikube"},
		{name: "minikube name without the user", context: "minikube", user: "someone", server: "https://192.168.49.2:8443"},
		{name: "docker-desktop", context: "docker-desktop", server: "https://kubernetes.docker.internal:6443", want: "docker-desktop"},
		{name: "rancher-desktop", context: "rancher-desktop", server: "https://127.0.0.1:6443", want: "rancher-desktop"},
		{name: "orbstack", context: "orbstack", server: "https://127.0.0.1:26443", want: "orbstack"},
		{name: "unknown", context: "prod", server: "https://10.0.0.1:6443"},
		{name: "unknown exec command", context: "prod", server: "https://10.0.0.1:6443", auth: execUser("custom-auth-tool")},
		{name: "rules that disagree", context: "kind-dev", server: "https://127.0.0.1:34567", auth: execUser("gcloud")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cluster := tt.cluster
			if cluster == "" {
				cluster = tt.context
			}
			user := tt.user
			if user == "" {
				user = "user"
			}
			entry := tt.entry
			if entry == nil {
				entry = &clientcmdapi.Cluster{Server: tt.server}
			}
			labels := clusterLabels(tt.context, entry, tt.auth, &clientcmdapi.Context{Cluster: cluster, AuthInfo: user})
			platform, has := labels["platform"]
			if tt.want == "" {
				assert.False(t, has, "no platform label: %v", platform)
				return
			}
			assert.Equal(t, tt.want, platform)
		})
	}
}

func TestClusterLabels_Facts(t *testing.T) {
	tests := []struct {
		name    string
		context string
		server  string
		ns      string
		auth    *clientcmdapi.AuthInfo
		want    map[string]interface{}
		absent  []string
	}{
		{name: "server, host and namespace", context: "a", server: "https://10.0.0.1:6443", ns: "kube-system",
			want: map[string]interface{}{"server": "https://10.0.0.1:6443", "host": "10.0.0.1", "namespace": "kube-system"}, absent: []string{"region", "account", "cluster_name", "environment"}},
		{name: "no namespace set", context: "a", server: "https://10.0.0.1:6443", absent: []string{"namespace"}},
		{name: "eks cluster ARN", context: "arn:aws:eks:us-east-1:123456789012:cluster/prod", server: "https://10.0.0.1",
			auth: execUser("aws", "eks", "get-token", "--region", "eu-west-1", "--role-arn", "arn:aws:iam::999999999999:role/r"),
			want: map[string]interface{}{"cluster_name": "prod", "region": "us-east-1", "account": "123456789012"}},
		{name: "eks host region", context: "a", server: "https://ABCDEF.gr7.us-west-2.eks.amazonaws.com",
			want: map[string]interface{}{"region": "us-west-2", "host": "ABCDEF.gr7.us-west-2.eks.amazonaws.com"}},
		{name: "gke context in a zone", context: "gke_my-project_europe-west1-b_prod", server: "https://10.0.0.1",
			want: map[string]interface{}{"project": "my-project", "zone": "europe-west1-b", "cluster_name": "prod"}, absent: []string{"region"}},
		{name: "gke context in a region", context: "gke_my-project_europe-west1_prod", server: "https://10.0.0.1",
			want: map[string]interface{}{"project": "my-project", "region": "europe-west1", "cluster_name": "prod"}, absent: []string{"zone"}},
		{name: "aks host region", context: "a", server: "https://dns-1a2b.hcp.eastus.azmk8s.io:443", want: map[string]interface{}{"region": "eastus"}},
		{name: "server without userinfo, query or fragment", context: "a", server: "https://admin:hunter2@10.0.0.1:6443/path?token=abc#frag",
			want: map[string]interface{}{"server": "https://10.0.0.1:6443/path", "host": "10.0.0.1"}},
		{name: "server that does not parse", context: "a", server: "https://admin:hunter2@[::1", absent: []string{"server", "host"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			labels := clusterLabels(tt.context, &clientcmdapi.Cluster{Server: tt.server}, tt.auth, &clientcmdapi.Context{Cluster: "c", AuthInfo: "u", Namespace: tt.ns})
			for key, want := range tt.want {
				assert.Equal(t, want, labels[key], key)
			}
			for _, key := range tt.absent {
				assert.NotContains(t, labels, key)
			}
		})
	}
}

func TestConnectionsFromKubeconfig_LabelsHoldNoSecret(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config")
	content := `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://admin:hunter2-basic@10.0.0.1:6443/?token=hunter2-query
    certificate-authority-data: aHVudGVyMi1jYQ==
  name: c
contexts:
- context: {cluster: c, user: token-user, namespace: ns}
  name: with-token
- context: {cluster: c, user: exec-user}
  name: with-exec
users:
- name: token-user
  user:
    token: hunter2-token
    client-key-data: aHVudGVyMi1rZXk=
    password: hunter2-password
- name: exec-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1
      command: aws
      args: [eks, get-token, --cluster-name, c]
      env:
      - {name: AWS_SECRET_ACCESS_KEY, value: hunter2-env}
      - {name: AWS_PROFILE, value: staging}
`
	require.NoError(t, os.WriteFile(path, []byte(content), 0o600))

	conns, _, err := connectionsFromKubeconfig(path)
	require.NoError(t, err)
	require.Len(t, conns, 2)
	for _, conn := range conns {
		all, err := json.Marshal(conn.Labels)
		require.NoError(t, err)
		assert.NotContains(t, strings.ToLower(string(all)), "hunter2", conn.Name)
		assert.Equal(t, "https://10.0.0.1:6443/", conn.Labels["server"])
	}
}
