package diag

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// timeoutError is a net.Error whose Timeout reports true.
type timeoutError struct{ text string }

func (e timeoutError) Error() string   { return e.text }
func (e timeoutError) Timeout() bool   { return true }
func (e timeoutError) Temporary() bool { return true }

// tlsHandshakeTimeout stands in for net/http's unexported error of the same text.
type tlsHandshakeTimeout struct{}

func (tlsHandshakeTimeout) Error() string   { return "net/http: TLS handshake timeout" }
func (tlsHandshakeTimeout) Timeout() bool   { return true }
func (tlsHandshakeTimeout) Temporary() bool { return true }

const secret = "secret-host.internal:6443"

type transportCase struct {
	name   string
	err    error
	class  string
	reason string
	code   string
}

func transportCases() []transportCase {
	opErr := func(op string, inner error) error { return &net.OpError{Op: op, Net: "tcp", Err: inner} }
	getErr := func(inner error) error { return &url.Error{Op: "Get", URL: "https://" + secret + "/api", Err: inner} }
	return []transportCase{
		// Timeouts.
		{"net.Error timeout", opErr("read", timeoutError{"i/o timeout"}), ClassNetwork, reasonTimeout, "TIMEOUT"},
		{"os.ErrDeadlineExceeded", fmt.Errorf("read: %w", os.ErrDeadlineExceeded), ClassNetwork, reasonTimeout, "TIMEOUT"},
		{"client timeout under url.Error", getErr(timeoutError{"Client.Timeout exceeded while awaiting headers"}), ClassNetwork, reasonTimeout, "TIMEOUT"},
		{"timeout under a non-net wrapper", getErr(fmt.Errorf("proxy: %w", timeoutError{"i/o timeout"})), ClassNetwork, reasonTimeout, "TIMEOUT"},
		{"ETIMEDOUT", opErr("dial", os.NewSyscallError("connect", syscall.ETIMEDOUT)), ClassNetwork, reasonTimeout, "TIMEOUT"},
		{"TLS handshake timeout", getErr(tlsHandshakeTimeout{}), ClassNetwork, reasonTLSHandshakeTimeout, "TIMEOUT"},
		{"wrapped TLS handshake timeout", fmt.Errorf("discover groups: %w", getErr(tlsHandshakeTimeout{})), ClassNetwork, reasonTLSHandshakeTimeout, "TIMEOUT"},

		// End of stream.
		{"io.EOF", io.EOF, ClassNetwork, reasonEOF, "UNAVAILABLE"},
		{"io.ErrUnexpectedEOF", io.ErrUnexpectedEOF, ClassNetwork, reasonEOF, "UNAVAILABLE"},
		{"url.Error around EOF", getErr(io.EOF), ClassNetwork, reasonEOF, "UNAVAILABLE"},
		{"wrapped url.Error around EOF", fmt.Errorf("discover groups: %w", getErr(io.EOF)), ClassNetwork, reasonEOF, "UNAVAILABLE"},
		{"wrapped url.Error around unexpected EOF", fmt.Errorf("discover groups: %w", getErr(io.ErrUnexpectedEOF)), ClassNetwork, reasonEOF, "UNAVAILABLE"},
		{"joined with a cleanup error", errors.Join(errors.New("cleanup failed"), getErr(io.EOF)), ClassNetwork, reasonEOF, "UNAVAILABLE"},

		// System call failures.
		{"ECONNREFUSED", syscall.ECONNREFUSED, ClassNetwork, reasonConnectionRefused, "CONNECTION_ERROR"},
		{"refused under url.Error", getErr(opErr("dial", os.NewSyscallError("connect", syscall.ECONNREFUSED))), ClassNetwork, reasonConnectionRefused, "CONNECTION_ERROR"},
		{"ECONNRESET", opErr("read", os.NewSyscallError("read", syscall.ECONNRESET)), ClassNetwork, reasonConnectionReset, "CONNECTION_ERROR"},
		{"reset under url.Error", getErr(opErr("read", os.NewSyscallError("read", syscall.ECONNRESET))), ClassNetwork, reasonConnectionReset, "CONNECTION_ERROR"},
		{"ECONNABORTED", opErr("read", syscall.ECONNABORTED), ClassNetwork, reasonConnectionReset, "CONNECTION_ERROR"},
		{"EPIPE", opErr("write", os.NewSyscallError("write", syscall.EPIPE)), ClassNetwork, reasonConnectionReset, "CONNECTION_ERROR"},
		{"ENETUNREACH", opErr("dial", os.NewSyscallError("connect", syscall.ENETUNREACH)), ClassNetwork, reasonUnreachable, "CONNECTION_ERROR"},
		{"EHOSTUNREACH", opErr("dial", os.NewSyscallError("connect", syscall.EHOSTUNREACH)), ClassNetwork, reasonUnreachable, "CONNECTION_ERROR"},
		{"DNS failure", &net.DNSError{Err: "no such host", Name: secret, IsNotFound: true}, ClassNetwork, reasonDNS, "CONNECTION_ERROR"},
		{"DNS failure under OpError", opErr("dial", &net.DNSError{Err: "no such host", Name: secret}), ClassNetwork, reasonDNS, "CONNECTION_ERROR"},

		// HTTP/2.
		{"HTTP/2 client connection lost", getErr(errors.New("http2: client connection lost")), ClassNetwork, reasonHTTP2, "UNAVAILABLE"},
		{"HTTP/2 GOAWAY", getErr(errors.New(`http2: server sent GOAWAY and closed the connection; LastStreamID=1999, ErrCode=NO_ERROR, debug=""`)), ClassNetwork, reasonHTTP2, "UNAVAILABLE"},
		{"HTTP/2 graceful GOAWAY", errors.New("http2: Transport received Server's graceful shutdown GOAWAY"), ClassNetwork, reasonHTTP2, "UNAVAILABLE"},
		{"HTTP/2 stream error", errors.New("stream error: stream ID 5; INTERNAL_ERROR; received from peer"), ClassNetwork, reasonHTTP2, "UNAVAILABLE"},

		// Any other failed network operation keeps the established code.
		{"OpError with unknown cause", opErr("dial", errors.New("anything")), ClassNetwork, reasonOther, "CONNECTION_ERROR"},
		{"OpError from a proxy", opErr("proxyconnect", errors.New("anything")), ClassNetwork, reasonOther, "CONNECTION_ERROR"},

		// Certificates.
		{"expired certificate", x509.CertificateInvalidError{Reason: x509.Expired}, ClassCertificate, reasonCertExpired, "CERTIFICATE_ERROR"},
		{"invalid certificate", x509.CertificateInvalidError{Reason: x509.NotAuthorizedToSign}, ClassCertificate, reasonCertInvalid, "CERTIFICATE_ERROR"},
		{"unknown authority", x509.UnknownAuthorityError{}, ClassCertificate, reasonCertUnknownAuthority, "CERTIFICATE_ERROR"},
		{"hostname mismatch", x509.HostnameError{Host: secret}, ClassCertificate, reasonCertHostname, "CERTIFICATE_ERROR"},
		{"verification failure", &tls.CertificateVerificationError{Err: errors.New("x509: anything")}, ClassCertificate, reasonCertInvalid, "CERTIFICATE_ERROR"},
		{"unknown authority under verification", getErr(&tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}}), ClassCertificate, reasonCertUnknownAuthority, "CERTIFICATE_ERROR"},
		{"certificate under a proxy OpError", opErr("proxyconnect", &tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}}), ClassCertificate, reasonCertUnknownAuthority, "CERTIFICATE_ERROR"},
	}
}

