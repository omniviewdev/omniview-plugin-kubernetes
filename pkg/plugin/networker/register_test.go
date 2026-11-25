package networker

import (
	"context"
	"testing"

	"github.com/omniview/kubernetes/pkg/connid/connidtest"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The session of a Pod forward states where it listens: the address it asks client-go to bind, which is
// "localhost" (both loopback families). Setting a forward up opens no connection: the tunnel is dialled
// by a goroutine, to the API server of the fixture kubeconfig, which is under .invalid and resolves nowhere.
func TestPodForwarderStatesWhereItListens(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	connection := connidtest.Connection(t, connidtest.Kubeconfig(t, "prod"), "prod")
	pctx := &types.PluginContext{Context: ctx, Connection: connection}
	opts := networker.ResourcePortForwardHandlerOpts{
		Resource: networker.PortForwardResourceConnection{
			ConnectionID: connection.ID,
			ResourceKey:  "k8s:/pods",
			ResourceID:   "pod",
			ResourceData: taggedFixture(map[string]any{"metadata": map[string]any{"name": "pod", "namespace": "ns"}}),
		},
		Options: networker.PortForwardSessionOptions{RemotePort: 8080},
	}

	result, err := (&PodResourceForwarder{}).ForwardResource(ctx, pctx, opts)

	require.NoError(t, err)
	assert.Equal(t, "localhost", result.LocalHost)
}
