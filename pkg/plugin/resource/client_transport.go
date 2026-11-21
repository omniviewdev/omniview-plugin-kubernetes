package resource

import (
	"context"
	"errors"

	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// LoadBoundedResourceClients constructs resource-only clients without changing
// the unbounded clients used by logs, exec, and metrics.
//
// The clients are built for the kubeconfig context that the data of the connection
// names (connid.DataKeyContext). The ID of a connection is derived and is not the
// name of a context; it only labels the diagnostics of the build.
func LoadBoundedResourceClients(ctx context.Context, conn *types.Connection) (*kubeauth.KubeClientBundle, error) {
	if conn == nil {
		return nil, errors.New("connection is required")
	}
	value, ok := conn.GetDataKey("kubeconfig")
	if !ok {
		return nil, errors.New("kubeconfig is required")
	}
	path, ok := value.(string)
	if !ok || path == "" {
		return nil, errors.New("kubeconfig must be a non-empty string")
	}
	kubeContext, err := kubeauth.ConnectionContext(conn.Data)
	if err != nil {
		return nil, err
	}
	return kubeauth.LoadResourceKubeClients(kubeauth.WithConnectionID(ctx, conn.ID), path, kubeContext)
}
