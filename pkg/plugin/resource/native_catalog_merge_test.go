package resource

import (
	"context"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

// What a refresh does to the catalog it replaces, when a group did not or does not answer (native_catalog_merge.go):
//   - a kind of a built-in group is never taken away;
//   - a kind of a group version that is listed and does not answer stays, and the group version is named;
//   - everything else follows the server: what a successful answer lists is added, what it no longer lists is gone.
// A heal attempt is such a refresh, so one attempt can neither shrink the catalog on the strength of a group that did not answer nor freeze it because one did not.

func TestNativeHealNeverTakesABuiltInKindAway(t *testing.T) {
	for _, tc := range []struct {
		name  string
		serve func(*healCase)
	}{
		{"core v1 answers a document without pods", func(c *healCase) { c.f.setCore(t) }},
		{"the index no longer lists the built-in group", func(c *healCase) { c.f.removeGroup(t, "apps") }},
		{"the built-in group version answers without its kind", func(c *healCase) { c.f.serveGroup(t, "apps") }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newHealCase(t)
			require.Contains(t, c.tokens(), "k8s:/pods")
			require.Contains(t, c.tokens(), "k8s:apps/deployments")
			tc.serve(c)
			c.attempt()
			require.Contains(t, c.tokens(), "k8s:/pods", "a shortened answer is not a deletion")
			require.Contains(t, c.tokens(), "k8s:apps/deployments")
			require.Equal(t, []string{"b.example/v1", "refresh.example/v2"}, c.unavailable(), "the groups that do not answer are still named")
			require.Equal(t, 1, c.heals.armed(), "and the loop goes on")
		})
		t.Run(tc.name+", and every group answers", func(t *testing.T) {
			c := newHealCase(t)
			tc.serve(c)
			c.f.setDown("/apis/b.example/v1", false)
			c.f.setDown("/apis/refresh.example/v2", false)
			c.attempt()
			require.Contains(t, c.tokens(), "k8s:/pods", "the attempt that ends the loop must not leave the catalog without its built-in kinds")
			require.Contains(t, c.tokens(), "k8s:apps/deployments")
			require.Contains(t, c.tokens(), "k8s:b.example/bees")
			require.Empty(t, c.unavailable())
			require.Zero(t, c.heals.armed())
		})
	}
}

func TestNativeHealFollowsTheServerForWhatItNoLongerLists(t *testing.T) {
	for _, tc := range []struct {
		name  string
		serve func(*healCase)
	}{
		{"an extension group the index no longer lists", func(c *healCase) { c.f.removeGroup(t, "crd.example") }},
		{"an extension kind its document no longer lists", func(c *healCase) { c.f.serveGroup(t, "crd.example") }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newHealCase(t)
			require.Contains(t, c.tokens(), "k8s:crd.example/gadgets")
			tc.serve(c)
			c.attempt()
			tokens := c.tokens()
			require.NotContains(t, tokens, "k8s:crd.example/gadgets", "the server says it is gone, and one group that does not answer does not freeze the catalog")
			require.Contains(t, tokens, "k8s:other.example/things")
			require.Contains(t, tokens, "k8s:/pods")
			require.Equal(t, []string{"b.example/v1", "refresh.example/v2"}, c.unavailable())
			require.Equal(t, 1, c.heals.armed())
		})
	}
}

func TestNativeHealAddsNewKindsWhileAGroupStaysDown(t *testing.T) {
	c := newHealCase(t)
	c.f.serveGroup(t, "new.example", "fresh")
	c.f.serveGroupVersion(t, "crd.example", "v1", "gadgets", "widgetsets")
	c.attempt()
	tokens := c.tokens()
	require.Contains(t, tokens, "k8s:new.example/fresh", "a CRD created meanwhile is added")
	require.Contains(t, tokens, "k8s:crd.example/widgetsets", "so is a kind that joined a group that answers")
	require.Equal(t, []string{"b.example/v1", "refresh.example/v2"}, c.unavailable())
}

