package resource

import (
	"context"
	"encoding/json"
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
	require.Equal(t, "https://cluster.example/prefix", sanitizedMetadataEndpoint(&rest.Config{Host: "https://user:password@cluster.example/prefix?token=secret#secret"}))
	require.Empty(t, sanitizedMetadataEndpoint(nil))
	for _, raw := range []string{"", "cluster.example/prefix", "file:///secret", "ftp://cluster.example", "https://%xx", "https://cluster.example:invalid", "https://"} {
		require.Empty(t, sanitizedMetadataEndpoint(&rest.Config{Host: raw}), raw)
	}
}

func TestConnectionMetadataRESTConfigEndpointNormalization(t *testing.T) {
	tests := []struct {
		name   string
		config rest.Config
		want   string
	}{
		{name: "bare IPv4", config: rest.Config{Host: "127.0.0.1"}, want: "http://127.0.0.1"},
		{name: "bare IPv4 port", config: rest.Config{Host: "127.0.0.1:6443"}, want: "http://127.0.0.1:6443"},
		{name: "bare DNS", config: rest.Config{Host: "cluster.example"}, want: "http://cluster.example"},
		{name: "bare DNS port", config: rest.Config{Host: "cluster.example:443"}, want: "http://cluster.example:443"},
		{name: "bare IPv6", config: rest.Config{Host: "[2001:db8::1]"}, want: "http://[2001:db8::1]"},
		{name: "bare IPv6 port", config: rest.Config{Host: "[2001:db8::1]:6443"}, want: "http://[2001:db8::1]:6443"},
		{name: "CA file selects TLS", config: rest.Config{Host: "cluster.example:6443", TLSClientConfig: rest.TLSClientConfig{CAFile: "/not-read/ca.crt"}}, want: "https://cluster.example:6443"},
		{name: "CA data selects TLS", config: rest.Config{Host: "127.0.0.1:6443", TLSClientConfig: rest.TLSClientConfig{CAData: []byte("secret-ca")}}, want: "https://127.0.0.1:6443"},
		{name: "certificate file selects TLS", config: rest.Config{Host: "cluster.example", TLSClientConfig: rest.TLSClientConfig{CertFile: "/not-read/client.crt"}}, want: "https://cluster.example"},
		{name: "certificate data selects TLS", config: rest.Config{Host: "[2001:db8::1]:6443", TLSClientConfig: rest.TLSClientConfig{CertData: []byte("secret-cert")}}, want: "https://[2001:db8::1]:6443"},
		{name: "insecure selects TLS", config: rest.Config{Host: "cluster.example", TLSClientConfig: rest.TLSClientConfig{Insecure: true}}, want: "https://cluster.example"},
		{name: "server name alone does not select TLS", config: rest.Config{Host: "cluster.example", TLSClientConfig: rest.TLSClientConfig{ServerName: "cluster.example"}}, want: "http://cluster.example"},
		{name: "explicit HTTP overrides TLS default", config: rest.Config{Host: "http://cluster.example/prefix", TLSClientConfig: rest.TLSClientConfig{Insecure: true}}, want: "http://cluster.example/prefix"},
		{name: "explicit HTTPS keeps prefix", config: rest.Config{Host: "https://cluster.example/prefix", APIPath: "/api"}, want: "https://cluster.example/prefix"},
		{name: "explicit URL strips secrets", config: rest.Config{Host: "https://user:secret@cluster.example/prefix%2Ftenant?token=secret#secret"}, want: "https://cluster.example/prefix%2Ftenant"},
		{name: "explicit IPv6 strips secrets", config: rest.Config{Host: "http://user:secret@[2001:db8::1]:6443/prefix?token=secret#secret"}, want: "http://[2001:db8::1]:6443/prefix"},
		{name: "bare host strips secrets", config: rest.Config{Host: "user:secret@cluster.example:6443?token=secret#secret"}, want: "http://cluster.example:6443"},
		{name: "missing host stays unknown", config: rest.Config{}},
		{name: "invalid host stays unknown", config: rest.Config{Host: "https://%xx"}},
		{name: "non HTTP scheme stays unknown", config: rest.Config{Host: "ftp://user:secret@cluster.example?token=secret#secret"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			before := rest.CopyConfig(&tt.config)
			update, err := connectionMetadata(context.Background(), types.Connection{}, &clients.ClientSet{RESTConfig: &tt.config})
			require.NoError(t, err)
			require.Equal(t, before, &tt.config)
			endpoint := update.Set["kubernetes.server_url"]
			if tt.want == "" {
				require.Equal(t, "unavailable", endpoint.State)
				require.Nil(t, endpoint.Value)
			} else {
				require.Equal(t, "success", endpoint.State)
				require.Equal(t, tt.want, endpoint.Value)
			}
			require.Equal(t, "unavailable", update.Set["kubernetes.server_version"].State)
			require.Equal(t, "unavailable", update.Set["kubernetes.server_platform"].State)
			encoded, err := json.Marshal(update)
			require.NoError(t, err)
			require.NotContains(t, string(encoded), "secret")
		})
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
