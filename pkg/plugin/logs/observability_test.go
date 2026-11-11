package logs

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
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
