package networker

import (
	"context"
	"testing"

	"github.com/omniview/kubernetes/pkg/connid"
	"github.com/omniview/kubernetes/pkg/connid/connidtest"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// Both forwarders build their clients first and judge the target second, and the first thing
// they judge is whose resource it is. A target of another provider is rejected as
// INVALID_REQUEST, which therefore shows that the clients were built; a failure to build them
// is another error. The ID of the connection is derived and is not a kube context, so the
// clients must be built for the context that the data names.
func TestForwardersBuildClientsForTheContextOfTheDataNotTheID(t *testing.T) {
	path := connidtest.Kubeconfig(t, "prod")
	for name, forwarder := range map[string]networker.ResourceForwarder{
		"pod":      &PodResourceForwarder{},
		"workload": &WorkloadResourceForwarder{},
	} {
		t.Run(name, func(t *testing.T) {
			connection := connidtest.Connection(t, path, "prod")
			pctx := &types.PluginContext{Context: context.Background(), Connection: connection}
			opts := networker.ResourcePortForwardHandlerOpts{Resource: networker.PortForwardResourceConnection{
				PluginID: "another-provider", ResourceKey: "k8s:/pods", ResourceID: "pod", ConnectionID: connection.ID,
			}}

			_, err := forwarder.ForwardResource(context.Background(), pctx, opts)

			require.Error(t, err)
			assert.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err), "the clients were built and the target was judged: %v", err)
		})
	}
}

// A connection that names no context fails to build its clients with INVALID_REQUEST too (and a
// sentence, which the setup of a forward replaces with its own fixed text), so that code no longer tells
// a target that was judged from clients that were never built: the span of a client build does.
func TestForwardersNeverReadTheIDAsTheContext(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		require.NoError(t, provider.Shutdown(context.Background()))
	})
	path := connidtest.Kubeconfig(t, "prod")
	for name, forwarder := range map[string]networker.ResourceForwarder{
		"pod":      &PodResourceForwarder{},
		"workload": &WorkloadResourceForwarder{},
	} {
		t.Run(name, func(t *testing.T) {
			connection := connidtest.Connection(t, path, "prod")
			delete(connection.Data, connid.DataKeyContext)
			connection.ID = "prod" // names a context of the file
			pctx := &types.PluginContext{Context: context.Background(), Connection: connection}
			opts := networker.ResourcePortForwardHandlerOpts{Resource: networker.PortForwardResourceConnection{
				PluginID: "another-provider", ResourceKey: "k8s:/pods", ResourceID: "pod", ConnectionID: connection.ID,
			}}

			exporter.Reset()
			_, err := forwarder.ForwardResource(context.Background(), pctx, opts)

			require.Error(t, err)
			assert.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err), "the connection is refused with a classification")
			spans := exporter.GetSpans()
			require.NotEmpty(t, spans, "the setup of the forward is traced")
			for _, span := range spans {
				assert.NotEqual(t, "kubernetes.client.build", span.Name, "no clients may be built for a connection that names no context")
			}
		})
	}
}
