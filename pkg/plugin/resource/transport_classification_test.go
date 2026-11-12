package resource

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/discovery"
	k8sfake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

const transportSecret = "native-secret-token /private/kubeconfig secret-cluster.internal"

type netTimeout struct{}

func (netTimeout) Error() string   { return transportSecret }
func (netTimeout) Timeout() bool   { return true }
func (netTimeout) Temporary() bool { return true }

// tlsHandshakeTimeout stands in for net/http's unexported error of the same text.
type tlsHandshakeTimeout struct{}

func (tlsHandshakeTimeout) Error() string   { return "net/http: TLS handshake timeout" }
func (tlsHandshakeTimeout) Timeout() bool   { return true }
func (tlsHandshakeTimeout) Temporary() bool { return true }

type transportFailure struct {
	name string
	err  error
	code string
}

// transportFailures covers the failure shapes of the first-click connection
// failure: the two that were seen as INTERNAL (an early end of the stream and a
// handshake that never finished) and the transport errors that look alike.
func transportFailures() []transportFailure {
	get := func(inner error) error {
		return &url.Error{Op: "Get", URL: "https://secret-cluster.internal:6443/api", Err: inner}
	}
	op := func(name string, inner error) error {
		return &net.OpError{Op: name, Net: "tcp", Addr: &net.TCPAddr{IP: net.ParseIP("192.0.2.18"), Port: 6443}, Err: inner}
	}
	return []transportFailure{
		{"net.Error with Timeout", op("read", netTimeout{}), "TIMEOUT"},
		{"net.Error with Timeout under url.Error", get(op("read", netTimeout{})), "TIMEOUT"},
		{"net/http: TLS handshake timeout", get(tlsHandshakeTimeout{}), "TIMEOUT"},
		{"wrapped TLS handshake timeout", fmt.Errorf("discover groups: %w", get(tlsHandshakeTimeout{})), "TIMEOUT"},
		{"os.ErrDeadlineExceeded", fmt.Errorf("read: %w", os.ErrDeadlineExceeded), "TIMEOUT"},
		{"io.EOF", io.EOF, "UNAVAILABLE"},
		{"io.ErrUnexpectedEOF", io.ErrUnexpectedEOF, "UNAVAILABLE"},
		{"url.Error around EOF", get(io.EOF), "UNAVAILABLE"},
		{"wrapped url.Error around EOF", fmt.Errorf("discover groups: %w", get(io.EOF)), "UNAVAILABLE"},
		{"wrapped url.Error around unexpected EOF", fmt.Errorf("discover groups: %w", get(io.ErrUnexpectedEOF)), "UNAVAILABLE"},
		{"joined with a cleanup error", errors.Join(get(io.EOF), errors.New("cleanup failed")), "UNAVAILABLE"},
		{"ECONNREFUSED", get(op("dial", os.NewSyscallError("connect", syscall.ECONNREFUSED))), "CONNECTION_ERROR"},
		{"ECONNRESET", get(op("read", os.NewSyscallError("read", syscall.ECONNRESET))), "CONNECTION_ERROR"},
		{"bare ECONNRESET", fmt.Errorf("read: %w", syscall.ECONNRESET), "CONNECTION_ERROR"},
		{"HTTP/2 connection lost", get(errors.New("http2: client connection lost")), "UNAVAILABLE"},
		{"HTTP/2 GOAWAY", get(errors.New(`http2: server sent GOAWAY and closed the connection; LastStreamID=1999, ErrCode=NO_ERROR, debug=""`)), "UNAVAILABLE"},
		{"HTTP/2 stream error", get(errors.New("stream error: stream ID 5; INTERNAL_ERROR; received from peer")), "UNAVAILABLE"},
		{"net.OpError with unknown cause", op("dial", errors.New(transportSecret)), "CONNECTION_ERROR"},
		{"certificate of unknown authority", get(&tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}}), "CERTIFICATE_ERROR"},
		{"hostname mismatch", get(x509.HostnameError{Host: "secret-cluster.internal"}), "CERTIFICATE_ERROR"},
	}
}

