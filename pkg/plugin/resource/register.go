package resource

import (
	"context"
	"fmt"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"go.uber.org/zap"
	"k8s.io/client-go/kubernetes"
)

// Register installs the single resource v2 boundary. Unrelated plugin services
// retain their existing transport version and independent registrations.
func Register(plugin *sdk.Plugin, retireMetrics func(string)) func(context.Context, resourcev2.AccessRoute, func(context.Context, *kubernetes.Clientset) error) error {
	provider, err := newKubernetesProvider(zap.S(), retireMetrics)
	if err != nil {
		panic(fmt.Sprintf("failed to build resource provider: %v", err))
	}
	sdk.RegisterResourcePlugin(plugin, provider)
	return provider.withStreamingClient
}

// withStreamingClient retains the sole SDK connection-generation lease until
// the streaming consumer closes. No second connection cache or client is created.
func (p *kubernetesProvider) withStreamingClient(ctx context.Context, route resourcev2.AccessRoute, use func(context.Context, *kubernetes.Clientset) error) error {
	return p.WithClient(ctx, route, func(nativeCtx context.Context, client *clients.ClientSet) error {
		if client.StreamingClientset == nil {
			return resourcev2.NewError("INTERNAL", "Native streaming client is not initialized")
		}
		return use(nativeCtx, client.StreamingClientset)
	})
}
