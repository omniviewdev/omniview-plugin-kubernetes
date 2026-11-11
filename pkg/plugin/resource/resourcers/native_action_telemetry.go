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

type nativeActionTelemetry struct {
	span                           trace.Span
	log                            *zap.SugaredLogger
	action, kind, stage, operation string
	connection, id, namespace      string
}

func startNativeActionTelemetry(ctx context.Context, log *zap.SugaredLogger, kind string, input resource.ActionRequest) (context.Context, *nativeActionTelemetry) {
	ctx, span := diag.Tracer().Start(ctx, "kubernetes."+kind+"."+input.Action)
	namespace, _ := nativeRequestNamespace(input.Reference.Address.Scope)
	return ctx, &nativeActionTelemetry{span: span, log: log, kind: kind, action: input.Action, connection: input.Route.Connection, id: input.Reference.Address.ID, namespace: namespace, stage: "validation", operation: "validate"}
}

func (t *nativeActionTelemetry) finish(err error) {
	defer t.span.End()
	classification := diag.ClassifyError(err, t.stage == "validation")
	outcome, class, reason, status := classification.Outcome, classification.Class, classification.Reason, classification.StatusCode
	if err != nil {
		t.span.SetStatus(codes.Error, class)
	}
	resourceType := "k8s:/nodes"
	if t.kind == "cronjob" {
		resourceType = "k8s:batch/cronjobs"
	} else if t.kind == "pod" {
		resourceType = "k8s:/pods"
	}
	attrs := []attribute.KeyValue{attribute.String("action", t.action), attribute.String("plugin", "kubernetes"), attribute.String("resource.type", resourceType), attribute.String("stage", t.stage), attribute.String("operation", t.operation), attribute.String("outcome", outcome)}
	fields := []interface{}{"action", t.action, "plugin", "kubernetes", "resource_type", resourceType, "stage", t.stage, "operation", t.operation, "outcome", outcome}
	attrs = append(attrs, attribute.String("connection", t.connection), attribute.String("resource.id", t.id), attribute.String("resource.namespace", t.namespace))
	fields = append(fields, "connection", t.connection, "resource_id", t.id, "namespace", t.namespace)
	if err != nil {
		attrs = append(attrs, attribute.String("error.class", class))
		fields = append(fields, "error_class", class)
		if class == "kubernetes" {
			attrs = append(attrs, attribute.Int("k8s.status_code", status), attribute.String("k8s.reason", reason))
			fields = append(fields, "k8s_status_code", status, "k8s_reason", reason)
		}
	}
	t.span.SetAttributes(attrs...)
	if t.span.SpanContext().IsValid() {
		fields = append(fields, "trace_id", t.span.SpanContext().TraceID().String(), "span_id", t.span.SpanContext().SpanID().String())
	}
	t.log.Infow("Kubernetes action finished", fields...)
}