func TestClassifyResourceError_TransportFailures(t *testing.T) {
	for _, tc := range transportFailures() {
		t.Run(tc.name, func(t *testing.T) {
			classified := classifyResourceError(tc.err)
			require.NotNil(t, classified, "a transport failure must not fall through to INTERNAL")
			var operationError *sdkresource.ResourceOperationError
			require.ErrorAs(t, classified, &operationError)
			assert.Equal(t, tc.code, operationError.Code)
			assert.Equal(t, tc.code, sdkresource.ErrorCode(classified))
			assert.NotEmpty(t, operationError.Title)
			assert.NotEmpty(t, operationError.Message)
			assert.Same(t, tc.err, operationError.Err, "the native cause stays available for local inspection")
			assert.ErrorIs(t, classified, tc.err)

			fields := []string{operationError.Code, operationError.Title, operationError.Message, classified.Error()}
			fields = append(fields, operationError.Suggestions...)
			for _, field := range fields {
				for _, secret := range []string{
					"native-secret-token", "/private/kubeconfig", "secret-cluster", "192.0.2.18", "6443", "GOAWAY", "LastStreamID",
				} {
					assert.NotContains(t, field, secret)
				}
			}
		})
	}
}

func TestClassifyResourceError_TransportFailureLeavesOtherErrorsAlone(t *testing.T) {
	for name, err := range map[string]error{
		"plain":      errors.New(transportSecret),
		"local bind": &net.OpError{Op: "listen", Net: "tcp", Err: errors.New("bind: address already in use")},
		"parse":      &url.Error{Op: "parse", URL: "::", Err: errors.New("missing protocol scheme")},
		"canceled":   context.Canceled,
		// A status always means the API server answered, whatever its message says.
		"status with transport text": k8sStatusError(418, "http2: client connection lost; GOAWAY; EOF"),
	} {
		t.Run(name, func(t *testing.T) {
			assert.Nil(t, classifyResourceError(err))
		})
	}
}

func TestClassifyResourceError_ServerErrors(t *testing.T) {
	for _, test := range []struct {
		status int32
		reason metav1.StatusReason
		code   string
	}{
		{500, metav1.StatusReasonInternalError, "PROVIDER_ERROR"},
		{500, metav1.StatusReasonServerTimeout, "TIMEOUT"},
		{501, "", "PROVIDER_ERROR"},
		{502, "", "UNAVAILABLE"},
		{503, metav1.StatusReasonServiceUnavailable, "UNAVAILABLE"},
		{504, metav1.StatusReasonTimeout, "TIMEOUT"},
		{505, "", "PROVIDER_ERROR"},
		{599, "", "PROVIDER_ERROR"},
	} {
		t.Run(fmt.Sprintf("%d_%s", test.status, test.reason), func(t *testing.T) {
			cause := &k8serrors.StatusError{ErrStatus: metav1.Status{Code: test.status, Reason: test.reason, Message: transportSecret}}
			classified := classifyResourceError(cause)
			var operationError *sdkresource.ResourceOperationError
			require.ErrorAs(t, classified, &operationError)
			assert.Equal(t, test.code, operationError.Code)
			assert.ErrorIs(t, classified, cause)
			assert.NotContains(t, classified.Error(), "native-secret-token")
			assert.NotEmpty(t, operationError.Message)
		})
	}
}

