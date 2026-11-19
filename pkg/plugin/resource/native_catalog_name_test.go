package resource

import (
	"context"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/helm"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/discovery/fake"
	clienttesting "k8s.io/client-go/testing"
)

// A page of one object needs a live read narrowed to that object. The catalog says so: the name is a query dimension of every native kind, with
// every operation (the source above all) declared over any name. These tests ask the SDK's own admission, the one the host runs, whether a
// narrowed read is admitted, so they cover the contract and not only the shape of the descriptor.

func nameCatalog(t *testing.T, watchScope resourcev2.QueryScope) (*kubernetesProvider, *nativeCatalogSnapshot) {
	t.Helper()
	discovery := &fake.FakeDiscovery{Fake: &clienttesting.Fake{Resources: []*metav1.APIResourceList{
		{GroupVersion: "v1", APIResources: []metav1.APIResource{
			{Name: "pods", Kind: "Pod", Namespaced: true, Verbs: metav1.Verbs{"get", "list", "watch", "create", "update", "delete"}},
			{Name: "nodes", Kind: "Node", Verbs: metav1.Verbs{"get", "list", "watch", "update"}},
		}},
		{GroupVersion: "sample.example/v1", APIResources: []metav1.APIResource{
			{Name: "widgets", Kind: "Widget", Namespaced: true, Verbs: metav1.Verbs{"get", "list", "watch"}},
			{Name: "clusterwidgets", Kind: "ClusterWidget", Verbs: metav1.Verbs{"get", "list", "watch"}},
		}},
	}}}
	bindings, coverage, err := discoverNativeTypes(context.Background(), discovery)
	require.NoError(t, err)
	provider := &kubernetesProvider{logger: zap.NewNop().Sugar(), helmTypes: helm.HelmResourceTypes()}
	snapshot, err := provider.assembleNativeCatalog(context.Background(), "route", &clients.ClientSet{}, bindings, coverage, nil, watchScope)
	require.NoError(t, err)
	require.NoError(t, resourcev2.ValidateCatalog(snapshot.catalog))
	return provider, snapshot
}

func nameTarget(snapshot *nativeCatalogSnapshot, token string, scope resourcev2.QueryScope) resourcev2.ReadTarget {
	return resourcev2.ReadTarget{
		Route: resourcev2.AccessRoute{Connection: "route"}, Provider: "kubernetes", Authority: "authority", Type: token, Scope: scope,
		Representation: snapshot.bindings[token].Descriptor.DefaultRepresentation,
	}
}

func oneName(name string) resourcev2.ScopeConstraint {
	return resourcev2.ScopeConstraint{Dimension: "name", Match: resourcev2.ScopeOneOf, Values: &[]string{name}}
}

func inNamespace(namespace string) resourcev2.ScopeConstraint {
	return resourcev2.ScopeConstraint{Dimension: "namespace", Match: resourcev2.ScopeOneOf, Values: &[]string{namespace}}
}

func TestNativeCatalogDeclaresTheNameOfEveryNativeKindAsAQueryDimension(t *testing.T) {
	_, snapshot := nameCatalog(t, nativeTestAny())
	for token, binding := range snapshot.bindings {
		t.Run(token, func(t *testing.T) {
			descriptor := binding.Descriptor
			name := resourcev2.Dimension{Name: "name", AllowEmpty: false}
			if binding.API.Namespaced {
				require.Equal(t, []resourcev2.Dimension{{Name: "namespace"}}, descriptor.IdentityDimensions)
				require.Equal(t, []resourcev2.Dimension{{Name: "namespace"}, name}, descriptor.QueryDimensions)
			} else {
				require.Empty(t, descriptor.IdentityDimensions, "an object's identity is its namespace and its id: the name dimension selects, it does not identify")
				require.Equal(t, []resourcev2.Dimension{name}, descriptor.QueryDimensions)
			}
			require.NotEmpty(t, descriptor.Capabilities)
			for _, capability := range descriptor.Capabilities {
				constraint := nameConstraint(t, capability.Scope)
				require.Equal(t, resourcev2.ScopeAny, constraint.Match, "%s is declared over any name", capability.Operation)
				require.Nil(t, constraint.Values)
			}
		})
	}
}

