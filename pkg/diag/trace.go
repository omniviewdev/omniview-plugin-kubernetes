package diag

import (
	"context"
	"errors"
	"fmt"

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
	// ErrorType is the Go type of the innermost wrapped error, such as
	// "*net.OpError" or "syscall.Errno". It names a compile-time type and
	// carries nothing from the error text, so it is safe in logs and spans.
	ErrorType string
}

func ClassifyError(err error, inValidation bool) Classification {
	c := classifyError(err, inValidation)
	if err != nil {
		c.ErrorType = fmt.Sprintf("%T", innermost(err))
	}
	return c
}

func classifyError(err error, inValidation bool) Classification {
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
	if transport, ok := ClassifyTransport(err); ok {
		return Classification{Outcome: "failure", Class: transport.Class, Reason: transport.Reason}
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
	} else if c.Reason != "" {
		attrs = append(attrs, attribute.String("error.reason", c.Reason))
	}
	if c.ErrorType != "" {
		attrs = append(attrs, attribute.String("error.type", c.ErrorType))
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
	} else if c.Reason != "" {
		fields = append(fields, "error_reason", c.Reason)
	}
	if c.ErrorType != "" {
		fields = append(fields, "error_type", c.ErrorType)
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
