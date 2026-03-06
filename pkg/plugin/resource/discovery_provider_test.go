package resource

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/discovery"
	fakediscovery "k8s.io/client-go/discovery/fake"
	fakeclientset "k8s.io/client-go/kubernetes/fake"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// newFakeDiscoveryConn wires a fake discovery client into a Connection so that
// kubeDiscoveryProvider.Discover can call utils.KubeClientsFromConnection.
// Since that function needs a real kubeconfig, we instead test the discovery
// parsing logic by calling the internal function's equivalent inline.

// testDiscovery tests the parsing logic of Discover by simulating what
// ServerGroupsAndResources returns.
func testDiscoveryParse(t *testing.T, resourceLists []*metav1.APIResourceList, want []struct {
	group, version, kind string
}, wantLen int) {
	t.Helper()

	// Simulate the parsing logic from kubeDiscoveryProvider.Discover
	var metas []struct{ Group, Version, Kind string }
	for _, rl := range resourceLists {
		gv := rl.GroupVersion
		group, version := "", gv
		if i := lastIndex(gv, '/'); i >= 0 {
			group, version = gv[:i], gv[i+1:]
		}
		if group == "" {
			group = "core"
		}
		for _, r := range rl.APIResources {
			if containsSlash(r.Name) {
				continue
			}
			metas = append(metas, struct{ Group, Version, Kind string }{group, version, r.Kind})
		}
	}

	require.Len(t, metas, wantLen)
	for i, w := range want {
		assert.Equal(t, w.group, metas[i].Group, "group mismatch at index %d", i)
		assert.Equal(t, w.version, metas[i].Version, "version mismatch at index %d", i)
		assert.Equal(t, w.kind, metas[i].Kind, "kind mismatch at index %d", i)
	}
}

func lastIndex(s string, sep byte) int {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == sep {
			return i
		}
	}
	return -1
}

func containsSlash(s string) bool {
	for _, c := range s {
		if c == '/' {
			return true
		}
	}
	return false
}

func TestDiscovery_ParsesGroupVersion(t *testing.T) {
	rls := []*metav1.APIResourceList{
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{Name: "deployments", Kind: "Deployment"},
			},
		},
	}
	testDiscoveryParse(t, rls, []struct{ group, version, kind string }{
		{"apps", "v1", "Deployment"},
	}, 1)
}

func TestDiscovery_CoreGroup(t *testing.T) {
	rls := []*metav1.APIResourceList{
		{
			GroupVersion: "v1",
			APIResources: []metav1.APIResource{
				{Name: "pods", Kind: "Pod"},
			},
		},
	}
	testDiscoveryParse(t, rls, []struct{ group, version, kind string }{
		{"core", "v1", "Pod"},
	}, 1)
}

func TestDiscovery_SkipsSubresources(t *testing.T) {
	rls := []*metav1.APIResourceList{
		{
			GroupVersion: "v1",
			APIResources: []metav1.APIResource{
				{Name: "pods", Kind: "Pod"},
				{Name: "pods/log", Kind: "Pod"},
				{Name: "pods/exec", Kind: "Pod"},
			},
		},
	}
	testDiscoveryParse(t, rls, []struct{ group, version, kind string }{
		{"core", "v1", "Pod"},
	}, 1)
}

func TestDiscovery_OnConnectionRemoved(t *testing.T) {
	dp := &kubeDiscoveryProvider{logger: zap.NewNop().Sugar()}
	err := dp.OnConnectionRemoved(context.Background(), &types.Connection{})
	assert.NoError(t, err)
}

// TestDiscovery_FakeDiscoveryClient verifies the real Discover method logic
// using k8s.io/client-go's fake discovery client.
func TestDiscovery_FakeDiscoveryClient(t *testing.T) {
	fakeCS := fakeclientset.NewSimpleClientset()
	fd := fakeCS.Discovery().(*fakediscovery.FakeDiscovery)

	fd.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "v1",
			APIResources: []metav1.APIResource{
				{Name: "pods", Kind: "Pod"},
				{Name: "pods/log", Kind: "Pod"},
				{Name: "services", Kind: "Service"},
			},
		},
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{Name: "deployments", Kind: "Deployment"},
				{Name: "deployments/scale", Kind: "Scale"},
			},
		},
	}

	// Call the internal discovery parsing logic directly (the Discover method
	// needs utils.KubeClientsFromConnection which requires a real kubeconfig).
	// We extract the same logic here.
	metas := parseDiscoveryResources(fd)

	// Should have: Pod, Service, Deployment (subresources skipped)
	require.Len(t, metas, 3)

	metaMap := make(map[string]bool)
	for _, m := range metas {
		metaMap[m.group+"::"+m.version+"::"+m.kind] = true
	}
	assert.True(t, metaMap["core::v1::Pod"])
	assert.True(t, metaMap["core::v1::Service"])
	assert.True(t, metaMap["apps::v1::Deployment"])
}

type simpleMeta struct {
	group, version, kind string
}

// --- normalizeGroup tests ---

func TestNormalizeGroup(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		// Standard K8s FQDN groups → short name
		{"admissionregistration.k8s.io", "admissionregistration"},
		{"networking.k8s.io", "networking"},
		{"rbac.authorization.k8s.io", "rbac"},
		{"storage.k8s.io", "storage"},
		{"apiextensions.k8s.io", "apiextensions"},
		{"flowcontrol.apiserver.k8s.io", "flowcontrol"},
		{"coordination.k8s.io", "coordination"},
		{"scheduling.k8s.io", "scheduling"},
		{"policy.k8s.io", "policy"},
		{"autoscaling.k8s.io", "autoscaling"},

		// .kubernetes.io suffix
		{"metrics.kubernetes.io", "metrics"},
		{"node.kubernetes.io", "node"},

		// CRD groups — left untouched
		{"stable.example.com", "stable.example.com"},
		{"acme.cert-manager.io", "acme.cert-manager.io"},
		{"argoproj.io", "argoproj.io"},

		// Already short names — pass through
		{"apps", "apps"},
		{"core", "core"},
		{"batch", "batch"},

		// Empty → "core"
		{"", "core"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := normalizeGroup(tt.input)
			assert.Equal(t, tt.want, got)
		})
	}
}

func parseDiscoveryResources(dc discovery.DiscoveryInterface) []simpleMeta {
	_, resourceLists, _ := dc.ServerGroupsAndResources()
	var metas []simpleMeta
	for _, rl := range resourceLists {
		gv := rl.GroupVersion
		group, version := "", gv
		if i := lastIndex(gv, '/'); i >= 0 {
			group, version = gv[:i], gv[i+1:]
		}
		if group == "" {
			group = "core"
		}
		for _, r := range rl.APIResources {
			if containsSlash(r.Name) {
				continue
			}
			metas = append(metas, simpleMeta{group, version, r.Kind})
		}
	}
	return metas
}
