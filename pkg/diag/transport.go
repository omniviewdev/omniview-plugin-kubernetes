package diag

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"net"
	"strings"
	"syscall"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// Classes for failures of the HTTP transport to the cluster: a request that
// produced no Kubernetes API response at all.
const (
	ClassNetwork     = "network"
	ClassCertificate = "certificate"
)

// Reasons refine ClassNetwork and ClassCertificate. They are a closed
// vocabulary chosen by this package, never derived from error text.
const (
	reasonTimeout             = "timeout"
	reasonTLSHandshakeTimeout = "tls_handshake_timeout"
	reasonConnectionRefused   = "connection_refused"
	reasonConnectionReset     = "connection_reset"
	reasonUnreachable         = "unreachable"
	reasonDNS                 = "dns"
	reasonEOF                 = "eof"
	reasonHTTP2               = "http2"
	reasonOther               = "other"

	reasonCertExpired          = "expired"
	reasonCertUnknownAuthority = "unknown_authority"
	reasonCertHostname         = "hostname"
	reasonCertInvalid          = "invalid"
)

// TransportFailure describes one kind of transport failure and how callers
// report it.
type TransportFailure struct {
	Class  string // ClassNetwork or ClassCertificate
	Reason string // one of the reasons above
	// Code is the SDK resource error code that reports this failure. The host
	// retries or surfaces it by code: TIMEOUT, CONNECTION_ERROR and UNAVAILABLE
	// are transient, CERTIFICATE_ERROR is not.
	Code string
	// Text is a fixed phrase safe to show to a client. It never contains
	// anything taken from the error.
	Text string
}

var transportReasons = map[string]TransportFailure{
	reasonTimeout:             {ClassNetwork, reasonTimeout, "TIMEOUT", "timed out"},
	reasonTLSHandshakeTimeout: {ClassNetwork, reasonTLSHandshakeTimeout, "TIMEOUT", "TLS handshake timed out"},
	reasonConnectionRefused:   {ClassNetwork, reasonConnectionRefused, "CONNECTION_ERROR", "connection refused"},
	reasonConnectionReset:     {ClassNetwork, reasonConnectionReset, "CONNECTION_ERROR", "connection reset"},
	reasonUnreachable:         {ClassNetwork, reasonUnreachable, "CONNECTION_ERROR", "network unreachable"},
	reasonDNS:                 {ClassNetwork, reasonDNS, "CONNECTION_ERROR", "host lookup failed"},
	reasonEOF:                 {ClassNetwork, reasonEOF, "UNAVAILABLE", "connection closed unexpectedly"},
	reasonHTTP2:               {ClassNetwork, reasonHTTP2, "UNAVAILABLE", "HTTP/2 connection lost"},
	reasonOther:               {ClassNetwork, reasonOther, "CONNECTION_ERROR", "network error"},

	reasonCertExpired:          {ClassCertificate, reasonCertExpired, "CERTIFICATE_ERROR", "certificate expired"},
	reasonCertUnknownAuthority: {ClassCertificate, reasonCertUnknownAuthority, "CERTIFICATE_ERROR", "certificate signed by unknown authority"},
	reasonCertHostname:         {ClassCertificate, reasonCertHostname, "CERTIFICATE_ERROR", "certificate does not match the host"},
	reasonCertInvalid:          {ClassCertificate, reasonCertInvalid, "CERTIFICATE_ERROR", "certificate could not be verified"},
}

// ClassifyTransport reports whether err is a failure to talk to the cluster
// rather than an answer from it, and which kind. It looks through every
// wrapper, including *url.Error and errors.Join.
//
// An error that carries a Kubernetes status is never a transport failure: the
// API server answered. Callers decide how context cancellation and deadlines
// rank against these results.
func ClassifyTransport(err error) (TransportFailure, bool) {
	if err == nil {
		return TransportFailure{}, false
	}
	var status apierrors.APIStatus
	if errors.As(err, &status) {
		return TransportFailure{}, false
	}
	reason := transportReason(err)
	if reason == "" {
		return TransportFailure{}, false
	}
	return transportReasons[reason], true
}

