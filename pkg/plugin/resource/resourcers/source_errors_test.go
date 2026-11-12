package resourcers

import (
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
	"syscall"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakedynamic "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"
)

// handshakeTimeout has the shape of net/http's unexported TLS handshake
// timeout: a net.Error that is not a *net.OpError.
type handshakeTimeout struct{}

func (handshakeTimeout) Error() string   { return "net/http: TLS handshake timeout" }
func (handshakeTimeout) Timeout() bool   { return true }
func (handshakeTimeout) Temporary() bool { return true }

func connectError(errno syscall.Errno) error {
	return &url.Error{Op: "Get", URL: "https://api.test/api/v1/pods?limit=1", Err: &net.OpError{Op: "dial", Net: "tcp", Err: &os.SyscallError{Syscall: "connect", Err: errno}}}
}

func TestClassifyWatchError(t *testing.T) {
	apiURL := "https://api.test/api/v1/pods?limit=1"
	podsResource := schema.GroupResource{Resource: "pods"}
	for _, tc := range []struct {
		name string
		err  error
		code string
	}{
		// Access and shape errors keep their own codes: retrying cannot fix them.
		{"forbidden", k8serrors.NewForbidden(podsResource, "", errors.New("denied")), "FORBIDDEN"},
		{"unauthorized", k8serrors.NewUnauthorized("expired"), "UNAUTHORIZED"},
		{"not found", k8serrors.NewNotFound(podsResource, "pods"), "NOT_FOUND"},
		{"method not allowed", k8serrors.NewMethodNotSupported(podsResource, "list"), "UNSUPPORTED"},
		{"bad request", k8serrors.NewBadRequest("bad selector"), "PROVIDER_ERROR"},
		{"conflict", k8serrors.NewConflict(podsResource, "pods", errors.New("changed")), "PROVIDER_ERROR"},
		// Throttling and server-side failures clear on their own.
		{"too many requests", k8serrors.NewTooManyRequests("slow down", 1), "UNAVAILABLE"},
		{"internal error", k8serrors.NewInternalError(errors.New("etcd timeout")), "UNAVAILABLE"},
		{"service unavailable", k8serrors.NewServiceUnavailable("starting"), "UNAVAILABLE"},
		{"bad gateway", &k8serrors.StatusError{ErrStatus: metav1.Status{Code: http.StatusBadGateway}}, "UNAVAILABLE"},
		{"gateway timeout", k8serrors.NewTimeoutError("did not complete", 1), "TIMEOUT"},
		{"request timeout", &k8serrors.StatusError{ErrStatus: metav1.Status{Code: http.StatusRequestTimeout}}, "TIMEOUT"},
		// Transport failures: no HTTP response at all.
		{"connection refused", connectError(syscall.ECONNREFUSED), "CONNECTION_ERROR"},
		{"connection reset", connectError(syscall.ECONNRESET), "CONNECTION_ERROR"},
		{"no such host", &url.Error{Op: "Get", URL: apiURL, Err: &net.OpError{Op: "dial", Net: "tcp", Err: &net.DNSError{Err: "no such host", Name: "api.test", IsNotFound: true}}}, "CONNECTION_ERROR"},
		{"dial timeout", &url.Error{Op: "Get", URL: apiURL, Err: &net.OpError{Op: "dial", Net: "tcp", Err: os.ErrDeadlineExceeded}}, "TIMEOUT"},
		{"tls handshake timeout", &url.Error{Op: "Get", URL: apiURL, Err: handshakeTimeout{}}, "TIMEOUT"},
		{"eof", &url.Error{Op: "Get", URL: apiURL, Err: io.EOF}, "UNAVAILABLE"},
		{"unexpected eof", fmt.Errorf("list pods: %w", io.ErrUnexpectedEOF), "UNAVAILABLE"},
		{"client deadline", &url.Error{Op: "Get", URL: apiURL, Err: context.DeadlineExceeded}, "TIMEOUT"},
		// A certificate that does not verify does not heal by retrying, and url.Error
		// around it must not be reported as a connection error.
		{"unknown authority", &url.Error{Op: "Get", URL: apiURL, Err: x509.UnknownAuthorityError{}}, "CERTIFICATE_ERROR"},
		{"expired certificate", &url.Error{Op: "Get", URL: apiURL, Err: x509.CertificateInvalidError{Reason: x509.Expired}}, "CERTIFICATE_ERROR"},
		{"verification failure", &url.Error{Op: "Get", URL: apiURL, Err: &tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}}}, "CERTIFICATE_ERROR"},
		// Unrecognized and already classified errors are unchanged.
		{"unknown", errors.New("native failure"), "PROVIDER_ERROR"},
		{"classified", resource.NewError("RESOURCE_LIMIT", "too large"), "RESOURCE_LIMIT"},
		{"classified wins over cause", &resource.ResourceOperationError{Code: "RESOURCE_LIMIT", Err: connectError(syscall.ECONNREFUSED)}, "RESOURCE_LIMIT"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			classified := classifyWatchError(tc.err)
			require.Equal(t, tc.code, classified.code)
			switch classified.code {
			case "UNAVAILABLE", "CONNECTION_ERROR", "CERTIFICATE_ERROR", "TIMEOUT":
				// A deadline keeps the native text it always had.
				if !errors.Is(tc.err, context.DeadlineExceeded) {
					require.NotContains(t, classified.message, "api.test", "public text must not carry the native error")
				}
			}
		})
	}
}

// TestSourceTransientProbeFailuresAreRetryable checks the whole open path: a
// transport failure or throttled LIST must reach the host with a code it
// reopens on, not as the terminal PROVIDER_ERROR.
func TestSourceTransientProbeFailuresAreRetryable(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		code string
	}{
		{"connection refused", connectError(syscall.ECONNREFUSED), "CONNECTION_ERROR"},
		{"tls handshake timeout", &url.Error{Op: "Get", Err: handshakeTimeout{}}, "TIMEOUT"},
		{"eof", &url.Error{Op: "Get", Err: io.EOF}, "UNAVAILABLE"},
		{"too many requests", k8serrors.NewTooManyRequests("slow down", 1), "UNAVAILABLE"},
		{"service unavailable", k8serrors.NewServiceUnavailable("starting"), "UNAVAILABLE"},
		{"certificate", &url.Error{Op: "Get", Err: x509.UnknownAuthorityError{}}, "CERTIFICATE_ERROR"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cs := newFakeClientSet(defaultGVRListKinds())
			cs.DynamicClient.(*fakedynamic.FakeDynamicClient).PrependReactor("list", "pods", func(k8stesting.Action) (bool, runtime.Object, error) {
				return true, nil, tc.err
			})
			emitter := &sourceTestEmitter{events: make(chan sourceTestEvent, 1)}
			err := newBaseResourcer().Source(context.Background(), cs, resource.SourceRequest{Target: testWatchTarget(), Representation: testWatchRepresentation()}, emitter)
			require.Equal(t, tc.code, resource.ErrorCode(err))
			require.Empty(t, emitter.events)
		})
	}
}
