package resource

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	fakediscovery "k8s.io/client-go/discovery/fake"
	clienttesting "k8s.io/client-go/testing"
)

// catalogDiscovery overrides only the discovery response. All parsing runs in
// discoverNativeTypes, not in a test copy of its implementation.
type catalogDiscovery struct {
	*fakediscovery.FakeDiscovery
	groups []*metav1.APIGroup
	lists  []*metav1.APIResourceList
	err    error
}

func (d catalogDiscovery) ServerGroupsAndResources() ([]*metav1.APIGroup, []*metav1.APIResourceList, error) {
	return d.groups, d.lists, d.err
}

func discoveryFixture(lists ...*metav1.APIResourceList) catalogDiscovery {
	return catalogDiscovery{FakeDiscovery: &fakediscovery.FakeDiscovery{Fake: &clienttesting.Fake{}}, lists: lists}
}

func TestNativeDiscoveryMergesVersionsUsingPreferredRepresentation(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		t.Run(map[bool]string{false: "preferred-last", true: "preferred-first"}[reverse], func(t *testing.T) {
			old := &metav1.APIResourceList{GroupVersion: "apps/v1beta1", APIResources: []metav1.APIResource{{Name: "deployments", Kind: "Deployment", Namespaced: true, Verbs: metav1.Verbs{"get"}}}}
			preferred := &metav1.APIResourceList{GroupVersion: "apps/v1", APIResources: []metav1.APIResource{{Name: "deployments", Kind: "Deployment", Namespaced: true, Verbs: metav1.Verbs{"get", "list"}}}}
			d := discoveryFixture(old, preferred)
			if reverse {
				d.lists = []*metav1.APIResourceList{preferred, old}
			}
			d.groups = []*metav1.APIGroup{{Name: "apps", PreferredVersion: metav1.GroupVersionForDiscovery{GroupVersion: "apps/v1", Version: "v1"}}}
			bindings, unavailable, err := discoverNativeTypes(context.Background(), d)
			require.NoError(t, err)
			require.Empty(t, unavailable)
			require.Len(t, bindings, 1)
			binding := bindings["k8s:apps/deployments"]
			require.Equal(t, schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}, binding.GVR)
			require.Equal(t, "k8s:apps/deployments", binding.Descriptor.Type)
			require.Len(t, binding.Descriptor.Capabilities, 3)
		})
	}
}

func TestNativeDiscoveryRejectsConflictingIdentityDimensions(t *testing.T) {
	d := discoveryFixture(
		&metav1.APIResourceList{GroupVersion: "example.com/v1", APIResources: []metav1.APIResource{{Name: "things", Kind: "Thing", Namespaced: true}}},
		&metav1.APIResourceList{GroupVersion: "example.com/v2", APIResources: []metav1.APIResource{{Name: "things", Kind: "Thing", Namespaced: false}}},
	)
	_, _, err := discoverNativeTypes(context.Background(), d)
	require.ErrorContains(t, err, "inconsistent native identity dimensions")
}

func TestNativeDiscoveryUnavailableGroupVersionIsNotCoverage(t *testing.T) {
	d := discoveryFixture(&metav1.APIResourceList{GroupVersion: "v1", APIResources: []metav1.APIResource{{Name: "pods", Kind: "Pod", Namespaced: true, Verbs: metav1.Verbs{"list"}}}})
	d.err = &discovery.ErrGroupDiscoveryFailed{Groups: map[schema.GroupVersion]error{
		{Group: "unavailable.example", Version: "v1"}: errors.New("unavailable"),
		{Group: "metrics.k8s.io", Version: "v1beta1"}: discovery.StaleGroupVersionError{},
	}}
	bindings, unavailable, err := discoverNativeTypes(context.Background(), d)
	require.NoError(t, err, "a group version that does not answer does not fail discovery")
	require.Contains(t, bindings, "k8s:/pods")
	require.Equal(t, []nativeUnavailable{
		{GroupVersion: "metrics.k8s.io/v1beta1", Reason: "stale"},
		{GroupVersion: "unavailable.example/v1", Reason: "failed"},
	}, unavailable, "the group versions are named, in order, each with a closed reason")
	d.lists = nil
	_, _, err = discoverNativeTypes(context.Background(), d)
	require.ErrorIs(t, err, d.err, "nothing discovered is a failed discovery, not an empty catalog")
}

func TestNativeDiscoveryPreservesActualGroupsAndSkipsSubresources(t *testing.T) {
	d := discoveryFixture(
		&metav1.APIResourceList{GroupVersion: "v1", APIResources: []metav1.APIResource{{Name: "pods", Kind: "Pod"}, {Name: "pods/log", Kind: "Pod"}, {Name: "pods/exec", Kind: "Pod"}}},
		&metav1.APIResourceList{GroupVersion: "core/v1", APIResources: []metav1.APIResource{{Name: "pods", Kind: "Pod"}}},
		&metav1.APIResourceList{GroupVersion: "networking.k8s.io/v1", APIResources: []metav1.APIResource{{Name: "ingresses", Kind: "Ingress"}}},
	)
	bindings, _, err := discoverNativeTypes(context.Background(), d)
	require.NoError(t, err)
	require.Len(t, bindings, 3)
	require.Equal(t, "", bindings["k8s:/pods"].GVR.Group)
	require.Equal(t, "core", bindings["k8s:core/pods"].GVR.Group)
	require.Equal(t, "networking.k8s.io", bindings["k8s:networking.k8s.io/ingresses"].GVR.Group)
}

func TestNativeDiscoveryRejectsMalformedEntries(t *testing.T) {
	for _, list := range []*metav1.APIResourceList{
		{GroupVersion: "bad/group/version"},
		{GroupVersion: "v1", APIResources: []metav1.APIResource{{Kind: "Pod"}}},
		{GroupVersion: "v1", APIResources: []metav1.APIResource{{Name: "pods"}}},
		{GroupVersion: "v1", APIResources: []metav1.APIResource{{Name: "pods", Kind: "Pod"}, {Name: "pods", Kind: "Pod"}}},
	} {
		_, _, err := discoverNativeTypes(context.Background(), discoveryFixture(list))
		require.Error(t, err)
	}
}