// diag.Classification.ResourceCode serves callers that cannot reach
// classifyResourceError; the two must report the same code for the same error.
func TestClassifyResourceError_AgreesWithDiagResourceCode(t *testing.T) {
	codeOf := func(err error) string {
		if classified := classifyResourceError(err); classified != nil {
			return sdkresource.ErrorCode(classified)
		}
		return ""
	}
	for status := 100; status <= 599; status++ {
		for _, reason := range []metav1.StatusReason{"", metav1.StatusReasonServerTimeout, metav1.StatusReasonForbidden} {
			err := &k8serrors.StatusError{ErrStatus: metav1.Status{Code: int32(status), Reason: reason}}
			assert.Equalf(t, codeOf(err), diag.ClassifyError(err, false).ResourceCode(), "status %d reason %q", status, reason)
		}
	}
	for _, tc := range transportFailures() {
		assert.Equalf(t, codeOf(tc.err), diag.ClassifyError(tc.err, false).ResourceCode(), "%s", tc.name)
		assert.Equalf(t, tc.code, codeOf(tc.err), "%s", tc.name)
	}
}

func recordStartLogs(t *testing.T) *logtest.RecordingSink {
	t.Helper()
	sink := &logtest.RecordingSink{}
	previous := logging.Default()
	logging.SetDefault(logging.New(logging.Config{
		Name:    "test",
		Level:   logging.NewLevelController(logging.LevelTrace),
		Backend: logging.NewSinkBackend(sink),
	}))
	t.Cleanup(func() { logging.SetDefault(previous) })
	return sink
}

func TestLogNativeStartFailureRecordsClassAndTypeNotText(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		level  logging.Level
		fields map[string]any
	}{
		{
			"end of stream", fmt.Errorf("discover: %w", &url.Error{Op: "Get", URL: "https://secret-cluster.internal/api", Err: io.EOF}), logging.LevelWarn,
			map[string]any{"outcome": "failure", "error_class": "network", "error_reason": "eof", "error_type": "*errors.errorString"},
		},
		{
			"acquisition deadline", fmt.Errorf("discover: %w", &url.Error{Op: "Get", URL: "https://secret-cluster.internal/api", Err: context.DeadlineExceeded}), logging.LevelWarn,
			map[string]any{"outcome": "canceled", "error_class": "deadline_exceeded", "error_type": "context.deadlineExceededError"},
		},
		{
			"status", k8serrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "secret-pod", errors.New(transportSecret)), logging.LevelWarn,
			map[string]any{"outcome": "failure", "error_class": "kubernetes", "k8s_status_code": 403, "k8s_reason": "Forbidden", "error_type": "*errors.StatusError"},
		},
		{
			"retired by a newer start", sdkresource.NewError("RESET_REQUIRED", "Native connection catalog acquisition was retired"), logging.LevelDebug,
			map[string]any{"outcome": "failure", "error_class": "other", "error_type": "*resourcev2.ResourceOperationError"},
		},
		{
			"canceled on purpose", fmt.Errorf("discover: %w", context.Canceled), logging.LevelDebug,
			map[string]any{"outcome": "canceled", "error_class": "canceled", "error_type": "*errors.errorString"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sink := recordStartLogs(t)
			logNativeStartFailure(context.Background(), "kind-load-lab", 3910*time.Millisecond, tc.err)
			records := sink.Records()
			require.Len(t, records, 1)
			assert.Equal(t, tc.level, records[0].Level)
			got := records[0].ToMap()
			assert.Equal(t, "kind-load-lab", got["connection"])
			assert.EqualValues(t, 3910, got["duration_ms"])
			for key, want := range tc.fields {
				assert.EqualValues(t, want, got[key], key)
			}
			assert.NotContains(t, fmt.Sprint(records[0].Message, records[0].Fields), "secret")
		})
	}
}

