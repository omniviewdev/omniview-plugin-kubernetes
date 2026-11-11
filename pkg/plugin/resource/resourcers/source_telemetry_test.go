package resourcers

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
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
	dynamicfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"
)

type unusedSourceEmitter struct{ resource.SourceEmitter }

func TestSourceProbeFailureIsClassifiedInSpanAndLogs(t *testing.T) {
	previous := otel.GetTracerProvider()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		require.NoError(t, provider.Shutdown(context.Background()))
	})
	gvr := schema.GroupVersionResource{Version: "v1", Resource: "pods"}
	dynamicClient := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{gvr: "PodList"})
	dynamicClient.PrependReactor("list", "pods", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "p", errors.New("secret-provider-text"))
	})
	core, logs := observer.New(zap.DebugLevel)
	base := NewKubernetesResourcerBase[MetaAccessor](zap.New(core).Sugar(), gvr)
	err := base.Source(context.Background(), &clients.ClientSet{DynamicClient: dynamicClient}, resource.SourceRequest{}, unusedSourceEmitter{})
	require.Error(t, err)
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, "kubernetes.source.snapshot", spans[0].Name)
	attributes := map[string]string{}
	for _, attr := range spans[0].Attributes {
		attributes[string(attr.Key)] = attr.Value.String()
	}
	assert.Equal(t, "failure", attributes["outcome"])
	assert.Equal(t, "kubernetes", attributes["error.class"])
	assert.Equal(t, "Forbidden", attributes["k8s.reason"])
	require.NotEmpty(t, spans[0].Events)
	assert.Equal(t, "probe_failed", spans[0].Events[0].Name)
	encoded, marshalErr := json.Marshal(spans[0])
	require.NoError(t, marshalErr)
	assert.NotContains(t, string(encoded), "secret-provider-text")
	var warned bool
	for _, entry := range logs.All() {
		encodedLog, marshalErr := json.Marshal(entry.ContextMap())
		require.NoError(t, marshalErr)
		assert.NotContains(t, string(encodedLog), "secret-provider-text")
		if entry.Message == "source probe failed" {
			warned = true
			assert.Equal(t, "Forbidden", entry.ContextMap()["k8s_reason"])
		}
	}
	assert.True(t, warned, "probe failure must emit a classified Warn")
}
