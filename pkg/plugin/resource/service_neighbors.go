package resource

import (
	"context"
	"slices"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniview/kubernetes/pkg/pluginid"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/util/validation"
)

// readServiceNeighbors is registered only on a core Service. SDK admission
// binds the operation to this connection generation; the broker supplies the
// independently admitted source targets. No request contains a peer query.
func readServiceNeighbors(ctx context.Context, client *clients.ClientSet, req resourcev2.RelatedReadRequest) (resourcev2.RelatedReadPage, error) {
	var empty resourcev2.RelatedReadPage
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	s, err := newNeighborSnapshot(req)
	if err != nil {
		return empty, err
	}
	a, err := newNeighborAPI(client)
	if err != nil {
		return empty, err
	}
	core := "/api/v1/namespaces/" + s.namespace + "/"
	rootPath := core + "services/" + req.Root.Address.ID
	var service neighborService
	if err := a.get(ctx, rootPath, "application/json", nil, &service); err != nil {
		return empty, err
	}
	if !s.isRoot(&service.neighborRecord) {
		return empty, resourcev2.NewError("RESET_REQUIRED", "The selected Service is no longer current")
	}
	s.examined[neighborServiceType] = true
	switch service.Spec.Type {
	case corev1.ServiceTypeExternalName:
		s.external = true
		if !neighborDNSName(service.Spec.ExternalName) {
			return empty, errNeighborResponse
		}
		s.addEdge(aliases, service.Spec.ExternalName, s.rootID(), neighborObjectID{})
	case "", corev1.ServiceTypeClusterIP, corev1.ServiceTypeNodePort, corev1.ServiceTypeLoadBalancer:
		// ClusterIP: None does not affect selection. metadata.labels is not a selector.
		if len(service.Spec.Selector) != 0 {
			s.selector, err = labels.ValidatedSelectorFromSet(service.Spec.Selector)
			if err != nil {
				return empty, errNeighborResponse
			}
		}
	default:
		return empty, resourcev2.NewError("UNSUPPORTED", "Unsupported Kubernetes Service type")
	}

	// Reserve a final exact root GET before acquiring any source. If the root
	// grows or changes during the snapshot, withholding the result is safe.
	reserveBytes := neighborBytes - a.bytes + 1
	if reserveBytes > a.bytes {
		return empty, errNeighborBudget
	}
	a.calls--
	a.bytes -= reserveBytes
	var sourceFailed bool
	if len(s.authority) > 1 {
		rules, err := a.namespaceRules(ctx, s.namespace)
		if ctx.Err() != nil {
			return empty, ctx.Err()
		}
		sourceFailed = err != nil && resourcev2.ErrorCode(err) != "PERMISSION_DENIED"
		for _, family := range []struct{ id, group, resource string }{
			{neighborIngressType, "networking.k8s.io", "ingresses"},
			{neighborSliceType, "discovery.k8s.io", "endpointslices"},
			{neighborPodType, "", "pods"},
		} {
			// Decide before seeing any candidates. A hidden object must not
			// affect coverage, consume a lookup or displace an admitted edge.
			if !namespaceGet(rules, family.group, family.resource) {
				delete(s.authority, family.id)
			}
		}
	}
	pagers := []neighborPager{
		{typeID: neighborIngressType, path: "/apis/networking.k8s.io/v1/namespaces/" + s.namespace + "/ingresses", page: neighborList("networking.k8s.io/v1", "Ingress", "application/json", s.ingress)},
		{typeID: neighborSliceType, path: "/apis/discovery.k8s.io/v1/namespaces/" + s.namespace + "/endpointslices", selector: discoveryv1.LabelServiceName + "=" + req.Root.Address.ID, page: neighborList("discovery.k8s.io/v1", "EndpointSlice", "application/json", s.slice)},
	}
	if s.selector != nil {
		pagers = append(pagers, neighborPager{typeID: neighborPodType, path: core + "pods", selector: s.selector.String(), page: neighborList("meta.k8s.io/v1", "PartialObjectMetadata", metadataListMediaType, s.selectedPod)})
	}
	// Give each admitted source its first page before continuing any other
	// collection. An RBAC failure in one family grants no fallback read.
	for {
		more := false
		for i := range pagers {
			p := &pagers[i]
			if p.done || s.authority[p.typeID] == "" {
				continue
			}
			if a.calls == 0 || a.bytes == 0 {
				s.partial = true
				sourceFailed = true
				continue
			}
			if err := p.read(ctx, a); err != nil {
				if ctx.Err() != nil {
					return empty, ctx.Err()
				}
				s.partial = true
				sourceFailed = sourceFailed || resourcev2.ErrorCode(err) != "PERMISSION_DENIED"
				continue
			}
			s.examined[p.typeID] = true
			more = more || !p.done
		}
		if !more {
			break
		}
	}
	if s.authority[neighborPodType] != "" {
		// A readable slice collection supplies the possible Pod joins. Mark
		// the family independently of a target's existence, UID or GET status.
		// An absent selector never causes a namespace-wide Pod LIST.
		if s.external || s.examined[neighborSliceType] {
			s.examined[neighborPodType] = true
		}
		if err := s.resolveTargets(ctx, a, core+"pods/"); err != nil {
			return empty, err
		}
	}
	if !s.external && !s.examined[neighborIngressType] && !s.examined[neighborSliceType] && !s.examined[neighborPodType] {
		if sourceFailed {
			return empty, errNeighborResponse
		}
		return empty, resourcev2.NewError("PERMISSION_DENIED", "No Service neighbor evidence is available")
	}
	a.calls++
	a.bytes += reserveBytes
	var current neighborRecord
	if err := a.get(ctx, rootPath, "application/json", nil, &current); err != nil {
		return empty, err
	}
	if !s.isRoot(&current) || current.Metadata.ResourceVersion != service.Metadata.ResourceVersion {
		return empty, resourcev2.NewError("RESET_REQUIRED", "The selected Service changed during the read")
	}
	result := s.page()
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return result, nil
}