func TestClassifyTransport(t *testing.T) {
	for _, tc := range transportCases() {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ClassifyTransport(tc.err)
			require.True(t, ok, "not recognized as a transport failure")
			assert.Equal(t, tc.class, got.Class)
			assert.Equal(t, tc.reason, got.Reason)
			assert.Equal(t, tc.code, got.Code)
			assert.NotEmpty(t, got.Text)
			assert.NotContains(t, got.Text, "secret")
		})
	}
}

func TestClassifyTransportIgnoresEverythingElse(t *testing.T) {
	forbidden := apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "pods", errors.New("http2: client connection lost"))
	for name, err := range map[string]error{
		"nil":                 nil,
		"plain":               errors.New("something completely unexpected"),
		"canceled":            context.Canceled,
		"url parse failure":   &url.Error{Op: "parse", URL: "::", Err: errors.New("missing protocol scheme")},
		"address error":       &net.AddrError{Err: "invalid port", Addr: "x"},
		"local listen":        &net.OpError{Op: "listen", Net: "tcp", Err: errors.New("bind: address already in use")},
		"local accept":        &net.OpError{Op: "accept", Net: "tcp", Err: syscall.EMFILE},
		"status with h2 text": forbidden,
		"status with GOAWAY":  &apierrors.StatusError{ErrStatus: metav1.Status{Code: 503, Message: "GOAWAY"}},
		"wrapped status":      fmt.Errorf("get: %w", &apierrors.StatusError{ErrStatus: metav1.Status{Code: 500, Message: "stream error: stream ID 1"}}),
	} {
		t.Run(name, func(t *testing.T) {
			_, ok := ClassifyTransport(err)
			assert.False(t, ok)
		})
	}
}

