package utils

import (
	"errors"

	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Returns a kube client bundle given the incoming plugin context
func KubeClientsFromContext(ctx *types.PluginContext) (*kubeauth.KubeClientBundle, error) {
	if ctx.Connection == nil {
		return nil, errors.New("kubeconfig is required")
	}

	val, ok := ctx.Connection.GetDataKey("kubeconfig")
	if !ok {
		return nil, errors.New("kubeconfig is required")
	}
	kubeconfigPath, ok := val.(string)
	if !ok {
		return nil, errors.New("kubeconfig is required and must be a string")
	}

	return kubeauth.LoadKubeClients(ctx.Context, kubeconfigPath, ctx.Connection.ID)
}
