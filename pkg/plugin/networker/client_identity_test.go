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

func TestForwardersNeverReadTheIDAsTheContext(t *testing.T) {
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

			_, err := forwarder.ForwardResource(context.Background(), pctx, opts)

			require.Error(t, err)
			assert.NotEqual(t, "INVALID_REQUEST", resourcev2.ErrorCode(err), "no clients may be built for a connection that names no context")
		})
	}
}
