package resource

import (
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	k8serrors "k8s.io/apimachinery/pkg/api/errors"

	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// helper to create a Kubernetes StatusError with a given code and message.
func k8sStatusError(code int32, message string) error {
	return &k8serrors.StatusError{
		ErrStatus: metav1.Status{
			Code:    code,
			Message: message,
		},
	}
}

func TestClassifyResourceError_Forbidden(t *testing.T) {
	err := k8sStatusError(403, "pods is forbidden: User \"test\"")

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *sdkresource.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "FORBIDDEN", opErr.Code)
	assert.Equal(t, "Access denied", opErr.Title)
	assert.NotEmpty(t, opErr.Message)
	assert.NotEmpty(t, opErr.Suggestions)
}

func TestClassifyResourceError_Unauthorized(t *testing.T) {
	err := k8sStatusError(401, "Unauthorized")

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *sdkresource.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "UNAUTHORIZED", opErr.Code)
	assert.Equal(t, "Authentication failed", opErr.Title)
}

func TestClassifyResourceError_NotFound(t *testing.T) {
	err := k8sStatusError(404, "the server could not find the requested resource")

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *sdkresource.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "NOT_FOUND", opErr.Code)
	assert.Equal(t, "Resource not found", opErr.Title)
}

func TestClassifyResourceError_Timeout408(t *testing.T) {
	err := k8sStatusError(408, "request timeout")

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *sdkresource.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "TIMEOUT", opErr.Code)
}

func TestClassifyResourceError_Timeout504(t *testing.T) {
	err := k8sStatusError(504, "gateway timeout")

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *sdkresource.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "TIMEOUT", opErr.Code)
}

func TestClassifyResourceError_Conflict(t *testing.T) {
	err := k8sStatusError(409, "the object has been modified")

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *sdkresource.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "CONFLICT", opErr.Code)
	assert.Equal(t, "Resource conflict", opErr.Title)
}

func TestClassifyResourceError_UnhandledStatusCode(t *testing.T) {
	// A status with no class of its own retains the transport INTERNAL fallback.
	// Server errors (5xx) are classified; see TestClassifyResourceError_ServerErrors.
	err := k8sStatusError(418, "I'm a teapot")

	result := classifyResourceError(err)
	assert.Nil(t, result, "unhandled K8s status codes should return nil for INTERNAL fallback")
}

func TestClassifyResourceError_ConnectionError(t *testing.T) {
	err := &net.OpError{
		Op:  "dial",
		Net: "tcp",
		Addr: &net.TCPAddr{
			IP:   net.ParseIP("10.0.0.1"),
			Port: 6443,
		},
		Err: errors.New("connection refused"),
	}

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *sdkresource.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "CONNECTION_ERROR", opErr.Code)
	assert.Equal(t, "Connection error", opErr.Title)
	assert.NotEmpty(t, opErr.Message)
}

func TestClassifyResourceError_WrappedConnectionError(t *testing.T) {
	inner := &net.OpError{
		Op:  "dial",
		Net: "tcp",
		Err: errors.New("no such host"),
	}
	wrapped := fmt.Errorf("Get \"https://cluster.example.com\": %w", inner)

	result := classifyResourceError(wrapped)
	require.NotNil(t, result)

	var opErr *sdkresource.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "CONNECTION_ERROR", opErr.Code)
}

func TestClassifyResourceError_CertificateInvalid(t *testing.T) {
	err := x509.CertificateInvalidError{
		Reason: x509.Expired,
	}

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *sdkresource.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "CERTIFICATE_ERROR", opErr.Code)
	assert.Equal(t, "Certificate error", opErr.Title)
}

func TestClassifyResourceError_UnknownAuthority(t *testing.T) {
	err := x509.UnknownAuthorityError{}

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *sdkresource.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "CERTIFICATE_ERROR", opErr.Code)
}

func TestClassifyResourceError_WrappedCertError(t *testing.T) {
	inner := x509.CertificateInvalidError{Reason: x509.Expired}
	wrapped := fmt.Errorf("TLS handshake: %w", inner)

	result := classifyResourceError(wrapped)
	require.NotNil(t, result)

	var opErr *sdkresource.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "CERTIFICATE_ERROR", opErr.Code)
}

func TestClassifyResourceError_PlainError(t *testing.T) {
	err := errors.New("something completely unexpected")

	result := classifyResourceError(err)
	assert.Nil(t, result, "unclassifiable errors should return nil")
}

func TestClassifyResourceError_PreservesOriginalError(t *testing.T) {
	original := k8sStatusError(403, "pods is forbidden")

	result := classifyResourceError(original)
	require.NotNil(t, result)

	var opErr *sdkresource.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.True(t, errors.Is(opErr, original),
		"ResourceOperationError.Err should wrap the original error")
}

func TestClassifyResourceError_StatusCodePriority(t *testing.T) {
	// A K8s error that also happens to be wrapped in net.OpError shouldn't
	// be classified as CONNECTION_ERROR — the K8s StatusError check runs first.
	err := &net.OpError{Op: "dial", Net: "tcp", Err: k8sStatusError(403, "forbidden")}

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *sdkresource.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "FORBIDDEN", opErr.Code, "K8s StatusError should take priority")
}

