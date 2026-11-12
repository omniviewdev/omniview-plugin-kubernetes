package kubeauth

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	logging "github.com/omniviewdev/plugin-sdk/log"
	sdkdiag "github.com/omniviewdev/plugin-sdk/pkg/diagnostics"
)

func clientBuildCount(t *testing.T, operation, outcome string) float64 {
	t.Helper()
	metrics, _ := sdkdiag.Default().Snapshot()
	for _, metric := range metrics {
		if metric.Name != "omniview.plugin.self.client.builds" {
			continue
		}
		for _, point := range metric.Points {
			got := map[string]string{}
			for _, attr := range point.Attrs {
				got[strings.ToLower(strings.TrimPrefix(attr.Key.String(), "DIAG_KEY_"))] = attr.Value
			}
			if got["operation"] == operation && got["outcome"] == outcome {
				return point.Value
			}
		}
	}
	return 0
}

func TestLoadResourceKubeClientsRecordsBuild(t *testing.T) {
	server := httptest.NewTLSServer(nil)
	defer server.Close()
	path := filepath.Join(t.TempDir(), "config")
	config := fmt.Sprintf("apiVersion: v1\nkind: Config\nclusters:\n- name: test\n  cluster:\n    server: %s\n    insecure-skip-tls-verify: true\nusers:\n- name: test\n  user:\n    token: build-secret\ncontexts:\n- name: test\n  context:\n    cluster: test\n    user: test\ncurrent-context: test\n", server.URL)
	if err := os.WriteFile(path, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	exporter, sink := captureObservability(t)
	before := clientBuildCount(t, "complete", "success")
	if _, err := LoadResourceKubeClients(context.Background(), path, "test"); err != nil {
		t.Fatal(err)
	}
	spans := exporter.GetSpans()
	if len(spans) != 1 || spans[0].Name != "kubernetes.client.build" {
		t.Fatalf("unexpected spans %v", spans)
	}
	if spanAttr(spans[0].Attributes, "outcome") != "success" || spanAttr(spans[0].Attributes, "operation") != "complete" || spanAttr(spans[0].Attributes, "connection") != "test" {
		t.Fatalf("attrs = %v", spans[0].Attributes)
	}
	if after := clientBuildCount(t, "complete", "success"); after != before+1 {
		t.Fatalf("client.builds{complete,success} = %v, want %v", after, before+1)
	}
	built := false
	for _, record := range sink.Records() {
		if record.Level == logging.LevelDebug && record.Message == "kubernetes clients built" && strings.Contains(fmt.Sprint(record.Fields), "duration_ms") {
			built = true
		}
	}
	if !built {
		t.Fatal("expected a duration log for the resource client build")
	}
	assertNoSecret(t, exporter, sink, "build-secret")
}

func TestLoadResourceKubeClientsFailureIsRecorded(t *testing.T) {
	exporter, sink := captureObservability(t)
	before := clientBuildCount(t, "detect", "failure")
	if _, err := LoadResourceKubeClients(context.Background(), filepath.Join(t.TempDir(), "missing-secret-path"), "ctx"); err == nil {
		t.Fatal("expected error")
	}
	spans := exporter.GetSpans()
	if len(spans) != 1 || spans[0].Name != "kubernetes.client.build" {
		t.Fatalf("unexpected spans %v", spans)
	}
	if spanAttr(spans[0].Attributes, "outcome") != "failure" || spanAttr(spans[0].Attributes, "operation") != "detect" {
		t.Fatalf("attrs = %v", spans[0].Attributes)
	}
	if after := clientBuildCount(t, "detect", "failure"); after != before+1 {
		t.Fatalf("client.builds{detect,failure} = %v, want %v", after, before+1)
	}
	warned := false
	for _, record := range sink.Records() {
		if record.Level == logging.LevelWarn && record.Message == "kubernetes client build failed" {
			warned = true
		}
	}
	if !warned {
		t.Fatal("expected a Warn log for the failed resource client build")
	}
	assertNoSecret(t, exporter, sink, "missing-secret-path")
}

func TestLoadResourceKubeClientsCanceledContextIsNotABuild(t *testing.T) {
	exporter, _ := captureObservability(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := LoadResourceKubeClients(ctx, "unused", "ctx"); err == nil {
		t.Fatal("expected error")
	}
	if spans := exporter.GetSpans(); len(spans) != 0 {
		t.Fatalf("pre-canceled call recorded spans %v", spans)
	}
}
