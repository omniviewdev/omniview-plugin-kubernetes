package kubeauth

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func captureObservability(t *testing.T) (*tracetest.InMemoryExporter, *logtest.RecordingSink) {
	t.Helper()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previousProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	sink := &logtest.RecordingSink{}
	previousLogger := logging.Default()
	logging.SetDefault(logging.New(logging.Config{
		Name:    "test",
		Level:   logging.NewLevelController(logging.LevelTrace),
		Backend: logging.NewSinkBackend(sink),
	}))
	t.Cleanup(func() {
		otel.SetTracerProvider(previousProvider)
		logging.SetDefault(previousLogger)
	})
	return exporter, sink
}

func assertNoSecret(t *testing.T, exporter *tracetest.InMemoryExporter, sink *logtest.RecordingSink, secret string) {
	t.Helper()
	for _, span := range exporter.GetSpans() {
		var dump strings.Builder
		fmt.Fprint(&dump, span.Name, span.Status, span.Attributes)
		for _, event := range span.Events {
			fmt.Fprint(&dump, event.Name, event.Attributes)
		}
		if strings.Contains(dump.String(), secret) {
			t.Fatalf("span %s leaked %q", span.Name, secret)
		}
	}
	for _, record := range sink.Records() {
		if strings.Contains(fmt.Sprint(record.Message, record.Fields), secret) {
			t.Fatalf("log %q leaked %q", record.Message, secret)
		}
	}
}

func spanAttr(attrs []attribute.KeyValue, key string) string {
	for _, a := range attrs {
		if string(a.Key) == key {
			return a.Value.Emit()
		}
	}
	return ""
}

func TestEKSTokenRefreshEmitsSpanWithoutSecrets(t *testing.T) {
	const secret = "fake-session-token"
	t.Setenv("AWS_EC2_METADATA_DISABLED", "true")
	t.Setenv("AWS_CONFIG_FILE", filepath.Join(t.TempDir(), "config"))
	t.Setenv("AWS_SHARED_CREDENTIALS_FILE", filepath.Join(t.TempDir(), "credentials"))
	t.Setenv("AWS_ACCESS_KEY_ID", "synthetic")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "synthetic")
	t.Setenv("AWS_SESSION_TOKEN", secret)
	exporter, sink := captureObservability(t)

	transport := &eksAuthTransport{ClusterName: "synthetic", Region: "us-east-1", Connection: "conn-1",
		Base: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: http.NoBody, Header: http.Header{"X-Secret": {secret}}}, nil
		})}
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "https://example.invalid/", nil)
	if _, err := transport.RoundTrip(req); err != nil {
		t.Fatal(err)
	}
	spans := exporter.GetSpans()
	if len(spans) != 1 || spans[0].Name != "kubernetes.auth.eks.token" {
		t.Fatalf("unexpected spans %v", spans)
	}
	if got := spanAttr(spans[0].Attributes, "outcome"); got != "success" {
		t.Fatalf("outcome = %q", got)
	}
	if got := spanAttr(spans[0].Attributes, "connection"); got != "conn-1" {
		t.Fatalf("connection = %q", got)
	}
	assertNoSecret(t, exporter, sink, secret)
	assertNoSecret(t, exporter, sink, transport.token)
}

func TestEKSTokenRefreshFailureIsClassifiedAndLogged(t *testing.T) {
	exporter, sink := captureObservability(t)
	transport := &eksAuthTransport{Region: "us-east-1", Connection: "conn-1"}
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "https://example.invalid/", nil)
	if _, err := transport.RoundTrip(req); err == nil {
		t.Fatal("expected error")
	}
	spans := exporter.GetSpans()
	if len(spans) != 1 {
		t.Fatalf("unexpected spans %v", spans)
	}
	if spanAttr(spans[0].Attributes, "outcome") != "failure" || spanAttr(spans[0].Attributes, "error.class") != "other" {
		t.Fatalf("attrs = %v", spans[0].Attributes)
	}
	warned := false
	for _, r := range sink.Records() {
		if r.Level == logging.LevelWarn && r.Message == "eks token refresh failed" {
			warned = true
		}
	}
	if !warned {
		t.Fatal("expected Warn log for failed refresh")
	}
}

func TestLoadKubeClientsFailureSpanIsClassified(t *testing.T) {
	exporter, sink := captureObservability(t)
	_, err := LoadKubeClients(context.Background(), filepath.Join(t.TempDir(), "missing-secret-path"), "ctx")
	if err == nil {
		t.Fatal("expected error")
	}
	spans := exporter.GetSpans()
	if len(spans) != 1 || spans[0].Name != "kubernetes.client.build" {
		t.Fatalf("unexpected spans %v", spans)
	}
	if spanAttr(spans[0].Attributes, "outcome") != "failure" || spanAttr(spans[0].Attributes, "operation") != "detect" {
		t.Fatalf("attrs = %v", spans[0].Attributes)
	}
	assertNoSecret(t, exporter, sink, "missing-secret-path")
}
