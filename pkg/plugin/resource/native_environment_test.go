package resource

import (
	"net/http"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/helm"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// environmentOf returns the environment each catalog type declares.
func environmentOf(catalog resourcev2.Catalog) map[string]*resourcev2.EnvironmentIdentity {
	declared := make(map[string]*resourcev2.EnvironmentIdentity, len(catalog.Types))
	for _, descriptor := range catalog.Types {
		declared[descriptor.Type] = descriptor.Environment
	}
	return declared
}

// durablePod returns the durable reference of a pod as the host would derive it
// from the catalog and the record. The authority stands in for a host-issued one.
func durablePod(t *testing.T, catalog resourcev2.Catalog, authority, name, uid string) resourcev2.DurableReference {
	t.Helper()
	environment := environmentOf(catalog)["k8s:/pods"]
	require.NotNil(t, environment, "pods must declare an environment")
	durable, err := resourcev2.NewDurableReference(*environment, resourcev2.ResourceReference{
		Address:     resourcev2.ResourceAddress{Provider: catalog.Provider, Authority: authority, Type: "k8s:/pods", Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "default"}}, ID: name},
		Incarnation: &uid,
	})
	require.NoError(t, err)
	return durable
}

func durableKey(t *testing.T, durable resourcev2.DurableReference) string {
	t.Helper()
	key, err := durable.Address.Key()
	require.NoError(t, err)
	return key
}

func (i *identityFixture) catalog() resourcev2.Catalog {
	return i.provider.catalogs[i.connection.ID].catalog
}

func TestNativeCatalogDeclaresTheClusterEnvironmentWhereItDeclaresTheHint(t *testing.T) {
	recordRetries(t, 3)
	i := newIdentityFixture(t, respondNamespace("cluster-uid-A"))
	require.NoError(t, i.start())
	catalog := i.catalog()
	want := &resourcev2.EnvironmentIdentity{Scheme: "kubernetes.namespace-uid.v1", ID: "cluster-uid-A"}
	declared := environmentOf(catalog)
	require.Equal(t, want, declared["k8s:/pods"])
	require.Equal(t, want, declared["k8s:refresh.example/widgets"], "discovered custom resources belong to the cluster too")
	require.Equal(t, want, declared[helm.ReleaseType], "releases are stored in the cluster")
	for _, local := range []string{helm.RepositoryType, helm.ChartType, auditType, editorQueryType} {
		require.Nil(t, declared[local], "%s is not backed by the cluster and has no durable identity", local)
	}
	for _, descriptor := range catalog.Types {
		require.Equal(t, descriptor.NativeAuthorityHint != nil, descriptor.Environment != nil, "%s: the environment and the hint describe the same backing", descriptor.Type)
		if descriptor.Environment != nil {
			require.Equal(t, descriptor.NativeAuthorityHint.ID, descriptor.Environment.ID)
		}
	}
	require.NoError(t, resourcev2.ValidateCatalog(catalog))
	wire, err := resourcev2.ToProtoCatalog(catalog)
	require.NoError(t, err)
	decoded, err := resourcev2.FromProtoCatalog(wire)
	require.NoError(t, err)
	require.Equal(t, environmentOf(catalog), environmentOf(decoded), "the declaration survives the plugin transport")
}

func TestNativeClusterEnvironmentOutlivesStopStartProfileEditAndRestart(t *testing.T) {
	recordRetries(t, 3)
	original := newIdentityFixture(t, respondNamespace("cluster-uid-A"))
	require.NoError(t, original.start())
	// The host issues a new authority after each of these events; the standing
	// authorities here only keep the references well-formed.
	first := durablePod(t, original.catalog(), "local:first", "web-0", "pod-uid-1")
	firstKey := durableKey(t, first)

	t.Run("stop and start", func(t *testing.T) {
		original.provider.retireNativeCatalog(original.connection.ID)
		require.NotContains(t, original.provider.catalogs, original.connection.ID)
		require.NoError(t, original.start())
		again := durablePod(t, original.catalog(), "local:second", "web-0", "pod-uid-1")
		require.Equal(t, first, again)
		require.Equal(t, firstKey, durableKey(t, again))
	})

	t.Run("profile edit that retargets the endpoint and renames the connection", func(t *testing.T) {
		// A different server URL and connection ID reach the same cluster: the
		// kube-system UID is the only thing that is the same.
		edited := newIdentityFixture(t, respondNamespace("cluster-uid-A"))
		edited.connection.ID = "renamed-context"
		require.NotEqual(t, original.url, edited.url)
		require.NoError(t, edited.start())
		again := durablePod(t, edited.catalog(), "local:third", "web-0", "pod-uid-1")
		require.Equal(t, first, again)
		require.Equal(t, firstKey, durableKey(t, again))
	})

	t.Run("plugin restart", func(t *testing.T) {
		restarted := refreshTestProvider()
		require.NoError(t, restarted.startNativeConnection(original.ctx, original.connection, original.client))
		again := durablePod(t, restarted.catalogs[original.connection.ID].catalog, "local:fourth", "web-0", "pod-uid-1")
		require.Equal(t, first, again)
		restarted.retireNativeCatalog(original.connection.ID)
	})

	t.Run("a different cluster is a different environment", func(t *testing.T) {
		other := newIdentityFixture(t, respondNamespace("cluster-uid-B"))
		require.NoError(t, other.start())
		// The same authority, name, namespace and pod UID: only the cluster differs.
		different := durablePod(t, other.catalog(), "local:first", "web-0", "pod-uid-1")
		require.NotEqual(t, first.Address.Environment, different.Address.Environment)
		require.NotEqual(t, firstKey, durableKey(t, different))
	})

	t.Run("a recreated pod keeps its identity and changes its incarnation", func(t *testing.T) {
		recreated := durablePod(t, original.catalog(), "local:first", "web-0", "pod-uid-2")
		require.Equal(t, firstKey, durableKey(t, recreated))
		require.NotEqual(t, first, recreated)
		require.Equal(t, "pod-uid-2", *recreated.Incarnation)
	})
}

func TestNativeClusterEnvironmentIsUnknownWithoutAReadableIdentity(t *testing.T) {
	recordRetries(t, 3)
	i := newIdentityFixture(t, respondStatus(http.StatusForbidden, metav1.StatusReasonForbidden))
	require.NoError(t, i.start())
	require.Nil(t, i.hint())
	for typ, environment := range environmentOf(i.catalog()) {
		require.Nil(t, environment, "%s must not guess an identity the cluster did not give", typ)
	}
	require.NoError(t, resourcev2.ValidateCatalog(i.catalog()))
}
