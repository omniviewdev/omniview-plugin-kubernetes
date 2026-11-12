package helm

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/downloader"
	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/helmpath"
	"helm.sh/helm/v3/pkg/registry"
	"helm.sh/helm/v3/pkg/repo"
)

// maxIndexBytes bounds a repository index file. Refresh refuses to store a
// larger index, so every index that was refreshed successfully can be read.
const maxIndexBytes = 16 << 20

// transferTimeout is the HTTP timeout for one Helm transfer: Helm's own default,
// shortened to the caller's remaining deadline. An already finished context is
// returned as an error without starting a transfer.
func transferTimeout(ctx context.Context) (time.Duration, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	timeout := time.Duration(getter.DefaultHTTPTimeout) * time.Second
	if deadline, ok := ctx.Deadline(); ok {
		if remaining := time.Until(deadline); remaining < timeout {
			timeout = remaining
		}
	}
	return timeout, nil
}

// awaitTransfer runs a blocking Helm transfer, which takes no context, and
// returns as soon as it ends or ctx is done. Whenever an error is returned,
// discard is called exactly once with whatever the transfer produced: at once
// for a failed transfer, or after an abandoned one finishes. An abandoned
// transfer is bounded by its HTTP timeout.
func awaitTransfer[T any](ctx context.Context, run func() (T, error), discard func(T)) (T, error) {
	type outcome struct {
		value T
		err   error
	}
	done := make(chan outcome, 1)
	go func() {
		value, err := run()
		done <- outcome{value, err}
	}()
	select {
	case result := <-done:
		if result.err != nil {
			discard(result.value)
		}
		return result.value, result.err
	case <-ctx.Done():
		go func() { discard((<-done).value) }()
		var zero T
		return zero, ctx.Err()
	}
}

// downloadRepoIndex refreshes a repository's cached index. Helm downloads into a
// staging directory inside the cache; the index is only moved into place once it
// is known to be readable, so a failed or oversized refresh keeps the previous
// index and a reader never sees a partial file.
func downloadRepoIndex(ctx context.Context, entry *repo.Entry, settings *cli.EnvSettings) (string, error) {
	timeout, err := transferTimeout(ctx)
	if err != nil {
		return "", err
	}
	chartRepo, err := repo.NewChartRepository(entry, getter.All(settings, getter.WithTimeout(timeout)))
	if err != nil {
		return "", fmt.Errorf("failed to create chart repository: %w", err)
	}
	if err := os.MkdirAll(settings.RepositoryCache, 0o755); err != nil {
		return "", err
	}
	staging, err := os.MkdirTemp(settings.RepositoryCache, ".refresh-")
	if err != nil {
		return "", err
	}
	chartRepo.CachePath = staging
	stagedIndex, err := awaitTransfer(ctx, chartRepo.DownloadIndexFile, func(string) { os.RemoveAll(staging) })
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(staging)
	info, err := os.Stat(stagedIndex)
	if err != nil {
		return "", err
	}
	if info.Size() > maxIndexBytes {
		return "", fmt.Errorf("Helm index exceeds 16 MiB")
	}
	finalIndex := filepath.Join(settings.RepositoryCache, helmpath.CacheIndexFile(entry.Name))
	// The chart name list is an optional completion aid; keep it with its index.
	stagedCharts := filepath.Join(staging, helmpath.CacheChartsFile(entry.Name))
	if _, statErr := os.Stat(stagedCharts); statErr == nil {
		if err := os.Rename(stagedCharts, filepath.Join(settings.RepositoryCache, helmpath.CacheChartsFile(entry.Name))); err != nil {
			return "", err
		}
	}
	if err := os.Rename(stagedIndex, finalIndex); err != nil {
		return "", err
	}
	return finalIndex, nil
}

// locateChartArchive resolves a chart reference to a local path. Repository
// charts are downloaded into a private directory, within the caller's deadline,
// and the returned cleanup removes it; archives never accumulate in the cache.
// Local paths, registry references and non-default options use Helm's own lookup.
func locateChartArchive(ctx context.Context, opts *action.ChartPathOptions, chartRef string, settings *cli.EnvSettings) (string, func(), error) {
	noCleanup := func() {}
	name := strings.TrimSpace(chartRef)
	if opts.RepoURL != "" || opts.Verify || registry.IsOCI(name) || filepath.IsAbs(name) || strings.HasPrefix(name, ".") {
		path, err := opts.LocateChart(chartRef, settings)
		return path, noCleanup, err
	}
	if _, err := os.Stat(name); err == nil {
		path, err := opts.LocateChart(chartRef, settings)
		return path, noCleanup, err
	}
	timeout, err := transferTimeout(ctx)
	if err != nil {
		return "", noCleanup, err
	}
	dest, err := os.MkdirTemp("", "omniview-helm-chart-")
	if err != nil {
		return "", noCleanup, err
	}
	dl := downloader.ChartDownloader{
		Out:     io.Discard,
		Getters: getter.All(settings, getter.WithTimeout(timeout)),
		Options: []getter.Option{
			getter.WithPassCredentialsAll(opts.PassCredentialsAll),
			getter.WithTLSClientConfig(opts.CertFile, opts.KeyFile, opts.CaFile),
			getter.WithInsecureSkipVerifyTLS(opts.InsecureSkipTLSverify),
			getter.WithPlainHTTP(opts.PlainHTTP),
			getter.WithBasicAuth(opts.Username, opts.Password),
		},
		RepositoryConfig: settings.RepositoryConfig,
		RepositoryCache:  settings.RepositoryCache,
	}
	path, err := awaitTransfer(ctx, func() (string, error) {
		path, _, err := dl.DownloadTo(name, strings.TrimSpace(opts.Version), dest)
		return path, err
	}, func(string) { os.RemoveAll(dest) })
	if err != nil {
		return "", noCleanup, err
	}
	return path, func() { os.RemoveAll(dest) }, nil
}
