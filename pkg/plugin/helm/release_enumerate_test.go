package helm

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"helm.sh/helm/v3/pkg/chart"
	helmrelease "helm.sh/helm/v3/pkg/release"
	helmtime "helm.sh/helm/v3/pkg/time"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
)

// helmStorageFake serves Helm secret storage the way the API server does:
// entries sorted by key, label-selected metadata lists with limit/continue,
// and single-entry GETs. It counts every request class.
type helmStorageFake struct {
	secrets []corev1.Secret // sorted by name

	metadataLists atomic.Int64
	namedLists    atomic.Int64
	fullLists     atomic.Int64
	versionGets   atomic.Int64
	secretGets    atomic.Int64
	getMu         sync.Mutex
	gets          map[string]int
}

func newHelmStorageFake(t *testing.T, names []string, revisions int) *helmStorageFake {
	t.Helper()
	fake := &helmStorageFake{gets: map[string]int{}}
	for _, name := range names {
		for version := 1; version <= revisions; version++ {
			rel := &helmrelease.Release{
				Name: name, Namespace: "selected", Version: version,
				Info:   &helmrelease.Info{FirstDeployed: helmtime.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC), Status: helmrelease.StatusDeployed},
				Chart:  &chart.Chart{Metadata: &chart.Metadata{Name: name + "-chart", Version: fmt.Sprintf("1.0.%d", version)}},
				Config: map[string]interface{}{"revision": version, "release": name},
			}
			raw, err := json.Marshal(rel)
			require.NoError(t, err)
			var compressed bytes.Buffer
			compressor := gzip.NewWriter(&compressed)
			_, err = compressor.Write(raw)
			require.NoError(t, err)
			require.NoError(t, compressor.Close())
			key := fmt.Sprintf("sh.helm.release.v1.%s.v%d", name, version)
			fake.secrets = append(fake.secrets, corev1.Secret{
				TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "Secret"},
				ObjectMeta: metav1.ObjectMeta{
					Name: key, Namespace: "selected", UID: k8stypes.UID("uid-" + key),
					Labels: map[string]string{"owner": "helm", "name": name, "version": strconv.Itoa(version), "status": "deployed"},
				},
				Type: "helm.sh/release.v1",
				Data: map[string][]byte{"release": []byte(base64.StdEncoding.EncodeToString(compressed.Bytes()))},
			})
		}
	}
	sort.Slice(fake.secrets, func(i, j int) bool { return fake.secrets[i].Name < fake.secrets[j].Name })
	return fake
}

func (f *helmStorageFake) reset() {
	f.metadataLists.Store(0)
	f.namedLists.Store(0)
	f.fullLists.Store(0)
	f.versionGets.Store(0)
	f.secretGets.Store(0)
	f.getMu.Lock()
	f.gets = map[string]int{}
	f.getMu.Unlock()
}

