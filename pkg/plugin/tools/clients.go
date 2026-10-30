package tools

import (
	"fmt"

	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/dynamic"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
	"k8s.io/client-go/restmapper"

	"github.com/omniview/kubernetes/pkg/utils"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Clients is the narrow client set the tools need. The interfaces let tests
// inject client-go fakes.
type Clients struct {
	Core      corev1client.CoreV1Interface
	Dynamic   dynamic.Interface
	Discovery discovery.DiscoveryInterface
}

// ClientProvider resolves the clients for the connection in the PluginContext.
type ClientProvider func(ctx *types.PluginContext) (*Clients, error)

var defaultClientProvider ClientProvider = func(ctx *types.PluginContext) (*Clients, error) {
	bundle, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}
	return &Clients{
		Core:      bundle.Clientset.CoreV1(),
		Dynamic:   bundle.Dynamic,
		Discovery: bundle.Discovery,
	}, nil
}

// resourceMapping resolves apiVersion + kind to a GVR and whether it is
// namespaced.
func (c *Clients) resourceMapping(apiVersion, kind string) (schema.GroupVersionResource, bool, error) {
	groupVersion, err := schema.ParseGroupVersion(apiVersion)
	if err != nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("invalid apiVersion %q: %w", apiVersion, err)
	}
	mapper := restmapper.NewDeferredDiscoveryRESTMapper(memory.NewMemCacheClient(c.Discovery))
	mapping, err := mapper.RESTMapping(schema.GroupKind{Group: groupVersion.Group, Kind: kind}, groupVersion.Version)
	if err != nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("unknown resource %s/%s: %w", apiVersion, kind, err)
	}
	return mapping.Resource, mapping.Scope.Name() == meta.RESTScopeNameNamespace, nil
}
