package helm

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/repo"
)

// helmCacheFixture points Helm's repository config and cache at a temp directory.
func helmCacheFixture(t *testing.T) (cache string) {
	t.Helper()
	dir := t.TempDir()
	cache = filepath.Join(dir, "cache")
	require.NoError(t, os.MkdirAll(cache, 0o755))
	t.Setenv("HELM_REPOSITORY_CONFIG", filepath.Join(dir, "repositories.yaml"))
	t.Setenv("HELM_REPOSITORY_CACHE", cache)
	return cache
}

func writeIndex(t *testing.T, path, chartName, description string) {
	t.Helper()
	index := repo.NewIndexFile()
	index.Entries[chartName] = repo.ChartVersions{{Metadata: &chart.Metadata{Name: chartName, Version: "1.0.0", APIVersion: "v2", Description: description}}}
	require.NoError(t, index.WriteFile(path, 0o600))
}

func TestLoadIndexReusesParsedIndexUntilFileChanges(t *testing.T) {
	cache := helmCacheFixture(t)
	parsedIndexes = parsedIndexCache{}
	path := filepath.Join(cache, "stable-index.yaml")
	writeIndex(t, path, "first", "")

	first, err := loadIndex("stable")
	require.NoError(t, err)
	again, err := loadIndex("stable")
	require.NoError(t, err)
	require.Same(t, first, again, "an unchanged file must not be parsed again")

	// Same size, different modification time.
	info, err := os.Stat(path)
	require.NoError(t, err)
	require.NoError(t, os.Chtimes(path, time.Now(), info.ModTime().Add(time.Hour)))
	touched, err := loadIndex("stable")
	require.NoError(t, err)
	require.NotSame(t, first, touched, "a changed modification time must be a miss")
	require.Contains(t, touched.Entries, "first")
	hit, err := loadIndex("stable")
	require.NoError(t, err)
	require.Same(t, touched, hit)

	// Same modification time, different size.
	info, err = os.Stat(path)
	require.NoError(t, err)
	writeIndex(t, path, "second-longer-name", "")
	require.NoError(t, os.Chtimes(path, time.Now(), info.ModTime()))
	resized, err := loadIndex("stable")
	require.NoError(t, err)
	require.NotSame(t, touched, resized, "a changed size must be a miss")
	require.Contains(t, resized.Entries, "second-longer-name")

	// A removed index is an error and is no longer retained.
	require.NoError(t, os.Remove(path))
	_, err = loadIndex("stable")
	require.True(t, os.IsNotExist(err))
	require.Empty(t, parsedIndexes.entries)
}

func TestParsedIndexCacheIsBounded(t *testing.T) {
	cache := helmCacheFixture(t)
	parsedIndexes = parsedIndexCache{}
	for i := range maxParsedIndexes + 4 {
		name := "repo-" + string(rune('a'+i))
		writeIndex(t, filepath.Join(cache, name+"-index.yaml"), "chart", "")
		_, err := loadIndex(name)
		require.NoError(t, err)
	}
	require.Len(t, parsedIndexes.entries, maxParsedIndexes)
}

func TestIndexLimitAppliesPerRepositoryNotToTheirSum(t *testing.T) {
	cache := helmCacheFixture(t)
	parsedIndexes = parsedIndexCache{}
	file := repo.NewFile()
	for _, name := range []string{"a", "b"} {
		file.Add(&repo.Entry{Name: name, URL: "https://unused.invalid/" + name})
		writeIndex(t, filepath.Join(cache, name+"-index.yaml"), "chart", strings.Repeat("x", 9<<20))
	}
	require.NoError(t, file.WriteFile(repoFile(), 0o600))

	value, err := NewChartResourcerWithActions(zap.NewNop().Sugar()).executeGetVersions("a", "chart")
	require.NoError(t, err, "two indexes that are each within the limit must stay readable")
	require.NotNil(t, value.Map["data"])

	_, err = NewChartResourcerWithActions(zap.NewNop().Sugar()).executeGetVersions("missing", "chart")
	require.ErrorContains(t, err, "repository missing not found in local cache")
	_, err = NewChartResourcerWithActions(zap.NewNop().Sugar()).executeGetVersions("a", "absent")
	require.ErrorContains(t, err, "chart absent not found in repository a")
}