func namespaceGet(rules []authorizationv1.ResourceRule, group, resource string) bool {
	has := func(values []string, exact string) bool {
		return slices.Contains(values, exact) || slices.Contains(values, "*")
	}
	for i := range rules {
		r := &rules[i]
		if len(r.ResourceNames) == 0 && has(r.Verbs, "get") && has(r.APIGroups, group) && has(r.Resources, resource) {
			return true
		}
	}
	return false
}

func newNeighborSnapshot(req resourcev2.RelatedReadRequest) (*neighborSnapshot, error) {
	r := req.Root
	ns, err := nativeIdentityNamespace(r.Address.Scope, true)
	if err != nil || req.Operation != serviceNeighborsOperation || req.Route.Connection == "" ||
		r.Address.Provider != pluginid.ResourceProvider || r.Address.Type != neighborServiceType || r.Address.Authority == "" ||
		len(validation.IsDNS1123Label(ns)) != 0 || len(validation.IsDNS1123Label(r.Address.ID)) != 0 ||
		r.Incarnation == nil || *r.Incarnation == "" || len(*r.Incarnation) > 256 {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Service neighbors requires an exact namespaced Service incarnation")
	}
	// Keep the returned citations independent of the SDK's borrowed input.
	uid := *r.Incarnation
	r.Incarnation = &uid
	r.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "namespace", Value: ns}}
	s := &neighborSnapshot{root: r, namespace: ns, authority: make(map[string]string, 4), examined: make(map[string]bool, 4), pods: make(map[string]string)}
	for _, t := range req.Sources {
		validType := t.Type == neighborServiceType || t.Type == neighborIngressType || t.Type == neighborSliceType || t.Type == neighborPodType
		selection, err := nativeQuerySelection(t.Scope, true)
		if !validType || s.authority[t.Type] != "" || t.Route != req.Route || t.Provider != r.Address.Provider || t.Authority == "" ||
			err != nil || len(selection.namespaces) != 1 || selection.namespaces[0] != ns ||
			(selection.names != nil && (t.Type != neighborServiceType || len(selection.names) != 1 || selection.names[0] != r.Address.ID)) ||
			(t.Type == neighborServiceType && t.Authority != r.Address.Authority) {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Invalid admitted Service neighbor scope")
		}
		s.authority[t.Type] = t.Authority
	}
	if s.authority[neighborServiceType] == "" {
		return nil, resourcev2.NewError("PERMISSION_DENIED", "The Service root is not admitted")
	}
	return s, nil
}

func (s *neighborSnapshot) isRoot(r *neighborRecord) bool {
	return r.APIVersion == "v1" && r.Kind == "Service" && r.Metadata.Name == s.root.Address.ID &&
		r.Metadata.Namespace == s.namespace && r.Metadata.UID == *s.root.Incarnation && r.Metadata.ResourceVersion != ""
}

func (s *neighborSnapshot) resolveTargets(ctx context.Context, a *neighborAPI, podPath string) error {
	// References are sorted and deduplicated. An unknown name costs at most
	// one GET, even for overlapping slices or several claimed UIDs. Lookups
	// spend the same call/byte budget as the paged acquisitions.
	for _, target := range s.targets {
		if err := ctx.Err(); err != nil {
			return err
		}
		uid, checked := s.pods[target.name]
		if !checked {
			if a.calls == 0 || a.bytes == 0 {
				s.partial = true
				continue // later targets can still match Pods in the authorized list
			}
			var pod neighborRecord
			err := a.get(ctx, podPath+target.name, metadataMediaType, nil, &pod)
			switch {
			case ctx.Err() != nil:
				return ctx.Err()
			case resourcev2.ErrorCode(err) == "NOT_FOUND", resourcev2.ErrorCode(err) == "PERMISSION_DENIED":
				// Neither is an authorized neighbor or grants an address
				// fallback. Do not expose which response the API supplied.
			case err != nil || pod.APIVersion != "meta.k8s.io/v1" || pod.Kind != "PartialObjectMetadata" || !pod.valid("meta.k8s.io/v1", "PartialObjectMetadata", s.namespace) || pod.Metadata.Name != target.name:
				s.partial = true
			default:
				uid = pod.Metadata.UID
			}
			s.pods[target.name] = uid
		}
		if uid == target.uid {
			s.addEdge(endpointPod, target.name, target.slice, neighborObjectID{neighborPodType, target.name, uid})
		}
	}
	return nil
}