// startFailureController wires the real SDK controller, with the plugin's error
// classifier and the logging start wrapper, around one native client.
func startFailureController(t *testing.T, client *clients.ClientSet) (*sdkresource.Controller[clients.ClientSet], sdktypes.Connection) {
	t.Helper()
	provider := refreshTestProvider()
	connection := sdktypes.Connection{ID: "kind-load-lab", Name: "Kind load lab"}
	controller, err := sdkresource.NewController(sdkresource.Config[clients.ClientSet]{
		DynamicSources:      true,
		Catalog:             provider.catalog,
		ResolveRegistration: provider.registration,
		ErrorClassifier:     &kubeErrorClassifier{},
		Lifecycle: &sdkresource.Lifecycle[clients.ClientSet]{
			LoadConnections: func(context.Context) ([]sdktypes.Connection, error) {
				return []sdktypes.Connection{connection}, nil
			},
			CreateClient:  func(context.Context, sdktypes.Connection) (*clients.ClientSet, error) { return client, nil },
			DestroyClient: provider.connections.DestroyClient,
			OnStart:       provider.startNativeConnectionObserved,
			OnStop: func(_ context.Context, connection sdktypes.Connection, _ *clients.ClientSet) error {
				provider.retireNativeCatalog(connection.ID)
				return nil
			},
		},
	})
	require.NoError(t, err)
	provider.Controller = controller
	t.Cleanup(func() { _ = controller.Close() })
	_, err = controller.LoadConnections(context.Background())
	require.NoError(t, err)
	return controller, connection
}

func kubeClientWith(discoveryClient discovery.DiscoveryInterface) *clients.ClientSet {
	return &clients.ClientSet{
		DiscoveryClient: discoveryClient,
		KubeClient:      k8sfake.NewClientset(&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "kube-system", UID: types.UID("cluster-uid")}}),
	}
}

func startRecord(t *testing.T, sink *logtest.RecordingSink) map[string]any {
	t.Helper()
	for _, record := range sink.Records() {
		if record.Message == "native connection start failed" {
			return record.ToMap()
		}
	}
	t.Fatal("the failed start was not logged")
	return nil
}

// TestStartConnectionTransportFailuresReachTheHostClassified is the first-click
// failure end to end: the apiserver of the lab drops or resets connections and
// answers 5xx under load, and the start used to surface as INTERNAL with no
// trace of the cause in the plugin log.
func TestStartConnectionTransportFailuresReachTheHostClassified(t *testing.T) {
	respond := func(status int) func(http.ResponseWriter, *http.Request) bool {
		return func(w http.ResponseWriter, _ *http.Request) bool {
			http.Error(w, transportSecret, status)
			return true
		}
	}
	for _, tc := range []struct {
		name   string
		hook   func(http.ResponseWriter, *http.Request) bool
		code   string
		fields map[string]any
	}{
		{
			"the server ends the stream", func(w http.ResponseWriter, _ *http.Request) bool {
				conn, _, err := w.(http.Hijacker).Hijack()
				if err == nil {
					_ = conn.Close()
				}
				return true
			},
			"UNAVAILABLE", map[string]any{"error_class": "network", "error_reason": "eof", "error_type": "*errors.errorString"},
		},
		{
			"the server resets the connection", func(w http.ResponseWriter, _ *http.Request) bool {
				conn, _, err := w.(http.Hijacker).Hijack()
				if err == nil {
					if tcp, ok := conn.(*net.TCPConn); ok {
						_ = tcp.SetLinger(0)
					}
					_ = conn.Close()
				}
				return true
			},
			"CONNECTION_ERROR", map[string]any{"error_class": "network", "error_reason": "connection_reset", "error_type": "syscall.Errno"},
		},
		{"502 from a gateway", respond(http.StatusBadGateway), "UNAVAILABLE", map[string]any{"error_class": "kubernetes", "k8s_status_code": 502}},
		{"503 under load", respond(http.StatusServiceUnavailable), "UNAVAILABLE", map[string]any{"error_class": "kubernetes", "k8s_status_code": 503}},
		{"500 from the apiserver", respond(http.StatusInternalServerError), "PROVIDER_ERROR", map[string]any{"error_class": "kubernetes", "k8s_status_code": 500}},
		{"429 from the apiserver", respond(http.StatusTooManyRequests), "RESOURCE_LIMIT", map[string]any{"error_class": "kubernetes", "k8s_status_code": 429}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sink := recordStartLogs(t)
			fixture, client := newRefreshHTTPFixture(t)
			fixture.mu.Lock()
			fixture.hook = tc.hook
			fixture.mu.Unlock()
			controller, connection := startFailureController(t, client)

			_, err := controller.StartConnection(context.Background(), connection.ID)
			require.Error(t, err)
			assert.Equal(t, tc.code, sdkresource.ErrorCode(err), "the host reads this code; INTERNAL hides a transient failure")

			got := startRecord(t, sink)
			assert.Equal(t, connection.ID, got["connection"])
			assert.Contains(t, got, "duration_ms")
			for key, want := range tc.fields {
				assert.EqualValues(t, want, got[key], key)
			}
			for _, record := range sink.Records() {
				text := fmt.Sprint(record.Message, record.Fields)
				assert.NotContains(t, text, "native-secret-token")
				assert.NotContains(t, text, "127.0.0.1")
			}
		})
	}

	t.Run("the certificate cannot be verified", func(t *testing.T) {
		sink := recordStartLogs(t)
		server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "unreachable", http.StatusNotFound) }))
		server.Config.ErrorLog = log.New(io.Discard, "", 0) // the client rejects the certificate; the server need not say so
		server.StartTLS()
		t.Cleanup(server.Close)
		d, err := discovery.NewDiscoveryClientForConfig(&rest.Config{Host: server.URL})
		require.NoError(t, err)
		controller, connection := startFailureController(t, kubeClientWith(d))

		_, err = controller.StartConnection(context.Background(), connection.ID)
		require.Error(t, err)
		assert.Equal(t, "CERTIFICATE_ERROR", sdkresource.ErrorCode(err))
		got := startRecord(t, sink)
		assert.Equal(t, "certificate", got["error_class"])
		assert.Equal(t, "unknown_authority", got["error_reason"])
		assert.Equal(t, "x509.UnknownAuthorityError", got["error_type"])
		for _, record := range sink.Records() {
			assert.False(t, strings.Contains(fmt.Sprint(record.Message, record.Fields), "127.0.0.1"))
		}
	})
}

