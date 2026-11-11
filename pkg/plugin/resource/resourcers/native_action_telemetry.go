package resourcers

import (
	"context"
	"errors"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type nativeActionTelemetry struct {
	span                           trace.Span
	log                            *zap.SugaredLogger
	action, kind, stage, operation string
	connection, id, namespace      string
}

func startNativeActionTelemetry(ctx context.Context, log *zap.SugaredLogger, kind string, input resource.ActionRequest) (context.Context, *nativeActionTelemetry) {
	ctx, span := otel.Tracer("omniview.plugin.kubernetes").Start(ctx, "kubernetes."+kind+"."+input.Action)
	namespace, _ := nativeRequestNamespace(input.Reference.Address.Scope)
	return ctx, &nativeActionTelemetry{span: span, log: log, kind: kind, action: input.Action, connection: input.Route.Connection, id: input.Reference.Address.ID, namespace: namespace, stage: "validation", operation: "validate"}
}

func (t *nativeActionTelemetry) finish(err error) {
	defer t.span.End()
	outcome, class, reason, status := "success", "", "", 0
	if err != nil {
		outcome, class = "failure", "other"
		switch {
		case errors.Is(err, context.Canceled):
			outcome, class = "canceled", "canceled"
		case errors.Is(err, context.DeadlineExceeded):
			outcome, class = "canceled", "deadline_exceeded"
		case t.stage == "validation":
			class = "validation"
		default:
			var apiStatus apierrors.APIStatus
			if errors.As(err, &apiStatus) {
				class = "kubernetes"
				s := apiStatus.Status()
				status = int(s.Code)
				switch s.Reason {
				case metav1.StatusReasonUnauthorized, metav1.StatusReasonForbidden, metav1.StatusReasonNotFound,
					metav1.StatusReasonAlreadyExists, metav1.StatusReasonConflict, metav1.StatusReasonInvalid,
					metav1.StatusReasonTooManyRequests, metav1.StatusReasonTimeout, metav1.StatusReasonServerTimeout,
					metav1.StatusReasonServiceUnavailable, metav1.StatusReasonInternalError, metav1.StatusReasonBadRequest,
					metav1.StatusReasonMethodNotAllowed, metav1.StatusReasonGone, metav1.StatusReasonExpired:
					reason = string(s.Reason)
				default:
					reason = "Other"
				}
			}
		}
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