// brokenError panics when asked for its text, like an error whose receiver is
// a nil pointer.
type brokenError struct{ cause *os.PathError }

func (e brokenError) Error() string { return e.cause.Error() }

func TestClassifyErrorNeverPanicsWhenAnErrorCannotPrintItself(t *testing.T) {
	assert.NotPanics(t, func() {
		c := ClassifyError(brokenError{}, false)
		assert.Equal(t, "other", c.Class)
		assert.Equal(t, "diag.brokenError", c.ErrorType)
	})
}

func TestClassifyErrorRanksContextAndStatusFirst(t *testing.T) {
	status := &apierrors.StatusError{ErrStatus: metav1.Status{Code: 403, Reason: metav1.StatusReasonForbidden}}
	for _, tc := range []struct {
		name          string
		err           error
		validation    bool
		class         string
		wantOutcome   string
		wantReason    string
		wantErrorType string
	}{
		{"deadline under url.Error", &url.Error{Op: "Get", URL: "https://" + secret, Err: context.DeadlineExceeded}, false, "deadline_exceeded", "canceled", "", "context.deadlineExceededError"},
		{"cancel under url.Error", &url.Error{Op: "Get", URL: "https://" + secret, Err: context.Canceled}, false, "canceled", "canceled", "", "*errors.errorString"},
		{"status wins over transport", &net.OpError{Op: "dial", Err: status}, false, "kubernetes", "failure", "Forbidden", "*errors.StatusError"},
		{"validation wins over transport", &url.Error{Err: io.EOF}, true, "validation", "failure", "", "*errors.errorString"},
		{"network failure is a failure", &url.Error{Err: io.EOF}, false, ClassNetwork, "failure", reasonEOF, "*errors.errorString"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := ClassifyError(tc.err, tc.validation)
			assert.Equal(t, tc.class, c.Class)
			assert.Equal(t, tc.wantOutcome, c.Outcome)
			assert.Equal(t, tc.wantReason, c.Reason)
			assert.Equal(t, tc.wantErrorType, c.ErrorType)
		})
	}
}

func TestClassifyErrorReportsTransportClassAndType(t *testing.T) {
	for _, tc := range transportCases() {
		t.Run(tc.name, func(t *testing.T) {
			c := ClassifyError(tc.err, false)
			assert.Equal(t, "failure", c.Outcome)
			assert.Equal(t, tc.class, c.Class)
			assert.Equal(t, tc.reason, c.Reason)
			assert.Equal(t, fmt.Sprintf("%T", innermost(tc.err)), c.ErrorType)
			assert.Equal(t, tc.code, c.ResourceCode())
			transport, ok := c.TransportFailure()
			require.True(t, ok)
			assert.Equal(t, tc.code, transport.Code)
		})
	}
}

