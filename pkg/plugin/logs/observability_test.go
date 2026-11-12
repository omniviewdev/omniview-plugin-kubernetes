package logs

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"syscall"
	"testing"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
)

func captureDefaultLogs(t *testing.T) *logtest.RecordingSink {
	t.Helper()
	sink := &logtest.RecordingSink{}
	previous := logging.Default()
	logging.SetDefault(logging.New(logging.Config{
		Name:    "test",
		Level:   logging.NewLevelController(logging.LevelDebug),
		Backend: logging.NewSinkBackend(sink),
	}))
	t.Cleanup(func() { logging.SetDefault(previous) })
	return sink
}

func captureSpans(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	previous := otel.GetTracerProvider()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		require.NoError(t, provider.Shutdown(context.Background()))
	})
	return exporter
}

func recordText(sink *logtest.RecordingSink) string {
	var b strings.Builder
	for _, record := range sink.Records() {
		b.WriteString(record.Message)
		for _, field := range record.Fields {
			fmt.Fprintf(&b, " %s=%v", field.Key, field.Value)
		}
		b.WriteByte('\n')
	}
	return b.String()
}

func TestSafeLogErrorClassifiesWithoutLeakingProviderText(t *testing.T) {
	sink := captureDefaultLogs(t)
	returned := safeLogError(context.Background(), nil, "read", errors.New("secret-provider-text"))
	require.Error(t, returned)
	assert.NotContains(t, returned.Error(), "secret-provider-text")

	records := sink.Records()
	require.Len(t, records, 1)
	assert.Equal(t, logging.LevelWarn, records[0].Level)
	fields := records[0].ToMap()
	assert.Equal(t, "read", fields["operation"])
	assert.Equal(t, "other", fields["error_class"])
	assert.NotContains(t, recordText(sink), "secret-provider-text")

	sink.Reset()
	assert.ErrorIs(t, safeLogError(context.Background(), nil, "read", context.Canceled), context.Canceled)
	require.Len(t, sink.Records(), 1)
	assert.Equal(t, logging.LevelDebug, sink.Records()[0].Level)
}

func statusFailure(code int32, reason metav1.StatusReason) error {
	return &apierrors.StatusError{ErrStatus: metav1.Status{Status: metav1.StatusFailure, Code: code, Reason: reason, Message: "secret-status-message"}}
}

func TestSafeLogErrorKeepsTheClassOfTheFailure(t *testing.T) {
	const host = "secret-host.internal"
	get := func(inner error) error {
		return &url.Error{Op: "Get", URL: "https://" + host + ":6443/api/v1/secret-path", Err: inner}
	}
	coded := func(code string) error {
		return &resourcev2.ResourceOperationError{Err: errors.New("secret-cause"), Code: code, Title: "secret-title", Message: "secret-message", Suggestions: []string{"secret-suggestion"}}
	}
	for _, tc := range []struct {
		name string
		err  error
		code string
	}{
		// What Kubernetes answers.
		{"400 bad request", statusFailure(400, metav1.StatusReasonBadRequest), "INVALID_REQUEST"},
		{"401 unauthorized", statusFailure(401, metav1.StatusReasonUnauthorized), "UNAUTHORIZED"},
		{"403 forbidden", statusFailure(403, metav1.StatusReasonForbidden), "FORBIDDEN"},
		{"404 not found", statusFailure(404, metav1.StatusReasonNotFound), "NOT_FOUND"},
		{"409 conflict", statusFailure(409, metav1.StatusReasonConflict), "CONFLICT"},
		{"410 gone", statusFailure(410, metav1.StatusReasonGone), "CONTINUATION_EXPIRED"},
		{"422 invalid", statusFailure(422, metav1.StatusReasonInvalid), "INVALID_REQUEST"},
		{"429 throttled", statusFailure(429, metav1.StatusReasonTooManyRequests), "RESOURCE_LIMIT"},
		{"500 internal", statusFailure(500, metav1.StatusReasonInternalError), "PROVIDER_ERROR"},
		{"503 unavailable", statusFailure(503, metav1.StatusReasonServiceUnavailable), "UNAVAILABLE"},
		{"504 timeout", statusFailure(504, metav1.StatusReasonTimeout), "TIMEOUT"},
		{"wrapped 404", fmt.Errorf("failed to get deployment ns/%s: %w", host, statusFailure(404, metav1.StatusReasonNotFound)), "NOT_FOUND"},
		{"unmapped status", statusFailure(418, metav1.StatusReasonUnknown), "INTERNAL"},

		// What the target validation says.
		{"invalid request", coded("INVALID_REQUEST"), "INVALID_REQUEST"},
		{"reset required", fmt.Errorf("resolve: %w", coded("RESET_REQUIRED")), "RESET_REQUIRED"},
		{"coded over a status", &resourcev2.ResourceOperationError{Err: statusFailure(404, metav1.StatusReasonNotFound), Code: "UNAVAILABLE"}, "UNAVAILABLE"},
		{"code outside the vocabulary", coded("secret-code"), "INTERNAL"},

		// What the transport says.
		{"timeout", get(&net.OpError{Op: "read", Net: "tcp", Err: os.ErrDeadlineExceeded}), "TIMEOUT"},
		{"end of stream", get(io.EOF), "UNAVAILABLE"},
		{"truncated body", fmt.Errorf("read: %w", io.ErrUnexpectedEOF), "UNAVAILABLE"},
		{"refused", get(&net.OpError{Op: "dial", Net: "tcp", Err: os.NewSyscallError("connect", syscall.ECONNREFUSED)}), "CONNECTION_ERROR"},
		{"reset", get(&net.OpError{Op: "read", Net: "tcp", Err: os.NewSyscallError("read", syscall.ECONNRESET)}), "CONNECTION_ERROR"},
		{"certificate", get(x509.UnknownAuthorityError{}), "CERTIFICATE_ERROR"},

		// Anything else is still INTERNAL.
		{"unknown", errors.New("secret-provider-text"), "INTERNAL"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sink := captureDefaultLogs(t)
			returned := safeLogError(context.Background(), nil, "open", tc.err)
			require.Error(t, returned)
			assert.Equal(t, tc.code, resourcev2.ErrorCode(returned))
			var detail *resourcev2.ResourceOperationError
			require.ErrorAs(t, returned, &detail)
			assert.Equal(t, "native log operation failed", detail.Message)
			assert.Empty(t, detail.Title)
			assert.Empty(t, detail.Suggestions)
			assert.Nil(t, detail.Err, "the native cause must not travel with the returned error")
			assert.NotContains(t, returned.Error(), "secret")

			records := sink.Records()
			require.Len(t, records, 1)
			assert.Equal(t, logging.LevelWarn, records[0].Level)
			fields := records[0].ToMap()
			assert.Equal(t, "open", fields["operation"])
			assert.Equal(t, fmt.Sprintf("%T", innermostCause(tc.err)), fields["error_type"], "the log must carry the Go type of the cause")
			assert.NotEmpty(t, fields["error_class"])
			assert.NotContains(t, recordText(sink), "secret")
			assert.NotContains(t, recordText(sink), host)
		})
	}
}

