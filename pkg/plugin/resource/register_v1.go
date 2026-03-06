package resource

import (
	"context"
	"fmt"

	"github.com/omniview/kubernetes/pkg/plugin/helm"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniview/kubernetes/pkg/plugin/resource/resourcers"
	"github.com/omniview/kubernetes/pkg/plugin/resource/resourcers/extras/benchmark"
	oldtypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	v1plugin "github.com/omniviewdev/plugin-sdk/pkg/v1/resource/plugin"
	"go.uber.org/zap"
)

// Register registers the v1 resource plugin with the plugin server.
func Register(plugin *sdk.Plugin) {
	logger := zap.S()

	connProvider := &kubeConnectionProvider{logger: logger}

	registrations := buildRegistrations(logger)

	// Add Helm registrations.
	helmSvc := helm.NewHelmService()
	helmDefs := helm.HelmResourceDefinitions()
	for meta, res := range helm.HelmResourcers(logger, helmSvc) {
		def := helmDefs[meta.String()]
		registrations = append(registrations, resource.ResourceRegistration[clients.ClientSet]{
			Meta:       meta,
			Resourcer:  res,
			Definition: &def,
		})
	}

	cfg := resource.ResourcePluginConfig[clients.ClientSet]{
		Connections:       connProvider,
		Resources:         registrations,
		Patterns:          map[string]resource.Resourcer[clients.ClientSet]{"*": resourcers.NewKubernetesPatternResourcer(logger)},
		Groups:            ResourceGroups,
		DefaultDefinition: convertDefinition(resourcers.DefaultResourceDef),
		Discovery:         &kubeDiscoveryProvider{logger: logger},
		ErrorClassifier:   &kubeErrorClassifier{},
	}

	controller, err := resource.BuildResourceController(context.Background(), cfg)
	if err != nil {
		panic(fmt.Sprintf("failed to build resource controller: %v", err))
	}

	plugin.RegisterCapability("resource", &v1plugin.GRPCPlugin{
		Impl:            controller,
		SettingsProvider: plugin.SettingsProvider,
	})
}

// buildRegistrations creates resource registrations from the static resourceMap.
// Specialized resourcers override the base resourcer for specific resource types.
func buildRegistrations(logger *zap.SugaredLogger) []resource.ResourceRegistration[clients.ClientSet] {
	// Map of resource keys to specialized resourcers.
	specialized := map[string]resource.Resourcer[clients.ClientSet]{
		"core::v1::Node":        resourcers.NewNodeResourcer(logger),
		"core::v1::Pod":         resourcers.NewPodResourcer(logger),
		"apps::v1::Deployment":  resourcers.NewDeploymentResourcer(logger),
		"apps::v1::DaemonSet":   resourcers.NewDaemonSetResourcer(logger),
		"apps::v1::StatefulSet": resourcers.NewStatefulSetResourcer(logger),
	}

	// Resources that should use SyncNever policy.
	// Includes events (too noisy) and create-only/virtual APIs that don't support LIST/WATCH.
	syncNeverKeys := map[string]bool{
		"core::v1::Event":                                 true,
		"core::v1::Binding":                               true,
		"core::v1::ComponentStatus":                       true,
		"core::v1::Status":                                true,
		"authentication::v1::TokenReview":                  true,
		"authentication::v1::TokenRequest":                 true,
		"authentication::v1::SelfSubjectReview":            true,
		"authentication::v1beta1::SelfSubjectReview":       true,
		"authorization::v1::SubjectAccessReview":           true,
		"authorization::v1::SelfSubjectAccessReview":       true,
		"authorization::v1::SelfSubjectRulesReview":        true,
		"authorization::v1::LocalSubjectAccessReview":      true,
		"autoscaling::v1::Scale":                           true,
		"policy::v1::Eviction":                             true,
	}

	registrations := make([]resource.ResourceRegistration[clients.ClientSet], 0, len(resourceMap)+1)

	// Add the benchmark resource (not in resourceMap).
	registrations = append(registrations, resource.ResourceRegistration[clients.ClientSet]{
		Meta: resource.ResourceMeta{
			Group:       "extras",
			Version:     "v1",
			Kind:        "ClusterBenchmark",
			Description: "ClusterBenchmark shows information on the configuration of a cluster",
		},
		Resourcer: &benchmark.ClusterBenchmarker{},
	})

	// Build registrations from the static resource map.
	for key, gvr := range resourceMap {
		meta := resource.ResourceMetaFromString(key)

		var res resource.Resourcer[clients.ClientSet]
		if s, ok := specialized[key]; ok {
			res = s
		} else {
			var opts []resourcers.Option
			if syncNeverKeys[key] {
				opts = append(opts, resourcers.WithSyncPolicy(resource.SyncNever))
			}
			res = resourcers.NewKubernetesResourcerBase[resourcers.MetaAccessor](logger, gvr, opts...)
		}

		reg := resource.ResourceRegistration[clients.ClientSet]{
			Meta:      meta,
			Resourcer: res,
		}

		// Attach definition if available.
		if def, ok := resourcers.ResourceDefs[key]; ok {
			v1def := convertDefinition(def)
			reg.Definition = &v1def
		}

		registrations = append(registrations, reg)
	}

	return registrations
}

// convertDefinition converts an old SDK ResourceDefinition to a v1 ResourceDefinition.
func convertDefinition(old oldtypes.ResourceDefinition) resource.ResourceDefinition {
	cols := make([]resource.ColumnDefinition, len(old.ColumnDefs))
	for i, c := range old.ColumnDefs {
		cols[i] = resource.ColumnDefinition{
			ID:               c.ID,
			Header:           c.Header,
			Accessors:        c.Accessors,
			AccessorPriority: string(c.AccessorPriority),
			ColorMap:         c.ColorMap,
			Color:            string(c.Color),
			Alignment:        string(c.Alignment),
			Hidden:           c.Hidden,
			Width:            c.Width,
			Formatter:        string(c.Formatter),
			Component:        c.Component,
			ComponentParams:  c.ComponentParams,
			ValueMap:         c.ValueMap,
		}
	}
	return resource.ResourceDefinition{
		IDAccessor:        old.IDAccessor,
		NamespaceAccessor: old.NamespaceAccessor,
		MemoizerAccessor:  old.MemoizerAccessor,
		ColumnDefs:        cols,
	}
}
