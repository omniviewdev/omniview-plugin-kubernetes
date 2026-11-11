package resource

import (
	"context"
	"github.com/omniview/kubernetes/pkg/plugin/helm"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniview/kubernetes/pkg/plugin/resource/resourcers"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"sort"
)

func (p *kubernetesProvider) GetSchemaDocument(ctx context.Context, route resourcev2.AccessRoute, reference resourcev2.SchemaDocumentReference) (document resourcev2.SchemaDocument, err error) {
	err = p.WithClient(ctx, route, func(ctx context.Context, _ *clients.ClientSet) error {
		p.mu.RLock()
		defer p.mu.RUnlock()
		snapshot := p.catalogs[route.Connection]
		if snapshot == nil || snapshot.schemas == nil || snapshot.schemas.ctx.Err() != nil {
			return resourcev2.NewError("RESET_REQUIRED", "Native schema generation is not available")
		}
		for gv, entry := range snapshot.schemas.entries {
			if entry.lease != nil && reference.ID == "kubernetes.openapi.v3/"+gv.String() && reference.Revision == entry.document.Revision {
				document = resourcev2.SchemaDocument{Reference: reference, Dialect: resourcev2.DialectOpenAPI30, Document: entry.document.Document}
				return ctx.Err()
			}
		}
		return resourcev2.NewError("RESET_REQUIRED", "The exact demanded schema document is not held by this connection")
	})
	return document, err
}

func (p *kubernetesProvider) ResolveSchema(ctx context.Context, request resourcev2.SchemaRequest) (binding resourcev2.SchemaBinding, err error) {
	if err := resourcev2.ValidateSchemaRequest(request); err != nil {
		return binding, err
	}
	err = p.WithClient(ctx, request.Route, func(ctx context.Context, client *clients.ClientSet) error {
		p.mu.Lock()
		snapshot := p.catalogs[request.Route.Connection]
		if snapshot == nil {
			p.mu.Unlock()
			return resourcev2.NewError("UNAVAILABLE", "Connection catalog is not available")
		}
		if snapshot.schemas == nil {
			snapshot.schemas = newNativeSchemaState(ctx)
		}
		state := snapshot.schemas
		served, native, admissionErr := admitNativeSchemaTarget(snapshot, request)
		p.mu.Unlock()
		if admissionErr != nil {
			return admissionErr
		}
		if request.Target.Auxiliary != nil {
			binding, err = p.helmAncillary.ResolveSchema(ctx, client, request)
		} else if native {
			binding, err = p.resolveNativeSchema(ctx, request, served, state)
		} else {
			binding = resourcev2.SchemaBinding{State: "absent"}
		}
		if err != nil {
			if canceled := ctx.Err(); canceled != nil {
				return canceled
			}
			if classified := classifyResourceError(err); classified != nil {
				return classified
			}
			return err
		}
		p.mu.RLock()
		defer p.mu.RUnlock()
		current := p.catalogs[request.Route.Connection]
		if current == nil || current.schemas != state || state.ctx.Err() != nil {
			return resourcev2.NewError("RESET_REQUIRED", "Native schema generation was retired")
		}
		currentServed, currentNative, err := admitNativeSchemaTarget(current, request)
		if err != nil || currentNative != native || currentServed.GVR != served.GVR || currentServed.API.Kind != served.API.Kind {
			return resourcev2.NewError("RESET_REQUIRED", "Native schema target changed during acquisition")
		}
		return ctx.Err()
	})
	if err != nil {
		return resourcev2.SchemaBinding{}, err
	}
	return binding, nil
}

func admitNativeSchemaTarget(snapshot *nativeCatalogSnapshot, request resourcev2.SchemaRequest) (nativeServedType, bool, error) {
	for _, descriptor := range snapshot.catalog.Types {
		if descriptor.Type != request.Type {
			continue
		}
		if request.Target.Auxiliary != nil {
			if request.Type != helm.ReleaseType || request.Target.Auxiliary.Key != "values" {
				return nativeServedType{}, false, resourcev2.NewError("UNSUPPORTED", "Resource type does not provide this auxiliary schema")
			}
			if _, err := resourcev2.AdmitCatalogOperation(snapshot.catalog, resourcev2.GetRequest{
				Route: request.Route, Reference: request.Target.Auxiliary.Reference,
				Representation: descriptor.DefaultRepresentation,
			}); err != nil {
				return nativeServedType{}, false, err
			}
			return nativeServedType{}, false, nil
		}
		for _, representation := range descriptor.Representations {
			if representation != *request.Target.Representation {
				continue
			}
			native, exists := snapshot.bindings[request.Type]
			if !exists {
				return nativeServedType{}, false, nil
			}
			for _, served := range nativeServedVersions(native) {
				gv := served.GVR.GroupVersion().String()
				if len(native.Served) == 0 || representation.ID == nativeRepresentationVersion+"/"+gv || representation.ID == nativeModelRepresentationVersion+"/"+gv {
					return served, true, nil
				}
			}
		}
		return nativeServedType{}, false, resourcev2.NewError("RESET_REQUIRED", "The exact schema representation is not current")
	}
	return nativeServedType{}, false, resourcev2.NewError("NOT_FOUND", "Resource type is not present in this connection catalog")
}