// The same failure through the provider as the plugin builds it: a kubeconfig,
// the real client construction, and the lifecycle and classifier it is wired
// with. Only the API server is a stand-in.
func TestProviderStartFailureIsClassifiedAndLoggedThroughProductionWiring(t *testing.T) {
	sink := recordStartLogs(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if conn, _, err := w.(http.Hijacker).Hijack(); err == nil {
			_ = conn.Close()
		}
	}))
	t.Cleanup(server.Close)
	kubeconfig := filepath.Join(t.TempDir(), "config")
	config := fmt.Sprintf("apiVersion: v1\nkind: Config\nclusters:\n- name: lab\n  cluster:\n    server: %s\ncontexts:\n- name: lab\n  context:\n    cluster: lab\n    user: lab\ncurrent-context: lab\nusers:\n- name: lab\n  user:\n    token: native-secret-token\n", server.URL)
	require.NoError(t, os.WriteFile(kubeconfig, []byte(config), 0o600))

	provider, err := newKubernetesProvider(zap.NewNop().Sugar(), func(string) {})
	require.NoError(t, err)
	t.Cleanup(func() { _ = provider.Close() })
	ctx := context.Background()
	require.NoError(t, provider.ApplyConnections(ctx, []sdktypes.Connection{{ID: "lab", Name: "lab", Data: map[string]any{"kubeconfig": kubeconfig}}}))

	_, err = provider.StartConnection(ctx, "lab")
	require.Error(t, err)
	assert.Equal(t, "UNAVAILABLE", sdkresource.ErrorCode(err))
	got := startRecord(t, sink)
	assert.Equal(t, "lab", got["connection"])
	assert.Equal(t, "network", got["error_class"])
	assert.Equal(t, "eof", got["error_reason"])
	assert.Equal(t, "*errors.errorString", got["error_type"])
	for _, record := range sink.Records() {
		text := fmt.Sprint(record.Message, record.Fields)
		assert.NotContains(t, text, "native-secret-token")
		assert.NotContains(t, text, "127.0.0.1")
	}
}
