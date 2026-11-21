package resource

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/omniview/kubernetes/pkg/connid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// foldsCase reports whether the file system that holds dir takes two names that differ only in case
// for one file (the default of macOS and of Windows).
func foldsCase(t *testing.T, dir string) bool {
	t.Helper()
	probe := filepath.Join(dir, "case-probe")
	require.NoError(t, os.WriteFile(probe, nil, 0o600))
	defer func() { require.NoError(t, os.Remove(probe)) }()
	lower, err := os.Stat(probe)
	require.NoError(t, err)
	upper, err := os.Stat(filepath.Join(dir, "CASE-PROBE"))
	return err == nil && os.SameFile(lower, upper)
}

// spelling is another way to reach a file, or the reason that it cannot be made on this machine.
type spelling struct {
	name string
	path string
	skip string // the capability that is missing here
}

// otherSpellings makes the spellings of the file at original that a path alone cannot tell are the same
// file: a hard link to it, and its name in another case where the file system ignores case.
func otherSpellings(t *testing.T, dir, original string) []spelling {
	t.Helper()
	hard := spelling{name: "hard link", path: filepath.Join(dir, "hard")}
	if err := os.Link(original, hard.path); err != nil {
		hard.skip = "this file system makes no hard link: " + err.Error()
	}
	variant := spelling{name: "case variant", path: filepath.Join(dir, strings.ToLower(filepath.Base(original)))}
	if !foldsCase(t, dir) {
		variant.skip = "this file system tells names apart by case"
	}
	return []spelling{hard, variant}
}

// One file is one source whatever it is called: a hard link to it, or the same name spelled in another
// case on a file system that ignores case, reach the file as a symlink does. The first spelling in the
// configured order stays and keeps the ID of its own path, so the IDs do not change from one start to the
// next while the list keeps its order.
func TestTheSameKubeconfigReachedByAHardLinkOrACaseVariantYieldsOneConnectionPerContext(t *testing.T) {
	dir := t.TempDir()
	original := filepath.Join(dir, "Config")
	writeInventoryKubeconfig(t, original, "https://10.0.0.1:6443", "prod", "dev")

	spellings := otherSpellings(t, dir, original)
	for loaderName, load := range inventoryLoaders(t) {
		t.Run(loaderName, func(t *testing.T) {
			for _, other := range spellings {
				t.Run(other.name, func(t *testing.T) {
					if other.skip != "" {
						t.Skip(other.skip)
					}
					for _, tt := range []struct {
						name  string
						paths []string
						kept  string
					}{
						{"file then " + other.name, []string{original, other.path}, original},
						{other.name + " then file", []string{other.path, original}, other.path},
						{other.name + " twice around the file", []string{other.path, original, other.path}, other.path},
					} {
						t.Run(tt.name, func(t *testing.T) {
							connections := load(tt.paths...)

							require.Len(t, connections, 2, "one connection for each context of the one file")
							assertDistinctIDs(t, connections)
							assert.Equal(t, []string{"dev", "prod"}, namesOf(connections))
							for _, connection := range connections {
								assert.Equal(t, connid.ID(connid.KindFile, inventoryLocator(t, tt.kept), connection.Name), connection.ID,
									"the ID comes from the path of the first listed spelling")
								assert.Equal(t, tt.kept, connection.Data["kubeconfig"])
							}
							assert.Equal(t, connections, load(tt.paths...), "the same list gives the same connections at the next start")
						})
					}
				})
			}
		})
	}
}

// Two files that only look alike are two sources: the same text in another file is not the same file.
func TestACopyOfAKubeconfigIsAnotherFile(t *testing.T) {
	dir := t.TempDir()
	original, duplicate := filepath.Join(dir, "config"), filepath.Join(dir, "copy")
	writeInventoryKubeconfig(t, original, "https://10.0.0.1:6443", "prod", "dev")
	text, err := os.ReadFile(original)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(duplicate, text, 0o600))

	for loaderName, load := range inventoryLoaders(t) {
		t.Run(loaderName, func(t *testing.T) {
			connections := load(original, duplicate)

			require.Len(t, connections, 4, "a copy is a source of its own")
			assertDistinctIDs(t, connections)
			assert.Equal(t, []string{"dev", "dev", "prod", "prod"}, namesOf(connections))
		})
	}
}

