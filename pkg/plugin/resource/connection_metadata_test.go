package resource

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/rest"
)

func TestMetadataEndpointSanitization(t *testing.T) {
	require.Equal(t, "https://cluster.example/prefix", sanitizedMetadataEndpoint("https://user:password@cluster.example/prefix?token=secret#secret"))
	for _, raw := range []string{"", "not-a-url", "file:///secret", "https://%xx"} {
		require.Empty(t, sanitizedMetadataEndpoint(raw))
	}
}

func TestConnectionMetadataOnlyRequestsVersionAndNeverMutatesConfiguration(t *testing.T) {
	for _, body := range []string{`{"gitVersion":"v1.34.0","platform":"linux/arm64"}`, `{"gitVersion":"v1.34.0"}`, strings.Repeat("x", 65537), `secret-token`} {
		t.Run(body[:min(len(body), 20)], func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				require.Equal(t, "/version", r.URL.Path)
				_, _ = w.Write([]byte(body))
			}))
			defer server.Close()
			config := &rest.Config{Host: server.URL}
			discoveryClient, err := discovery.NewDiscoveryClientForConfig(config)
			require.NoError(t, err)
			connection := types.Connection{ID: "owned", Data: map[string]interface{}{"cluster": "configured"}}
			update, err := connectionMetadata(context.Background(), connection, &clients.ClientSet{RESTConfig: config, DiscoveryClient: discoveryClient})
			require.NoError(t, err)
			require.Equal(t, 1, calls)
			require.Len(t, update.Set, 3)
			require.Equal(t, map[string]interface{}{"cluster": "configured"}, connection.Data)
			require.Equal(t, "success", update.Set["kubernetes.server_url"].State)
			if strings.HasPrefix(body, `{"gitVersion"`) {
				require.Equal(t, "v1.34.0", update.Set["kubernetes.server_version"].Value)
			} else {
				require.Equal(t, "unavailable", update.Set["kubernetes.server_version"].State)
				require.NotContains(t, update.Set["kubernetes.server_version"].Error.Message, body)
			}
		})
	}
}

func TestConnectionMetadataCanceledRequestKeepsEndpointSibling(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	config := &rest.Config{Host: server.URL}
	discoveryClient, err := discovery.NewDiscoveryClientForConfig(config)
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	update, err := connectionMetadata(ctx, types.Connection{ID: "kind-kind"}, &clients.ClientSet{RESTConfig: config, DiscoveryClient: discoveryClient})
	require.NoError(t, err)
	require.Equal(t, "success", update.Set["kubernetes.server_url"].State)
	require.Equal(t, "unavailable", update.Set["kubernetes.server_version"].State)
	require.Equal(t, "kind", update.Set["kubernetes.provider"].Value)
	require.Equal(t, "connection_config", update.Set["kubernetes.provider_source"].Value)
	require.Contains(t, update.Remove, "aws.account_id")
}
