package exec

import (
	"context"
	"regexp"

	"github.com/omniview/kubernetes/pkg/diag"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// execLogger returns the request-scoped logger, falling back to the process default.
func execLogger(ctx *types.PluginContext) logging.Logger {
	if ctx != nil && ctx.Logger != nil {
		return ctx.Logger
	}
	return logging.Default()
}

// execBaseContext returns the request context for log records.
func execBaseContext(ctx *types.PluginContext) context.Context {
	if ctx != nil && ctx.Context != nil {
		return ctx.Context
	}
	return context.Background()
}

// execLoggerFromContext resolves the logger of the diagnostic carried by ctx.
func execLoggerFromContext(ctx context.Context) logging.Logger {
	if parent, ok := ctx.Value(execDiagnosticKey{}).(*execDiagnostic); ok {
		return execLogger(parent.ctx)
	}
	return logging.Default()
}

// execBuildFailed records an executor construction failure as a span event
// and a classified Warn. The raw error text is never exported.
func execBuildFailed(ctx context.Context, transport string, err error) {
	class := diag.ClassifyError(err, false)
	trace.SpanFromContext(ctx).AddEvent("executor_build_failed", trace.WithAttributes(
		append([]attribute.KeyValue{attribute.String("transport", transport)}, class.SpanAttrs()...)...))
	execLoggerFromContext(ctx).Warnw(ctx, "exec executor build failed",
		append([]any{"transport", transport}, class.LogFields()...)...)
}

var containerReasonPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9]{0,39}$`)

// safeContainerReason returns a kubelet-reported container reason only when it
// has the shape of an enum-like identifier; anything else is remote free text.
func safeContainerReason(reason string) string {
	if reason == "" {
		return "Unknown"
	}
	if containerReasonPattern.MatchString(reason) {
		return reason
	}
	return "Unknown"
}
