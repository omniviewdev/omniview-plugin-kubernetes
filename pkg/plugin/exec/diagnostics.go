package exec

import (
	"context"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

type execDiagnosticKey struct{}

type execDiagnostic struct {
	ctx       *types.PluginContext
	span      trace.Span
	stage     string
	operation string
	pod       string
	namespace string
}

func startExecDiagnostic(ctx *types.PluginContext, name string) (context.Context, *execDiagnostic) {
	base := context.Background()
	if ctx != nil && ctx.Context != nil {
		base = ctx.Context
	}
	base, span := diag.Tracer().Start(base, name)
	return base, &execDiagnostic{ctx: ctx, span: span, stage: "admission", operation: "validate"}
}

func (d *execDiagnostic) finish(err error) {
	defer d.span.End()
	classification := diag.ClassifyError(err, d.stage == "admission")
	outcome, class, reason, status := classification.Outcome, classification.Class, classification.Reason, classification.StatusCode
	if err != nil {
		d.span.SetStatus(codes.Error, class)
	}
	connection := ""
	if d.ctx != nil && d.ctx.Connection != nil {
		connection = d.ctx.Connection.ID
	}
	attrs := []attribute.KeyValue{attribute.String("action", "exec"), attribute.String("plugin", "kubernetes"),
		attribute.String("connection", connection), attribute.String("resource.type", "k8s:/pods"),
		attribute.String("resource.id", d.pod), attribute.String("pod.namespace", d.namespace),
		attribute.String("stage", d.stage), attribute.String("operation", d.operation), attribute.String("outcome", outcome)}
	fields := []interface{}{"action", "exec", "plugin", "kubernetes", "connection", connection, "resource_type", "k8s:/pods",
		"resource_id", d.pod, "pod_namespace", d.namespace, "stage", d.stage, "operation", d.operation, "outcome", outcome}
	if err != nil {
		attrs = append(attrs, attribute.String("error.class", class))
		fields = append(fields, "error_class", class)
		if class == "kubernetes" {
			attrs = append(attrs, attribute.Int("k8s.status_code", status), attribute.String("k8s.reason", reason))
			fields = append(fields, "k8s_status_code", status, "k8s_reason", reason)
		}
	}
	d.span.SetAttributes(attrs...)
	if d.span.SpanContext().IsValid() {
		fields = append(fields, "trace_id", d.span.SpanContext().TraceID().String(), "span_id", d.span.SpanContext().SpanID().String())
	}
	if d.ctx != nil && d.ctx.Logger != nil {
		d.ctx.Logger.Infow(context.Background(), "Pod exec finished", fields...)
	}
}
