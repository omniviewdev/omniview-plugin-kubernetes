package resource

import (
	"errors"

	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/omniview/kubernetes/pkg/diag"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// classifyResourceError inspects a Kubernetes API error and returns a structured
// ResourceOperationError with an appropriate code, title, and suggestions.
// Returns nil for errors it cannot classify (the gRPC server falls back to INTERNAL).
// Public text is fixed; native diagnostics remain available only through Err.
//
// A request that produced no API response at all (a timeout, a reset or refused
// connection, a stream that ended early, a certificate that failed verification)
// is classified by diag.ClassifyTransport, so the host sees a transient code
// instead of an opaque failure.
func classifyResourceError(err error) error {
	// Check Kubernetes StatusError first (covers most API server errors).
	var statusErr *k8serrors.StatusError
	if errors.As(err, &statusErr) {
		code := statusErr.ErrStatus.Code

		switch {
		case code == 400 || code == 422:
			return &sdkresource.ResourceOperationError{Err: err, Code: "INVALID_REQUEST", Title: "Invalid request", Message: "The cluster rejected the resource request."}
		case code == 405:
			return &sdkresource.ResourceOperationError{Err: err, Code: "UNSUPPORTED", Title: "Unsupported operation", Message: "The cluster does not support this resource operation."}
		case code == 410:
			return &sdkresource.ResourceOperationError{Err: err, Code: "CONTINUATION_EXPIRED", Title: "Source continuation expired", Message: "The resource listing continuation has expired. Start a new listing."}
		case code == 413 || code == 429:
			return &sdkresource.ResourceOperationError{Err: err, Code: "RESOURCE_LIMIT", Title: "Resource limit", Message: "The request exceeded a cluster resource or rate limit."}
		case code == 502 || code == 503:
			return unavailableError(err)
		case code == 403:
			return &sdkresource.ResourceOperationError{
				Err:     err,
				Code:    "FORBIDDEN",
				Title:   "Access denied",
				Message: "You do not have permission to perform this resource operation.",
				Suggestions: []string{
					"Check your RBAC permissions for this resource type",
					"Contact your cluster administrator for access",
				},
			}
		case code == 401:
			return &sdkresource.ResourceOperationError{
				Err:     err,
				Code:    "UNAUTHORIZED",
				Title:   "Authentication failed",
				Message: "The cluster could not authenticate the request.",
				Suggestions: []string{
					"Your auth token may have expired — try re-authenticating",
					"Check your kubeconfig credentials",
				},
			}
		case code == 404:
			return &sdkresource.ResourceOperationError{
				Err:     err,
				Code:    "NOT_FOUND",
				Title:   "Resource not found",
				Message: "The requested resource or API group was not found.",
				Suggestions: []string{
					"The resource or API group may not exist on this cluster",
					"You may not have permission to discover this API group",
				},
			}
		case code == 408 || code == 504 || (code == 500 && statusErr.ErrStatus.Reason == metav1.StatusReasonServerTimeout):
			return timeoutError(err)
		case code == 409:
			return &sdkresource.ResourceOperationError{
				Err:     err,
				Code:    "CONFLICT",
				Title:   "Resource conflict",
				Message: "The resource operation conflicts with the current cluster state.",
				Suggestions: []string{
					"The resource was modified by another process",
					"Refresh and try again",
				},
			}
		case code >= 500:
			return &sdkresource.ResourceOperationError{Err: err, Code: "PROVIDER_ERROR", Title: "Cluster error", Message: "The cluster could not complete the request."}
		}
	}

	// The request never produced an API response: classify the transport failure.
	if failure, ok := diag.ClassifyTransport(err); ok {
		switch failure.Code {
		case "TIMEOUT":
			return timeoutError(err)
		case "UNAVAILABLE":
			return unavailableError(err)
		case "CERTIFICATE_ERROR":
			return certificateError(err)
		default:
			return connectionError(err)
		}
	}

	// Unclassified — let the gRPC server wrap as INTERNAL.
	return nil
}

// The helpers below carry the public text shared by a Kubernetes status and the
// transport failure that reports the same code.

func unavailableError(err error) error {
	return &sdkresource.ResourceOperationError{Err: err, Code: "UNAVAILABLE", Title: "Source unavailable", Message: "The cluster is temporarily unavailable."}
}

func timeoutError(err error) error {
	return &sdkresource.ResourceOperationError{
		Err:     err,
		Code:    "TIMEOUT",
		Title:   "Request timed out",
		Message: "The cluster did not complete the request in time.",
		Suggestions: []string{
			"The cluster may be under heavy load",
			"Check your network connection",
		},
	}
}

func connectionError(err error) error {
	return &sdkresource.ResourceOperationError{
		Err:     err,
		Code:    "CONNECTION_ERROR",
		Title:   "Connection error",
		Message: "Unable to connect to the cluster.",
		Suggestions: []string{
			"Check that the cluster is running and reachable",
			"Verify your network connection",
			"Check if a VPN or proxy is required",
		},
	}
}

func certificateError(err error) error {
	return &sdkresource.ResourceOperationError{
		Err:     err,
		Code:    "CERTIFICATE_ERROR",
		Title:   "Certificate error",
		Message: "The cluster certificate could not be verified.",
		Suggestions: []string{
			"The cluster certificate may have expired",
			"Your kubeconfig may reference outdated certificates",
			"Check if the CA bundle is configured correctly",
		},
	}
}
