package metric

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/omniviewdev/plugin-sdk/settings"

	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func captureMetricLogs(t *testing.T) *logtest.RecordingSink {
	t.Helper()
	sink := &logtest.RecordingSink{}
	previous := logging.Default()
	logging.SetDefault(logging.New(logging.Config{
		Name:    "test",
		Level:   logging.NewLevelController(logging.LevelDebug),
		Backend: logging.NewSinkBackend(sink),
	}))
	t.Cleanup(func() { logging.SetDefault(previous) })
	return sink
}

func captureMetricSpans(t *testing.T) *tracetest.InMemoryExporter {
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

func metricRecordText(sink *logtest.RecordingSink) string {
	var b strings.Builder
	for _, record := range sink.Records() {
		b.WriteString(record.Message)
		for _, field := range record.Fields {
			fmt.Fprintf(&b, " %s=%v", field.Key, field.Value)
		}
		b.WriteByte('\n')
	}
	return b.String()
}

func TestCompositeQueryEmitsClassifiedSpan(t *testing.T) {
	exporter := captureMetricSpans(t)
	sink := captureMetricLogs(t)
	const arbitraryMetricID = "prom_private_metric_identifier"
	_, err := compositeQuery(nil, nil, sdkmetric.QueryRequest{ResourceKey: "k8s:/nodes", MetricIDs: []string{arbitraryMetricID}})
	require.Error(t, err)

	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, "kubernetes.metric.query", spans[0].Name)
	attrs := map[string]string{}
	for _, attr := range spans[0].Attributes {
		attrs[string(attr.Key)] = attr.Value.String()
	}
	assert.Equal(t, "prometheus", attrs["source"])
	assert.Equal(t, "k8s:/nodes", attrs["resource.type"])
	assert.Equal(t, "current", attrs["shape"])
	assert.Equal(t, "failure", attrs["outcome"])
	assert.Equal(t, "other", attrs["error.class"])
	assert.Contains(t, metricRecordText(sink), "metric query finished")
	assert.NotContains(t, metricRecordText(sink), arbitraryMetricID)
	for _, attr := range spans[0].Attributes {
		assert.NotContains(t, attr.Value.String(), arbitraryMetricID)
	}

	exporter.Reset()
	_, _ = compositeQuery(nil, nil, sdkmetric.QueryRequest{ResourceKey: "cluster::metrics"})
	spans = exporter.GetSpans()
	require.Len(t, spans, 1)
	for _, attr := range spans[0].Attributes {
		if attr.Key == "source" {
			assert.Equal(t, "prometheus", attr.Value.AsString())
		}
	}
}

type countingServiceChecker struct{ calls int }

func (f *countingServiceChecker) ServiceExists(context.Context, string, string) (bool, error) {
	f.calls++
	return true, nil
}

func TestDetectionRecordsCacheHitOnSpan(t *testing.T) {
	exporter := captureMetricSpans(t)
	sink := captureMetricLogs(t)
	detector := NewPrometheusDetector(DetectorOpts{})
	checker := &countingServiceChecker{}

	for i, wantHit := range []bool{false, true} {
		exporter.Reset()
		ctx, span := otel.Tracer("test").Start(context.Background(), "parent")
		result := detector.Detect(ctx, "cluster", checker, "", "", 0)
		span.End()
		require.True(t, result.Found)
		spans := exporter.GetSpans()
		require.Len(t, spans, 1, "iteration %d", i)
		var hit, seen bool
		for _, attr := range spans[0].Attributes {
			if attr.Key == "cache.hit" {
				hit, seen = attr.Value.AsBool(), true
			}
		}
		require.True(t, seen)
		assert.Equal(t, wantHit, hit)
		require.Len(t, spans[0].Events, 1)
		assert.Equal(t, "prometheus.detect", spans[0].Events[0].Name)
	}
	assert.Equal(t, 1, checker.calls)
	assert.Contains(t, metricRecordText(sink), "prometheus detection result")
}

func TestServiceProbeFailureIsLoggedAsClassWithoutProviderText(t *testing.T) {
	sink := captureMetricLogs(t)
	client := fake.NewSimpleClientset()
	client.PrependReactor("get", "services", func(ktesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "services"}, "prometheus", errors.New("secret-forbidden-text"))
	})
	exists, err := (&kubeServiceChecker{clientset: client}).ServiceExists(context.Background(), "monitoring", "prometheus")
	require.NoError(t, err)
	assert.False(t, exists)

	text := metricRecordText(sink)
	assert.Contains(t, text, "prometheus service probe failed")
	assert.Contains(t, text, "k8s_reason=Forbidden")
	assert.NotContains(t, text, "secret-forbidden-text")
}

func TestPromMetricQueryFailedDoesNotLeakErrorText(t *testing.T) {
	sink := captureMetricLogs(t)
	promMetricQueryFailed(context.Background(), "instant", errors.New("prometheus query error: secret-promql-error"))
	records := sink.Records()
	require.Len(t, records, 1)
	assert.Equal(t, logging.LevelDebug, records[0].Level)
	fields := records[0].ToMap()
	assert.NotContains(t, fields, "metric_id")
	assert.Equal(t, "other", fields["error_class"])
	assert.NotContains(t, metricRecordText(sink), "secret-promql-error")
}

func TestNodeMetricsClientErrorDoesNotExposeKubeconfigPath(t *testing.T) {
	qctx := &sdkmetric.QueryContext{
		Context:      context.Background(),
		ConnectionID: "cluster",
		Connection: &types.Connection{
			ID:   "cluster",
			Data: map[string]any{"kubeconfig": "/secret/home/user/missing-kubeconfig"},
		},
	}
	response, err := queryNodeMetrics(qctx, sdkmetric.QueryRequest{ResourceKey: "k8s:/nodes", ResourceID: "node"})
	require.NoError(t, err)
	require.NotNil(t, response)
	assert.False(t, response.Success)
	assert.NotEmpty(t, response.Error)
	assert.NotContains(t, response.Error, "/secret/home/user")
}

func TestCompositeQuerySanitizesRemoteErrors(t *testing.T) {
	captureMetricSpans(t)
	factory := func(context.Context, *types.Connection) (*kubeauth.KubeClientBundle, error) {
		return nil, fmt.Errorf("dial https://secret-cluster.invalid with token secret-token: %w", errors.New("secret-remote-text"))
	}
	prom := retirementClient(t, factory)
	prom.settings = settings.NewProvider(settings.ProviderOpts{PluginID: "kubernetes"})
	qctx := &sdkmetric.QueryContext{
		Context:      context.Background(),
		ConnectionID: "cluster",
		Connection:   &types.Connection{ID: "cluster"},
	}
	for _, shape := range []sdkmetric.MetricShape{sdkmetric.ShapeCurrent, sdkmetric.ShapeTimeseries} {
		_, err := compositeQuery(prom, qctx, sdkmetric.QueryRequest{ResourceKey: "cluster::metrics", Shape: shape})
		require.Error(t, err)
		assert.NotContains(t, err.Error(), "secret-")
	}
}
