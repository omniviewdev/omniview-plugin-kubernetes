package logs

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/omniview/kubernetes/pkg/connid/connidtest"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// The logs lane builds no client of its own. It borrows the clients of the connection from the
// resource provider by route, and the route names the connection by its ID, which is derived, and
// never by the name of its kube context. The clients behind that route are built for the context
// that the data of the connection names (see the resource lane's tests).
func TestNativeHandlerRoutesByTheConnectionIDNotItsContext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "line\n")
	}))
	defer server.Close()
	client, err := kubernetes.NewForConfig(&rest.Config{Host: server.URL})
	require.NoError(t, err)
	routes := make(chan resourcev2.AccessRoute, 1)
	released := make(chan struct{})
	borrow := func(ctx context.Context, route resourcev2.AccessRoute, use func(context.Context, *kubernetes.Clientset) error) error {
		defer close(released)
		routes <- route
		return use(ctx, client)
	}
	connection := connidtest.Connection(t, connidtest.Kubeconfig(t, "prod"), "prod")
	ctx := &types.PluginContext{Context: context.Background(), Connection: connection}

	stream, err := nativeHandler(borrow)(ctx, sdklogs.LogStreamRequest{Labels: map[string]string{"pod": "pod", "namespace": "ns"}})
	require.NoError(t, err)
	_, err = io.ReadAll(stream)
	require.NoError(t, err)
	require.NoError(t, stream.Close())
	awaitReleased(t, released)

	route := <-routes
	require.Equal(t, connection.ID, route.Connection)
	require.NotEqual(t, "prod", route.Connection)
}
