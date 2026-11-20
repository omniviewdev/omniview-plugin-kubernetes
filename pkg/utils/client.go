package utils

import (
	"errors"

	"github.com/omniview/kubernetes/pkg/connid"
	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// KubeClientsFromContext returns a kube client bundle given the incoming plugin context.
//
// The clients are built for the kubeconfig context that the data of the connection names
// (connid.DataKeyContext). The ID of a connection is derived and is not the name of a context;
// it only labels the diagnostics of the build.
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

	kubeContext, err := connid.ContextFromData(ctx.Connection.Data)
	if err != nil {
		return nil, err
	}

	return kubeauth.LoadKubeClients(kubeauth.WithConnectionID(ctx.Context, ctx.Connection.ID), kubeconfigPath, kubeContext)
}
