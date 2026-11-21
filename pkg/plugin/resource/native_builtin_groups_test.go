package resource

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/resourcers"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"k8s.io/client-go/kubernetes/scheme"
)

// nativeBuiltinGroups decides what a group version that does not answer is: an extension that is down (the connection is served without its kinds) or the API server not
// being readable (the start fails). A built-in group that is missing from the list is read as an extension, so a Pod-class kind could be left out silently. The list is checked
// against the three places that know which groups the API server serves, so that it cannot rot when one of them moves: the Kubernetes API client-go builds against, the kinds the
// plugin itself names, and the kinds its UI lists.

func missingFromBuiltinGroups(groups map[string]string) []string {
	var missing []string
	for group, where := range groups {
		if _, ok := nativeBuiltinGroups[group]; !ok {
			missing = append(missing, "group "+`"`+group+`"`+" ("+where+")")
		}
	}
	sort.Strings(missing)
	return missing
}

// groupOfToken is the group of a type token: "k8s:apps/deployments" is "apps", "k8s:/pods" is the core group.
func groupOfToken(token string) (string, bool) {
	rest, ok := strings.CutPrefix(token, "k8s:")
	if !ok {
		return "", false
	}
	group, _, found := strings.Cut(rest, "/")
	return group, found
}

func TestNativeBuiltinGroupsHoldEveryGroupClientGoServes(t *testing.T) {
	groups := map[string]string{}
	for gvk := range scheme.Scheme.AllKnownTypes() {
		if gvk.Group == "extensions" { // removed from the API server in 1.22; the scheme keeps the types for old clients
			continue
		}
		groups[gvk.Group] = "client-go's scheme, " + gvk.Kind
	}
	require.NotEmpty(t, groups)
	require.Empty(t, missingFromBuiltinGroups(groups), "a group client-go knows is served by the API server in process: add it to nativeBuiltinGroups")
}

func TestNativeBuiltinGroupsHoldTheGroupsOfTheKindsThePluginNames(t *testing.T) {
	tokens := map[string]string{}
	relationships := resourcers.RelationshipTable()
	for source, descriptors := range relationships {
		tokens[source] = "a relationship source"
		for _, descriptor := range descriptors {
			tokens[descriptor.TargetType] = "a relationship target of " + source
		}
	}
	for token := range nativeSpecializedHelpers(zap.NewNop().Sugar(), relationships) {
		tokens[token] = "a specialized resourcer"
	}
	groups := map[string]string{}
	for token, where := range tokens {
		if group, ok := groupOfToken(token); ok {
			groups[group] = token + ", " + where
		}
	}
	require.NotEmpty(t, groups)
	require.Empty(t, missingFromBuiltinGroups(groups))
}

func TestNativeBuiltinGroupsHoldTheGroupsOfTheKindsTheUIListsAndNothingElseIsAssumed(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "..", "..", "ui", "src", "kinds", "*", "definition.ts"))
	require.NoError(t, err)
	require.NotEmpty(t, files, "the kind definitions of the UI are where this test looks for the groups the UI lists")
	identity := regexp.MustCompile(`const identity = \{ group: '([^']*)'`)
	groups := map[string]string{}
	for _, file := range files {
		source, err := os.ReadFile(file)
		require.NoError(t, err)
		match := identity.FindSubmatch(source)
		require.NotNil(t, match, "%s declares its identity as the others do", file)
		groups[string(match[1])] = filepath.Base(filepath.Dir(file))
	}
	require.Empty(t, missingFromBuiltinGroups(groups))
	// The list is not a guess about extensions: a group that is not served in process stays out of it, whatever its name.
	for _, extension := range []string{"metrics.k8s.io", "snapshot.storage.k8s.io", "gateway.networking.k8s.io", "cert-manager.io"} {
		require.NotContains(t, nativeBuiltinGroups, extension)
	}
}

// The three tests above only say that nothing the API server serves is missing from the list; a group dropped from it that no source names (the aggregator's own apiregistration.k8s.io
// is not in client-go's scheme) and a group added to it that is not served in process (an extension such as custom.metrics.k8s.io, which would make its failure a refused start) both
// went unseen. The list is exactly the groups client-go's scheme knows (minus extensions, removed from the API server in 1.22) and the two the API server serves in process that its
// scheme does not: the aggregator's and the CRD API.
func TestNativeBuiltinGroupsAreExactlyTheGroupsTheAPIServerServesInProcess(t *testing.T) {
	want := map[string]struct{}{"apiextensions.k8s.io": {}, "apiregistration.k8s.io": {}}
	for gvk := range scheme.Scheme.AllKnownTypes() {
		if gvk.Group != "extensions" {
			want[gvk.Group] = struct{}{}
		}
	}
	var unexpected, missing []string
	for group := range nativeBuiltinGroups {
		if _, ok := want[group]; !ok {
			unexpected = append(unexpected, group)
		}
	}
	for group := range want {
		if _, ok := nativeBuiltinGroups[group]; !ok {
			missing = append(missing, group)
		}
	}
	sort.Strings(unexpected)
	sort.Strings(missing)
	require.Empty(t, unexpected, "these groups are not served by the API server in process: an extension group that does not answer is an unavailable group, not a cluster that cannot be read")
	require.Empty(t, missing, "the API server serves these groups in process")
}
