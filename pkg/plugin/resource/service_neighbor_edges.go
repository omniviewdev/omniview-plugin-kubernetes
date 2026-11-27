package resource

import (
	"cmp"
	"net/netip"
	"slices"
	"strings"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/util/validation"
)

const (
	serviceNeighborsOperation = "kubernetes/service-neighbors@1"
	neighborServiceType       = "k8s:/services"
	neighborIngressType       = "k8s:networking.k8s.io/ingresses"
	neighborSliceType         = "k8s:discovery.k8s.io/endpointslices"
	neighborPodType           = "k8s:/pods"
	neighborCandidateLimit    = 129 // the broker may prove one authorized overflow row
)

type neighborRecord struct {
	metav1.TypeMeta
	Metadata struct {
		Name, Namespace, UID, ResourceVersion string
		Labels                                map[string]string
		OwnerReferences                       []metav1.OwnerReference
	} `json:"metadata"`
}

// The list envelope establishes type/version when Kubernetes omits item GVKs.
func (r *neighborRecord) valid(version, kind, namespace string) bool {
	return (r.APIVersion == "" || r.APIVersion == version) && (r.Kind == "" || r.Kind == kind) &&
		r.Metadata.Namespace == namespace && len(validation.IsDNS1123Subdomain(r.Metadata.Name)) == 0 &&
		r.Metadata.UID != "" && len(r.Metadata.UID) <= 256
}

type neighborService struct {
	neighborRecord
	Spec struct {
		Type         corev1.ServiceType
		Selector     map[string]string
		ExternalName string
	}
}

type neighborIngress struct {
	neighborRecord
	Spec struct {
		DefaultBackend *networkingv1.IngressBackend
		Rules          []networkingv1.IngressRule
	}
}

type neighborSlice struct {
	neighborRecord
	AddressType discoveryv1.AddressType
	Endpoints   []struct {
		Addresses []string
		TargetRef *corev1.ObjectReference
	}
}

// These constants follow the public lexicographic order (direction, relation,
// kind). Namespace is fixed for the read; name follows, then fixed evidence.
type serviceEdgeKind uint8

const (
	publishesFor serviceEdgeKind = iota
	routesTo
	aliases
	endpointAddress
	endpointPod
	selectsPod
)

var serviceEdgeFields = [...]struct{ direction, relation, kind, evidence string }{
	publishesFor:    {"inbound", "publishes-for", "EndpointSlice", "slice-service-name"},
	routesTo:        {"inbound", "routes-to", "Ingress", "ingress-backend"},
	aliases:         {"outbound", "aliases", "DNSName", "external-name"},
	endpointAddress: {"outbound", "has-endpoint", "EndpointAddress", "slice-address"},
	endpointPod:     {"outbound", "has-endpoint", "Pod", "slice-target"},
	selectsPod:      {"outbound", "selects", "Pod", "service-selector"},
}

type neighborObjectID struct{ typeID, name, uid string }

type serviceEdge struct {
	kind            serviceEdgeKind
	name            string
	proof, neighbor neighborObjectID
}

type endpointTarget struct {
	name, uid string
	slice     neighborObjectID
}

type neighborSnapshot struct {
	root      resourcev2.ResourceReference
	namespace string
	authority map[string]string // each source has its own broker-issued authority
	examined  map[string]bool
	selector  labels.Selector // nil means no Pod selection, never everything
	external  bool
	partial   bool
	edges     []serviceEdge
	targets   []endpointTarget
	pods      map[string]string // only live Pod reads in this demand, at most 8 * 64
}

func earlierProof(a, b neighborObjectID) bool {
	return a.name < b.name || (a.name == b.name && a.uid < b.uid)
}

func (s *neighborSnapshot) addEdge(kind serviceEdgeKind, name string, proof, neighbor neighborObjectID) {
	edge := serviceEdge{kind: kind, name: name, proof: proof, neighbor: neighbor}
	i, found := slices.BinarySearchFunc(s.edges, edge, func(a, b serviceEdge) int {
		if a.kind != b.kind {
			return cmp.Compare(a.kind, b.kind)
		}
		return strings.Compare(a.name, b.name)
	})
	if found {
		if earlierProof(proof, s.edges[i].proof) {
			s.edges[i] = edge
		}
		return
	}
	if len(s.edges) == neighborCandidateLimit {
		// The host, not the provider, decides which overflow is authorized. It
		// cannot examine more than these candidates, so do not claim completeness.
		s.partial = true
		if i == len(s.edges) {
			return
		}
		s.edges = s.edges[:len(s.edges)-1]
	}
	s.edges = slices.Insert(s.edges, i, edge)
}

func (s *neighborSnapshot) addTarget(ref *corev1.ObjectReference, slice neighborObjectID) {
	if ref.Kind != "Pod" || (ref.APIVersion != "" && ref.APIVersion != "v1") || ref.Namespace != s.namespace ||
		len(validation.IsDNS1123Subdomain(ref.Name)) != 0 || ref.UID == "" || len(ref.UID) > 256 {
		return
	}
	target := endpointTarget{name: ref.Name, uid: string(ref.UID), slice: slice}
	i, found := slices.BinarySearchFunc(s.targets, target, func(a, b endpointTarget) int {
		if a.name != b.name {
			return strings.Compare(a.name, b.name)
		}
		return strings.Compare(a.uid, b.uid)
	})
	if found {
		if earlierProof(slice, s.targets[i].slice) {
			s.targets[i].slice = slice
		}
		return
	}
	if len(s.targets) == neighborCandidateLimit {
		s.partial = true // additional proposed (not yet authorized) joins
		if i == len(s.targets) {
			return
		}
		s.targets = s.targets[:len(s.targets)-1]
	}
	s.targets = slices.Insert(s.targets, i, target)
}

