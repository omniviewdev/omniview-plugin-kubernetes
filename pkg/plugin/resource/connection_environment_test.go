package resource

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/omniview/kubernetes/pkg/connid"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/rest"
)

// inContext is a connection for the kubeconfig context name. Its ID is derived, as the IDs of the
// inventory are: only the context name, which its data carries, says what the context is.
func inContext(name string, labels map[string]interface{}) types.Connection {
	return types.Connection{
		ID: connid.ID(connid.KindFile, "/fixture/kubeconfig", name), Name: name, Labels: labels,
		Data: map[string]any{connid.DataKeyContext: name},
	}
}

// environmentFacts are the keys that say where a cluster runs and what it is: each is said, or removed.
var environmentFacts = []string{
	"kubernetes.platform", "kubernetes.platform_source", "kubernetes.distribution", "kubernetes.distribution_source",
	"cloud.provider", "cloud.region", "cloud.availability_zone", "cloud.account.id", "k8s.cluster.name", "azure.resource_group",
}

func TestConnectionEnvironmentPublication(t *testing.T) {
	tests := []struct {
		name       string
		connection types.Connection
		endpoint   string
		want       map[string]string
	}{
		{name: "kind context without version", connection: inContext("kind-kind", nil), want: map[string]string{"kubernetes.platform": "kind", "kubernetes.platform_source": "connection_config"}},
		{name: "unknown omits hints", connection: types.Connection{ID: "eksperimental-0123456789", Name: "kind-prod", Data: map[string]any{connid.DataKeyContext: "eksperimental"}, Labels: map[string]interface{}{"cloud.region": "us-west-2", "cloud.account.id": "sample-project", "auth.method": "aws-custom", "kubeconfig.cluster": 42}}},
		{name: "malformed cluster ARN", connection: inContext("arn:aws:eks:us-east-1:123:cluster/prod", nil)},
		{name: "wrong ARN partition", connection: inContext("arn:aws-cn:eks:us-east-1:123456789012:cluster/prod", nil)},
		{name: "the ID is not the context", connection: types.Connection{ID: "kind-looking-id-0123456789", Data: map[string]any{connid.DataKeyContext: "prod"}}},
		{name: "the name that the user may edit is not the context", connection: types.Connection{ID: "id-0123456789", Name: "kind-prod", Data: map[string]any{connid.DataKeyContext: "prod"}}},
		{name: "no context in the data", connection: types.Connection{ID: "kind-kind"}},
		{name: "unknown configuration ignores cloud labels", connection: types.Connection{Labels: map[string]interface{}{"cloud.region": "us-west-2", "cloud.account.id": "12345678-1234-1234-1234-123456789abc"}}},
		{name: "role account is not cluster account", connection: types.Connection{Labels: map[string]interface{}{"auth.method": "eks", "cloud.region": "us-west-2", "cloud.account.id": "999999999999", "aws.role": "arn:aws:iam::999999999999:role/secret", "aws.profile": "secret-profile"}}, want: map[string]string{"kubernetes.platform": "eks", "kubernetes.platform_source": "connection_config", "cloud.provider": "aws", "cloud.region": "us-west-2"}},
		{name: "cluster ARN account and name", connection: inContext("arn:aws:eks:us-east-1:123456789012:cluster/prod", map[string]interface{}{"cloud.account.id": "999999999999", "cloud.region": "us-west-2"}), want: map[string]string{"kubernetes.platform": "eks", "kubernetes.platform_source": "connection_config", "cloud.provider": "aws", "cloud.region": "us-east-1", "cloud.account.id": "123456789012", "k8s.cluster.name": "prod"}},
		{name: "endpoint beats config", connection: inContext("kind-prod", map[string]interface{}{"cloud.region": "us-east-1", "cloud.account.id": "sample-project"}), endpoint: "https://user:secret@ABC.gr7.us-west-2.eks.amazonaws.com?secret=token", want: map[string]string{"kubernetes.platform": "eks", "kubernetes.platform_source": "server_endpoint", "kubernetes.distribution": "eks", "kubernetes.distribution_source": "server_endpoint", "cloud.provider": "aws", "cloud.region": "us-west-2"}},
		{name: "bare EKS endpoint", endpoint: "ABC.gr7.us-west-2.eks.amazonaws.com:443", want: map[string]string{"kubernetes.platform": "eks", "kubernetes.platform_source": "server_endpoint", "kubernetes.distribution": "eks", "kubernetes.distribution_source": "server_endpoint", "cloud.provider": "aws", "cloud.region": "us-west-2"}},
		{name: "bare AKS endpoint", endpoint: "prod-abcd.westus.azmk8s.io:443", want: map[string]string{"kubernetes.platform": "aks", "kubernetes.platform_source": "server_endpoint", "kubernetes.distribution": "aks", "kubernetes.distribution_source": "server_endpoint", "cloud.provider": "azure"}},
		{name: "AKS endpoint of the hcp form", endpoint: "https://prod-abcd.hcp.westus.azmk8s.io:443", want: map[string]string{"kubernetes.platform": "aks", "kubernetes.platform_source": "server_endpoint", "kubernetes.distribution": "aks", "kubernetes.distribution_source": "server_endpoint", "cloud.provider": "azure"}},
		{name: "non HTTP endpoint cannot infer provider", endpoint: "ftp://abc.us-west-2.eks.amazonaws.com"},
		{name: "endpoint suffix spoof", endpoint: "https://abc.us-west-2.eks.amazonaws.com.attacker.example"},
		{name: "GKE configuration", connection: inContext("gke_sample-project_us-central1-a_prod", nil), want: map[string]string{"kubernetes.platform": "gke", "kubernetes.platform_source": "connection_config", "cloud.provider": "gcp", "cloud.account.id": "sample-project", "cloud.availability_zone": "us-central1-a", "cloud.region": "us-central1", "k8s.cluster.name": "prod"}},
		{name: "Azure configuration", connection: types.Connection{Labels: map[string]interface{}{"auth.method": "aks", "cloud.account.id": "12345678-1234-1234-1234-123456789abc", "azure.resource_group": "rg-prod"}}, want: map[string]string{"kubernetes.platform": "aks", "kubernetes.platform_source": "connection_config", "cloud.provider": "azure", "cloud.account.id": "12345678-1234-1234-1234-123456789abc", "azure.resource_group": "rg-prod"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			update, err := connectionMetadata(context.Background(), tt.connection, &clients.ClientSet{RESTConfig: &rest.Config{Host: tt.endpoint}}, catalogFacts{})
			require.NoError(t, err)
			for _, key := range environmentFacts {
				value, expected := tt.want[key]
				observation, exists := update.Set[key]
				require.Equal(t, expected, exists, key)
				if expected {
					require.Equal(t, value, observation.Value, key)
					require.NotContains(t, update.Remove, key)
				} else {
					require.Contains(t, update.Remove, key)
				}
			}
			encoded, err := json.Marshal(update)
			require.NoError(t, err)
			require.NotContains(t, string(encoded), "secret")
			require.NotContains(t, string(encoded), "999999999999")
		})
	}
}