func TestClassifyErrorLeavesUnknownErrorsOther(t *testing.T) {
	c := ClassifyError(errors.New("secret-remote-text"), false)
	assert.Equal(t, Classification{Outcome: "failure", Class: "other", ErrorType: "*errors.errorString"}, c)
	assert.Empty(t, c.ResourceCode())
	_, ok := c.TransportFailure()
	assert.False(t, ok)
	assert.Equal(t, Classification{Outcome: "success"}, ClassifyError(nil, false))
}

func TestInnermostFollowsWrappersAndJoins(t *testing.T) {
	assert.Equal(t, syscall.ECONNRESET, innermost(fmt.Errorf("outer: %w", &url.Error{
		Err: &net.OpError{Err: os.NewSyscallError("read", syscall.ECONNRESET)},
	})))
	assert.Equal(t, io.EOF, innermost(errors.Join(nil, fmt.Errorf("first: %w", io.EOF), errors.New("second"))))
	plain := errors.New("plain")
	assert.Same(t, plain, innermost(plain))
}

func TestLogFieldsCarryClassAndTypeButNoText(t *testing.T) {
	err := fmt.Errorf("get %s: %w", secret, &url.Error{
		Op: "Get", URL: "https://" + secret + "/api",
		Err: &net.OpError{Op: "read", Net: "tcp", Addr: &net.TCPAddr{IP: net.ParseIP("192.0.2.9"), Port: 6443}, Err: os.NewSyscallError("read", syscall.ECONNRESET)},
	})
	c := ClassifyError(err, false)
	fields := map[string]any{}
	pairs := c.LogFields()
	require.Zero(t, len(pairs)%2)
	for i := 0; i < len(pairs); i += 2 {
		fields[pairs[i].(string)] = pairs[i+1]
	}
	assert.Equal(t, map[string]any{
		"outcome":      "failure",
		"error_class":  ClassNetwork,
		"error_reason": reasonConnectionReset,
		"error_type":   "syscall.Errno",
	}, fields)
	for _, v := range fields {
		assert.NotContains(t, fmt.Sprint(v), "secret")
		assert.NotContains(t, fmt.Sprint(v), "192.0.2.9")
	}

	attrs := map[string]string{}
	for _, kv := range c.SpanAttrs() {
		attrs[string(kv.Key)] = kv.Value.Emit()
	}
	assert.Equal(t, map[string]string{
		"outcome":      "failure",
		"error.class":  ClassNetwork,
		"error.reason": reasonConnectionReset,
		"error.type":   "syscall.Errno",
	}, attrs)
}

func TestLogFieldsKeepKubernetesShape(t *testing.T) {
	err := &apierrors.StatusError{ErrStatus: metav1.Status{Code: 404, Reason: metav1.StatusReasonNotFound, Message: "secret-message"}}
	pairs := ClassifyError(err, false).LogFields()
	assert.Equal(t, []any{
		"outcome", "failure", "error_class", "kubernetes",
		"k8s_status_code", 404, "k8s_reason", "NotFound",
		"error_type", "*errors.StatusError",
	}, pairs)
}

func TestResourceCodeForKubernetesStatuses(t *testing.T) {
	for status, want := range map[int]string{
		400: "INVALID_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "UNSUPPORTED",
		408: "TIMEOUT", 409: "CONFLICT", 410: "CONTINUATION_EXPIRED", 413: "RESOURCE_LIMIT", 422: "INVALID_REQUEST",
		429: "RESOURCE_LIMIT", 500: "PROVIDER_ERROR", 501: "PROVIDER_ERROR", 502: "UNAVAILABLE", 503: "UNAVAILABLE",
		504: "TIMEOUT", 599: "PROVIDER_ERROR",
		// Statuses with no code of their own.
		0: "", 200: "", 418: "", 499: "",
	} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			err := &apierrors.StatusError{ErrStatus: metav1.Status{Code: int32(status)}}
			assert.Equal(t, want, ClassifyError(err, false).ResourceCode())
		})
	}
	serverTimeout := &apierrors.StatusError{ErrStatus: metav1.Status{Code: 500, Reason: metav1.StatusReasonServerTimeout}}
	assert.Equal(t, "TIMEOUT", ClassifyError(serverTimeout, false).ResourceCode())
}

