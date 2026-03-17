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
		def, ok := helmDefs[meta.String()]
		if !ok {
			logger.Warnf("no helm definition found for %s, skipping registration", meta.String())
			continue
		}
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
	// Load centralized relationship table.
	relTable := resourcers.RelationshipTable()

	// Map of resource keys to specialized resourcers.
	// Use comma-ok to avoid passing zero-value slices if a key is missing from the table.
	specialized := make(map[string]resource.Resourcer[clients.ClientSet])
	for key, constructor := range map[string]func(*zap.SugaredLogger, ...resourcers.Option) resource.Resourcer[clients.ClientSet]{
		"core::v1::Node":        func(l *zap.SugaredLogger, o ...resourcers.Option) resource.Resourcer[clients.ClientSet] { return resourcers.NewNodeResourcer(l, o...) },
		"core::v1::Pod":         func(l *zap.SugaredLogger, o ...resourcers.Option) resource.Resourcer[clients.ClientSet] { return resourcers.NewPodResourcer(l, o...) },
		"apps::v1::Deployment":  func(l *zap.SugaredLogger, o ...resourcers.Option) resource.Resourcer[clients.ClientSet] { return resourcers.NewDeploymentResourcer(l, o...) },
		"apps::v1::DaemonSet":   func(l *zap.SugaredLogger, o ...resourcers.Option) resource.Resourcer[clients.ClientSet] { return resourcers.NewDaemonSetResourcer(l, o...) },
		"apps::v1::StatefulSet":                        func(l *zap.SugaredLogger, o ...resourcers.Option) resource.Resourcer[clients.ClientSet] { return resourcers.NewStatefulSetResourcer(l, o...) },
		"autoscaling::v2::HorizontalPodAutoscaler":     func(l *zap.SugaredLogger, o ...resourcers.Option) resource.Resourcer[clients.ClientSet] { return resourcers.NewHPAResourcer(l, o...) },
		"rbac::v1::RoleBinding":                         func(l *zap.SugaredLogger, o ...resourcers.Option) resource.Resourcer[clients.ClientSet] { return resourcers.NewRoleBindingResourcer(l, o...) },
	} {
		var opts []resourcers.Option
		if rels, ok := relTable[key]; ok {
			opts = append(opts, resourcers.WithRelationships(rels))
		}
		specialized[key] = constructor(logger, opts...)
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
			if rels, ok := relTable[key]; ok {
				opts = append(opts, resourcers.WithRelationships(rels))
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
