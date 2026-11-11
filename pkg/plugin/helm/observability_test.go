package helm

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
)

func captureHelmSpans(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() { otel.SetTracerProvider(previous); _ = provider.Shutdown(context.Background()) })
	return exporter
}

func spanText(attrs []attribute.KeyValue) string {
	var b strings.Builder
	for _, a := range attrs {
		b.WriteString(string(a.Key) + "=" + a.Value.String() + ";")
	}
	return b.String()
}

func TestTraceRepoIndexRecordsClassificationWithoutURLOrErrorText(t *testing.T) {
	exporter := captureHelmSpans(t)
	core, logs := observer.New(zap.DebugLevel)
	secret := "https://user:s3cr3t-token@charts.example/index.yaml"

	err := traceRepoIndex(context.Background(), zap.New(core).Sugar(), "stable", "index", func() error {
		return errors.New("GET " + secret + ": connection refused")
	})
	require.Error(t, err)

	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	require.Equal(t, "kubernetes.helm.repo.index", spans[0].Name)
	text := spanText(spans[0].Attributes) + spans[0].Status.Description
	require.Contains(t, text, "repo=stable")
	require.Contains(t, text, "outcome=failure")
	require.Contains(t, text, "error.class=other")
	require.NotContains(t, text, "s3cr3t-token")

	entries := logs.All()
	require.Len(t, entries, 1)
	require.Equal(t, zap.WarnLevel, entries[0].Level)
	require.NotContains(t, fmt.Sprint(entries[0].Message, entries[0].ContextMap()), "s3cr3t-token")
}

func TestLocateAndLoadChartRecordsFailureEventWithoutPaths(t *testing.T) {
	exporter := captureHelmSpans(t)
	dir := t.TempDir()
	t.Setenv("HELM_REPOSITORY_CONFIG", filepath.Join(dir, "repositories.yaml"))
	t.Setenv("HELM_REPOSITORY_CACHE", filepath.Join(dir, "cache"))

	ctx, span := otel.Tracer("test").Start(context.Background(), "parent")
	_, err := locateAndLoadChart(ctx, &action.ChartPathOptions{}, "missing-repo/missing-chart", cli.New())
	span.End()
	require.Error(t, err)

	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	var found bool
	for _, event := range spans[0].Events {
		if event.Name != "chart_load_failed" {
			continue
		}
		found = true
		text := spanText(event.Attributes)
		require.Contains(t, text, "stage=locate")
		require.Contains(t, text, "error.class=other")
		require.NotContains(t, text, dir)
	}
	require.True(t, found, "chart_load_failed event missing")
}

func TestHelmDebugSinkRoutesToStructuredLoggerAtDebug(t *testing.T) {
	sink := &logtest.RecordingSink{}
	previous := logging.Default()
	level := logging.NewLevelController(logging.LevelDebug)
	logging.SetDefault(logging.New(logging.Config{Name: "test", Level: level, Backend: logging.NewSinkBackend(sink)}))
	t.Cleanup(func() { logging.SetDefault(previous) })

	helmDebugSink(context.Background())("creating %d resource(s)", 3)
	records := sink.Records()
	require.Len(t, records, 1)
	require.Equal(t, logging.LevelDebug, records[0].Level)
	require.Equal(t, "creating 3 resource(s)", records[0].Message)

	level.Set(logging.LevelInfo)
	sink.Reset()
	helmDebugSink(context.Background())("hidden")
	require.Empty(t, sink.Records())
}
