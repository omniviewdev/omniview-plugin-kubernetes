package utils

import (
	"errors"

	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// KubeClientsFromConnection creates kube clients directly from a Connection,
// used by v1 SDK interfaces that receive context.Context + Connection instead
// of the old *types.PluginContext.
func KubeClientsFromConnection(conn *types.Connection) (*kubeauth.KubeClientBundle, error) {
	if conn == nil {
		return nil, errors.New("connection is required")
	}

	val, ok := conn.GetDataKey("kubeconfig")
	if !ok {
		return nil, errors.New("kubeconfig is required")
	}
	kubeconfigPath, ok := val.(string)
	if !ok {
		return nil, errors.New("kubeconfig is required and must be a string")
	}
	if kubeconfigPath == "" {
		return nil, errors.New("kubeconfig is required and must be a non-empty string")
	}

	return kubeauth.LoadKubeClients(kubeconfigPath, conn.ID)
}
