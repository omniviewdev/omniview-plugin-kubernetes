package logs

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	"github.com/stretchr/testify/require"
)

// taggedFixture keeps existing malformed fixture cases while invoking only the
// canonical callback contract. Production code never converts generic maps.
func taggedFixture(raw any) *resourcev2.Value {
	if raw == nil {
		return nil
	}
	value := fixtureValue(raw)
	return &value
}

func fixtureValue(raw any) resourcev2.Value {
	value, err := resourcev2.ValueFromNative(raw)
	if err != nil {
		panic(err)
	}
	return value
}

func TestPodSourceBuilderLeavesExactFieldsUntouched(t *testing.T) {
	data := taggedFixture(map[string]interface{}{
		"metadata": map[string]interface{}{"name": "pod", "namespace": "ns"},
		"spec":     map[string]interface{}{"containers": []interface{}{map[string]interface{}{"name": "app"}}},
	})
	data.Map["wide"] = resourcev2.Value{Kind: "uint64", Uint: "18446744073709551615"}
	data.Map["signed"] = resourcev2.Value{Kind: "int64", Int: "-9223372036854775808"}
	data.Map["opaque"] = resourcev2.Value{Kind: "string", String: "9007199254740993"}
	sources := PodSourceBuilder("pod", data, sdklogs.LogSessionOptions{})
	require.Len(t, sources, 1)
	require.Equal(t, "pod/app", sources[0].ID)
	require.Equal(t, "18446744073709551615", data.Map["wide"].Uint)
	require.Equal(t, "-9223372036854775808", data.Map["signed"].Int)
	require.Equal(t, "9007199254740993", data.Map["opaque"].String)
}

func TestPodLogHandlerRejectsCanonicalMismatchBeforeClientAccess(t *testing.T) {
	ctx := &types.PluginContext{Connection: &types.Connection{ID: "selected"}}
	data := taggedFixture(map[string]interface{}{"metadata": map[string]interface{}{"name": "pod", "namespace": "ns", "uid": "uid"}})
	ref := &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "host-owned", Type: "k8s:/pods", Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "ns"}}, ID: "pod"}}
	for _, tc := range []struct {
		name   string
		route  string
		labels map[string]string
	}{
		{"route", "other", nil},
		{"pod", "selected", map[string]string{"pod": "other"}},
		{"namespace", "selected", map[string]string{"namespace": "other"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := PodLogHandler(nil, ctx, sdklogs.LogStreamRequest{ResourceData: data, Reference: ref, Route: &resourcev2.AccessRoute{Connection: tc.route}, Labels: tc.labels})
			require.ErrorContains(t, err, "does not match")
		})
	}
}

func TestPodLogHandlerUsesNativeStreamWithoutTargetGet(t *testing.T) {
	requests := make(chan string, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.URL.Path
		if r.URL.Path != "/api/v1/namespaces/ns/pods/pod/log" {
			http.Error(w, "target GET forbidden", http.StatusForbidden)
			return
		}
		if r.URL.Query().Get("container") != "app" || r.URL.Query().Get("timestamps") != "true" {
			http.Error(w, "native log options missing", http.StatusBadRequest)
			return
		}
		_, _ = io.WriteString(w, "2026-10-28T00:00:00Z native log\n")
	}))
	defer server.Close()
	client, err := kubernetes.NewForConfig(&rest.Config{Host: server.URL})
	require.NoError(t, err)
	borrow := func(ctx context.Context, route resourcev2.AccessRoute, use func(context.Context, *kubernetes.Clientset) error) error {
		require.Equal(t, "selected", route.Connection)
		return use(ctx, client)
	}
	ctx := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	ref := &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "host-owned", Type: "k8s:/pods", Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "ns"}}, ID: "pod"}}
	stream, err := nativeHandler(borrow)(ctx, sdklogs.LogStreamRequest{
		Reference: ref, Route: &resourcev2.AccessRoute{Connection: "selected"},
		Labels: map[string]string{"container": "app"},
	})
	require.NoError(t, err)
	defer stream.Close()
	body, err := io.ReadAll(stream)
	require.NoError(t, err)
	require.Contains(t, string(body), "native log")
	require.Equal(t, "/api/v1/namespaces/ns/pods/pod/log", <-requests)
	require.Empty(t, requests)
}

func TestPodSourceBuilderConsumesReferenceAndRejectsMismatch(t *testing.T) {
	data := taggedFixture(map[string]any{"spec": map[string]any{"containers": []any{map[string]any{"name": "app"}}}})
	ref := &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "host-owned", Type: "k8s:/pods", Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "ns"}}, ID: "pod"}}
	opts := sdklogs.LogSessionOptions{Reference: ref, Route: &resourcev2.AccessRoute{Connection: "selected"}, Follow: true}
	sources := PodSourceBuilder("pod", data, opts)
	require.Len(t, sources, 1)
	require.Equal(t, "pod/app", sources[0].ID)
	require.Equal(t, "ns", sources[0].Labels["namespace"])
	data.Map["metadata"] = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"name": {Kind: "string", String: "other"}}}
	require.Nil(t, PodSourceBuilder("pod", data, opts))
	delete(data.Map, "metadata")
	opts.Route = nil
	require.Nil(t, PodSourceBuilder("pod", data, opts))
}