// transportReason returns the most specific reason for err, or "" when err is
// not a transport failure.
func transportReason(err error) string {
	if reason := certificateReason(err); reason != "" {
		return reason
	}
	if reason := timeoutReason(err); reason != "" {
		return reason
	}
	switch {
	case errors.Is(err, syscall.ECONNREFUSED):
		return reasonConnectionRefused
	case errors.Is(err, syscall.ECONNRESET), errors.Is(err, syscall.ECONNABORTED), errors.Is(err, syscall.EPIPE):
		return reasonConnectionReset
	case errors.Is(err, syscall.ENETUNREACH), errors.Is(err, syscall.EHOSTUNREACH):
		return reasonUnreachable
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return reasonDNS
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return reasonEOF
	}
	if http2Failure(err) {
		return reasonHTTP2
	}
	// Any other failed network operation, except the ones that act on this
	// machine rather than on the connection to the cluster.
	var opErr *net.OpError
	if errors.As(err, &opErr) && opErr.Op != "listen" && opErr.Op != "accept" {
		return reasonOther
	}
	return ""
}

// timeoutReason returns a reason when any error in the chain reports a timeout.
// The deadline of a net.Conn, a dial, the response-header wait of an
// http.Client and the TLS handshake all do. context.DeadlineExceeded does too;
// callers that rank it separately check it first.
func timeoutReason(err error) string {
	reason := ""
	anyInChain(err, func(e error) bool {
		t, ok := e.(interface{ Timeout() bool })
		if !ok || !t.Timeout() {
			return false
		}
		reason = reasonTimeout
		if errorText(e) == "net/http: TLS handshake timeout" {
			reason = reasonTLSHandshakeTimeout
			return true
		}
		return false
	})
	return reason
}

func certificateReason(err error) string {
	var invalid x509.CertificateInvalidError
	var authority x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var verification *tls.CertificateVerificationError
	switch {
	case errors.As(err, &invalid):
		if invalid.Reason == x509.Expired {
			return reasonCertExpired
		}
		return reasonCertInvalid
	case errors.As(err, &authority):
		return reasonCertUnknownAuthority
	case errors.As(err, &hostname):
		return reasonCertHostname
	case errors.As(err, &verification):
		return reasonCertInvalid
	}
	return ""
}

// http2Failure recognizes a lost HTTP/2 connection, a GOAWAY and a reset
// stream. golang.org/x/net/http2 does not export a matchable cause for the
// first, and its other error types are not reachable without a direct
// dependency on that module, so the fixed phrases of the library are matched
// instead. They are only read here to choose a reason; they never leave it.
func http2Failure(err error) bool {
	msg := errorText(err)
	return strings.Contains(msg, "http2: client connection lost") ||
		strings.Contains(msg, "http2: server sent GOAWAY") ||
		strings.Contains(msg, "graceful shutdown GOAWAY") ||
		strings.Contains(msg, "stream error: stream ID")
}

// errorText is err.Error() for a classifier that must never panic: it runs on
// failure paths, often from deferred cleanup, where a typed nil error would
// otherwise take the process down.
func errorText(err error) (text string) {
	defer func() {
		if recover() != nil {
			text = ""
		}
	}()
	return err.Error()
}

// anyInChain reports whether match is true for err or any error it wraps. It
// visits wrapped errors in the same order as errors.As.
func anyInChain(err error, match func(error) bool) bool {
	for err != nil {
		if match(err) {
			return true
		}
		switch wrapper := err.(type) {
		case interface{ Unwrap() []error }:
			for _, child := range wrapper.Unwrap() {
				if anyInChain(child, match) {
					return true
				}
			}
			return false
		case interface{ Unwrap() error }:
			err = wrapper.Unwrap()
		default:
			return false
		}
	}
	return false
}

// innermost returns the deepest error reachable by unwrapping err, following
// the first non-nil member of a joined error.
func innermost(err error) error {
	for {
		var next error
		switch wrapper := err.(type) {
		case interface{ Unwrap() []error }:
			for _, child := range wrapper.Unwrap() {
				if child != nil {
					next = child
					break
				}
			}
		case interface{ Unwrap() error }:
			next = wrapper.Unwrap()
		}
		if next == nil {
			return err
		}
		err = next
	}
}
