package metric

import (
	"context"

	"github.com/omniview/kubernetes/pkg/diag"
	logging "github.com/omniviewdev/plugin-sdk/log"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// promLog returns the process logger configured by the SDK. Metric query
// contexts carry no request-scoped logger.
func promLog() logging.Logger { return logging.Default() }

// promMetricQueryFailed records a tolerated per-metric query failure. The
// metric ID comes from the plugin's own catalog; the error is only classified.
func promMetricQueryFailed(ctx context.Context, operation, metricID string, err error) {
	promLog().Debugw(ctx, "prometheus metric query failed; metric skipped",
		append([]any{"operation", operation, "metric_id", metricID}, diag.ClassifyError(err, false).LogFields()...)...)
}

// metricShapeName maps a metric shape to a closed vocabulary.
func metricShapeName(shape sdkmetric.MetricShape) string {
	switch shape {
	case sdkmetric.ShapeCurrent:
		return "current"
	case sdkmetric.ShapeTimeseries:
		return "timeseries"
	case sdkmetric.ShapeAggregate:
		return "aggregate"
	default:
		return "other"
	}
}

// detectionObserved records the Prometheus detection outcome on the active
// span (when any) and as a Debug log.
func detectionObserved(ctx context.Context, cacheHit bool, result *DetectionResult) {
	attrs := []attribute.KeyValue{attribute.Bool("cache.hit", cacheHit)}
	fields := []any{"cache_hit", cacheHit}
	if result != nil {
		attrs = append(attrs, attribute.Bool("prometheus.found", result.Found))
		fields = append(fields, "found", result.Found)
		if result.Found {
			fields = append(fields, "service", result.Service, "resource_namespace", result.Namespace)
		}
	}
	span := trace.SpanFromContext(ctx)
	span.SetAttributes(attribute.Bool("cache.hit", cacheHit))
	span.AddEvent("prometheus.detect", trace.WithAttributes(attrs...))
	promLog().Debugw(ctx, "prometheus detection result", fields...)
}
