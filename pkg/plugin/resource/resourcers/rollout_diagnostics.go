package resourcers

import (
	"context"

	"github.com/omniview/kubernetes/pkg/diag"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

type rolloutDiagnostic struct {
	span                                            trace.Span
	log                                             *zap.SugaredLogger
	action, stage, operation                        string
	connection, resourceType, resourceID, namespace string
}

func startRolloutDiagnostic(ctx context.Context, log *zap.SugaredLogger, kind, action string, input resource.ActionRequest) (context.Context, *rolloutDiagnostic) {
	ctx, span := diag.Tracer().Start(ctx, "kubernetes."+kind+"."+action)
	namespace, _ := nativeRequestNamespace(input.Reference.Address.Scope)
	resourceType := ""
	switch kind {
	case "deployment":
		resourceType = "k8s:apps/deployments"
	case "statefulset":
		resourceType = "k8s:apps/statefulsets"
	case "daemonset":
		resourceType = "k8s:apps/daemonsets"
	}
	return ctx, &rolloutDiagnostic{span: span, log: log, action: action, stage: "validation", operation: "validate",
		connection: input.Route.Connection, resourceType: resourceType, resourceID: input.Reference.Address.ID, namespace: namespace}
}

func (d *rolloutDiagnostic) finish(err error) {
	defer d.span.End()
	classification := diag.ClassifyError(err, d.stage == "validation")
	outcome, class, reason, status := classification.Outcome, classification.Class, classification.Reason, classification.StatusCode
	if err != nil {
		d.span.SetStatus(codes.Error, class)
	}
	attrs := []attribute.KeyValue{attribute.String("plugin", "kubernetes"), attribute.String("resource.type", d.resourceType),
		attribute.String("connection", d.connection), attribute.String("resource.id", d.resourceID), attribute.String("resource.namespace", d.namespace),
		attribute.String("action", d.action), attribute.String("stage", d.stage), attribute.String("operation", d.operation), attribute.String("outcome", outcome)}
	fields := []interface{}{"plugin", "kubernetes", "resource_type", d.resourceType, "connection", d.connection, "resource_id", d.resourceID, "resource_namespace", d.namespace, "action", d.action, "stage", d.stage, "operation", d.operation, "outcome", outcome}
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
	d.log.Infow("Workload action finished", fields...)
}