func (f *helmStorageFake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	const collection = "/api/v1/namespaces/selected/secrets"
	switch {
	case r.URL.Path == "/version":
		f.versionGets.Add(1)
		fmt.Fprint(w, `{"major":"1","minor":"35","gitVersion":"v1.35.0"}`)
	case r.URL.Path == collection:
		f.metadataLists.Add(1)
		selector := r.URL.Query().Get("labelSelector")
		var match func(corev1.Secret) bool
		switch {
		case selector == "owner=helm":
			f.fullLists.Add(1)
			match = func(corev1.Secret) bool { return true }
		case strings.HasPrefix(selector, "owner=helm,name="):
			f.namedLists.Add(1)
			name := strings.TrimPrefix(selector, "owner=helm,name=")
			match = func(s corev1.Secret) bool { return s.Labels["name"] == name }
		default:
			http.Error(w, "unexpected selector "+selector, http.StatusBadRequest)
			return
		}
		start := 0
		if token := r.URL.Query().Get("continue"); token != "" {
			start, _ = strconv.Atoi(token)
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		list := metav1.PartialObjectMetadataList{TypeMeta: metav1.TypeMeta{APIVersion: "meta.k8s.io/v1", Kind: "PartialObjectMetadataList"}}
		i := start
		for ; i < len(f.secrets) && len(list.Items) < limit; i++ {
			if match(f.secrets[i]) {
				list.Items = append(list.Items, metav1.PartialObjectMetadata{ObjectMeta: f.secrets[i].ObjectMeta})
			}
		}
		for j := i; j < len(f.secrets) && list.Continue == ""; j++ {
			if match(f.secrets[j]) {
				list.Continue = strconv.Itoa(i)
			}
		}
		json.NewEncoder(w).Encode(list)
	case strings.HasPrefix(r.URL.Path, collection+"/"):
		key := strings.TrimPrefix(r.URL.Path, collection+"/")
		f.secretGets.Add(1)
		f.getMu.Lock()
		f.gets[key]++
		f.getMu.Unlock()
		for _, secret := range f.secrets {
			if secret.Name == key {
				json.NewEncoder(w).Encode(secret)
				return
			}
		}
		http.Error(w, "not found", http.StatusNotFound)
	default:
		http.Error(w, "unexpected endpoint "+r.URL.Path, http.StatusNotFound)
	}
}

func (f *helmStorageFake) client(t *testing.T) (*clients.ClientSet, context.Context) {
	t.Helper()
	server := httptest.NewServer(f)
	t.Cleanup(server.Close)
	client := &clients.ClientSet{RESTConfig: &rest.Config{Host: server.URL}, HTTPClient: &http.Client{Transport: http.DefaultTransport}}
	ctx := sdkresource.WithSession(context.Background(), sdkresource.Session{Connection: &types.Connection{ID: "owned-cluster"}})
	return client, ctx
}

func enumerateTarget() sdkresource.ReadTarget {
	namespaces := []string{"selected"}
	return sdkresource.ReadTarget{
		Provider: "kubernetes", Authority: "fixture-authority", Type: ReleaseType,
		Scope: []sdkresource.ScopeConstraint{{Dimension: "namespace", Match: sdkresource.ScopeOneOf, Values: &namespaces}},
	}
}

// enumerateAll pages through every release page and returns the records in order.
func enumerateAll(t *testing.T, ctx context.Context, client *clients.ClientSet, pageSize uint32) []sdkresource.Record {
	t.Helper()
	ancillary := NewHelmAncillary(zap.NewNop().Sugar())
	var records []sdkresource.Record
	var cursor *string
	for pages := 0; ; pages++ {
		require.Less(t, pages, 1000, "enumeration did not terminate")
		page, err := ancillary.Enumerate(ctx, client, sdkresource.EnumerateRequest{Target: enumerateTarget(), PageSize: pageSize, Cursor: cursor})
		require.NoError(t, err)
		records = append(records, page.Records...)
		if page.NextCursor == nil {
			return records
		}
		cursor = page.NextCursor
	}
}

// legacyEnumerate is the previous enumeration: every storage entry is resolved
// through a release-qualified lookup and a full decode, then older revisions
// are discarded. It is the behavioral reference for the optimized path.
func legacyEnumerate(t *testing.T, ctx context.Context, client *clients.ClientSet, fake *helmStorageFake) []sdkresource.Record {
	t.Helper()
	ancillary := NewHelmAncillary(zap.NewNop().Sugar())
	var records []sdkresource.Record
	for _, item := range fake.secrets {
		name, namespace := item.Labels["name"], item.Namespace
		cfg, err := ancillary.release.getConfig(ctx, client, namespace)
		require.NoError(t, err)
		snapshot, err := getNamedRelease(ctx, client, cfg, namespace, name, nil)
		require.NoError(t, err)
		if strconv.Itoa(snapshot.release.Version) != item.Labels["version"] || string(item.UID) != snapshot.identity.uid {
			continue
		}
		scope := []sdkresource.ScopeEntry{{Dimension: "namespace", Value: namespace}}
		record, err := helmReleaseRecord(targetReference(enumerateTarget(), name, scope), snapshot)
		require.NoError(t, err)
		records = append(records, record)
	}
	return records
}

func TestEnumerateReleasesDecodesOnlyLatestRevisionFromOneList(t *testing.T) {
	t.Setenv("HELM_DRIVER", "secrets")
	fake := newHelmStorageFake(t, []string{"app", "cache", "zeta"}, 10)
	client, ctx := fake.client(t)

	records := enumerateAll(t, ctx, client, 256)
	require.EqualValues(t, 1, fake.metadataLists.Load(), "one LIST must cover every revision")
	require.EqualValues(t, 1, fake.fullLists.Load())
	require.EqualValues(t, 0, fake.namedLists.Load(), "no per-release lookup is needed when the page holds all revisions")
	require.EqualValues(t, 0, fake.versionGets.Load(), "enumeration must not probe /version per release")
	require.EqualValues(t, 3, fake.secretGets.Load(), "only the latest revision of each release is decoded")
	for _, key := range []string{"sh.helm.release.v1.app.v10", "sh.helm.release.v1.cache.v10", "sh.helm.release.v1.zeta.v10"} {
		require.Equal(t, 1, fake.gets[key], key)
	}
	require.Len(t, records, 3)

	fake.reset()
	expected := legacyEnumerate(t, ctx, client, fake)
	require.Greater(t, fake.secretGets.Load(), int64(3), "reference path decodes more than the latest revisions")
	require.Equal(t, expected, records)
}

func TestEnumerateReleasesPagesMatchLegacyOutput(t *testing.T) {
	t.Setenv("HELM_DRIVER", "secrets")
	// "app.v1a" sorts between app.v10 and app.v2, so revisions of "app" are not
	// contiguous in storage order; "app-b" sorts before "app".
	fake := newHelmStorageFake(t, []string{"app", "app-b", "app.v1a", "zeta"}, 10)
	client, ctx := fake.client(t)
	expected := legacyEnumerate(t, ctx, client, fake)
	require.Len(t, expected, 4)

	for _, size := range []uint32{0, 1, 2, 3, 7, 10, 11, 13, 20, 39, 40, 41, 256} {
		t.Run(fmt.Sprintf("page size %d", size), func(t *testing.T) {
			fake.reset()
			records := enumerateAll(t, ctx, client, size)
			require.Equal(t, expected, records)
			require.EqualValues(t, 0, fake.versionGets.Load())
			require.LessOrEqual(t, fake.secretGets.Load(), int64(4), "each release is decoded at most once")
			for key, count := range fake.gets {
				require.Equal(t, 1, count, key)
				require.True(t, strings.HasSuffix(key, ".v10"), "decoded a non-latest revision: "+key)
			}
		})
	}
}

func TestReleasePageHoldsAllRevisions(t *testing.T) {
	item := func(name string) metav1.PartialObjectMetadata {
		return metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{Namespace: "ns", Name: name}}
	}
	items := []metav1.PartialObjectMetadata{item("sh.helm.release.v1.b.v1"), item("sh.helm.release.v1.c.v1"), item("sh.helm.release.v1.d.v1")}

	all := releasePageHoldsAllRevisions(items, false, false)
	require.True(t, all("ns", "b"))

	middle := releasePageHoldsAllRevisions(items, true, true)
	require.True(t, middle("ns", "c"), "release strictly inside the page")
	require.False(t, middle("ns", "b"), "first key may continue a release started on the previous page")
	require.False(t, middle("ns", "d"), "last key may continue on the next page")

	first := releasePageHoldsAllRevisions(items, false, true)
	require.True(t, first("ns", "b"))
	require.False(t, first("ns", "d"))

	last := releasePageHoldsAllRevisions(items, true, false)
	require.False(t, last("ns", "b"))
	require.True(t, last("ns", "d"))

	unsorted := releasePageHoldsAllRevisions([]metav1.PartialObjectMetadata{items[1], items[0]}, true, true)
	require.False(t, unsorted("ns", "c"), "an unsorted page is never trusted")
	require.False(t, releasePageHoldsAllRevisions(nil, true, true)("ns", "c"))
}