func (p *kubernetesProvider) GetResourceDefinition(ctx context.Context, route resourcev2.AccessRoute, token string) (definition resourcev2.ResourceDefinition, err error) {
	err = p.WithClient(ctx, route, func(_ context.Context, _ *clients.ClientSet) error {
		snapshot, err := p.snapshot(route)
		if err != nil {
			return err
		}
		if helmDefinition, ok := p.helmDefinitions[token]; ok {
			definition = helmDefinition
			return nil
		}
		if token == auditType {
			definition = resourcers.DefaultResourceDef
			return nil
		}
		if _, ok := snapshot.bindings[token]; !ok {
			return resourcev2.NewError("NOT_FOUND", "Resource type is not present in this connection catalog")
		}
		definition, _ = resourcers.ResourceDefs[token]
		if len(definition.ColumnDefs) == 0 {
			definition = resourcers.DefaultResourceDef
		}
		return nil
	})
	return definition, err
}

func nativeGroupDisplayID(group string) string {
	switch group {
	case "":
		return "core"
	case "apps", "batch", "policy":
		return group
	case "admissionregistration.k8s.io":
		return "admissionregistration"
	case "apiextensions.k8s.io":
		return "apiextensions"
	case "apiregistration.k8s.io":
		return "apiregistration"
	case "autoscaling":
		return "autoscaling"
	case "authentication.k8s.io":
		return "authentication"
	case "authorization.k8s.io":
		return "authorization"
	case "certificates.k8s.io":
		return "certificates"
	case "coordination.k8s.io":
		return "coordination"
	case "discovery.k8s.io":
		return "discovery"
	case "events.k8s.io":
		return "events"
	case "flowcontrol.apiserver.k8s.io":
		return "flowcontrol"
	case "internal.apiserver.k8s.io":
		return "apiserverinternal"
	case "metrics.k8s.io":
		return "metrics"
	case "networking.k8s.io":
		return "networking"
	case "node.k8s.io":
		return "node"
	case "rbac.authorization.k8s.io":
		return "rbac"
	case "resource.k8s.io":
		return "resource"
	case "scheduling.k8s.io":
		return "scheduling"
	case "storage.k8s.io":
		return "storage"
	default:
		return ""
	}
}

func (p *kubernetesProvider) GetResourceGroups(ctx context.Context, route resourcev2.AccessRoute) (groups []resourcev2.ResourceGroup, err error) {
	err = p.WithClient(ctx, route, func(_ context.Context, _ *clients.ClientSet) error {
		snapshot, err := p.snapshot(route)
		if err != nil {
			return err
		}
		presentations := make(map[string]resourcev2.ResourceGroup, len(ResourceGroups))
		for _, group := range ResourceGroups {
			presentations[group.ID] = group
		}
		byID := make(map[string]resourcev2.ResourceGroup)
		for token, binding := range snapshot.bindings {
			id := "k8s:" + binding.GVR.Group
			group, exists := byID[id]
			if !exists {
				group = presentations[nativeGroupDisplayID(binding.GVR.Group)]
				group.ID = id
				if group.Name == "" {
					group.Name = binding.GVR.Group
				}
				group.Resources = []string{}
			}
			group.Resources = append(group.Resources, token)
			byID[id] = group
		}
		helmGroup := helm.HelmResourceGroup()
		helmGroup.ID = "helm:"
		byID[helmGroup.ID] = helmGroup
		byID["audit:"] = resourcev2.ResourceGroup{ID: "audit:", Name: "Audits", Resources: []string{auditType}}
		for _, group := range byID {
			if len(group.Resources) != 0 {
				sort.Strings(group.Resources)
				groups = append(groups, group)
			}
		}
		sort.Slice(groups, func(i, j int) bool { return groups[i].ID < groups[j].ID })
		return nil
	})
	return groups, err
}
