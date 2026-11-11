package helm

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
)

// helmDebugSink routes Helm's internal debug output to the plugin logger at
// Debug so it is controlled by the plugin log level instead of stderr.
func helmDebugSink(ctx context.Context) action.DebugLog {
	logger := logging.Default().Named("helm")
	return func(format string, v ...interface{}) {
		if !logger.Enabled(ctx, logging.LevelDebug) {
			return
		}
		logger.Debug(ctx, fmt.Sprintf(format, v...))
	}
}

// locateAndLoadChart resolves a chart reference and loads it, recording
// chart_located / chart_load_failed events on the current span. Only the
// classification is recorded; chart paths and provider text never leave the
// returned error.
func locateAndLoadChart(ctx context.Context, opts *action.ChartPathOptions, chartRef string, settings *cli.EnvSettings) (*chart.Chart, error) {
	span := trace.SpanFromContext(ctx)
	chartPath, err := opts.LocateChart(chartRef, settings)
	if err != nil {
		span.AddEvent("chart_load_failed", trace.WithAttributes(
			attribute.String("stage", "locate"),
			attribute.String("error.class", diag.ClassifyError(err, false).Class),
		))
		return nil, fmt.Errorf("failed to locate chart %s: %w", chartRef, err)
	}
	span.AddEvent("chart_located", trace.WithAttributes(attribute.Bool("version_pinned", opts.Version != "")))
	ch, err := loader.Load(chartPath)
	if err != nil {
		span.AddEvent("chart_load_failed", trace.WithAttributes(
			attribute.String("stage", "load"),
			attribute.String("error.class", diag.ClassifyError(err, false).Class),
		))
		return nil, fmt.Errorf("failed to load chart %s: %w", chartPath, err)
	}
	return ch, nil
}

// traceRepoIndex wraps a repository index download or OCI registry operation in
// a kubernetes.helm.repo.index span. The repository URL (which may carry
// credentials) is never recorded; only the repository name and operation kind.
func traceRepoIndex(ctx context.Context, log *zap.SugaredLogger, repoName, kind string, run func() error) error {
	_, span := diag.Tracer().Start(ctx, "kubernetes.helm.repo.index", trace.WithAttributes(
		attribute.String("repo", repoName), attribute.String("kind", kind),
	))
	start := time.Now()
	err := run()
	c := diag.EndSpan(span, err, false)
	if log != nil {
		fields := append([]interface{}{"repo", repoName, "kind", kind, "duration_ms", time.Since(start).Milliseconds()}, c.LogFields()...)
		if err != nil {
			log.Warnw("Helm repository index operation failed", fields...)
		} else {
			log.Debugw("Helm repository index operation finished", fields...)
		}
	}
	return err
}

// releaseOpSpanName maps a known Helm release action to its span name.
func releaseOpSpanName(actionID string) string {
	return "kubernetes.helm.release." + strings.ReplaceAll(actionID, "-", "_")
}
