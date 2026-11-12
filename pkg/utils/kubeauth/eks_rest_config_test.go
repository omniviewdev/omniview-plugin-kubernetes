package kubeauth

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	utilnet "k8s.io/apimachinery/pkg/util/net"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"k8s.io/client-go/tools/remotecommand"
	"k8s.io/client-go/transport/spdy"
	metricsclientset "k8s.io/metrics/pkg/client/clientset/versioned"
)

const eksBearerPrefix = "Bearer " + tokenPrefix

// useSyntheticAWSCredentials points the AWS SDK at static fake credentials and no
// metadata service. EKS token minting is a local presign, so no AWS call is made.
func useSyntheticAWSCredentials(t *testing.T) {
	t.Helper()
	t.Setenv("AWS_EC2_METADATA_DISABLED", "true")
	t.Setenv("AWS_PROFILE", "")
	t.Setenv("AWS_CONFIG_FILE", filepath.Join(t.TempDir(), "config"))
	t.Setenv("AWS_SHARED_CREDENTIALS_FILE", filepath.Join(t.TempDir(), "credentials"))
	t.Setenv("AWS_ACCESS_KEY_ID", "synthetic")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "synthetic")
}

// failIfAWSCLIRuns puts an `aws` on PATH that records its own execution. EKS
// authentication is plugin-owned, so client-go must never run the CLI.
func failIfAWSCLIRuns(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the aws CLI sentinel is a shell script")
	}
	dir := t.TempDir()
	marker := filepath.Join(dir, "aws-ran")
	script := "#!/bin/sh\n: > '" + marker + "'\nexit 97\n"
	require.NoError(t, os.WriteFile(filepath.Join(dir, "aws"), []byte(script), 0o700))
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Cleanup(func() {
		_, err := os.Stat(marker)
		assert.True(t, os.IsNotExist(err), "the aws CLI was executed")
	})
}

// writeEKSKubeconfig writes a kubeconfig for an `aws eks get-token` exec user
// that trusts the server's certificate. Its context is "test-context".
func writeEKSKubeconfig(t *testing.T, server *httptest.Server) string {
	t.Helper()
	return writeTLSKubeconfig(t, server, map[string]*clientcmdapi.AuthInfo{
		"eks-user": {Exec: &clientcmdapi.ExecConfig{
			APIVersion: "client.authentication.k8s.io/v1beta1",
			Command:    "aws",
			Args:       []string{"--region", "us-west-2", "eks", "get-token", "--cluster-name", "synthetic-cluster"},
		}},
	}, "eks-user")
}

// eksRestConfigConsumers are the ways the plugin turns a published rest.Config
// into requests without going through the bundle's own clients. Each performs
// one request against server; the server refuses anything but /version, which
// is enough because only the request the server receives matters.
var eksRestConfigConsumers = []struct {
	name string
	call func(t *testing.T, config *rest.Config, server *httptest.Server)
}{
	{"rest.HTTPClientFor", func(t *testing.T, config *rest.Config, server *httptest.Server) {
		client, err := rest.HTTPClientFor(config)
		require.NoError(t, err)
		response, err := client.Get(server.URL + "/version")
		require.NoError(t, err)
		response.Body.Close()
	}},
	{"rest.TransportFor", func(t *testing.T, config *rest.Config, server *httptest.Server) {
		roundTripper, err := rest.TransportFor(config)
		require.NoError(t, err)
		response, err := (&http.Client{Transport: roundTripper}).Get(server.URL + "/version")
		require.NoError(t, err)
		response.Body.Close()
	}},
	{"kubernetes.NewForConfig", func(t *testing.T, config *rest.Config, server *httptest.Server) {
		clientset, err := kubernetes.NewForConfig(config)
		require.NoError(t, err)
		_, err = clientset.Discovery().ServerVersion()
		require.NoError(t, err)
	}},
	{"legacy metrics client", func(t *testing.T, config *rest.Config, server *httptest.Server) {
		metricsClient, err := metricsclientset.NewForConfig(config)
		require.NoError(t, err)
		_, err = metricsClient.MetricsV1beta1().NodeMetricses().List(context.Background(), metav1.ListOptions{})
		require.Error(t, err, "the server refuses the metrics API")
	}},
	{"SPDY exec executor", func(t *testing.T, config *rest.Config, server *httptest.Server) {
		target, err := url.Parse(server.URL + "/api/v1/namespaces/ns/pods/one/exec")
		require.NoError(t, err)
		executor, err := remotecommand.NewSPDYExecutor(config, http.MethodPost, target)
		require.NoError(t, err)
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		require.Error(t, executor.StreamWithContext(ctx, remotecommand.StreamOptions{Stdout: io.Discard}),
			"the server refuses the upgrade")
	}},
	{"WebSocket exec executor", func(t *testing.T, config *rest.Config, server *httptest.Server) {
		executor, err := remotecommand.NewWebSocketExecutor(config, http.MethodGet, server.URL+"/api/v1/namespaces/ns/pods/one/exec")
		require.NoError(t, err)
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		require.Error(t, executor.StreamWithContext(ctx, remotecommand.StreamOptions{Stdout: io.Discard}),
			"the server refuses the upgrade")
	}},
	{"SPDY port-forward dialer", func(t *testing.T, config *rest.Config, server *httptest.Server) {
		roundTripper, upgrader, err := spdy.RoundTripperFor(config)
		require.NoError(t, err)
		target, err := url.Parse(server.URL + "/api/v1/namespaces/ns/pods/one/portforward")
		require.NoError(t, err)
		dialer := spdy.NewDialer(upgrader, &http.Client{Transport: roundTripper}, http.MethodPost, target)
		_, _, err = dialer.Dial("portforward.k8s.io")
		require.Error(t, err, "the server refuses the upgrade")
	}},
}