// The errors below come out of net/http itself, over in-memory connections, so
// the classifier is checked against the real shapes and not only stand-ins.

func pipeClient(t *testing.T, tlsHandshakeTimeout time.Duration, serve func(net.Conn)) *http.Client {
	t.Helper()
	transport := &http.Transport{
		DialContext: func(context.Context, string, string) (net.Conn, error) {
			client, server := net.Pipe()
			go func() {
				defer server.Close()
				serve(server)
			}()
			return client, nil
		},
		TLSHandshakeTimeout: tlsHandshakeTimeout,
		DisableKeepAlives:   true,
	}
	t.Cleanup(transport.CloseIdleConnections)
	return &http.Client{Transport: transport}
}

func get(t *testing.T, client *http.Client, rawURL string) (*http.Response, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	require.NoError(t, err)
	return client.Do(req)
}

func TestClassifyTransportOnErrorsFromNetHTTP(t *testing.T) {
	t.Run("server closes without answering", func(t *testing.T) {
		client := pipeClient(t, 0, func(c net.Conn) { _, _ = http.ReadRequest(bufio.NewReader(c)) })
		_, err := get(t, client, "http://pipe.test/api")
		require.Error(t, err)
		require.ErrorIs(t, err, io.EOF)
		got, ok := ClassifyTransport(err)
		require.True(t, ok)
		assert.Equal(t, reasonEOF, got.Reason)
		assert.Equal(t, "UNAVAILABLE", got.Code)
		assert.Equal(t, "*errors.errorString", ClassifyError(err, false).ErrorType)
	})
	t.Run("server closes inside a body", func(t *testing.T) {
		client := pipeClient(t, 0, func(c net.Conn) {
			if _, err := http.ReadRequest(bufio.NewReader(c)); err == nil {
				_, _ = io.WriteString(c, "HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nshort")
			}
		})
		resp, err := get(t, client, "http://pipe.test/api")
		require.NoError(t, err)
		defer resp.Body.Close()
		_, err = io.ReadAll(resp.Body)
		require.ErrorIs(t, err, io.ErrUnexpectedEOF)
		got, ok := ClassifyTransport(err)
		require.True(t, ok)
		assert.Equal(t, reasonEOF, got.Reason)
	})
	t.Run("TLS handshake never completes", func(t *testing.T) {
		client := pipeClient(t, 5*time.Millisecond, func(c net.Conn) { _, _ = io.Copy(io.Discard, c) })
		_, err := get(t, client, "https://pipe.test/api")
		require.Error(t, err)
		require.Contains(t, err.Error(), "net/http: TLS handshake timeout")
		got, ok := ClassifyTransport(err)
		require.True(t, ok)
		assert.Equal(t, reasonTLSHandshakeTimeout, got.Reason)
		assert.Equal(t, "TIMEOUT", got.Code)
		c := ClassifyError(fmt.Errorf("discover groups: %w", err), false)
		assert.Equal(t, ClassNetwork, c.Class)
		assert.Equal(t, "http.tlsHandshakeTimeoutError", c.ErrorType)
	})
	t.Run("client deadline", func(t *testing.T) {
		client := pipeClient(t, 0, func(c net.Conn) { _, _ = io.Copy(io.Discard, c) })
		client.Timeout = 5 * time.Millisecond
		_, err := get(t, client, "http://pipe.test/api")
		require.Error(t, err)
		got, ok := ClassifyTransport(err)
		require.True(t, ok)
		assert.Equal(t, "TIMEOUT", got.Code)
		assert.True(t, strings.Contains(err.Error(), "Client.Timeout"), err.Error())
	})
}
