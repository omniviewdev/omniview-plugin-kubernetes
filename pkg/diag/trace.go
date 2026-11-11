package diag

import (
	"context"
	"errors"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const TracerName = "omniview.plugin.kubernetes"

func Tracer() trace.Tracer { return otel.Tracer(TracerName) }

type Classification struct {
	Outcome, Class, Reason string
	StatusCode             int
}

func ClassifyError(err error, inValidation bool) Classification {
	if err == nil {
		return Classification{Outcome: "success"}
	}
	if errors.Is(err, context.Canceled) {
		return Classification{Outcome: "canceled", Class: "canceled"}
	}
	if errors.Is(err, context.DeadlineExceeded) || resource.ErrorCode(err) == "TIMEOUT" {
		return Classification{Outcome: "canceled", Class: "deadline_exceeded"}
	}
	if inValidation {
		return Classification{Outcome: "failure", Class: "validation"}
	}
	var apiStatus apierrors.APIStatus
	if errors.As(err, &apiStatus) {
		s := apiStatus.Status()
		reason := "Other"
		switch s.Reason {
		case metav1.StatusReasonUnauthorized, metav1.StatusReasonForbidden, metav1.StatusReasonNotFound,
			metav1.StatusReasonAlreadyExists, metav1.StatusReasonConflict, metav1.StatusReasonInvalid,
			metav1.StatusReasonTooManyRequests, metav1.StatusReasonTimeout, metav1.StatusReasonServerTimeout,
			metav1.StatusReasonServiceUnavailable, metav1.StatusReasonInternalError, metav1.StatusReasonBadRequest,
			metav1.StatusReasonMethodNotAllowed, metav1.StatusReasonGone, metav1.StatusReasonExpired:
			reason = string(s.Reason)
		}
		return Classification{Outcome: "failure", Class: "kubernetes", Reason: reason, StatusCode: int(s.Code)}
	}
	return Classification{Outcome: "failure", Class: "other"}
}
func (c Classification) SpanAttrs() []attribute.KeyValue {
	attrs := []attribute.KeyValue{attribute.String("outcome", c.Outcome)}
	if c.Class != "" {
		attrs = append(attrs, attribute.String("error.class", c.Class))
	}
	if c.Class == "kubernetes" {
		attrs = append(attrs, attribute.Int("k8s.status_code", c.StatusCode), attribute.String("k8s.reason", c.Reason))
	}
	return attrs
}
func (c Classification) LogFields() []any {
	fields := []any{"outcome", c.Outcome}
	if c.Class != "" {
		fields = append(fields, "error_class", c.Class)
	}
	if c.Class == "kubernetes" {
		fields = append(fields, "k8s_status_code", c.StatusCode, "k8s_reason", c.Reason)
	}
	return fields
}
func EndSpan(span trace.Span, err error, inValidation bool) Classification {
	c := ClassifyError(err, inValidation)
	span.SetAttributes(c.SpanAttrs()...)
	if c.Outcome == "failure" {
		span.SetStatus(codes.Error, c.Class)
	}
	span.End()
	return c
}
