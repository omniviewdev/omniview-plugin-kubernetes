package kubeauth

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The kube context that a client bundle is built for and the connection it is built
// for are two things. The context selects the cluster in the kubeconfig; the
// connection ID labels the spans, logs and profiler samples of the build, so that
// they line up with every other diagnostic of the connection.
const labelTestConnectionID = "prod-0123456789"

func writeLabelTestKubeconfig(t *testing.T) string {
	t.Helper()
	server := httptest.NewTLSServer(nil)
	t.Cleanup(server.Close)
	path := filepath.Join(t.TempDir(), "config")
	config := fmt.Sprintf("apiVersion: v1\nkind: Config\nclusters:\n- name: test\n  cluster:\n    server: %s\n    insecure-skip-tls-verify: true\nusers:\n- name: test\n  user:\n    token: label-secret\ncontexts:\n- name: prod\n  context:\n    cluster: test\n    user: test\ncurrent-context: prod\n", server.URL)
	require.NoError(t, os.WriteFile(path, []byte(config), 0o600))
	return path
}

func TestClientBuildIsLabelledWithTheConnectionIDAndSelectsTheContext(t *testing.T) {
	path := writeLabelTestKubeconfig(t)
	for loaderName, load := range eksBundleLoaders {
		t.Run(loaderName, func(t *testing.T) {
			exporter, sink := captureObservability(t)
			ctx := WithConnectionID(context.Background(), labelTestConnectionID)

			_, err := load(ctx, path, "prod")
			require.NoError(t, err, "the context is what selects the cluster; the ID is only a label")

			spans := exporter.GetSpans()
			require.Len(t, spans, 1)
			assert.Equal(t, labelTestConnectionID, spanAttr(spans[0].Attributes, "connection"))
			labelled := false
			for _, record := range sink.Records() {
				if record.Message == "kubernetes clients built" {
					labelled = true
					assert.Equal(t, labelTestConnectionID, record.ToMap()["connection"])
				}
			}
			assert.True(t, labelled, "the build log line is missing")
		})
	}
}

func TestClientBuildFailureIsLabelledWithTheConnectionID(t *testing.T) {
	path := writeLabelTestKubeconfig(t)
	for loaderName, load := range eksBundleLoaders {
		t.Run(loaderName, func(t *testing.T) {
			exporter, sink := captureObservability(t)
			ctx := WithConnectionID(context.Background(), labelTestConnectionID)

			_, err := load(ctx, path, "missing")
			require.ErrorContains(t, err, `context "missing" not found`)

			spans := exporter.GetSpans()
			require.Len(t, spans, 1)
			assert.Equal(t, labelTestConnectionID, spanAttr(spans[0].Attributes, "connection"))
			warned := false
			for _, record := range sink.Records() {
				if record.Message == "kubernetes client build failed" {
					warned = true
					assert.Equal(t, labelTestConnectionID, record.ToMap()["connection"])
				}
			}
			assert.True(t, warned, "the failure log line is missing")
		})
	}
}

// A build that is given no connection ID keeps labelling itself with the context.
func TestClientBuildWithoutAConnectionIDIsLabelledWithTheContext(t *testing.T) {
	path := writeLabelTestKubeconfig(t)
	for loaderName, load := range eksBundleLoaders {
		t.Run(loaderName, func(t *testing.T) {
			exporter, _ := captureObservability(t)
			_, err := load(context.Background(), path, "prod")
			require.NoError(t, err)
			spans := exporter.GetSpans()
			require.Len(t, spans, 1)
			assert.Equal(t, "prod", spanAttr(spans[0].Attributes, "connection"))
		})
	}
}

// EKS token refreshes are logged and traced under the connection too.
func TestEKSTokenRefreshIsLabelledWithTheConnectionID(t *testing.T) {
	for loaderName, load := range eksBundleLoaders {
		t.Run(loaderName, func(t *testing.T) {
			useSyntheticAWSCredentials(t)
			failIfAWSCLIRuns(t)
			exporter, sink := captureObservability(t)
			recorder := &authorizationRecorder{}
			server := httptest.NewTLSServer(http.HandlerFunc(recorder.handler))
			defer server.Close()
			path := writeEKSKubeconfig(t, server) // its context is "test-context"
			ctx := WithConnectionID(context.Background(), labelTestConnectionID)

			bundle, err := load(ctx, path, "test-context")
			require.NoError(t, err)
			_, err = bundle.Discovery.ServerVersion()
			require.NoError(t, err)

			refreshed := false
			for _, span := range exporter.GetSpans() {
				if span.Name == "kubernetes.auth.eks.token" {
					refreshed = true
					assert.Equal(t, labelTestConnectionID, spanAttr(span.Attributes, "connection"))
				}
			}
			require.True(t, refreshed, "no EKS token refresh was traced")
			logged := false
			for _, record := range sink.Records() {
				if record.Message == "eks token refreshed" {
					logged = true
					assert.Equal(t, labelTestConnectionID, record.ToMap()["connection"])
				}
			}
			assert.True(t, logged, "no EKS token refresh was logged")
		})
	}
}

func TestWithConnectionIDKeepsANilContextNil(t *testing.T) {
	var ctx context.Context
	assert.Nil(t, WithConnectionID(ctx, labelTestConnectionID))
	// So a build still reports the missing context itself.
	_, err := LoadKubeClients(WithConnectionID(ctx, labelTestConnectionID), "unused", "prod")
	require.ErrorContains(t, err, "requires a context")
}
