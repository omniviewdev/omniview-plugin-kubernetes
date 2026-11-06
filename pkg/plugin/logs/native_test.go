package logs

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

func testBorrower(t *testing.T, server *httptest.Server, released chan struct{}) ClientBorrower {
	t.Helper()
	client, err := kubernetes.NewForConfig(&rest.Config{Host: server.URL})
	require.NoError(t, err)
	return func(ctx context.Context, route resourcev2.AccessRoute, use func(context.Context, *kubernetes.Clientset) error) error {
		defer close(released)
		return use(ctx, client)
	}
}

func awaitReleased(t *testing.T, released <-chan struct{}) {
	t.Helper()
	select {
	case <-released:
	case <-time.After(5 * time.Second):
		t.Fatal("native borrower not released")
	}
}

func TestNativeFiniteBoundsAndOptions(t *testing.T) {
	for _, tc := range []struct {
		name                string
		tail, limit         int64
		wantTail, wantLimit string
	}{
		{"defaults", 0, 0, "200", "1048576"},
		{"clamped", 6000, 2000000, "5000", "1048576"},
		{"explicit", 12, 64, "12", "64"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			queries := make(chan url.Values, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/v1/namespaces/ns/pods/pod/log" {
					http.Error(w, "unexpected target GET", http.StatusForbidden)
					return
				}
				queries <- r.URL.Query()
				_, _ = io.WriteString(w, strings.Repeat("x", (1<<20)+16))
			}))
			defer server.Close()
			released := make(chan struct{})
			ctx := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
			stream, err := nativeHandler(testBorrower(t, server, released))(ctx, sdklogs.LogStreamRequest{
				Labels:    map[string]string{"pod": "pod", "namespace": "ns"},
				TailLines: tc.tail, LimitBytes: tc.limit, IncludePrevious: true, SinceSeconds: 30,
			})
			require.NoError(t, err)
			select {
			case <-released:
				t.Fatal("released before consumption")
			default:
			}
			body, err := io.ReadAll(stream)
			require.NoError(t, err)
			limit := 1 << 20
			if tc.limit > 0 && tc.limit < int64(limit) {
				limit = int(tc.limit)
			}
			require.Len(t, body, limit)
			require.NoError(t, stream.Close())
			awaitReleased(t, released)
			query := <-queries
			require.Equal(t, tc.wantTail, query.Get("tailLines"))
			require.Equal(t, tc.wantLimit, query.Get("limitBytes"))
			require.Empty(t, query.Get("container"))
			require.Equal(t, "true", query.Get("previous"))
			require.Equal(t, "true", query.Get("timestamps"))
			require.Equal(t, "30", query.Get("sinceSeconds"))
		})
	}
}

func TestNativeSinceTimeOverridesSinceSeconds(t *testing.T) {
	queries := make(chan url.Values, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queries <- r.URL.Query()
		if r.URL.Query().Has("sinceTime") && r.URL.Query().Has("sinceSeconds") {
			http.Error(w, "only one of sinceSeconds or sinceTime may be specified", http.StatusBadRequest)
			return
		}
		_, _ = io.WriteString(w, "2026-11-03T00:00:01Z hello\n")
	}))
	defer server.Close()
	released := make(chan struct{})
	ctx := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	since := time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)
	stream, err := nativeHandler(testBorrower(t, server, released))(ctx, sdklogs.LogStreamRequest{
		Labels:    map[string]string{"pod": "pod", "namespace": "ns"},
		SinceTime: &since, SinceSeconds: 30,
	})
	require.NoError(t, err)
	defer stream.Close()
	body, err := io.ReadAll(stream)
	require.NoError(t, err)
	require.Contains(t, string(body), "hello")
	awaitReleased(t, released)
	query := <-queries
	require.Equal(t, since.Format(time.RFC3339), query.Get("sinceTime"))
	require.Empty(t, query.Get("sinceSeconds"))
}