func TestAwaitTransferReturnsOnCancelAndDiscardsLateResult(t *testing.T) {
	release := make(chan struct{})
	discarded := make(chan string, 1)
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	go func() { <-started; cancel() }()
	value, err := awaitTransfer(ctx, func() (string, error) {
		close(started)
		<-release
		return "late", nil
	}, func(v string) { discarded <- v })
	require.ErrorIs(t, err, context.Canceled)
	require.Empty(t, value)
	select {
	case <-discarded:
		t.Fatal("result discarded before the transfer finished")
	default:
	}
	close(release)
	require.Equal(t, "late", <-discarded, "the abandoned transfer's result must be released")

	failure := errors.New("boom")
	discards := 0
	_, err = awaitTransfer(context.Background(), func() (string, error) { return "partial", failure }, func(v string) {
		discards++
		require.Equal(t, "partial", v)
	})
	require.ErrorIs(t, err, failure)
	require.Equal(t, 1, discards)

	got, err := awaitTransfer(context.Background(), func() (string, error) { return "ok", nil }, func(string) { t.Error("successful result discarded") })
	require.NoError(t, err)
	require.Equal(t, "ok", got)
}

func TestTransferTimeoutFollowsCallerDeadline(t *testing.T) {
	timeout, err := transferTimeout(context.Background())
	require.NoError(t, err)
	require.Equal(t, 120*time.Second, timeout)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	timeout, err = transferTimeout(ctx)
	require.NoError(t, err)
	require.Greater(t, timeout, time.Duration(0))
	require.LessOrEqual(t, timeout, 5*time.Second)

	expired, cancelExpired := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancelExpired()
	_, err = transferTimeout(expired)
	require.ErrorIs(t, err, context.DeadlineExceeded)
}

func TestDownloadRepoIndexStagesChecksSizeAndKeepsPreviousIndex(t *testing.T) {
	cache := helmCacheFixture(t)
	parsedIndexes = parsedIndexCache{}
	var body func(http.ResponseWriter)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { body(w) }))
	t.Cleanup(server.Close)
	entry := &repo.Entry{Name: "stable", URL: server.URL}
	settings := cli.New()
	good := func(w http.ResponseWriter) {
		w.Write([]byte("apiVersion: v1\nentries:\n  fresh:\n  - name: fresh\n    version: 1.0.0\n    urls:\n    - fresh-1.0.0.tgz\n"))
	}

	body = good
	path, err := downloadRepoIndex(context.Background(), entry, settings)
	require.NoError(t, err)
	require.Equal(t, filepath.Join(cache, "stable-index.yaml"), path)
	index, err := loadIndex("stable")
	require.NoError(t, err)
	require.Contains(t, index.Entries, "fresh")
	require.FileExists(t, filepath.Join(cache, "stable-charts.txt"))
	entries, err := os.ReadDir(cache)
	require.NoError(t, err)
	for _, e := range entries {
		require.False(t, strings.HasPrefix(e.Name(), ".refresh-"), "staging left behind: "+e.Name())
	}

	// An index that cannot be read back must not replace the stored one.
	before, err := os.ReadFile(path)
	require.NoError(t, err)
	body = func(w http.ResponseWriter) {
		w.Write([]byte("apiVersion: v1\nentries:\n  big:\n  - name: big\n    version: 1.0.0\n    description: "))
		w.Write([]byte(strings.Repeat("x", maxIndexBytes)))
		w.Write([]byte("\n"))
	}
	_, err = downloadRepoIndex(context.Background(), entry, settings)
	require.ErrorContains(t, err, "exceeds 16 MiB")
	after, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, before, after, "previous index must survive a rejected refresh")
	entries, err = os.ReadDir(cache)
	require.NoError(t, err)
	for _, e := range entries {
		require.False(t, strings.HasPrefix(e.Name(), ".refresh-"), "staging left behind: "+e.Name())
	}

	// A failing transfer also leaves the previous index alone.
	body = func(w http.ResponseWriter) { http.Error(w, "nope", http.StatusInternalServerError) }
	_, err = downloadRepoIndex(context.Background(), entry, settings)
	require.Error(t, err)
	after, err = os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, before, after)
}