// innermostCause unwraps single wrappers the way the logged type should.
func innermostCause(err error) error {
	for {
		next := errors.Unwrap(err)
		if next == nil {
			return err
		}
		err = next
	}
}

func TestSafeLogErrorLogsTransportClassAndType(t *testing.T) {
	sink := captureDefaultLogs(t)
	err := fmt.Errorf("open: %w", &url.Error{Op: "Get", URL: "https://secret-host.internal/api", Err: io.EOF})
	returned := safeLogError(context.Background(), nil, "open", err)
	assert.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(returned))
	records := sink.Records()
	require.Len(t, records, 1)
	fields := records[0].ToMap()
	assert.Equal(t, "network", fields["error_class"])
	assert.Equal(t, "eof", fields["error_reason"])
	assert.Equal(t, "*errors.errorString", fields["error_type"])
	assert.Equal(t, "failure", fields["outcome"])
}

func TestProcessPodWatchEventsLogsClassifiedErrorEvent(t *testing.T) {
	sink := captureDefaultLogs(t)
	fw := watch.NewFake()
	eventCh := make(chan logs.SourceEvent, 4)
	done := make(chan struct{})
	go func() {
		defer close(done)
		processPodWatchEvents(context.Background(), logging.Default(), fw, "", map[string]map[string]struct{}{}, eventCh)
	}()
	fw.Error(&metav1.Status{Status: metav1.StatusFailure, Reason: metav1.StatusReasonExpired, Code: 410, Message: "secret-status-message"})
	<-done

	var warn map[string]any
	for _, record := range sink.Records() {
		if record.Level == logging.LevelWarn {
			warn = record.ToMap()
		}
	}
	require.NotNil(t, warn, "watch error event must log a Warn")
	assert.Equal(t, "kubernetes", warn["error_class"])
	assert.Equal(t, "Expired", warn["k8s_reason"])
	assert.EqualValues(t, 410, warn["k8s_status_code"])
	assert.NotContains(t, recordText(sink), "secret-status-message")
}

func TestRelistPodsFailureEmitsClassifiedSpanAndLog(t *testing.T) {
	sink := captureDefaultLogs(t)
	exporter := captureSpans(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","code":403,"message":"secret-list-denied"}`))
	}))
	defer server.Close()
	client, err := kubernetes.NewForConfig(&rest.Config{Host: server.URL})
	require.NoError(t, err)

	prev := map[string]map[string]struct{}{"pod": {"pod/c": {}}}
	rv, known := relistPods(context.Background(), logging.Default(), &kubeauth.KubeClientBundle{Clientset: client}, "ns", labels.Everything(), "", prev, make(chan logs.SourceEvent, 1))
	assert.Empty(t, rv)
	assert.Equal(t, prev, known)

	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, "kubernetes.logs.watch", spans[0].Name)
	attrs := map[string]string{}
	for _, attr := range spans[0].Attributes {
		attrs[string(attr.Key)] = attr.Value.String()
	}
	assert.Equal(t, "relist", attrs["phase"])
	assert.Equal(t, "failure", attrs["outcome"])
	assert.Equal(t, "kubernetes", attrs["error.class"])
	assert.Equal(t, "Forbidden", attrs["k8s.reason"])

	text := recordText(sink)
	assert.Contains(t, text, "pod source relist failed")
	assert.NotContains(t, text, "secret-list-denied")
	for _, span := range spans {
		for _, attr := range span.Attributes {
			assert.NotContains(t, attr.Value.String(), "secret-list-denied")
		}
		assert.NotContains(t, span.Status.Description, "secret-list-denied")
	}
}