func TestNativeFollowLeaseCloseAndCancel(t *testing.T) {
	for _, cancelRequest := range []bool{false, true} {
		t.Run(map[bool]string{false: "close", true: "cancel"}[cancelRequest], func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/v1/namespaces/ns/pods/pod/log" {
					http.Error(w, "unexpected GET", 403)
					return
				}
				query := r.URL.Query()
				if query.Get("follow") != "true" || query.Get("tailLines") != "" || query.Get("limitBytes") != "" {
					http.Error(w, "follow options changed", http.StatusBadRequest)
					return
				}
				w.WriteHeader(http.StatusOK)
				w.(http.Flusher).Flush()
				<-r.Context().Done()
			}))
			defer server.Close()
			requestCtx, cancel := context.WithCancel(context.Background())
			defer cancel()
			released := make(chan struct{})
			ctx := &types.PluginContext{Context: requestCtx, Connection: &types.Connection{ID: "selected"}}
			stream, err := nativeHandler(testBorrower(t, server, released))(ctx, sdklogs.LogStreamRequest{
				Labels: map[string]string{"pod": "pod", "namespace": "ns"}, Follow: true,
			})
			require.NoError(t, err)
			select {
			case <-released:
				t.Fatal("released live reader")
			default:
			}
			if cancelRequest {
				cancel()
			} else {
				require.NoError(t, stream.Close())
			}
			awaitReleased(t, released)
			require.NoError(t, stream.Close())
		})
	}
}

func TestNativeResolverLeaseSpansWatcher(t *testing.T) {
	watchStarted := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/apis/apps/v1/namespaces/ns/deployments/deploy":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"apiVersion":"apps/v1","kind":"Deployment","metadata":{"name":"deploy","namespace":"ns"},"spec":{"selector":{"matchLabels":{"app":"test"}}}}`)
		case "/api/v1/namespaces/ns/pods":
			w.Header().Set("Content-Type", "application/json")
			if r.URL.Query().Get("watch") == "true" {
				close(watchStarted)
				w.WriteHeader(http.StatusOK)
				w.(http.Flusher).Flush()
				<-r.Context().Done()
				return
			}
			_, _ = io.WriteString(w, `{"apiVersion":"v1","kind":"PodList","metadata":{"resourceVersion":"1"},"items":[]}`)
		default:
			http.Error(w, "unexpected request", 403)
		}
	}))
	defer server.Close()
	requestCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	released := make(chan struct{})
	ctx := &types.PluginContext{Context: requestCtx, Connection: &types.Connection{ID: "selected"}}
	result, err := nativeResolver(testBorrower(t, server, released), DeploymentSourceResolver)(ctx,
		taggedFixture(map[string]any{"metadata": map[string]any{"name": "deploy", "namespace": "ns"}}), sdklogs.SourceResolverOptions{Watch: true})
	require.NoError(t, err)
	select {
	case <-watchStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("watch not started")
	}
	select {
	case <-released:
		t.Fatal("released running producer")
	default:
	}
	cancel()
	awaitReleased(t, released)
	_, open := <-result.Events
	require.False(t, open)
}

func TestNativeErrorsKeepDiagnosticsOffWire(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "secret kube credential diagnostic", http.StatusForbidden)
	}))
	defer server.Close()
	released := make(chan struct{})
	ctx := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	stream, err := nativeHandler(testBorrower(t, server, released))(ctx, sdklogs.LogStreamRequest{
		Labels: map[string]string{"pod": "pod", "namespace": "ns"},
	})
	require.Nil(t, stream)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "secret")
	awaitReleased(t, released)
}

func TestNativeFiniteCanonicalSourceNeedsNoObservedBody(t *testing.T) {
	for _, container := range []string{"", "app"} {
		t.Run("container="+container, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.Equal(t, "/api/v1/namespaces/ns/pods/pod/log", r.URL.Path)
				require.Equal(t, container, r.URL.Query().Get("container"))
				_, _ = io.WriteString(w, "2026-10-30T00:00:00Z native default container\n")
			}))
			t.Cleanup(server.Close)
			ref := &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
				Provider: "kubernetes", Authority: "host-owned", Type: "k8s:/pods", ID: "pod",
				Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "ns"}},
			}}
			route := &resourcev2.AccessRoute{Connection: "selected"}
			sources := PodSourceBuilder("pod", nil, sdklogs.LogSessionOptions{Reference: ref, Route: route, Target: container})
			require.Len(t, sources, 1)
			released := make(chan struct{})
			ctx := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
			stream, err := nativeHandler(testBorrower(t, server, released))(ctx, sdklogs.LogStreamRequest{
				Reference: ref, Route: route, Labels: sources[0].Labels,
			})
			require.NoError(t, err)
			body, err := io.ReadAll(stream)
			require.NoError(t, err)
			require.Contains(t, string(body), "native default container")
			require.NoError(t, stream.Close())
			awaitReleased(t, released)
		})
	}
}
