package metric

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/omniviewdev/plugin-sdk/settings"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestNodeFiniteSetCapacitySurvivesMetricsServerDenial(t *testing.T) {
	var inventory, queries, usage atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/v1/nodes":
			inventory.Add(1)
			fmt.Fprint(w, `{"apiVersion":"v1","kind":"NodeList","items":[{"metadata":{"name":"first"},"status":{"addresses":[{"type":"InternalIP","address":"10.0.0.1"}],"capacity":{"cpu":"4","memory":"8Gi"}}},{"metadata":{"name":"second"},"status":{"addresses":[{"type":"InternalIP","address":"2001:db8::2"}],"capacity":{"cpu":"8","memory":"16Gi"}}}]}`)
		case strings.Contains(r.URL.Path, "/proxy/api/v1/query"):
			queries.Add(1)
			expression := r.URL.Query().Get("query")
			if expression == "" {
				if parts := strings.SplitN(r.URL.Path, "?", 2); len(parts) == 2 {
					values, _ := url.ParseQuery(parts[1])
					expression = values.Get("query")
				}
			}
			require.Contains(t, expression, `instance=~`)
			require.NotContains(t, expression, "first")
			require.Contains(t, expression, "2001:db8::2")
			fmt.Fprint(w, `{"status":"success","data":{"resultType":"vector","result":[{"metric":{"instance":"10.0.0.1:9100"},"value":[1793664000,"25"]},{"metric":{"instance":"[2001:db8::2]:9100"},"value":[1793664000,"50"]},{"metric":{"instance":"10.99.0.1:9100"},"value":[1793664000,"999"]}]}}`)
		case strings.Contains(r.URL.Path, "/services/"):
			fmt.Fprint(w, `{"apiVersion":"v1","kind":"Service","metadata":{"name":"prometheus-server","namespace":"monitoring"}}`)
		default:
			usage.Add(1)
			w.WriteHeader(http.StatusForbidden)
			fmt.Fprint(w, `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","message":"metrics denied","code":403}`)
		}
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "config")
	config := fmt.Sprintf("apiVersion: v1\nkind: Config\nclusters:\n- name: fixture\n  cluster:\n    server: %s\ncontexts:\n- name: fixture\n  context:\n    cluster: fixture\n    user: fixture\ncurrent-context: fixture\nusers:\n- name: fixture\n  user: {}\n", server.URL)
	require.NoError(t, os.WriteFile(path, []byte(config), 0600))
	qctx := &sdkmetric.QueryContext{Context: context.Background(), ConnectionID: "fixture", Connection: &types.Connection{ID: "fixture", Data: map[string]interface{}{"kubeconfig": path}}}
	request := sdkmetric.ResourceSetQueryRequest{ResourceConnectionID: qctx.ConnectionID, MetricIDs: []string{"cpu_usage", "cpu_capacity", "memory_capacity", "prom_cpu_utilization"}}
	for _, name := range []string{"first", "second"} {
		request.Resources = append(request.Resources, sdkmetric.MetricResource{Token: name, ResourceKey: "k8s:/nodes", ResourceID: name, PublicData: metricValue(t, map[string]any{"apiVersion": "v1", "kind": "Node", "metadata": map[string]any{"name": name}})})
	}
	client := newPrometheusClient(settings.NewProvider(settings.ProviderOpts{}))
	defer client.clientCache.Stop()
	defer client.retireConnection(qctx.ConnectionID)
	response, err := client.QueryResources(qctx, request)
	require.NoError(t, err)
	require.EqualValues(t, 1, inventory.Load())
	require.EqualValues(t, 1, queries.Load())
	require.EqualValues(t, 1, usage.Load())
	require.Len(t, response.Results, 8)
	require.Equal(t, sdkmetric.MetricStatusDenied, response.Results[0].Status)
	require.Equal(t, float64(4000), response.Results[1].Value.CurrentValue.Value)
	require.Equal(t, float64(8*1024*1024*1024), response.Results[2].Value.CurrentValue.Value)
	require.Equal(t, float64(25), response.Results[3].Value.CurrentValue.Value)
	require.Equal(t, time.Unix(1793664000, 0), response.Results[3].Value.CurrentValue.Timestamp)
	require.Equal(t, float64(8000), response.Results[5].Value.CurrentValue.Value)
	require.Equal(t, float64(50), response.Results[7].Value.CurrentValue.Value)
	inventory.Store(0)
	usage.Store(0)
	queries.Store(0)
	request.MetricIDs = []string{"cpu_capacity"}
	_, err = client.QueryResources(qctx, request)
	require.NoError(t, err)
	require.EqualValues(t, 1, inventory.Load())
	require.Zero(t, usage.Load())
	require.Zero(t, queries.Load())
}

func TestNativePrometheusPreservesCoresAndSampleTime(t *testing.T) {
	sample, err := nativePromCurrent("prom_cpu_usage_rate", nil, [2]interface{}{float64(1793664000.25), "0.125"})
	require.NoError(t, err)
	require.Equal(t, 0.125, sample.CurrentValue.Value)
	require.Equal(t, time.Unix(1793664000, 250000000), sample.CurrentValue.Timestamp)
	for _, pair := range [][2]interface{}{{float64(1), "NaN"}, {float64(-1), "1"}, {float64(253402300800), "1"}} {
		_, err := nativePromCurrent("prom_cpu_usage_rate", nil, pair)
		require.Error(t, err)
	}
	_, err = nativePromPoints("prom_cpu_usage_rate", [][2]interface{}{{float64(100), "0.125"}}, sdkmetric.ResourceSetQueryRequest{StartTime: time.Unix(101, 0), EndTime: time.Unix(200, 0)})
	require.Error(t, err)
}

func TestNodeFiniteSetRejectsSharedAddressesWithoutQuery(t *testing.T) {
	identities := []nativeIdentity{{"k8s:/nodes", "", "first"}, {"k8s:/nodes", "", "second"}}
	nodes := &corev1.NodeList{}
	for _, identity := range identities {
		nodes.Items = append(nodes.Items, corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: identity.name}, Status: corev1.NodeStatus{Addresses: []corev1.NodeAddress{{Type: corev1.NodeInternalIP, Address: "10.0.0.1"}}}})
	}
	failures := 0
	(&prometheusClient{}).queryNodeSetPrometheus(nil, sdkmetric.ResourceSetQueryRequest{MetricIDs: []string{"prom_cpu_utilization"}}, identities, nodes, nil, func(identity nativeIdentity, id string, result *sdkmetric.MetricResult, err error) {
		require.Equal(t, "AMBIGUOUS", resourcev2.ErrorCode(err))
		require.Nil(t, result)
		failures++
	})
	require.Equal(t, 2, failures)
}
