package resource

import (
	"context"
	"errors"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type actionAdmissionKey struct{}

// Action observes failures before the native action handler takes ownership.
func (p *kubernetesProvider) Action(ctx context.Context, request resourcev2.ActionRequest) (value resourcev2.Value, resultErr error) {
	if !diagnosedNativeAction(request.Reference.Address.Type, request.Action) {
		return p.Controller.Action(ctx, request)
	}
	ctx, span := otel.Tracer("omniview.plugin.kubernetes").Start(ctx, "kubernetes.action.preflight")
	defer span.End()
	delegated := false
	ctx = context.WithValue(ctx, actionAdmissionKey{}, &delegated)
	defer func() {
		if resultErr == nil || delegated {
			return
		}
		classification, reason, status := "validation", "", 0
		switch {
		case errors.Is(resultErr, context.Canceled):
			classification = "canceled"
		case errors.Is(resultErr, context.DeadlineExceeded):
			classification = "deadline_exceeded"
		default:
			var apiStatus apierrors.APIStatus
			if errors.As(resultErr, &apiStatus) {
				classification = "kubernetes"
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
		outcome := "failure"
		if classification == "canceled" || classification == "deadline_exceeded" {
			outcome = "canceled"
		}
		attrs := []attribute.KeyValue{attribute.String("action", request.Action), attribute.String("plugin", "kubernetes"),
			attribute.String("connection", request.Route.Connection), attribute.String("resource.type", request.Reference.Address.Type),
			attribute.String("resource.id", request.Reference.Address.ID), attribute.String("stage", "preflight"),
			attribute.String("outcome", outcome), attribute.String("error.class", classification)}
		fields := []interface{}{"action", request.Action, "plugin", "kubernetes", "connection", request.Route.Connection,
			"resource_type", request.Reference.Address.Type, "resource_id", request.Reference.Address.ID,
			"stage", "preflight", "outcome", outcome, "error_class", classification}
		if classification == "kubernetes" {
			attrs = append(attrs, attribute.Int("k8s.status_code", status), attribute.String("k8s.reason", reason))
			fields = append(fields, "k8s_status_code", status, "k8s_reason", reason)
		}
		span.SetAttributes(attrs...)
		span.SetStatus(codes.Error, classification)
		if span.SpanContext().IsValid() {
			fields = append(fields, "trace_id", span.SpanContext().TraceID().String(), "span_id", span.SpanContext().SpanID().String())
		}
		p.logger.Infow("Kubernetes action preflight failed", fields...)
	}()
	return p.Controller.Action(ctx, request)
}

func diagnosedNativeAction(resourceType, action string) bool {
	switch resourceType {
	case "k8s:apps/deployments":
		return action == "rollout-restart" || action == "scale" || action == "pause" || action == "resume"
	case "k8s:apps/statefulsets":
		return action == "rollout-restart" || action == "scale"
	case "k8s:apps/daemonsets":
		return action == "rollout-restart"
	case "k8s:batch/cronjobs":
		return action == "trigger" || action == "suspend" || action == "resume"
	case "k8s:/nodes":
		return action == "cordon" || action == "uncordon" || action == "add-taint" || action == "remove-taint" || action == "get-conditions"
	case "k8s:/pods":
		return action == "exec"
	}
	return false
}