var eksBundleLoaders = map[string]func(context.Context, string, string) (*KubeClientBundle, error){
	"LoadKubeClients":         LoadKubeClients,
	"LoadResourceKubeClients": LoadResourceKubeClients,
}

// The published rest.Config is what exec, port-forward and the legacy metrics
// client build their own transports from. For EKS it must carry the
// authentication, because client-go never runs the aws CLI for it.
func TestEKSPublishedRestConfigAuthenticatesConsumers(t *testing.T) {
	for loaderName, load := range eksBundleLoaders {
		for _, consumer := range eksRestConfigConsumers {
			t.Run(loaderName+"/"+consumer.name, func(t *testing.T) {
				useSyntheticAWSCredentials(t)
				failIfAWSCLIRuns(t)
				recorder := &authorizationRecorder{}
				server := httptest.NewTLSServer(http.HandlerFunc(recorder.handler))
				defer server.Close()
				path := writeEKSKubeconfig(t, server)

				bundle, err := load(context.Background(), path, "test-context")
				require.NoError(t, err)
				require.Nil(t, bundle.RestConfig.ExecProvider, "the aws CLI exec path must stay disabled")
				require.Empty(t, bundle.RestConfig.BearerToken, "a static token would go stale")

				consumer.call(t, bundle.RestConfig, server)

				seen := recorder.seen()
				require.NotEmpty(t, seen, "the request never reached the server")
				for _, authorization := range seen {
					require.True(t, strings.HasPrefix(authorization, eksBearerPrefix),
						"request was not authenticated with an EKS token: %q", authorization)
					assert.Greater(t, len(authorization), len(eksBearerPrefix), "empty EKS token")
				}
			})
		}
	}
}

func countEKSTokenRefreshes(exporter *tracetest.InMemoryExporter) int {
	refreshes := 0
	for _, span := range exporter.GetSpans() {
		if span.Name == "kubernetes.auth.eks.token" {
			refreshes++
		}
	}
	return refreshes
}

// Clients the plugin builds itself and transports built from the published
// config belong to one connection, so they must draw on one token cache: one
// STS presign serves all of them, whichever client asks first.
func TestEKSPublishedRestConfigSharesTheBundleTokenCache(t *testing.T) {
	for loaderName, load := range eksBundleLoaders {
		t.Run(loaderName, func(t *testing.T) {
			useSyntheticAWSCredentials(t)
			failIfAWSCLIRuns(t)
			exporter, _ := captureObservability(t)
			recorder := &authorizationRecorder{}
			server := httptest.NewTLSServer(http.HandlerFunc(recorder.handler))
			defer server.Close()
			path := writeEKSKubeconfig(t, server)

			bundle, err := load(context.Background(), path, "test-context")
			require.NoError(t, err)

			// The bundle's own client mints the first token ...
			_, err = bundle.Discovery.ServerVersion()
			require.NoError(t, err)
			require.Equal(t, 1, countEKSTokenRefreshes(exporter))
			// ... which every transport built from the published config reuses.
			for _, consumer := range eksRestConfigConsumers {
				consumer.call(t, bundle.RestConfig, server)
			}
			assert.Equal(t, 1, countEKSTokenRefreshes(exporter), "a consumer minted a token of its own")

			seen := recorder.seen()
			require.Greater(t, len(seen), len(eksRestConfigConsumers))
			for _, authorization := range seen[1:] {
				assert.Equal(t, seen[0], authorization, "consumers must send the shared cached token")
			}
		})
	}
}

