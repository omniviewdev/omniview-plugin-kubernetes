package exec

import (
	"github.com/omniview/kubernetes/pkg/utils"
	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ClientProvider is a function that returns a KubeClientBundle from a PluginContext.
// It allows dependency injection for testing.
type ClientProvider func(ctx *types.PluginContext) (*kubeauth.KubeClientBundle, error)

// defaultClientProvider uses the real KubeClientsFromContext implementation.
var defaultClientProvider ClientProvider = utils.KubeClientsFromContext
