package remoteerr

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"syscall"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestSanitizeDropsRemoteTextAndKeepsClass(t *testing.T) {
	assert.NoError(t, Sanitize("op", nil))

	other := Sanitize("op", fmt.Errorf("wrap: %w", errors.New("secret-remote-text")))
	require.Error(t, other)
	assert.Equal(t, "op failed", other.Error())

	assert.Equal(t, context.Canceled, Sanitize("op", context.Canceled))
	wrappedDeadline := Sanitize("op", fmt.Errorf("secret-wrapper: %w", context.DeadlineExceeded))
	assert.ErrorIs(t, wrappedDeadline, context.DeadlineExceeded)
	assert.NotContains(t, wrappedDeadline.Error(), "secret-wrapper")

	forbidden := apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "secret-name", errors.New("secret-api-message"))
	got := Sanitize("op", fmt.Errorf("outer secret-outer: %w", forbidden))
	assert.True(t, apierrors.IsForbidden(got), "API class must stay matchable")
	assert.Contains(t, got.Error(), "Forbidden")
	assert.Contains(t, got.Error(), "403")
	for _, secret := range []string{"secret-name", "secret-api-message", "secret-outer"} {
		assert.NotContains(t, got.Error(), secret)
	}

	provider := &resource.ResourceOperationError{
		Err:         errors.New("secret-cause"),
		Code:        "FORBIDDEN",
		Title:       "secret-title",
		Message:     "secret-message",
		Suggestions: []string{"secret-suggestion"},
	}
	coded := Sanitize("op", fmt.Errorf("secret-wrapper: %w", provider))
	var detail *resource.ResourceOperationError
	require.True(t, errors.As(coded, &detail))
	assert.Equal(t, "FORBIDDEN", detail.Code)
	assert.Equal(t, "op failed (FORBIDDEN)", detail.Message)
	assert.Empty(t, detail.Title)
	assert.Empty(t, detail.Suggestions)
	assert.Nil(t, detail.Err)
	assert.NotContains(t, coded.Error(), "secret-")

	// A code outside the reviewed vocabulary is not trusted.
	unknown := Sanitize("op", &resource.ResourceOperationError{Code: "secret-code", Message: "secret-message"})
	assert.Equal(t, "op failed", unknown.Error())
}

type timeoutError struct{}

func (timeoutError) Error() string   { return "secret-timeout-text" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

func TestSanitizeKeepsTransportClassWithoutRemoteText(t *testing.T) {
	const host = "secret-host.internal"
	addr := &net.TCPAddr{IP: net.ParseIP("192.0.2.9"), Port: 6443}
	get := func(inner error) error {
		return &url.Error{Op: "Get", URL: "https://" + host + ":6443/api/v1/secret-path", Err: inner}
	}
	for _, tc := range []struct {
		name string
		err  error
		code string
		text string
	}{
		{"timeout", get(&net.OpError{Op: "read", Net: "tcp", Addr: addr, Err: timeoutError{}}), "TIMEOUT", "op failed: timed out"},
		{"deadline of a connection", fmt.Errorf("read: %w", os.ErrDeadlineExceeded), "TIMEOUT", "op failed: timed out"},
		{"end of stream", get(io.EOF), "UNAVAILABLE", "op failed: connection closed unexpectedly"},
		{"truncated body", fmt.Errorf("decode: %w", io.ErrUnexpectedEOF), "UNAVAILABLE", "op failed: connection closed unexpectedly"},
		{"refused", get(&net.OpError{Op: "dial", Net: "tcp", Addr: addr, Err: os.NewSyscallError("connect", syscall.ECONNREFUSED)}), "CONNECTION_ERROR", "op failed: connection refused"},
		{"reset", get(&net.OpError{Op: "read", Net: "tcp", Addr: addr, Err: os.NewSyscallError("read", syscall.ECONNRESET)}), "CONNECTION_ERROR", "op failed: connection reset"},
		{"lookup", get(&net.OpError{Op: "dial", Net: "tcp", Err: &net.DNSError{Err: "no such host", Name: host}}), "CONNECTION_ERROR", "op failed: host lookup failed"},
		{"HTTP/2 connection lost", get(errors.New("http2: client connection lost")), "UNAVAILABLE", "op failed: HTTP/2 connection lost"},
		{"unclassified network error", get(&net.OpError{Op: "dial", Net: "tcp", Addr: addr, Err: errors.New("secret-op-text")}), "CONNECTION_ERROR", "op failed: network error"},
		{"unknown authority", get(&tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}}), "CERTIFICATE_ERROR", "op failed: certificate signed by unknown authority"},
		{"hostname", get(x509.HostnameError{Host: host}), "CERTIFICATE_ERROR", "op failed: certificate does not match the host"},
		{"expired", x509.CertificateInvalidError{Reason: x509.Expired, Detail: "secret-detail"}, "CERTIFICATE_ERROR", "op failed: certificate expired"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := Sanitize("op", fmt.Errorf("outer secret-outer: %w", tc.err))
			require.Error(t, got)
			assert.Equal(t, tc.text, got.Error())
			assert.Equal(t, tc.code, resource.ErrorCode(got), "the SDK must report the class, not mask it")
			var detail *resource.ResourceOperationError
			require.ErrorAs(t, got, &detail)
			assert.Equal(t, "op failed ("+tc.code+")", detail.Message)
			assert.Empty(t, detail.Title)
			assert.Empty(t, detail.Suggestions)
			assert.Nil(t, detail.Err, "the native cause must not travel with the sanitized error")
			assert.NotErrorIs(t, got, tc.err)
			for _, leaked := range []string{"secret", host, "192.0.2.9", "6443", "no such host"} {
				assert.NotContains(t, got.Error(), leaked)
				assert.NotContains(t, detail.Error(), leaked)
			}
			// A second pass keeps the class.
			again := Sanitize("op", got)
			assert.Equal(t, tc.code, resource.ErrorCode(again))
		})
	}
}

func TestSanitizeTimeoutsOfTheContextStayContextErrors(t *testing.T) {
	wrapped := Sanitize("op", &url.Error{Op: "Get", URL: "https://secret-host/api", Err: context.DeadlineExceeded})
	assert.ErrorIs(t, wrapped, context.DeadlineExceeded)
	assert.Equal(t, "op timed out", wrapped.Error())
	assert.Equal(t, "TIMEOUT", resource.ErrorCode(wrapped))
}

func TestSanitizeLeavesLocalNetworkFailuresUnclassified(t *testing.T) {
	got := Sanitize("op", &net.OpError{Op: "listen", Net: "tcp", Err: errors.New("bind: address already in use")})
	assert.Equal(t, "op failed", got.Error())
	assert.Equal(t, "INTERNAL", resource.ErrorCode(got))
}