// authLayers walks the RoundTripperWrapper chain and reports how many EKS
// authenticating layers it passes and what it ends on.
func authLayers(rt http.RoundTripper) (layers int, innermost http.RoundTripper) {
	for rt != nil {
		switch rt.(type) {
		case *eksAuthTransport, *eksBearerTransport:
			layers++
		}
		wrapper, ok := rt.(utilnet.RoundTripperWrapper)
		if !ok {
			return layers, rt
		}
		innermost = rt
		rt = wrapper.WrappedRoundTripper()
	}
	return layers, innermost
}

// The bundle's own clients already carry the EKS authentication inside their
// private http.Client. Publishing the same authentication through the rest.Config
// must not stack a second layer on them, and connection retirement must still be
// able to walk from the client down to the shared *http.Transport.
func TestEKSOwnClientsCarryExactlyOneAuthLayer(t *testing.T) {
	useSyntheticAWSCredentials(t)
	failIfAWSCLIRuns(t)
	server := httptest.NewTLSServer(http.HandlerFunc((&authorizationRecorder{}).handler))
	defer server.Close()
	path := writeEKSKubeconfig(t, server)

	strategy, err := DetectAuthStrategy(path, "test-context")
	require.NoError(t, err)
	eks, ok := strategy.(*EKSAuthStrategy)
	require.True(t, ok, "expected *EKSAuthStrategy, got %T", strategy)
	config, err := eks.BuildRestConfig(context.Background(), path, "test-context")
	require.NoError(t, err)
	clientset, err := eks.NewForConfig(config)
	require.NoError(t, err)

	for name, client := range map[string]*http.Client{
		"private http client":   eks.httpClient,
		"clientset REST client": clientset.CoreV1().RESTClient().(*rest.RESTClient).Client,
	} {
		layers, innermost := authLayers(client.Transport)
		assert.Equal(t, 1, layers, "%s: want exactly one EKS authentication layer", name)
		_, isHTTPTransport := innermost.(*http.Transport)
		assert.True(t, isHTTPTransport, "%s: chain ends on %T, so closing idle connections cannot reach the shared transport", name, innermost)
	}

	// A transport built from the published config has its own single layer.
	roundTripper, err := rest.TransportFor(config)
	require.NoError(t, err)
	layers, _ := authLayers(roundTripper)
	assert.Equal(t, 1, layers)
}

// A refused upgrade proves the credentials arrive; a granted one proves the
// authenticating layer leaves the upgraded connection usable. This server only
// upgrades requests that carry an EKS token, then holds the connection open.
func TestEKSPublishedRestConfigSPDYUpgradeThroughAuthLayer(t *testing.T) {
	for loaderName, load := range eksBundleLoaders {
		t.Run(loaderName, func(t *testing.T) {
			useSyntheticAWSCredentials(t)
			failIfAWSCLIRuns(t)
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.HasPrefix(r.Header.Get("Authorization"), eksBearerPrefix) {
					http.Error(w, "unauthorized", http.StatusUnauthorized)
					return
				}
				conn, _, err := w.(http.Hijacker).Hijack()
				if err != nil {
					return
				}
				defer conn.Close()
				io.WriteString(conn, "HTTP/1.1 101 Switching Protocols\r\n"+
					"Connection: Upgrade\r\nUpgrade: SPDY/3.1\r\nX-Stream-Protocol-Version: portforward.k8s.io\r\n\r\n")
				io.Copy(io.Discard, conn)
			}))
			defer server.Close()
			path := writeEKSKubeconfig(t, server)

			bundle, err := load(context.Background(), path, "test-context")
			require.NoError(t, err)
			roundTripper, upgrader, err := spdy.RoundTripperFor(bundle.RestConfig)
			require.NoError(t, err)
			request, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/namespaces/ns/pods/one/portforward", nil)
			require.NoError(t, err)

			connection, protocol, err := spdy.Negotiate(upgrader, &http.Client{Transport: roundTripper}, request, "portforward.k8s.io")
			require.NoError(t, err)
			assert.Equal(t, "portforward.k8s.io", protocol)
			require.NoError(t, connection.Close())
		})
	}
}