func TestNativeHealKeepsWhatIsListedButDoesNotAnswerAndAddsWhatAnswers(t *testing.T) {
	c := newHealCase(t)
	// other.example answered at the start and is listed still: it flaps down while b.example, which did not answer at the start, answers.
	c.f.setDown("/apis/other.example/v1", true)
	c.f.setDown("/apis/b.example/v1", false)
	c.attempt()
	tokens := c.tokens()
	require.Contains(t, tokens, "k8s:other.example/things", "a group that is listed and does not answer keeps its kinds")
	require.Contains(t, tokens, "k8s:b.example/bees", "and does not block the kinds of a group that answers")
	require.Equal(t, []string{"other.example/v1", "refresh.example/v2"}, c.unavailable(), "the fact follows the latest discovery: b.example is out of it, other.example is in")
	require.Equal(t, 1, c.heals.armed())

	// A group version that answers again takes its versions back, and the last group to answer ends the loop.
	c.f.setDown("/apis/refresh.example/v2", false)
	c.attempt()
	require.Equal(t, 2, servedVersions(c.p, c.route, "k8s:refresh.example/widgets"))
	require.Equal(t, []string{"other.example/v1"}, c.unavailable())
	c.f.setDown("/apis/other.example/v1", false)
	c.attempt()
	require.Empty(t, c.unavailable())
	require.Zero(t, c.heals.armed())
	require.Contains(t, c.tokens(), "k8s:other.example/things")
}

func TestNativeHealServesOnlyTheVersionsThatAnswered(t *testing.T) {
	c := newHealCase(t)
	// The version that answers serves the kind; the version that never answered stays named and is not invented.
	require.Equal(t, 1, servedVersions(c.p, c.route, "k8s:refresh.example/widgets"))
	c.attempt()
	require.Equal(t, 1, servedVersions(c.p, c.route, "k8s:refresh.example/widgets"))
	require.Equal(t, "v1", c.p.catalogs[c.route.Connection].bindings["k8s:refresh.example/widgets"].GVR.Version)
}

// One attempt in which every case is present: the answers of the groups are all different.
func TestNativeHealMixedCase(t *testing.T) {
	c := newHealCase(t)
	c.f.removeGroup(t, "crd.example")                           // gone: the index no longer lists it
	c.f.setDown("/apis/other.example/v1", true)                 // listed, does not answer: kept, named
	c.f.setDown("/apis/b.example/v1", false)                    // did not answer, answers: added
	c.f.serveGroup(t, "new.example", "fresh")                   // new: added
	c.f.serveGroupVersion(t, "refresh.example", "v1", "gizmos") // answers without the kind it had (widgets): gone; v2 still does not answer: named
	c.f.removeGroup(t, "apps")                                  // a built-in group the index lost, and a document that lost its kind:
	c.f.setCore(t)                                              // kept
	c.attempt()
	tokens := c.tokens()
	for _, kept := range []string{"k8s:/pods", "k8s:apps/deployments", "k8s:other.example/things", "k8s:b.example/bees", "k8s:new.example/fresh", "k8s:refresh.example/gizmos"} {
		require.Contains(t, tokens, kept)
	}
	for _, gone := range []string{"k8s:crd.example/gadgets", "k8s:refresh.example/widgets"} {
		require.NotContains(t, tokens, gone)
	}
	require.Equal(t, []string{"other.example/v1", "refresh.example/v2"}, c.unavailable())
	require.Equal(t, 1, c.heals.armed())
}

// The fact names what does not answer now, not what did not answer when the connection started and not what the server has since forgotten.
func TestNativeHealFactNamesWhatIsUnavailableNow(t *testing.T) {
	c := newHealCase(t)
	fact := func() []string {
		t.Helper()
		snapshot, err := c.p.RefreshConnectionMetadata(context.Background(), c.route.Connection)
		require.NoError(t, err)
		entry, present := snapshot.Entries[FactUnavailableAPIGroups]
		if !present {
			return nil
		}
		value, ok := entry.Value.(map[string]any)
		require.True(t, ok, "the fact is an object: how many groups, and the first of them: %T", entry.Value)
		groups, ok := value["groups"].([]any)
		require.True(t, ok)
		names := []string{}
		for _, group := range groups {
			names = append(names, group.(map[string]any)["groupVersion"].(string))
		}
		return names
	}
	require.Equal(t, []string{"b.example/v1", "refresh.example/v2"}, fact())

	c.f.setDown("/apis/refresh.example/v2", false)
	c.f.setDown("/apis/other.example/v1", true)
	c.attempt()
	require.Equal(t, []string{"b.example/v1", "other.example/v1"}, fact(), "a group that failed since is named, one that answers is not")

	c.f.removeGroup(t, "other.example") // deleted while it was down
	c.f.setDown("/apis/crd.example/v1", true)
	c.attempt()
	require.Equal(t, []string{"b.example/v1", "crd.example/v1"}, fact(), "a group the server has forgotten is not named, one that failed since is")
	require.NotContains(t, c.tokens(), "k8s:other.example/things")
	require.Contains(t, c.tokens(), "k8s:crd.example/gadgets")
}