func TestConnectionEnvironmentVersionEvidence(t *testing.T) {
	for _, tt := range []struct{ version, platform, distribution, source string }{
		{"v1.34.0", "kind", "", "connection_config"},
		{"v1.34.0+k3s1", "kind", "k3s", "connection_config"},
		{"v1.34.0+rke2r1", "kind", "rke2", "connection_config"},
		{"v1.34.0+k0s.0", "kind", "k0s", "connection_config"},
		{"v1.34.0+k0s", "kind", "k0s", "connection_config"},
		{"v1.34.0-eks-123abc", "eks", "eks", "server_version"},
		{"v1.34.0-eks-f69fefa", "eks", "eks", "server_version"},
		{"v1.34.0-gke.123", "gke", "gke", "server_version"},
		{"v1.34.0-eksperimental", "kind", "", "connection_config"},
		{"v1.34.0-eks-nothex", "kind", "", "connection_config"},
		{"v1.34.0-gke123", "kind", "", "connection_config"},
		{"v1.34.0+k3s-custom", "kind", "", "connection_config"},
		{"v1.34.0+rke2-custom", "kind", "", "connection_config"},
		{"v1.34.0+k0sx", "kind", "", "connection_config"},
	} {
		t.Run(tt.version, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				require.Equal(t, "/version", r.URL.Path)
				_ = json.NewEncoder(w).Encode(map[string]string{"gitVersion": tt.version, "platform": "linux/arm64"})
			}))
			defer server.Close()
			config := &rest.Config{Host: server.URL}
			discoveryClient, err := discovery.NewDiscoveryClientForConfig(config)
			require.NoError(t, err)
			update, err := connectionMetadata(context.Background(), inContext("kind-kind", nil), &clients.ClientSet{RESTConfig: config, DiscoveryClient: discoveryClient}, catalogFacts{})
			require.NoError(t, err)
			require.Equal(t, 1, calls)
			require.Equal(t, tt.version, update.Set["kubernetes.server.version"].Value)
			require.Equal(t, "linux/arm64", update.Set["kubernetes.server.platform"].Value)
			require.Equal(t, tt.platform, update.Set["kubernetes.platform"].Value)
			require.Equal(t, tt.source, update.Set["kubernetes.platform_source"].Value)
			if tt.distribution == "" {
				require.Contains(t, update.Remove, "kubernetes.distribution")
			} else {
				require.Equal(t, tt.distribution, update.Set["kubernetes.distribution"].Value)
				require.Equal(t, "server_version", update.Set["kubernetes.distribution_source"].Value)
			}
		})
	}
}