// shareTargets looks only at what the file system said: a file that it could not say anything about is
// recognized by its path alone, and is never taken for another file.
func TestShareTargetsLeavesAFileTheFileSystemCouldNotDescribeAlone(t *testing.T) {
	dir := t.TempDir()
	first, second := filepath.Join(dir, "first"), filepath.Join(dir, "second")
	writeInventoryKubeconfig(t, first, "https://10.0.0.1:6443", "prod")
	writeInventoryKubeconfig(t, second, "https://10.0.0.2:6443", "prod")
	firstInfo, secondInfo := kubeconfigFileInfo(first), kubeconfigFileInfo(second)
	require.NotNil(t, firstInfo)
	require.NotNil(t, secondInfo)
	require.Nil(t, kubeconfigFileInfo(filepath.Join(dir, "missing")))

	files := []inventoryFile{
		{index: 0, target: "/a"},
		{index: 1, target: "/b"},
		{index: 2, target: "/c", info: firstInfo},
		{index: 3, target: "/d", info: secondInfo},
		{index: 4, target: "/e", info: firstInfo},
	}
	shareTargets(files)

	targets := make([]string, 0, len(files))
	for _, file := range files {
		targets = append(targets, file.target)
	}
	assert.Equal(t, []string{"/a", "/b", "/c", "/d", "/c"}, targets, "only the file that the file system says is the same takes the earlier target")
}

// A path is made absolute against the working directory of the plugin before it is hashed, so that the
// same file gives one ID however it is written.
func TestARelativeKubeconfigPathGivesTheIDOfItsAbsolutePath(t *testing.T) {
	dir := t.TempDir()
	writeInventoryKubeconfig(t, filepath.Join(dir, "config"), "https://10.0.0.1:6443", "prod")
	t.Chdir(dir)
	here, err := os.Getwd()
	require.NoError(t, err)
	want := connid.ID(connid.KindFile, connid.FileLocator(filepath.Join(here, "config"), runtime.GOOS), "prod")

	for loaderName, load := range inventoryLoaders(t) {
		t.Run(loaderName, func(t *testing.T) {
			for _, spelling := range []string{"config", "." + string(filepath.Separator) + "config", filepath.Join("..", filepath.Base(dir), "config")} {
				connections := load(spelling)

				require.Len(t, connections, 1, spelling)
				assert.Equal(t, want, connections[0].ID, "%q is the file at %q", spelling, filepath.Join(here, "config"))
			}
			assert.Len(t, load("config", filepath.Join(here, "config")), 1, "the relative and the absolute spelling of one file are one connection")
		})
	}
}

// setKubeconfigOS runs the rest of the test under the file-name rules of another operating system.
func setKubeconfigOS(t *testing.T, goos string) {
	t.Helper()
	kubeconfigOS.Store(&goos)
	t.Cleanup(func() { kubeconfigOS.Store(nil) })
}

// The rule of the machine's file system is the one the locator follows, in every loader: Windows
// ignores case, so on Windows one file spelled two ways is one source. The OS is a seam so that the
// wiring is checked on any machine; connid tests the rule itself.
func TestTheLocatorOfEveryLoaderFollowsTheFileNameRulesOfTheOS(t *testing.T) {
	assert.Equal(t, runtime.GOOS, currentKubeconfigOS(), "the rule is the machine's unless a test says otherwise")

	dir := filepath.Join(t.TempDir(), "Team-A")
	require.NoError(t, os.Mkdir(dir, 0o700))
	path := filepath.Join(dir, "KubeConfig")
	writeInventoryKubeconfig(t, path, "https://10.0.0.1:6443", "prod")
	exact := filepath.Clean(inventoryAbs(t, path))
	require.NotEqual(t, exact, strings.ToLower(exact), "the path has capitals, or this test cannot tell the rules apart")

	for _, tt := range []struct {
		goos    string
		locator string
	}{
		{"windows", strings.ToLower(exact)},
		{"linux", exact},
		{"darwin", exact},
	} {
		t.Run(tt.goos, func(t *testing.T) {
			setKubeconfigOS(t, tt.goos)
			for loaderName, load := range inventoryLoaders(t) {
				t.Run(loaderName, func(t *testing.T) {
					connections := load(path)

					require.Len(t, connections, 1)
					assert.Equal(t, connid.ID(connid.KindFile, tt.locator, "prod"), connections[0].ID)
				})
			}
		})
	}
}

// inventoryAbs is the absolute path of path, as the definition of a locator says (before any case is
// folded), worked out from the working directory here and not by the code under test.
func inventoryAbs(t *testing.T, path string) string {
	t.Helper()
	if filepath.IsAbs(path) {
		return path
	}
	here, err := os.Getwd()
	require.NoError(t, err)
	return filepath.Join(here, path)
}
