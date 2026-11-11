// Package remoteerr turns errors that may carry remote (Kubernetes API,
// Prometheus, kubelet, filesystem) text into errors that are safe to return to
// clients. The class is preserved for errors.Is/As based classification; the
// original text is dropped.
package remoteerr

import (
	"context"
	"errors"
	"fmt"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/omniview/kubernetes/pkg/diag"
)

type safeError struct {
	msg   string
	class error
}

func (e *safeError) Error() string { return e.msg }
func (e *safeError) Unwrap() error { return e.class }

// Sanitize returns an error that is safe to send to a client.
//
//   - nil stays nil.
//   - Errors carrying an allow-listed SDK resource code keep only that code, with
//     fixed local text; their title, message and cause are dropped.
//   - Cancellation and deadlines stay matchable with errors.Is.
//   - Kubernetes API failures keep their status code and allow-listed reason and
//     stay matchable with apierrors helpers, but lose the server message.
//   - Everything else becomes "<operation> failed".
//
// operation must be a fixed string written by our code.
func Sanitize(operation string, err error) error {
	if err == nil {
		return nil
	}
	// The bare context sentinels carry no remote text and callers compare them directly.
	if err == context.Canceled || err == context.DeadlineExceeded {
		return err
	}
	var coded *resource.ResourceOperationError
	if errors.As(err, &coded) && coded != nil && resource.IsErrorCode(coded.Code) {
		// Title, Message and the wrapped cause may carry provider data; only the
		// allow-listed code survives, with fixed local text.
		return resource.NewError(coded.Code, operation+" failed ("+coded.Code+")")
	}
	class := diag.ClassifyError(err, false)
	switch class.Class {
	case "canceled":
		return &safeError{msg: operation + " canceled", class: context.Canceled}
	case "deadline_exceeded":
		return &safeError{msg: operation + " timed out", class: context.DeadlineExceeded}
	case "kubernetes":
		reason := metav1.StatusReason(class.Reason)
		label := class.Reason
		if class.Reason == "Other" {
			reason = metav1.StatusReasonUnknown
		}
		return &safeError{
			msg: fmt.Sprintf("%s failed: kubernetes API error (%s, status %d)", operation, label, class.StatusCode),
			class: &apierrors.StatusError{ErrStatus: metav1.Status{
				Status: metav1.StatusFailure, Reason: reason, Code: int32(class.StatusCode),
			}},
		}
	default:
		return &safeError{msg: operation + " failed"}
	}
}