func nameConstraint(t *testing.T, scope resourcev2.QueryScope) resourcev2.ScopeConstraint {
	t.Helper()
	for _, constraint := range scope {
		if constraint.Dimension == "name" {
			return constraint
		}
	}
	t.Fatalf("scope %v has no name constraint", scope)
	return resourcev2.ScopeConstraint{}
}

func TestNativeCatalogAdmitsALiveReadNarrowedToOneObject(t *testing.T) {
	for _, tc := range []struct {
		token string
		scope resourcev2.QueryScope
	}{
		{"k8s:/pods", resourcev2.QueryScope{inNamespace("checkout"), oneName("cart-api")}},
		{"k8s:sample.example/widgets", resourcev2.QueryScope{inNamespace("checkout"), oneName("w-1")}},
		{"k8s:/nodes", resourcev2.QueryScope{oneName("worker-1")}},
		{"k8s:sample.example/clusterwidgets", resourcev2.QueryScope{oneName("cw-1")}},
	} {
		t.Run(tc.token, func(t *testing.T) {
			_, snapshot := nameCatalog(t, nativeTestAny())
			target := nameTarget(snapshot, tc.token, tc.scope)

			// the host's own choice of mode: a read that follows the object, then the finite read it falls back to
			descriptor, err := resourcev2.AdmitCatalogOperation(snapshot.catalog, target)
			require.NoError(t, err, "the narrowed source must be admitted as a source with updates")
			require.Equal(t, tc.token, descriptor.Type)
			require.Equal(t, resourcev2.ContinuityBestEffort, resourcev2.SourceGuaranteeForTarget(descriptor, target))
			_, err = resourcev2.AdmitCatalogOperation(snapshot.catalog, resourcev2.EnumerateRequest{Target: target, PageSize: 1})
			require.NoError(t, err)
		})
	}
}

func TestNativeCatalogNameDoesNotChangeWhatAnExactObjectIsAdmittedFor(t *testing.T) {
	_, snapshot := nameCatalog(t, nativeTestAny())
	address := resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "authority", Type: "k8s:/pods", ID: "cart-api", Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "checkout"}}}
	route := resourcev2.AccessRoute{Connection: "route"}
	representation := snapshot.bindings["k8s:/pods"].Descriptor.DefaultRepresentation
	for name, request := range map[string]any{
		"get":    resourcev2.GetRequest{Route: route, Reference: resourcev2.ResourceReference{Address: address}, Representation: representation},
		"update": resourcev2.MutationRequest{Route: route, Reference: resourcev2.ResourceReference{Address: address}, Operation: "update", Input: resourcev2.Value{Kind: "map"}},
		"delete": resourcev2.MutationRequest{Route: route, Reference: resourcev2.ResourceReference{Address: address}, Operation: "delete", Input: resourcev2.Value{Kind: "null"}},
	} {
		_, err := resourcev2.AdmitCatalogOperation(snapshot.catalog, request)
		require.NoError(t, err, name)
	}
}

func TestNativeCatalogRefusesANameScopeThatIsNotAScope(t *testing.T) {
	_, snapshot := nameCatalog(t, nativeTestAny())
	empty := []string{""}
	for _, tc := range []struct {
		name  string
		token string
		scope resourcev2.QueryScope
		code  string
	}{
		{"an empty name", "k8s:/pods", resourcev2.QueryScope{inNamespace("checkout"), {Dimension: "name", Match: resourcev2.ScopeOneOf, Values: &empty}}, "INVALID_REQUEST"},
		{"no name at all: the host fills in any, a caller that does not is wrong", "k8s:/pods", resourcev2.QueryScope{inNamespace("checkout")}, "INVALID_REQUEST"},
		{"no name for a cluster-scoped kind", "k8s:/nodes", resourcev2.QueryScope{}, "INVALID_REQUEST"},
		{"a name twice", "k8s:/pods", resourcev2.QueryScope{inNamespace("checkout"), oneName("a"), oneName("b")}, "INVALID_REQUEST"},
		{"a dimension the kind does not declare", "k8s:/nodes", resourcev2.QueryScope{oneName("worker-1"), inNamespace("checkout")}, "INVALID_REQUEST"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := resourcev2.AdmitCatalogOperation(snapshot.catalog, nameTarget(snapshot, tc.token, tc.scope))
			require.Equal(t, tc.code, resourcev2.ErrorCode(err), "%v", err)
		})
	}
}