// TestClassifyResourceError_JSONRoundTrip verifies the full error flow:
// K8s error → classifyResourceError → ResourceOperationError → .Error() JSON → parseable
func TestClassifyResourceError_JSONRoundTrip(t *testing.T) {
	k8sErr := k8sStatusError(403, `pods is forbidden: User "system:anonymous" cannot list resource "pods"`)
	classified := classifyResourceError(k8sErr)
	require.NotNil(t, classified)

	// The classified error's .Error() should produce valid, parseable JSON
	jsonStr := classified.Error()
	assert.Contains(t, jsonStr, `"code":"FORBIDDEN"`)
	assert.Contains(t, jsonStr, `"title":"Access denied"`)
	assert.Contains(t, jsonStr, `"suggestions"`)
}

func TestClassifyResourceErrorFiniteSourceFailures(t *testing.T) {
	for _, test := range []struct {
		status int32
		code   string
	}{
		{400, "INVALID_REQUEST"},
		{422, "INVALID_REQUEST"},
		{405, "UNSUPPORTED"},
		{410, "CONTINUATION_EXPIRED"},
		{413, "RESOURCE_LIMIT"},
		{429, "RESOURCE_LIMIT"},
		{503, "UNAVAILABLE"},
	} {
		t.Run(fmt.Sprint(test.status), func(t *testing.T) {
			cause := k8sStatusError(test.status, "native source failure")
			classified := classifyResourceError(cause)
			var operationError *sdkresource.ResourceOperationError
			require.ErrorAs(t, classified, &operationError)
			require.Equal(t, test.code, operationError.Code)
			require.ErrorIs(t, classified, cause)
		})
	}
}

func TestClassifyResourceError_PublicTextExcludesNativeDiagnostics(t *testing.T) {
	const diagnostic = `native-secret-token /private/kubeconfig https://private-cluster.example:6443`
	tests := []struct {
		name  string
		cause error
		code  string
	}{
		{
			name: "connection",
			cause: &net.OpError{
				Op:     "dial",
				Net:    "tcp",
				Source: &net.TCPAddr{IP: net.ParseIP("192.0.2.17"), Port: 54321},
				Addr:   &net.TCPAddr{IP: net.ParseIP("192.0.2.18"), Port: 6443},
				Err:    errors.New(diagnostic),
			},
			code: "CONNECTION_ERROR",
		},
		{
			name:  "invalid certificate",
			cause: x509.CertificateInvalidError{Reason: x509.Expired, Detail: diagnostic},
			code:  "CERTIFICATE_ERROR",
		},
		{
			name:  "unknown authority",
			cause: x509.UnknownAuthorityError{},
			code:  "CERTIFICATE_ERROR",
		},
	}
	for _, status := range []struct {
		status int32
		code   string
	}{
		{400, "INVALID_REQUEST"},
		{401, "UNAUTHORIZED"},
		{403, "FORBIDDEN"},
		{404, "NOT_FOUND"},
		{405, "UNSUPPORTED"},
		{408, "TIMEOUT"},
		{409, "CONFLICT"},
		{410, "CONTINUATION_EXPIRED"},
		{413, "RESOURCE_LIMIT"},
		{422, "INVALID_REQUEST"},
		{429, "RESOURCE_LIMIT"},
		{503, "UNAVAILABLE"},
		{504, "TIMEOUT"},
	} {
		tests = append(tests, struct {
			name  string
			cause error
			code  string
		}{fmt.Sprint(status.status), k8sStatusError(status.status, diagnostic), status.code})
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			wrapped := fmt.Errorf("request to %s: %w", diagnostic, test.cause)
			classified := classifyResourceError(wrapped)
			var operationError *sdkresource.ResourceOperationError
			require.ErrorAs(t, classified, &operationError)
			assert.Equal(t, test.code, operationError.Code)
			assert.Same(t, wrapped, operationError.Err)
			assert.ErrorIs(t, classified, wrapped)
			assert.ErrorIs(t, classified, test.cause)
			switch test.cause.(type) {
			case *k8serrors.StatusError:
				var native *k8serrors.StatusError
				require.ErrorAs(t, classified, &native)
				assert.Same(t, test.cause, native)
			case *net.OpError:
				var native *net.OpError
				require.ErrorAs(t, classified, &native)
				assert.Same(t, test.cause, native)
			case x509.CertificateInvalidError:
				var native x509.CertificateInvalidError
				require.ErrorAs(t, classified, &native)
				assert.Equal(t, test.cause, native)
			case x509.UnknownAuthorityError:
				var native x509.UnknownAuthorityError
				require.ErrorAs(t, classified, &native)
				assert.Equal(t, test.cause, native)
			}
			assert.NotEmpty(t, operationError.Message)
			fields := []string{operationError.Code, operationError.Title, operationError.Message, classified.Error()}
			fields = append(fields, operationError.Suggestions...)
			for _, field := range fields {
				for _, secret := range []string{
					"native-secret-token", "/private/kubeconfig", "private-cluster.example",
					"192.0.2.17", "192.0.2.18", "54321", "6443",
				} {
					assert.NotContains(t, field, secret)
				}
			}
		})
	}
}
