package utils

import (
	"context"
	"testing"

	"github.com/omniview/kubernetes/pkg/connid"
	"github.com/omniview/kubernetes/pkg/connid/connidtest"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// KubeClientsFromContext is the one entry point that the exec, metrics and
// port-forward lanes build their clients through. A connection's ID is derived and
// is not a kube context, so the context must come from the connection's data.
var identityContexts = []string{"prod", "arn:aws:eks:us-east-1:111122223333:cluster/prod", "odd name;$(x)"}

func TestKubeClientsFromContext_BuildsForTheContextOfTheDataNotTheID(t *testing.T) {
	path := connidtest.Kubeconfig(t, identityContexts...)
	for _, name := range identityContexts {
		t.Run(name, func(t *testing.T) {
			connection := connidtest.Connection(t, path, name)
			require.NotEqual(t, name, connection.ID)

			bundle, err := KubeClientsFromContext(&types.PluginContext{Context: context.Background(), Connection: connection})

			require.NoError(t, err)
			assert.Equal(t, connidtest.Server(name), bundle.RestConfig.Host,
				"the clients must be for the selected context, not the current one of the file")
		})
	}
}

func TestKubeClientsFromContext_NeverReadsTheIDAsTheContext(t *testing.T) {
	path := connidtest.Kubeconfig(t, "prod")
	connection := connidtest.Connection(t, path, "prod")
	delete(connection.Data, connid.DataKeyContext)
	connection.ID = "prod" // an ID that happens to be the name of a context of the file

	_, err := KubeClientsFromContext(&types.PluginContext{Context: context.Background(), Connection: connection})

	require.ErrorIs(t, err, connid.ErrNoContext)
}

func TestKubeClientsFromContext_RejectsAnUnusableContext(t *testing.T) {
	path := connidtest.Kubeconfig(t, "prod")
	for label, value := range map[string]any{"empty": "", "not a string": 7, "a list": []string{"prod"}} {
		t.Run(label, func(t *testing.T) {
			connection := connidtest.Connection(t, path, "prod")
			connection.Data[connid.DataKeyContext] = value
			_, err := KubeClientsFromContext(&types.PluginContext{Context: context.Background(), Connection: connection})
			require.ErrorIs(t, err, connid.ErrNoContext)
		})
	}
}

// What the user reads when a connection names no context: a classification and a sentence.
func TestKubeClientsFromContext_ANoContextErrorIsClassifiedWithASentence(t *testing.T) {
	path := connidtest.Kubeconfig(t, "prod")
	connection := connidtest.Connection(t, path, "prod")
	delete(connection.Data, connid.DataKeyContext)

	_, err := KubeClientsFromContext(&types.PluginContext{Context: context.Background(), Connection: connection})

	connidtest.RequireNoContextError(t, err)
}

func TestKubeClientsFromContext_TheContextMustExistInTheKubeconfig(t *testing.T) {
	path := connidtest.Kubeconfig(t, "prod")
	connection := connidtest.Connection(t, path, "prod")
	connection.Data[connid.DataKeyContext] = "gone"

	_, err := KubeClientsFromContext(&types.PluginContext{Context: context.Background(), Connection: connection})

	require.ErrorContains(t, err, `context "gone" not found`)
}

// The build's diagnostics are labelled with the connection ID, like every other
// diagnostic of the connection, and not with the context.
func TestKubeClientsFromContext_LabelsTheBuildWithTheConnectionID(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		require.NoError(t, provider.Shutdown(context.Background()))
	})
	path := connidtest.Kubeconfig(t, "prod")
	connection := connidtest.Connection(t, path, "prod")

	_, err := KubeClientsFromContext(&types.PluginContext{Context: context.Background(), Connection: connection})
	require.NoError(t, err)

	var labelled bool
	for _, span := range exporter.GetSpans() {
		if span.Name != "kubernetes.client.build" {
			continue
		}
		labelled = true
		for _, attribute := range span.Attributes {
			if attribute.Key == "connection" {
				assert.Equal(t, connection.ID, attribute.Value.AsString())
			}
		}
	}
	assert.True(t, labelled, "no client build span")
}
