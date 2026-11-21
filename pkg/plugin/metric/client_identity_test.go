package metric

import (
	"context"
	"testing"

	"github.com/omniview/kubernetes/pkg/connid"
	"github.com/omniview/kubernetes/pkg/connid/connidtest"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The ID of a connection is derived and is not a kube context. Every way that the metrics
// lane builds clients (the cache of the native and Prometheus sources through the default
// factory, and the legacy metrics client) selects the context that the data names.

func TestDefaultClientFactoryBuildsForTheContextOfTheDataNotTheID(t *testing.T) {
	path := connidtest.Kubeconfig(t, "prod")
	connection := connidtest.Connection(t, path, "prod")

	bundle, err := DefaultClientFactory(context.Background(), connection)

	require.NoError(t, err)
	assert.Equal(t, connidtest.Server("prod"), bundle.RestConfig.Host)
}

func TestDefaultClientFactoryNeverReadsTheIDAsTheContext(t *testing.T) {
	path := connidtest.Kubeconfig(t, "prod")
	connection := connidtest.Connection(t, path, "prod")
	delete(connection.Data, connid.DataKeyContext)
	connection.ID = "prod" // names a context of the file

	_, err := DefaultClientFactory(context.Background(), connection)

	require.ErrorIs(t, err, connid.ErrNoContext)
}

func TestMetricsClientIsBuiltForTheContextOfTheData(t *testing.T) {
	path := connidtest.Kubeconfig(t, "prod")
	connection := connidtest.Connection(t, path, "prod")
	qctx := &sdkmetric.QueryContext{Context: context.Background(), ConnectionID: connection.ID, Connection: connection}

	client, err := getMetricsClient(qctx)
	require.NoError(t, err)
	require.NotNil(t, client)

	delete(connection.Data, connid.DataKeyContext)
	_, err = getMetricsClient(qctx)
	require.ErrorIs(t, err, connid.ErrNoContext)
}

// The cache keys on the connection ID. Two kubeconfigs that each define a context named
// prod are two connections with two IDs, and each gets clients for its own server.
func TestClientCacheKeepsSameNamedContextsOfDifferentKubeconfigsApart(t *testing.T) {
	const serverOne, serverTwo = "https://one.invalid:6443", "https://two.invalid:6443"
	first := connidtest.Connection(t, connidtest.KubeconfigAt(t, map[string]string{"prod": serverOne}), "prod")
	second := connidtest.Connection(t, connidtest.KubeconfigAt(t, map[string]string{"prod": serverTwo}), "prod")
	require.NotEqual(t, first.ID, second.ID)
	cache := NewClientCache(ClientCacheOpts{})
	defer cache.Stop()

	built, err := cache.Get(context.Background(), first.ID, first)
	require.NoError(t, err)
	other, err := cache.Get(context.Background(), second.ID, second)
	require.NoError(t, err)
	again, err := cache.Get(context.Background(), first.ID, first)
	require.NoError(t, err)

	assert.Equal(t, serverOne, built.RestConfig.Host)
	assert.Equal(t, serverTwo, other.RestConfig.Host)
	assert.Same(t, built, again, "the same ID is served from the cache")

	cache.Evict(first.ID)
	rebuilt, err := cache.Get(context.Background(), first.ID, first)
	require.NoError(t, err)
	assert.NotSame(t, built, rebuilt, "evicting one connection rebuilds that connection")
	still, err := cache.Get(context.Background(), second.ID, second)
	require.NoError(t, err)
	assert.Same(t, other, still, "and leaves the connection of the same name alone")
}
