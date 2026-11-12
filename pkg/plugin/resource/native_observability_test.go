package resource

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	clienttesting "k8s.io/client-go/testing"
)

func captureSpans(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	previous := otel.GetTracerProvider()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		require.NoError(t, provider.Shutdown(context.Background()))
	})
	return exporter
}

func spanAttributes(span tracetest.SpanStub) map[string]string {
	attributes := make(map[string]string)
	for _, attr := range span.Attributes {
		attributes[string(attr.Key)] = attr.Value.String()
	}
	return attributes
}

func TestNativeGetSpanClassifiesFailureWithoutProviderText(t *testing.T) {
	exporter := captureSpans(t)
	client := nativeTestClient()
	client.PrependReactor("get", "widgets", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "widgets"}, "native-name", errors.New("secret-provider-text"))
	})
	_, err := NativeGet(context.Background(), client, nativeTestGVR, true, nativeTestGet("team-a"), nativeTestRepresentation())
	require.Error(t, err)
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, "kubernetes.resource.get", spans[0].Name)
	attributes := spanAttributes(spans[0])
	assert.Equal(t, "failure", attributes["outcome"])
	assert.Equal(t, "kubernetes", attributes["error.class"])
	assert.Equal(t, "Forbidden", attributes["k8s.reason"])
	assert.Equal(t, "team-a", attributes["resource.namespace"])
	assert.Equal(t, "native-name", attributes["resource.id"])
	encoded, marshalErr := json.Marshal(spans[0].Attributes)
	require.NoError(t, marshalErr)
	assert.NotContains(t, string(encoded), "secret-provider-text")
	assert.NotContains(t, spans[0].Status.Description, "secret-provider-text")
}

func TestNativeGetSpanClassifiesTransportFailureWithItsCauseType(t *testing.T) {
	exporter := captureSpans(t)
	client := nativeTestClient()
	client.PrependReactor("get", "widgets", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, &url.Error{Op: "Get", URL: "https://secret-host.internal:6443/apis/example/v1/widgets/native-name", Err: io.EOF}
	})
	_, err := NativeGet(context.Background(), client, nativeTestGVR, true, nativeTestGet("team-a"), nativeTestRepresentation())
	require.Error(t, err)
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	attributes := spanAttributes(spans[0])
	assert.Equal(t, "failure", attributes["outcome"])
	assert.Equal(t, "network", attributes["error.class"])
	assert.Equal(t, "eof", attributes["error.reason"])
	assert.Equal(t, "*errors.errorString", attributes["error.type"])
	encoded, marshalErr := json.Marshal(spans[0].Attributes)
	require.NoError(t, marshalErr)
	assert.NotContains(t, string(encoded), "secret-host")
	assert.NotContains(t, spans[0].Status.Description, "secret-host")
}

func TestNativeEnumerateSpanReportsItemCount(t *testing.T) {
	exporter := captureSpans(t)
	client := nativeTestClient(nativeTestObject("one", "team-a"))
	_, err := NativeEnumerate(context.Background(), client, nativeTestGVR, true, nativeTestEnumerate(nativeTestOneOf("team-a")), nativeTestRepresentation())
	require.NoError(t, err)
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, "kubernetes.resource.list", spans[0].Name)
	attributes := spanAttributes(spans[0])
	assert.Equal(t, "success", attributes["outcome"])
	assert.Equal(t, "1", attributes["items"])
}

func TestNativeSchemaFailureLogsClosedBudgetReason(t *testing.T) {
	core, logs := observer.New(zap.DebugLevel)
	p := &kubernetesProvider{logger: zap.New(core).Sugar()}
	p.logNativeSchemaFailures(map[string]error{
		"a": &nativeBudgetError{reason: "schema_retained_budget", text: "secret-budget-text"},
		"b": context.Canceled,
	})
	var warned bool
	for _, entry := range logs.All() {
		encoded, err := json.Marshal(entry.ContextMap())
		require.NoError(t, err)
		assert.NotContains(t, string(encoded), "secret-budget-text")
		if entry.Message == "native catalog budget exhausted" {
			warned = true
			assert.Equal(t, "schema_retained_budget", entry.ContextMap()["reason"])
		}
	}
	assert.True(t, warned)
}