// A connection that reads only some namespaces keeps doing so: the name narrows within them, it never widens them.
func TestNativeCatalogNameStaysWithinTheConnectionsNamespaces(t *testing.T) {
	_, snapshot := nameCatalog(t, nativeTestOneOf("checkout"))
	_, err := resourcev2.AdmitCatalogOperation(snapshot.catalog, nameTarget(snapshot, "k8s:/pods", resourcev2.QueryScope{inNamespace("checkout"), oneName("cart-api")}))
	require.NoError(t, err)
	_, err = resourcev2.AdmitCatalogOperation(snapshot.catalog, nameTarget(snapshot, "k8s:/pods", resourcev2.QueryScope{inNamespace("staging"), oneName("cart-api")}))
	require.Equal(t, "UNSUPPORTED", resourcev2.ErrorCode(err))
	_, err = resourcev2.AdmitCatalogOperation(snapshot.catalog, nameTarget(snapshot, "k8s:/pods", resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeAny}, oneName("cart-api")}))
	require.Equal(t, "UNSUPPORTED", resourcev2.ErrorCode(err), "a name does not widen the namespaces the connection reads")
}

// The types the plugin registers beside the native kinds are not built from discovery and keep their own dimensions.
func TestNativeCatalogNameIsOnlyForNativeKinds(t *testing.T) {
	_, snapshot := nameCatalog(t, nativeTestAny())
	seen := map[string]bool{}
	for _, descriptor := range snapshot.catalog.Types {
		for _, dimension := range descriptor.QueryDimensions {
			if dimension.Name == "name" {
				seen[descriptor.Type] = true
			}
		}
	}
	require.Len(t, seen, 4, "the four native kinds of the fixture, and none of Helm, the audit or the editor's queries")
	for _, token := range []string{"k8s:/pods", "k8s:/nodes", "k8s:sample.example/widgets", "k8s:sample.example/clusterwidgets"} {
		require.True(t, seen[token], token)
	}
	for _, descriptor := range snapshot.catalog.Types {
		if descriptor.Type == "helm:releases" {
			require.Equal(t, []resourcev2.Dimension{{Name: "namespace"}}, descriptor.QueryDimensions)
			for _, capability := range descriptor.Capabilities {
				require.Equal(t, nativeTestAny(), capability.Scope)
			}
		}
	}
}

// A source opened before this dimension existed was opened over the dimensions of the catalog before it. The SDK compares them with the current
// catalog's and fences the source: it is reopened once, over the new catalog, with no new wire field and no change in the host.
func TestSourcesOpenedBeforeTheNameDimensionAreFencedOnce(t *testing.T) {
	_, snapshot := nameCatalog(t, nativeTestAny())
	current := snapshot.bindings["k8s:/pods"].Descriptor
	previous := current
	previous.QueryDimensions = current.IdentityDimensions
	previous.Capabilities = nil
	for _, capability := range current.Capabilities {
		capability.Scope = nativeTestAny()
		previous.Capabilities = append(previous.Capabilities, capability)
	}
	open := resourcev2.SourceOpenRequest{
		Target:  nameTarget(snapshot, "k8s:/pods", nativeTestAny()),
		Mode:    resourcev2.SourceModeSnapshotAndUpdates,
		Binding: resourcev2.RepresentationBinding{Representation: current.Representations[0]},
	}
	require.True(t, resourcev2.SourceOperationalContractEqual(previous, previous, open), "a catalog that did not change keeps its sources")
	require.False(t, resourcev2.SourceOperationalContractEqual(previous, current, open), "the new dimension fences the sources opened before it")
}
