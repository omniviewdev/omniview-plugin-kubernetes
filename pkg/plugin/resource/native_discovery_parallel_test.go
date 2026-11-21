package resource

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"k8s.io/client-go/discovery"
)

// Without aggregated discovery every group version is a request. The built-in ones are read by a pool of four; the versions of an extension group are all read at once, so that
// the ones that hang cost one bound in total (nativeGroupReadBound).
func TestNativeDiscoveryParallelRequests(t *testing.T) {
	for _, scenario := range []struct {
		name  string
		serve func(*testing.T, *refreshHTTPFixture)
		// overlap is how many reads wait together before any is answered: all of them, or the pool's four.
		overlap int
		// want is what a complete discovery lists, in the order of the index.
		want []string
	}{
		{
			"built-in group versions are read by a pool of four",
			func(t *testing.T, f *refreshHTTPFixture) {
				f.setVersions(t)
				for _, gv := range [][2]string{{"apps", "v1"}, {"apps", "v1beta1"}, {"apps", "v1beta2"}, {"batch", "v1"}, {"batch", "v1beta1"}, {"autoscaling", "v1"}, {"autoscaling", "v2"}} {
					f.serveGroupVersion(t, gv[0], gv[1], "things")
				}
			},
			nativeCatalogRequestConcurrency,
			[]string{"v1", "apps/v1", "apps/v1beta1", "apps/v1beta2", "batch/v1", "batch/v1beta1", "autoscaling/v1", "autoscaling/v2"},
		},
		{
			"the versions of an extension group are all read at once",
			func(t *testing.T, f *refreshHTTPFixture) { f.setVersions(t, "v1", "v2", "v3", "v4", "v5", "v6", "v7") },
			8, // core v1 and the seven versions
			[]string{"v1", "refresh.example/v1", "refresh.example/v2", "refresh.example/v3", "refresh.example/v4", "refresh.example/v5", "refresh.example/v6", "refresh.example/v7"},
		},
	} {
		for _, cancelRequests := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/cancel=%t", scenario.name, cancelRequests), func(t *testing.T) {
				f, client := newRefreshHTTPFixture(t)
				scenario.serve(t, f)
				entered := make(chan string, 16)
				release := make(chan struct{}, 16)
				var active, peak atomic.Int32
				f.mu.Lock()
				f.hook = func(w http.ResponseWriter, r *http.Request) bool {
					if r.URL.Path == "/api" || r.URL.Path == "/apis" {
						return false
					}
					n := active.Add(1)
					defer active.Add(-1)
					for old := peak.Load(); n > old; old = peak.Load() {
						if peak.CompareAndSwap(old, n) {
							break
						}
					}
					entered <- r.URL.Path
					select {
					case <-release:
						return false
					case <-r.Context().Done():
						return true
					}
				}
				f.mu.Unlock()
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				t.Cleanup(func() { close(release) })
				type outcome struct {
					versions []string
					err      error
				}
				done := make(chan outcome, 1)
				go func() {
					_, lists, err := discoverNativeResources(ctx, client.DiscoveryClient)
					result := outcome{err: err}
					for _, list := range lists {
						result.versions = append(result.versions, list.GroupVersion)
					}
					done <- result
				}()
				for range scenario.overlap {
					select {
					case <-entered:
					case <-time.After(5 * time.Second):
						t.Fatalf("discovery did not overlap %d requests", scenario.overlap)
					}
				}
				if scenario.overlap < len(scenario.want) {
					// The pool is full: a read more must not begin while the four wait.
					select {
					case path := <-entered:
						t.Fatalf("a read of %s began while %d waited", path, scenario.overlap)
					case <-time.After(200 * time.Millisecond):
					}
				}
				if cancelRequests {
					cancel()
				} else {
					// Send tokens rather than closing: cleanup owns the close.
					for range 16 {
						release <- struct{}{}
					}
				}
				select {
				case result := <-done:
					if cancelRequests {
						require.ErrorIs(t, result.err, context.Canceled)
						require.Empty(t, result.versions)
					} else {
						require.NoError(t, result.err)
						require.Equal(t, scenario.want, result.versions)
					}
				case <-time.After(5 * time.Second):
					t.Fatal("discovery did not finish")
				}
				require.Equal(t, int32(scenario.overlap), peak.Load())
			})
		}
	}
}

func TestNativeDiscoveryValidatesBeforeDispatch(t *testing.T) {
	f, client := newRefreshHTTPFixture(t)
	f.setVersions(t, "v1", "v1")
	_, _, err := discoverNativeResources(context.Background(), client.DiscoveryClient)
	require.ErrorContains(t, err, "duplicate")
	require.Equal(t, 0, f.count("/api/v1"))
	require.Equal(t, 0, f.count("/apis/refresh.example/v1"))
}

func TestNativeDiscoveryConcurrentAggregateBudget(t *testing.T) {
	f, client := newRefreshHTTPFixture(t)
	f.setVersions(t, "v1", "v2", "v3", "v4", "v5", "v6")
	f.mu.Lock()
	for path, document := range f.documents {
		if strings.HasPrefix(path, "/apis/refresh.example/") {
			f.documents[path] = document + strings.Repeat(" ", 3<<20)
		}
	}
	f.mu.Unlock()
	_, lists, err := discoverNativeResources(context.Background(), client.DiscoveryClient)
	var partial *discovery.ErrGroupDiscoveryFailed
	require.ErrorAs(t, err, &partial)
	require.NotEmpty(t, lists, "valid discovery remains available to partial-coverage consumers")
	accepted := 0
	for _, list := range lists {
		if strings.HasPrefix(list.GroupVersion, "refresh.example/") {
			accepted++
		}
	}
	require.LessOrEqual(t, accepted, 5, "workers must share one aggregate read allowance")
	for _, cause := range partial.Groups {
		require.ErrorContains(t, cause, "byte budget")
	}
}

func TestNativeDiscoveryMismatchFailsWithoutPartialResults(t *testing.T) {
	f, client := newRefreshHTTPFixture(t)
	f.mu.Lock()
	f.documents["/apis/refresh.example/v2"] = `{"groupVersion":"other.example/v2","resources":[]}`
	f.mu.Unlock()
	groups, lists, err := discoverNativeResources(context.Background(), client.DiscoveryClient)
	require.ErrorContains(t, err, "different group version")
	require.Nil(t, groups)
	require.Nil(t, lists)
}

func TestNativeDiscoveryPartialFailureKeepsOrderedResults(t *testing.T) {
	f, client := newRefreshHTTPFixture(t)
	f.mu.Lock()
	f.fail = "/apis/refresh.example/v1"
	f.mu.Unlock()
	_, lists, err := discoverNativeResources(context.Background(), client.DiscoveryClient)
	var partial *discovery.ErrGroupDiscoveryFailed
	require.ErrorAs(t, err, &partial)
	require.Len(t, partial.Groups, 1)
	require.Len(t, lists, 2)
	require.Equal(t, "v1", lists[0].GroupVersion)
	require.Equal(t, "refresh.example/v2", lists[1].GroupVersion)
}
