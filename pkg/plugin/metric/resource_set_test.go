package metric

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

func TestNativeFiniteSetReportsEachUnsupportedMetric(t *testing.T) {
	qctx := &sdkmetric.QueryContext{Context: context.Background(), ConnectionID: "cluster", Connection: &types.Connection{ID: "cluster"}}
	request := sdkmetric.ResourceSetQueryRequest{ResourceConnectionID: "cluster", MetricIDs: []string{"prom_unknown"}, MappingRevision: "revision", Source: sdkmetric.MetricSourceReference{PluginID: "kubernetes", ConnectionID: "cluster"}}
	for _, ns := range []string{"first", "second"} {
		request.Resources = append(request.Resources, sdkmetric.MetricResource{Token: ns, ResourceKey: "k8s:/pods", ResourceID: "same", ResourceNamespace: ns, PublicData: metricValue(t, map[string]any{"apiVersion": "v1", "kind": "Pod", "metadata": map[string]any{"name": "same", "namespace": ns}})})
	}
	response, err := (&prometheusClient{}).QueryResources(qctx, request)
	require.NoError(t, err)
	require.Len(t, response.Results, 2)
	for i, result := range response.Results {
		require.Equal(t, request.Resources[i].Token, result.ResourceToken)
		require.Empty(t, result.Dimensions)
		require.Equal(t, sdkmetric.MetricStatusUnsupported, result.Status)
		require.Nil(t, result.Value)
		require.True(t, result.Provenance.Native)
		require.Equal(t, request.Source, result.Provenance.Source)
		require.Equal(t, "revision", result.MappingRevision)
		require.NotEmpty(t, result.Warnings)
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	qctx.Context = canceled
	_, err = (&prometheusClient{}).QueryResources(qctx, request)
	require.ErrorIs(t, err, context.Canceled)
}

func TestNativeGroupedSelectorEscapesFiniteNames(t *testing.T) {
	expression, err := nativePodExpression(nativeGroup{"k8s:/pods", "selected"}, []nativeIdentity{{"k8s:/pods", "selected", "one.name"}, {"k8s:/pods", "selected", "two"}}, "prom_cpu_usage_rate")
	require.NoError(t, err)
	require.Contains(t, expression, `pod=~"one\\.name|two"`)
	require.Contains(t, expression, `namespace="selected"`)
	require.Equal(t, 1, strings.Count(expression, "container_cpu_usage_seconds_total"))
	_, err = nativePodExpression(nativeGroup{"k8s:/nodes", ""}, nil, "prom_cpu_usage_rate")
	require.Error(t, err)
}

func TestNativePrometheusMissingIsNotZero(t *testing.T) {
	for _, raw := range []interface{}{nil, "NaN", "+Inf", "-Inf", "not-a-number"} {
		_, ok := nativePromValue([2]interface{}{float64(1), raw})
		require.False(t, ok)
	}
	value, ok := nativePromValue([2]interface{}{float64(1), "0"})
	require.True(t, ok)
	require.Zero(t, value)
}

func TestNativeMetricsServerUsesOneListAndKeepsMissing(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		require.Equal(t, "/apis/metrics.k8s.io/v1beta1/namespaces/selected/pods", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"apiVersion":"metrics.k8s.io/v1beta1","kind":"PodMetricsList","items":[{"metadata":{"name":"present","namespace":"selected"},"timestamp":"2026-11-03T00:00:00Z","window":"30s","containers":[{"name":"app","usage":{"cpu":"125m","memory":"1Mi"}}]},{"metadata":{"name":"foreign","namespace":"selected"},"containers":[{"name":"app","usage":{"cpu":"999m","memory":"2Mi"}}]}]}`)
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "config")
	config := fmt.Sprintf("apiVersion: v1\nkind: Config\nclusters:\n- name: fixture\n  cluster:\n    server: %s\ncontexts:\n- name: fixture\n  context:\n    cluster: fixture\n    user: fixture\ncurrent-context: fixture\nusers:\n- name: fixture\n  user: {}\n", server.URL)
	require.NoError(t, os.WriteFile(path, []byte(config), 0600))
	qctx := &sdkmetric.QueryContext{Context: context.Background(), ConnectionID: "fixture", Connection: &types.Connection{ID: "fixture", Data: map[string]interface{}{"kubeconfig": path}}}
	request := sdkmetric.ResourceSetQueryRequest{ResourceConnectionID: qctx.ConnectionID, MetricIDs: []string{"cpu_usage", "memory_usage"}}
	for _, name := range []string{"present", "missing"} {
		request.Resources = append(request.Resources, sdkmetric.MetricResource{Token: name, ResourceKey: "k8s:/pods", ResourceID: name, ResourceNamespace: "selected", PublicData: metricValue(t, map[string]any{"apiVersion": "v1", "kind": "Pod", "metadata": map[string]any{"name": name, "namespace": "selected"}})})
	}
	response, err := (&prometheusClient{}).QueryResources(qctx, request)
	require.NoError(t, err)
	require.EqualValues(t, 1, calls.Load())
	require.Len(t, response.Results, 4)
	require.Equal(t, sdkmetric.MetricStatusOK, response.Results[0].Status)
	require.Equal(t, float64(125), response.Results[0].Value.CurrentValue.Value)
	require.Equal(t, float64(1048576), response.Results[1].Value.CurrentValue.Value)
	require.Equal(t, sdkmetric.MetricStatusMissing, response.Results[2].Status)
	require.Nil(t, response.Results[2].Value)
	require.Equal(t, sdkmetric.MetricStatusMissing, response.Results[3].Status)
}
