package connid

import (
	"crypto/sha256"
	"encoding/hex"
	"math/rand/v2"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// idShape is the whole format: a slug of the context name, a dash and ten hex digits.
var idShape = regexp.MustCompile(`^[a-z0-9._-]+-[0-9a-f]{10}$`)

// slugOf returns the readable part of an ID.
func slugOf(t *testing.T, id string) string {
	t.Helper()
	require.Regexp(t, idShape, id)
	return id[:len(id)-len("-0123456789")]
}

// The expected hashes below were computed outside this package, with Python's hashlib over the
// documented key (kind NUL locator NUL context name), so they pin the key layout and not only
// the code that builds it.
func TestIDGoldenVectors(t *testing.T) {
	const alice = "/home/alice/.kube/config"
	for _, tt := range []struct {
		name    string
		kind    Kind
		locator string
		context string
		want    string
	}{
		{"plain name", KindFile, alice, "prod", "prod-ea252c86a6"},
		{"the exact name is hashed, only the slug is folded", KindFile, alice, "Prod", "prod-a06c29e7fa"},
		{"another file, same name", KindFile, "/home/bob/.kube/config", "prod", "prod-f06f936cf6"},
		{"EKS ARN", KindFile, alice, "arn:aws:eks:us-east-1:111122223333:cluster/prod", "arn-aws-eks-us-east-1-111122223333-cluster-prod-6d193ed69a"},
		{"GKE keeps underscores", KindFile, alice, "gke_my-project_us-central1-a_prod", "gke_my-project_us-central1-a_prod-7ca391b53a"},
		{"Windows locator", KindFile, `c:\users\alice\.kube\config`, "prod", "prod-d82f70a64b"},
		{"no ASCII letters at all", KindFile, alice, "日本語", "context-d3794ddfcf"},
		{"empty name", KindFile, alice, "", "context-26c28c4b94"},
		{"slug is cut to 48", KindFile, alice, strings.Repeat("a", 60), strings.Repeat("a", 48) + "-b39c3d0a13"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, ID(tt.kind, tt.locator, tt.context))
		})
	}
}

func TestIDShapeOfAnEKSContext(t *testing.T) {
	id := ID(KindFile, "/home/alice/.kube/config", "arn:aws:eks:us-east-1:111122223333:cluster/prod")
	assert.Regexp(t, `^arn-aws-eks-us-east-1-111122223333-cluster-prod-[0-9a-f]{10}$`, id)
}

func TestSourceKeyIsKindLocatorAndExactContextSeparatedByNUL(t *testing.T) {
	assert.Equal(t, "file\x00/home/alice/.kube/config\x00Prod", SourceKey(KindFile, "/home/alice/.kube/config", "Prod"))

	// The ID hashes exactly that key.
	sum := sha256.Sum256([]byte(SourceKey(KindFile, "/p", "ctx")))
	assert.Equal(t, "ctx-"+hex.EncodeToString(sum[:5]), ID(KindFile, "/p", "ctx"))
}

func TestOnlyTheFileKindExists(t *testing.T) {
	assert.Equal(t, Kind("file"), KindFile)
}

func TestIDDependsOnKindLocatorAndExactName(t *testing.T) {
	base := ID(KindFile, "/a/config", "prod")
	assert.Equal(t, base, ID(KindFile, "/a/config", "prod"), "a pure function of its inputs")
	assert.NotEqual(t, base, ID(KindFile, "/b/config", "prod"), "same name in another file")
	assert.NotEqual(t, base, ID(KindFile, "/a/config", "Prod"), "names that differ only in case share a slug, not an ID")
	assert.NotEqual(t, base, ID(KindFile, "/a/config", "prod "), "names that differ only in characters the slug drops")
	assert.NotEqual(t, base, ID("other", "/a/config", "prod"), "the kind is part of the key")

	// The NUL separators keep (locator, name) pairs apart: moving a character across the
	// boundary must not give the same key.
	assert.NotEqual(t, SourceKey(KindFile, "/a/co", "nfig"), SourceKey(KindFile, "/a/conf", "ig"))
}

// A later source kind must be able to join without resetting an ID that already exists, so the
// hash is present however few connections there are.
func TestHashIsPresentEvenForAUniqueName(t *testing.T) {
	id := ID(KindFile, "/a/config", "only-one")
	assert.Regexp(t, `^only-one-[0-9a-f]{10}$`, id)
}

func TestFileLocatorFoldsCaseOnlyOnWindows(t *testing.T) {
	const path = `C:\Users\Alice\.kube\Config`
	assert.Equal(t, `c:\users\alice\.kube\config`, FileLocator(path, "windows"), "the whole path, drive letter included")
	for _, goos := range []string{"linux", "darwin", "freebsd", "plan9", ""} {
		assert.Equal(t, path, FileLocator(path, goos), goos)
	}
	assert.Equal(t, "/Home/Alice/.kube/Config", FileLocator("/Home/Alice/.kube/Config", "linux"), "case is preserved off Windows")

	// The case fold reaches the ID: one file spelled two ways is one source on Windows only.
	assert.Equal(t,
		ID(KindFile, FileLocator(`C:\Users\Alice\.kube\config`, "windows"), "prod"),
		ID(KindFile, FileLocator(`c:\users\alice\.kube\CONFIG`, "windows"), "prod"))
	assert.NotEqual(t,
		ID(KindFile, FileLocator("/Users/Alice/.kube/config", "linux"), "prod"),
		ID(KindFile, FileLocator("/users/alice/.kube/config", "linux"), "prod"))
}