// A refresh of a connection that never lacked a group follows the server, as it always did: the control of the rules above.
func TestNativeRefreshOfACompleteCatalogFollowsTheServer(t *testing.T) {
	heals := recordHeals(t)
	f, p, route := newHealProvider(t)
	f.addBuiltinApps(t)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	require.Contains(t, catalogTokens(t, p, route), "k8s:apps/deployments")
	f.removeGroup(t, "apps")
	expireRefresh(p, route.Connection)
	_, err = p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route, Refresh: true})
	require.NoError(t, err)
	require.NotContains(t, catalogTokens(t, p, route), "k8s:apps/deployments")
	require.Zero(t, heals.armed())
}

// The rejection that two earlier tests asserted is gone: a refresh that cannot read a group keeps what the group served and says so.
func TestNativeRefreshThatCannotReadAGroupKeepsItsKinds(t *testing.T) {
	heals := recordHeals(t)
	recordRetries(t, 3)
	f, p, route := newHealProvider(t)
	_, err := p.StartConnection(context.Background(), route.Connection)
	require.NoError(t, err)
	require.Equal(t, 2, servedVersions(p, route, "k8s:refresh.example/widgets"))
	require.Zero(t, heals.armed())

	f.setDown("/apis/refresh.example/v2", true)
	expireRefresh(p, route.Connection)
	_, err = p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: route, Refresh: true})
	require.NoError(t, err, "a group that does not answer is no reason to refuse the refresh")
	require.Equal(t, 2, servedVersions(p, route, "k8s:refresh.example/widgets"), "nothing is taken away on the strength of an answer that was not read")
	require.Equal(t, []string{"refresh.example/v2"}, unavailableNames(p, route))
	require.Equal(t, 1, heals.armed(), "a refresh that first records an unavailable group starts the heal: nothing else would")
	require.Equal(t, []time.Duration{30 * time.Second}, heals.scheduled())
}

// A refresh that changes the set of unavailable groups keeps the heal that is pending and its backoff: a second wait of 30 s would turn the backoff into a constant.
func TestNativeRefreshKeepsThePendingHealAndItsBackoff(t *testing.T) {
	c := newHealCase(t)
	c.attempt()
	require.Equal(t, []time.Duration{30 * time.Second, time.Minute}, c.heals.scheduled())
	c.f.setDown("/apis/other.example/v1", true)
	expireRefresh(c.p, c.route.Connection)
	_, err := c.p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: c.route, Refresh: true})
	require.NoError(t, err)
	require.Equal(t, []string{"b.example/v1", "other.example/v1", "refresh.example/v2"}, c.unavailable())
	require.Equal(t, 1, c.heals.armed())
	require.Equal(t, []time.Duration{30 * time.Second, time.Minute}, c.heals.scheduled(), "no second heal was armed")
}

// An explicit refresh that installs the recovered catalog updates the fact itself, and the heal that was pending has nothing left to do.
func TestNativeExplicitRefreshUpdatesTheFactAndEndsTheHeal(t *testing.T) {
	c := newHealCase(t)
	snapshot, err := c.p.RefreshConnectionMetadata(context.Background(), c.route.Connection)
	require.NoError(t, err)
	require.Contains(t, snapshot.Entries, FactUnavailableAPIGroups)

	c.f.setDown("/apis/b.example/v1", false)
	c.f.setDown("/apis/refresh.example/v2", false)
	expireRefresh(c.p, c.route.Connection)
	_, err = c.p.Catalog(context.Background(), resourcev2.CatalogRequest{Route: c.route, Refresh: true})
	require.NoError(t, err)
	require.Empty(t, c.unavailable())
	require.Zero(t, c.heals.armed(), "every group answers: the pending heal is cancelled")
	require.Eventually(t, func() bool {
		current, err := c.p.GetConnectionMetadata(context.Background(), c.route.Connection)
		if err != nil {
			return false
		}
		_, present := current.Entries[FactUnavailableAPIGroups]
		return !present
	}, 5*time.Second, 10*time.Millisecond, "the fact follows the installed catalog whichever path installed it, without a refresh of the facts asked for")
}

// The attempts of a connection whose catalog the server shortens, and a discovery that lists nothing, are not a way to lose the catalog.
func TestNativeHealRefusesADiscoveryThatListsNothing(t *testing.T) {
	c := newHealCase(t)
	c.f.setDocuments(map[string]string{
		"/api":  `{"kind":"APIVersions","versions":[]}`,
		"/apis": `{"kind":"APIGroupList","apiVersion":"v1","groups":[]}`,
	})
	before := c.tokens()
	c.attempt()
	require.Equal(t, before, c.tokens(), "an empty answer is an answer that could not be believed, not the removal of every kind")
	require.Equal(t, []string{"b.example/v1", "refresh.example/v2"}, c.unavailable())
	require.Equal(t, 1, c.heals.armed(), "the next attempt is scheduled")
}