func (s *neighborSnapshot) rootID() neighborObjectID {
	return neighborObjectID{neighborServiceType, s.root.Address.ID, *s.root.Incarnation}
}

func (s *neighborSnapshot) ingress(obj *neighborIngress) {
	if !obj.valid("networking.k8s.io/v1", "Ingress", s.namespace) {
		s.partial = true
		return
	}
	matches := func(b *networkingv1.IngressBackend) bool {
		return b != nil && b.Resource == nil && b.Service != nil && b.Service.Name == s.root.Address.ID
	}
	found := matches(obj.Spec.DefaultBackend)
	for i := range obj.Spec.Rules {
		if found {
			break
		}
		if http := obj.Spec.Rules[i].HTTP; http != nil {
			for j := range http.Paths {
				if matches(&http.Paths[j].Backend) {
					found = true
					break
				}
			}
		}
	}
	if found {
		ref := neighborObjectID{neighborIngressType, obj.Metadata.Name, obj.Metadata.UID}
		s.addEdge(routesTo, ref.name, ref, ref)
	}
}

func neighborDNSName(name string) bool {
	return len(validation.IsDNS1123Subdomain(strings.TrimSuffix(name, "."))) == 0
}

func neighborAddress(t discoveryv1.AddressType, literal string) bool {
	if t == discoveryv1.AddressTypeFQDN {
		return neighborDNSName(literal)
	}
	ip, err := netip.ParseAddr(literal)
	return err == nil && ip.Zone() == "" && ((t == discoveryv1.AddressTypeIPv4 && ip.Is4()) || (t == discoveryv1.AddressTypeIPv6 && ip.Is6()))
}

func (s *neighborSnapshot) slice(obj *neighborSlice) {
	if !obj.valid("discovery.k8s.io/v1", "EndpointSlice", s.namespace) {
		s.partial = true
		return
	}
	if obj.Metadata.Labels[discoveryv1.LabelServiceName] != s.root.Address.ID {
		return
	}
	for _, owner := range obj.Metadata.OwnerReferences {
		if owner.Kind == "Service" && (owner.APIVersion != "v1" || owner.Name != s.root.Address.ID || string(owner.UID) != *s.root.Incarnation) {
			return
		}
	}
	ref := neighborObjectID{neighborSliceType, obj.Metadata.Name, obj.Metadata.UID}
	s.addEdge(publishesFor, ref.name, ref, ref)
	if s.external {
		return // an ExternalName is an alias, not a forwarding Service
	}
	for _, ep := range obj.Endpoints {
		if ep.TargetRef != nil {
			if s.authority[neighborPodType] != "" {
				s.addTarget(ep.TargetRef, ref)
			}
			continue // a stale, foreign or unreadable ref must never disclose its address
		}
		for _, address := range ep.Addresses {
			if neighborAddress(obj.AddressType, address) {
				s.addEdge(endpointAddress, address, ref, neighborObjectID{})
			}
		}
	}
}

func (s *neighborSnapshot) selectedPod(obj *neighborRecord) {
	if !obj.valid("meta.k8s.io/v1", "PartialObjectMetadata", s.namespace) {
		s.partial = true
		return
	}
	if s.selector == nil || !s.selector.Matches(labels.Set(obj.Metadata.Labels)) {
		return
	}
	ref := neighborObjectID{neighborPodType, obj.Metadata.Name, obj.Metadata.UID}
	s.pods[ref.name] = ref.uid
	s.addEdge(selectsPod, ref.name, s.rootID(), ref)
}

func (s *neighborSnapshot) reference(id neighborObjectID) resourcev2.ResourceReference {
	if id.typeID == neighborServiceType {
		return s.root
	}
	uid := id.uid
	return resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
		Provider: s.root.Address.Provider, Authority: s.authority[id.typeID], Type: id.typeID, ID: id.name, Scope: s.root.Address.Scope,
	}, Incarnation: &uid}
}

func (s *neighborSnapshot) page() resourcev2.RelatedReadPage {
	result := resourcev2.RelatedReadPage{Coverage: "complete", Rows: make([]resourcev2.RelatedReadCandidate, len(s.edges))}
	for _, family := range []string{neighborServiceType, neighborIngressType, neighborSliceType, neighborPodType} {
		if s.examined[family] {
			result.Sources = append(result.Sources, family)
		} else {
			result.Coverage = "partial"
		}
	}
	if s.partial {
		result.Coverage = "partial"
	}
	for i, e := range s.edges {
		v := serviceEdgeFields[e.kind]
		row := &result.Rows[i]
		row.Row = map[string]any{"direction": v.direction, "relation": v.relation, "kind": v.kind, "namespace": s.namespace, "name": e.name, "evidence": v.evidence}
		row.Evidence = []resourcev2.ResourceReference{s.reference(e.proof)}
		if e.neighbor.typeID != "" {
			if e.neighbor != e.proof {
				row.Evidence = append(row.Evidence, s.reference(e.neighbor))
			}
			row.Neighbor = &row.Evidence[len(row.Evidence)-1]
		}
	}
	return result
}