func TestDownloadRepoIndexHonorsCancellation(t *testing.T) {
	cache := helmCacheFixture(t)
	entered, release := make(chan struct{}, 1), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entered <- struct{}{}
		<-release
	}))
	t.Cleanup(server.Close)
	t.Cleanup(func() { close(release) })

	expired, cancelExpired := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancelExpired()
	_, err := downloadRepoIndex(expired, &repo.Entry{Name: "stable", URL: server.URL}, cli.New())
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.Empty(t, entered, "an expired context must not start a transfer")

	ctx, cancel := context.WithCancel(context.Background())
	go func() { <-entered; cancel() }()
	_, err = downloadRepoIndex(ctx, &repo.Entry{Name: "stable", URL: server.URL}, cli.New())
	require.ErrorIs(t, err, context.Canceled)
	require.NoFileExists(t, filepath.Join(cache, "stable-index.yaml"))
}

func chartRepositoryFixture(t *testing.T, cache string) (*httptest.Server, int) {
	t.Helper()
	archive, err := chartutil.Save(&chart.Chart{
		Metadata: &chart.Metadata{APIVersion: "v2", Name: "demo", Version: "1.0.0"},
		Raw:      []*chart.File{{Name: "values.yaml", Data: []byte("replicas: 1\n")}},
		Files:    []*chart.File{{Name: "README.md", Data: []byte("demo readme")}},
	}, t.TempDir())
	require.NoError(t, err)
	data, err := os.ReadFile(archive)
	require.NoError(t, err)
	var hits int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/demo-1.0.0.tgz" {
			http.NotFound(w, r)
			return
		}
		hits++
		w.Write(data)
	}))
	t.Cleanup(server.Close)
	index := repo.NewIndexFile()
	index.MustAdd(&chart.Metadata{APIVersion: "v2", Name: "demo", Version: "1.0.0"}, "demo-1.0.0.tgz", server.URL, "sha256:unused")
	require.NoError(t, index.WriteFile(filepath.Join(cache, "demo-repo-index.yaml"), 0o600))
	file := repo.NewFile()
	file.Add(&repo.Entry{Name: "demo-repo", URL: server.URL})
	require.NoError(t, file.WriteFile(repoFile(), 0o600))
	return server, hits
}

func TestLocateAndLoadChartLeavesNoArchivesBehind(t *testing.T) {
	cache := helmCacheFixture(t)
	scratch := t.TempDir()
	t.Setenv("TMPDIR", scratch)
	server, _ := chartRepositoryFixture(t, cache)
	_ = server

	for range 20 {
		ch, err := locateAndLoadChart(context.Background(), &action.ChartPathOptions{Version: "1.0.0"}, "demo-repo/demo", cli.New())
		require.NoError(t, err)
		require.Equal(t, "demo", ch.Metadata.Name)
	}
	entries, err := os.ReadDir(cache)
	require.NoError(t, err)
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	require.Equal(t, []string{"demo-repo-index.yaml"}, names, "chart archives must not accumulate in the repository cache")
	leftovers, err := os.ReadDir(scratch)
	require.NoError(t, err)
	require.Empty(t, leftovers, "per-call download directories must be removed")
}

func TestLocateAndLoadChartHonorsContext(t *testing.T) {
	cache := helmCacheFixture(t)
	scratch := t.TempDir()
	t.Setenv("TMPDIR", scratch)
	chartRepositoryFixture(t, cache)

	expired, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	_, err := locateAndLoadChart(expired, &action.ChartPathOptions{Version: "1.0.0"}, "demo-repo/demo", cli.New())
	require.ErrorIs(t, err, context.DeadlineExceeded)
	leftovers, err := os.ReadDir(scratch)
	require.NoError(t, err)
	require.Empty(t, leftovers)
}

func TestChartActionsReadValuesAndReadme(t *testing.T) {
	cache := helmCacheFixture(t)
	chartRepositoryFixture(t, cache)
	resourcer := NewChartResourcerWithActions(zap.NewNop().Sugar())
	ref := resource.ResourceReference{Address: resource.ResourceAddress{Provider: "kubernetes", Type: ChartType, ID: "demo-repo/demo"}}
	params, err := resource.ValueFromNative(map[string]interface{}{"version": "1.0.0"})
	require.NoError(t, err)
	detail, err := resourcer.Action(context.Background(), nil, resource.ActionRequest{Reference: ref, Action: "get-chart-detail", Input: params})
	require.NoError(t, err)
	data, err := nativeObject(detail.Map["data"])
	require.NoError(t, err)
	require.Equal(t, "replicas: 1\n", data["values"])
	require.Equal(t, "demo readme", data["readme"])
}
