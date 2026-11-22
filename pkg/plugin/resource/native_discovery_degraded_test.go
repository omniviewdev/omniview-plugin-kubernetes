package resource

import (
	"context"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// One extension API that serves a document that parses but is wrong must not keep a user out of a working cluster any more than one that does not answer: its group version is
// named, with the reason invalid, and its kinds are left out (or kept, when the catalog knew them). The same document of a built-in group is the cluster that cannot be trusted:
// the start fails.
func TestNativeStartNamesAnExtensionGroupWhoseDocumentIsWrongInsteadOfFailing(t *testing.T) {
	resource := func(name, kind string, namespaced bool) metav1.APIResource {
		return metav1.APIResource{Name: name, Kind: kind, Namespaced: namespaced, Verbs: metav1.Verbs{"get", "list"}}
	}
	document := func(gv string, resources ...metav1.APIResource) string {
		return mustJSON(t, metav1.APIResourceList{GroupVersion: gv, APIResources: resources})
	}
	for _, tc := range []struct {
		name string
		docs map[string]string
		// invalid is the group versions the start names, in order.
		invalid []string
	}{
		{"a resource without a kind", map[string]string{"/apis/bad.example/v1": document("bad.example/v1", resource("things", "", true))}, []string{"bad.example/v1"}},
		{"a resource without a name", map[string]string{"/apis/bad.example/v1": document("bad.example/v1", resource("", "Thing", true))}, []string{"bad.example/v1"}},
		{"the same resource twice in one document", map[string]string{"/apis/bad.example/v1": document("bad.example/v1", resource("things", "Thing", true), resource("things", "Thing", true))}, []string{"bad.example/v1"}},
		{"two versions that disagree on whether the resource is namespaced", map[string]string{
			"/apis/bad.example/v1": document("bad.example/v1", resource("things", "Thing", true)),
			"/apis/bad.example/v2": document("bad.example/v2", resource("things", "Thing", false)),
		}, []string{"bad.example/v1", "bad.example/v2"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recordRetries(t, 3)
			heals := recordHeals(t)
			f, p, route := newHealProvider(t)
			f.serveGroupVersion(t, "bad.example", "v1", "things")
			if _, second := tc.docs["/apis/bad.example/v2"]; second {
				f.serveGroupVersion(t, "bad.example", "v2", "things")
			}
			f.setDocuments(tc.docs)
			_, err := p.StartConnection(context.Background(), route.Connection)
			require.NoError(t, err, "one extension API with a wrong document must not refuse the connection")
			want := make([]nativeUnavailable, 0, len(tc.invalid))
			for _, gv := range tc.invalid {
				want = append(want, nativeUnavailable{GroupVersion: gv, Reason: "invalid"})
			}
			require.Equal(t, want, unavailableWithReasons(p, route.Connection))
			tokens := catalogTokens(t, p, route)
			require.Contains(t, tokens, "k8s:/pods")
			require.Contains(t, tokens, "k8s:refresh.example/widgets", "what answers is served")
			require.NotContains(t, tokens, "k8s:bad.example/things")
			require.Equal(t, 1, heals.armed(), "the group is read again")
		})
	}

	t.Run("the same document of a built-in group still fails the start", func(t *testing.T) {
		recordRetries(t, 3)
		f, p, route := newHealProvider(t)
		f.addBuiltinApps(t)
		f.setDocuments(map[string]string{"/apis/apps/v1": document("apps/v1", resource("deployments", "", true))})
		_, err := p.StartConnection(context.Background(), route.Connection)
		require.Error(t, err)
		require.NotContains(t, p.catalogs, route.Connection)
	})
}

// A heal attempt removes a kind only when an index that is healthy no longer lists it. An index is healthy when the catalog has no extension kind to lose, or when it still lists at
// least one of the extension groups the catalog knew (a group the aggregator flags stale is listed). One that lists none of them is a stale replica, a filtering gateway, an aggregator
// that restarted without its cache, or every one of them deleted, and discovery cannot say which: nothing is removed, the groups whose kinds stay are named with the reason absent, and
// the loop goes on (a kind that has gone stale is cheaper than one that vanished with the loop that would have brought it back).
func TestNativeHealKeepsEveryExtensionKindWhenTheIndexListsNoneOfThem(t *testing.T) {
	c := newHealCase(t) // b.example/v1 and refresh.example/v2 answer 503; crd.example, other.example and refresh.example/v1 answer
	before := c.tokens()
	require.Contains(t, before, "k8s:crd.example/gadgets")
	for _, group := range []string{"b.example", "refresh.example", "crd.example", "other.example"} {
		c.f.removeGroup(t, group)
	}
	c.attempt()
	require.Equal(t, before, c.tokens(), "the index lists no extension group: nothing is removed")
	require.Equal(t, 1, c.heals.armed(), "and the loop goes on")
	absent := []nativeUnavailable{{"crd.example/v1", "absent"}, {"other.example/v1", "absent"}, {"refresh.example/v1", "absent"}}
	require.Equal(t, absent, unavailableWithReasons(c.p, c.route.Connection), "the groups whose kinds stay are named; those that were down have no kinds to keep")

	// The index is whole again: what answers is read again, what is still down is named as it was, and nothing was lost meanwhile.
	c.f.serveGroupVersion(t, "refresh.example", "v1", "widgets")
	c.f.serveGroupVersion(t, "refresh.example", "v2", "widgets")
	c.f.serveGroup(t, "b.example", "bees")
	c.f.serveGroup(t, "crd.example", "gadgets")
	c.f.serveGroup(t, "other.example", "things")
	c.attempt()
	require.Equal(t, before, c.tokens())
	require.Equal(t, []string{"b.example/v1", "refresh.example/v2"}, c.unavailable())
	require.Equal(t, 1, c.heals.armed())
}

// The usual partial catalog is one dead aggregated API (metrics-server) beside kinds that all answer. When the user deletes its APIService the index stops listing it, and the heal ends:
// a catalog with no extension kind has nothing an index that lists no extension group could take away, so that index is believed.
func TestNativeHealEndsWhenTheOnlyExtensionGroupTheCatalogKnewIsDeleted(t *testing.T) {
	recordRetries(t, 3)
	heals := recordHeals(t)
	f, p, route := newHealProvider(t)
	f.addBuiltinApps(t)
	f.removeGroup(t, "refresh.example")
	f.serveGroup(t, "b.example", "bees")
	f.setDown("/apis/b.example/v1", true)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	require.Equal(t, []string{"b.example/v1"}, unavailableNames(p, route))
	require.Equal(t, 1, heals.armed())

	f.removeGroup(t, "b.example")
	expireRefresh(p, route.Connection)
	heals.fire(t)
	require.Empty(t, unavailableNames(p, route), "the group is gone: the fact goes")
	require.Equal(t, 0, heals.armed(), "and so does the loop")
}

// A refresh of a catalog that lacks no group is not a heal: it follows the server as it always did, even when the index lists no extension group (the last operator was uninstalled).
// The rule that keeps kinds against a degraded index is for a catalog that is already partial; applied here it would name groups nobody serves and start a loop that never ends.
func TestNativeRefreshOfACompleteCatalogFollowsAnIndexThatListsNoExtensionGroup(t *testing.T) {
	heals := recordHeals(t)
	f, p, route := newHealProvider(t)
	f.addBuiltinApps(t)
	f.serveGroup(t, "crd.example", "gadgets")
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	require.Contains(t, catalogTokens(t, p, route), "k8s:crd.example/gadgets")
	require.Zero(t, heals.armed())

	f.removeGroup(t, "crd.example")
	f.removeGroup(t, "refresh.example")
	expireRefresh(p, route.Connection)
	_, err = p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route, Refresh: true})
	require.NoError(t, err)
	tokens := catalogTokens(t, p, route)
	require.NotContains(t, tokens, "k8s:crd.example/gadgets")
	require.NotContains(t, tokens, "k8s:refresh.example/widgets")
	require.Empty(t, unavailableNames(p, route), "nothing is named: the catalog lacks no group")
	require.Zero(t, heals.armed(), "and no heal starts")
}