func TestFromLegacyIDIsTheIDOfTheContextNameInTheSource(t *testing.T) {
	// Before this scheme the ID of a connection was its context name.
	assert.Equal(t, "prod-ea252c86a6", FromLegacyID("prod", KindFile, "/home/alice/.kube/config"))
	assert.Equal(t, ID(KindFile, "/x", "kind-dev"), FromLegacyID("kind-dev", KindFile, "/x"))
}

func TestSlug(t *testing.T) {
	for _, tt := range []struct{ name, in, want string }{
		{"already a slug", "prod", "prod"},
		{"lower-cased", "PROD", "prod"},
		{"digits and . _ - stay", "My_Cluster.v2-01", "my_cluster.v2-01"},
		{"EKS ARN", "arn:aws:eks:us-east-1:111122223333:cluster/prod", "arn-aws-eks-us-east-1-111122223333-cluster-prod"},
		{"other characters become a dash", "a b/c:d@e", "a-b-c-d-e"},
		{"runs collapse", "a   b", "a-b"},
		{"runs of literal dashes collapse", "a--b", "a-b"},
		{"mixed runs collapse", "a - / - b", "a-b"},
		{"leading dashes are trimmed", "--prod", "prod"},
		{"leading replaced characters are trimmed", "//prod", "prod"},
		{"trailing dashes are trimmed", "prod--", "prod"},
		{"dot and underscore may lead", ".hidden_", ".hidden_"},
		{"only separators", "---", "context"},
		{"only replaced characters", "///", "context"},
		{"empty", "", "context"},
		{"non-ASCII only", "日本語", "context"},
		{"non-ASCII between", "Straße", "stra-e"},
		{"NUL and newline", "a\x00b\nc", "a-b-c"},
		{"invalid UTF-8", "a\xffb", "a-b"},
		// Lower-casing folds ASCII letters only, so that the slug never depends on a Unicode table
		// or on the language that computes it: U+0130 and U+212A lower-case to ASCII in Go and
		// do not in JavaScript.
		{"dotted capital I is not folded", "\u0130stanbul", "stanbul"},
		{"Kelvin sign is not folded", "\u212aelvin", "elvin"},
		{"exactly 48 stays", strings.Repeat("a", 48), strings.Repeat("a", 48)},
		{"49 is cut to 48", strings.Repeat("a", 49), strings.Repeat("a", 48)},
		{"a cut that ends on a dash trims it", strings.Repeat("a", 47) + " " + strings.Repeat("b", 10), strings.Repeat("a", 47)},
		{"a cut after a dash-free 48", strings.Repeat("a", 48) + " b", strings.Repeat("a", 48)},
		{"trailing dash on a name of exactly 49", strings.Repeat("a", 48) + "-", strings.Repeat("a", 48)},
	} {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, slug(tt.in))
		})
	}
}

// The properties the consumers rely on, over a fixed pseudo-random corpus of context names that
// includes everything a kubeconfig can hold: separators, controls, NUL, multi-byte text and bytes
// that are not UTF-8.
func TestIDProperties(t *testing.T) {
	const locator = "/home/zz-secret-user/xx-private-dir/kubeconfig-file"
	rng := rand.New(rand.NewPCG(20261120, 6))
	// Pieces, not runes, so that names can hold bytes that are not UTF-8. Dashes are repeated to
	// make runs likely.
	pieces := []string{
		"a", "b", "z", "A", "Q", "Z", "0", "7", "9", ".", "_", "-", "-", "-", ":", "/", `\`, " ", "\t", "\n", "\x00",
		"@", "#", "%", "'", `"`, "~", "日", "本", "é", "ß", "\u0130", "\u212a", "\xff", "\xc3",
	}
	for range 5000 {
		var name strings.Builder
		for range rng.IntN(120) {
			name.WriteString(pieces[rng.IntN(len(pieces))])
		}
		id := ID(KindFile, locator, name.String())

		require.Regexp(t, idShape, id, "only [a-z0-9._-]: %q", name.String())
		require.LessOrEqual(t, len(id), 59, "%q", name.String())
		require.NotEqual(t, byte('-'), id[0], "an ID never starts with a dash: %q", name.String())
		s := slugOf(t, id)
		require.NotEmpty(t, s)
		require.LessOrEqual(t, len(s), 48)
		require.NotContains(t, s, "--", "%q", name.String())
		require.NotEqual(t, byte('-'), s[len(s)-1], "the slug never ends on a dash: %q", name.String())
		require.Equal(t, id, ID(KindFile, locator, name.String()), "deterministic")
		// None of these can be spelled by the pieces above, so a hit would be a leak of the locator.
		for _, private := range []string{"secret", "private", "kubeconfig", "/home", "home"} {
			require.NotContains(t, id, private, "the path, the home directory and the user name never appear in an ID")
		}
	}
}

func TestIDDoesNotExposeThePathHomeOrUser(t *testing.T) {
	id := ID(KindFile, "/Users/alice/.kube/config", "prod")
	for _, leak := range []string{"alice", "Users", "users", ".kube", "config", "/"} {
		assert.NotContains(t, id, leak)
	}
}

func TestContextFromData(t *testing.T) {
	assert.Equal(t, "context", DataKeyContext)

	name, err := ContextFromData(map[string]any{DataKeyContext: "Prod;$(x)", "kubeconfig": "/p"})
	require.NoError(t, err)
	assert.Equal(t, "Prod;$(x)", name, "the exact name, never folded")

	for label, data := range map[string]map[string]any{
		"nil data":     nil,
		"no key":       {"kubeconfig": "/p"},
		"empty":        {DataKeyContext: ""},
		"not a string": {DataKeyContext: 42},
		"a list":       {DataKeyContext: []string{"prod"}},
	} {
		_, err := ContextFromData(data)
		require.ErrorIs(t, err, ErrNoContext, label)
	}
}
