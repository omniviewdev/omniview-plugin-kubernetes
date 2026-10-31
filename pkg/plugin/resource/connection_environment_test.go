package resource

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/rest"
)

func TestConnectionEnvironmentPublication(t *testing.T) {
	tests := []struct {
		name       string
		connection types.Connection
		endpoint   string
		want       map[string]string
	}{
		{name: "kind context without version", connection: types.Connection{ID: "kind-kind"}, want: map[string]string{"kubernetes.provider": "kind", "kubernetes.provider_source": "connection_config"}},
		{name: "unknown omits hints", connection: types.Connection{ID: "eksperimental", Name: "kind-prod", Labels: map[string]interface{}{"region": "us-west-2", "project": "sample-project", "auth_method": "aws-custom", "cluster": 42}}},
		{name: "malformed cluster ARN", connection: types.Connection{ID: "arn:aws:eks:us-east-1:123:cluster/prod"}},
		{name: "wrong ARN partition", connection: types.Connection{ID: "arn:aws-cn:eks:us-east-1:123456789012:cluster/prod"}},
		{name: "unknown configuration ignores cloud labels", connection: types.Connection{Labels: map[string]interface{}{"region": "us-west-2", "project": "sample-project", "subscription": "12345678-1234-1234-1234-123456789abc"}}},
		{name: "role account is not cluster account", connection: types.Connection{Labels: map[string]interface{}{"auth_method": "eks", "region": "us-west-2", "account": "999999999999", "role": "arn:aws:iam::999999999999:role/secret", "profile": "secret-profile"}}, want: map[string]string{"kubernetes.provider": "eks", "kubernetes.provider_source": "connection_config", "cloud.provider": "aws", "aws.region": "us-west-2"}},
		{name: "cluster ARN account", connection: types.Connection{ID: "arn:aws:eks:us-east-1:123456789012:cluster/prod", Labels: map[string]interface{}{"account": "999999999999", "region": "us-west-2"}}, want: map[string]string{"kubernetes.provider": "eks", "kubernetes.provider_source": "connection_config", "cloud.provider": "aws", "aws.region": "us-east-1", "aws.account_id": "123456789012"}},
		{name: "endpoint beats config", connection: types.Connection{ID: "kind-prod", Labels: map[string]interface{}{"region": "us-east-1", "project": "sample-project"}}, endpoint: "https://user:secret@ABC.gr7.us-west-2.eks.amazonaws.com?secret=token", want: map[string]string{"kubernetes.provider": "eks", "kubernetes.provider_source": "server_endpoint", "cloud.provider": "aws", "aws.region": "us-west-2"}},
		{name: "endpoint suffix spoof", endpoint: "https://abc.us-west-2.eks.amazonaws.com.attacker.example"},
		{name: "GKE configuration", connection: types.Connection{ID: "gke_sample-project_us-central1-a_prod"}, want: map[string]string{"kubernetes.provider": "gke", "kubernetes.provider_source": "connection_config", "cloud.provider": "gcp", "gcp.project_id": "sample-project", "gcp.zone": "us-central1-a", "gcp.region": "us-central1"}},
		{name: "Azure configuration", connection: types.Connection{Labels: map[string]interface{}{"auth_method": "aks", "subscription": "12345678-1234-1234-1234-123456789abc", "resource_group": "rg-prod"}}, want: map[string]string{"kubernetes.provider": "aks", "kubernetes.provider_source": "connection_config", "cloud.provider": "azure", "azure.subscription_id": "12345678-1234-1234-1234-123456789abc", "azure.resource_group": "rg-prod"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			update, err := connectionMetadata(context.Background(), tt.connection, &clients.ClientSet{RESTConfig: &rest.Config{Host: tt.endpoint}})
			require.NoError(t, err)
			for _, key := range environmentMetadataKeys {
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
	for _, tt := range []struct{ version, provider, distribution, source string }{
		{"v1.34.0", "kind", "", "connection_config"},
		{"v1.34.0+k3s1", "kind", "k3s", "connection_config"},
		{"v1.34.0+rke2r1", "kind", "rke2", "connection_config"},
		{"v1.34.0-eks-123abc", "eks", "eks", "server_version"},
		{"v1.34.0-eks-f69fefa", "eks", "eks", "server_version"},
		{"v1.34.0-gke.123", "gke", "gke", "server_version"},
		{"v1.34.0-eksperimental", "kind", "", "connection_config"},
		{"v1.34.0-eks-nothex", "kind", "", "connection_config"},
		{"v1.34.0-gke123", "kind", "", "connection_config"},
		{"v1.34.0+k3s-custom", "kind", "", "connection_config"},
		{"v1.34.0+rke2-custom", "kind", "", "connection_config"},
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
			update, err := connectionMetadata(context.Background(), types.Connection{ID: "kind-kind"}, &clients.ClientSet{RESTConfig: config, DiscoveryClient: discoveryClient})
			require.NoError(t, err)
			require.Equal(t, 1, calls)
			require.Equal(t, tt.provider, update.Set["kubernetes.provider"].Value)
			require.Equal(t, tt.source, update.Set["kubernetes.provider_source"].Value)
			require.Equal(t, "linux/arm64", update.Set["kubernetes.server_platform"].Value)
			if tt.distribution == "" {
				require.Contains(t, update.Remove, "kubernetes.distribution")
			} else {
				require.Equal(t, tt.distribution, update.Set["kubernetes.distribution"].Value)
				require.Equal(t, "server_version", update.Set["kubernetes.distribution_source"].Value)
			}
		})
	}
}