// node is a Node as the cluster states it, with only what a probe reads of one.
func node(providerID string, labels map[string]string) corev1.Node {
	return corev1.Node{ObjectMeta: metav1.ObjectMeta{Labels: labels}, Spec: corev1.NodeSpec{ProviderID: providerID}}
}

func topology(region, zone string) map[string]string {
	return map[string]string{"topology.kubernetes.io/region": region, "topology.kubernetes.io/zone": zone}
}

// What the cluster states weighs against the configuration and fills what it leaves out: the distribution from the version, the cluster's own API groups or its Nodes, and the cloud, its region and
// its zones from the Nodes. The configuration is never replaced, and a cluster whose Nodes disagree says nothing of what they disagree on.
func TestConnectionEnvironmentFromTheCluster(t *testing.T) {
	talos := node("", nil)
	talos.Status.NodeInfo.OSImage = "Talos (v1.7.5)"
	tests := []struct {
		name       string
		connection types.Connection
		version    string
		groups     []string
		nodes      []corev1.Node
		want       map[string]string
	}{
		{name: "OpenShift serves the cluster configuration API group", groups: []string{"apps", "config.openshift.io"}, want: map[string]string{"kubernetes.distribution": "openshift", "kubernetes.distribution_source": "api_group"}},
		{name: "a group with that name is not enough: another group says nothing", groups: []string{"config.example.io", "openshift.io"}},
		{name: "the version outranks the Nodes", version: "v1.30.2+k3s1", nodes: []corev1.Node{node("kind://docker/kind/kind-control-plane", nil)}, want: map[string]string{"kubernetes.distribution": "k3s", "kubernetes.distribution_source": "server_version"}},
		{name: "kind says so in the provider ID of its Nodes", connection: inContext("kind-kind", nil), nodes: []corev1.Node{node("kind://docker/kind/kind-control-plane", nil), node("kind://docker/kind/kind-worker", nil)},
			want: map[string]string{"kubernetes.platform": "kind", "kubernetes.platform_source": "connection_config", "kubernetes.distribution": "kind", "kubernetes.distribution_source": "node"}},
		{name: "k3s in the provider ID", nodes: []corev1.Node{node("k3s://server-0", nil)}, want: map[string]string{"kubernetes.distribution": "k3s", "kubernetes.distribution_source": "node"}},
		{name: "minikube in a label of its Node", nodes: []corev1.Node{node("", map[string]string{"minikube.k8s.io/name": "minikube"})}, want: map[string]string{"kubernetes.distribution": "minikube", "kubernetes.distribution_source": "node"}},
		{name: "MicroK8s in a label of its Node", nodes: []corev1.Node{node("", map[string]string{"microk8s.io/cluster": "true"})}, want: map[string]string{"kubernetes.distribution": "microk8s", "kubernetes.distribution_source": "node"}},
		{name: "AKS in a label of its Nodes", nodes: []corev1.Node{node("", map[string]string{"kubernetes.azure.com/cluster": "MC_rg_prod_westus"})}, want: map[string]string{"kubernetes.distribution": "aks", "kubernetes.distribution_source": "node"}},
		{name: "Talos in the operating system image of its Node", nodes: []corev1.Node{talos}, want: map[string]string{"kubernetes.distribution": "talos", "kubernetes.distribution_source": "node"}},
		{name: "Nodes that say different distributions say none", nodes: []corev1.Node{node("", map[string]string{"minikube.k8s.io/name": "x"}), node("", map[string]string{"microk8s.io/cluster": "true"})}},
		{name: "the cloud, region and zones of the Nodes, with no configuration", nodes: []corev1.Node{
			node("aws:///us-east-1a/i-0123", topology("us-east-1", "us-east-1a")), node("aws:///us-east-1b/i-0456", topology("us-east-1", "us-east-1b")),
			node("aws:///us-east-1a/i-0789", map[string]string{"failure-domain.beta.kubernetes.io/region": "us-east-1", "failure-domain.beta.kubernetes.io/zone": "us-east-1a"}),
		}, want: map[string]string{"cloud.provider": "aws", "cloud.region": "us-east-1", "cloud.availability_zone": "us-east-1a,us-east-1b"}},
		{name: "a Google provider ID", nodes: []corev1.Node{node("gce://project/us-central1-a/node-1", topology("us-central1", "us-central1-a"))}, want: map[string]string{"cloud.provider": "gcp", "cloud.region": "us-central1", "cloud.availability_zone": "us-central1-a"}},
		{name: "an Azure provider ID", nodes: []corev1.Node{node("azure:///subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Compute/virtualMachineScaleSets/vmss/virtualMachines/0", topology("westeurope", "westeurope-1"))}, want: map[string]string{"cloud.provider": "azure", "cloud.region": "westeurope", "cloud.availability_zone": "westeurope-1"}},
		{name: "the configuration says what it says, and the Nodes fill the rest", connection: inContext("arn:aws:eks:us-east-1:123456789012:cluster/prod", nil), nodes: []corev1.Node{node("gce://project/us-east-2a/node-1", topology("us-east-2", "us-east-2a"))},
			want: map[string]string{"kubernetes.platform": "eks", "kubernetes.platform_source": "connection_config", "cloud.provider": "aws", "cloud.region": "us-east-1", "cloud.account.id": "123456789012", "k8s.cluster.name": "prod", "cloud.availability_zone": "us-east-2a"}},
		{name: "Nodes in two regions state no region, and their zones", nodes: []corev1.Node{node("aws:///a/i-1", topology("us-east-1", "us-east-1a")), node("aws:///b/i-2", topology("us-west-2", "us-west-2b"))}, want: map[string]string{"cloud.provider": "aws", "cloud.availability_zone": "us-east-1a,us-west-2b"}},
		{name: "a cloud this plugin does not name is none", nodes: []corev1.Node{node("digitalocean://1234", nil)}},
		{name: "no Nodes read, no fact from them"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			facts := make([]nodeFacts, 0, len(tt.nodes))
			for i := range tt.nodes {
				facts = append(facts, nodeFactsOf(&tt.nodes[i]))
			}
			got := inferConnectionEnvironment(tt.connection, "", clusterEvidence{version: tt.version, groups: tt.groups, nodes: summarizeNodes(facts)})
			want := tt.want
			if want == nil {
				want = map[string]string{}
			}
			require.Equal(t, want, got)
		})
	}
}
