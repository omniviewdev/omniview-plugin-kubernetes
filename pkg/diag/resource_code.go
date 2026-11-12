package diag

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TransportFailure returns the transport failure behind a network or
// certificate classification.
func (c Classification) TransportFailure() (TransportFailure, bool) {
	if c.Class != ClassNetwork && c.Class != ClassCertificate {
		return TransportFailure{}, false
	}
	failure, ok := transportReasons[c.Reason]
	return failure, ok
}

// ResourceCode returns the SDK resource error code that reports this failure
// to a caller, or "" when the classification does not identify one (other,
// validation, and the context outcomes, which the SDK maps itself).
//
// Kubernetes statuses follow the table in classifyResourceError in
// pkg/plugin/resource; a test there keeps the two in step.
func (c Classification) ResourceCode() string {
	switch c.Class {
	case "kubernetes":
		return statusResourceCode(c.StatusCode, c.Reason)
	case ClassNetwork, ClassCertificate:
		failure, _ := c.TransportFailure()
		return failure.Code
	}
	return ""
}

func statusResourceCode(status int, reason string) string {
	switch {
	case status == 400 || status == 422:
		return "INVALID_REQUEST"
	case status == 401:
		return "UNAUTHORIZED"
	case status == 403:
		return "FORBIDDEN"
	case status == 404:
		return "NOT_FOUND"
	case status == 405:
		return "UNSUPPORTED"
	case status == 408 || status == 504 || (status == 500 && reason == string(metav1.StatusReasonServerTimeout)):
		return "TIMEOUT"
	case status == 409:
		return "CONFLICT"
	case status == 410:
		return "CONTINUATION_EXPIRED"
	case status == 413 || status == 429:
		return "RESOURCE_LIMIT"
	case status == 502 || status == 503:
		return "UNAVAILABLE"
	case status >= 500:
		return "PROVIDER_ERROR"
	}
	return ""
}
