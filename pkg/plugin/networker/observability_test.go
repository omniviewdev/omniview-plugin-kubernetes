package networker

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"testing"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestForwardLineCountReportsLinesNotContent(t *testing.T) {
	assert.Equal(t, 0, forwardLineCount(new(bytes.Buffer)))
	assert.Equal(t, 1, forwardLineCount(bytes.NewBufferString("secret-line")))
	assert.Equal(t, 2, forwardLineCount(bytes.NewBufferString("secret-a\nsecret-b\n")))
}

func TestForwardSetupFailureIsClassifiedAndDoesNotLeakKubeconfigPath(t *testing.T) {
	previous := otel.GetTracerProvider()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		require.NoError(t, provider.Shutdown(context.Background()))
	})
	sink := &logtest.RecordingSink{}
	logger := logging.New(logging.Config{Name: "test", Level: logging.NewLevelController(logging.LevelDebug), Backend: logging.NewSinkBackend(sink)})
	pctx := &types.PluginContext{
		Context: context.Background(),
		Logger:  logger,
		Connection: &types.Connection{
			ID:   "cluster",
			Data: map[string]any{"kubeconfig": "/secret/kube/config-that-does-not-exist"},
		},
	}

	for name, forwarder := range map[string]networker.ResourceForwarder{
		"pod":      &PodResourceForwarder{},
		"workload": &WorkloadResourceForwarder{},
	} {
		t.Run(name, func(t *testing.T) {
			exporter.Reset()
			sink.Reset()
			_, err := forwarder.ForwardResource(context.Background(), pctx, networker.ResourcePortForwardHandlerOpts{
				Resource: networker.PortForwardResourceConnection{ResourceKey: "k8s:/pods", ResourceID: "pod"},
			})
			require.Error(t, err)
			assert.NotContains(t, err.Error(), "/secret/kube", "returned error must not expose the kubeconfig path")
			var open tracetest.SpanStub
			var found bool
			for _, span := range exporter.GetSpans() {
				if span.Name == "kubernetes.portforward.session.open" {
					open, found = span, true
				}
			}
			require.True(t, found, "port-forward setup span missing")
			spans := []tracetest.SpanStub{open}
			attrs := map[string]string{}
			for _, attr := range spans[0].Attributes {
				attrs[string(attr.Key)] = attr.Value.String()
				assert.NotContains(t, attr.Value.String(), "/secret/kube")
			}
			assert.Equal(t, "failure", attrs["outcome"])
			assert.Equal(t, "other", attrs["error.class"])
			assert.Equal(t, "cluster", attrs["connection"])
			assert.NotContains(t, spans[0].Status.Description, "/secret/kube")

			var b strings.Builder
			for _, record := range sink.Records() {
				b.WriteString(record.Message)
				for _, field := range record.Fields {
					fmt.Fprintf(&b, " %s=%v", field.Key, field.Value)
				}
			}
			assert.Contains(t, b.String(), "setup failed")
			assert.NotContains(t, b.String(), "/secret/kube")
		})
	}
}
