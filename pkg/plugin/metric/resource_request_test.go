package metric

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/omniviewdev/plugin-sdk/settings"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

func metricValue(t *testing.T, native any) *resourcev2.Value {
	t.Helper()
	if native == nil {
		return nil
	}
	value, err := resourcev2.ValueFromNative(native)
	require.NoError(t, err)
	return &value
}

func TestMetricResourceAdmissionPreservesOriginalObservation(t *testing.T) {
	data := metricValue(t, map[string]any{"apiVersion": "v1", "kind": "Pod", "metadata": map[string]any{"name": "native-pod", "namespace": "selected", "uid": "observed-uid"}, "spec": map[string]any{"exact": int64(9007199254740993)}})
	qctx := &sdkmetric.QueryContext{Context: context.Background(), ConnectionID: "owned-cluster", Connection: &types.Connection{ID: "owned-cluster"}}
	request := func() sdkmetric.QueryRequest {
		uid := "observed-uid"
		return sdkmetric.QueryRequest{ResourceKey: "k8s:/pods", ResourceData: data, Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "fixture-host-authority", Type: "k8s:/pods", ID: "native-pod", Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "selected"}}}, Incarnation: &uid}, Route: &resourcev2.AccessRoute{Connection: "owned-cluster"}}
	}
	req := request()
	require.NoError(t, admitMetricRequest(qctx, &req))
	require.Equal(t, "native-pod", req.ResourceID)
	require.Equal(t, "selected", req.ResourceNamespace)
	require.Same(t, data, req.ResourceData)
	require.Equal(t, "9007199254740993", data.Map["spec"].Map["exact"].Int)
	t.Run("reference without observation", func(t *testing.T) {
		req := request()
		req.ResourceData = nil
		require.NoError(t, admitMetricRequest(qctx, &req))
		require.Equal(t, "native-pod", req.ResourceID)
	})
	cases := []struct {
		name, code string
		mutate     func(*sdkmetric.QueryRequest)
	}{
		{"wrong connection", "INVALID_REQUEST", func(req *sdkmetric.QueryRequest) { req.Route.Connection = "another-cluster" }},
		{"wrong selector name", "INVALID_REQUEST", func(req *sdkmetric.QueryRequest) { req.ResourceID = "other-pod" }},
		{"wrong selector namespace", "INVALID_REQUEST", func(req *sdkmetric.QueryRequest) { req.ResourceNamespace = "other" }},
		{"wrong provider", "INVALID_REQUEST", func(req *sdkmetric.QueryRequest) { req.Reference.Address.Provider = "other-provider" }},
		{"wrong incarnation", "RESET_REQUIRED", func(req *sdkmetric.QueryRequest) { uid := "replacement-uid"; req.Reference.Incarnation = &uid }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := request()
			tc.mutate(&req)
			require.Equal(t, tc.code, resourcev2.ErrorCode(admitMetricRequest(qctx, &req)))
		})
	}
}

func TestMetricClusterOverridesAreNotResourceIntent(t *testing.T) {
	qctx := &sdkmetric.QueryContext{Context: context.Background(), ConnectionID: "owned-cluster", Connection: &types.Connection{ID: "owned-cluster"}}
	req := sdkmetric.QueryRequest{ResourceKey: "cluster::metrics", Params: map[string]string{"prometheus_service_name": "custom-prometheus", "prometheus_service_namespace": "observability", "prometheus_service_port": "9091"}}
	require.NoError(t, admitMetricRequest(qctx, &req))
	require.Nil(t, req.ResourceData)
	require.Nil(t, req.Reference)
	require.Nil(t, req.Route)
	cfg, err := (&prometheusClient{}).getConfig(req.Params)
	require.NoError(t, err)
	require.Equal(t, prometheusConfig{Service: "custom-prometheus", Namespace: "observability", Port: 9091}, cfg)
	req.ResourceData = &resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{}}
	require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(admitMetricRequest(qctx, &req)))
	req.ResourceData = nil
	req.Params["prometheus_service_port"] = "65536"
	require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(admitMetricRequest(qctx, &req)))
	_, err = (&prometheusClient{}).getConfig(req.Params)
	require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
	batch := sdkmetric.QueryRequest{ResourceKey: "k8s:/pods", ResourceNamespace: "selected"}
	require.NoError(t, admitMetricRequest(qctx, &batch), "native batch metrics remain independent of one resource identity")
	named := sdkmetric.QueryRequest{ResourceKey: "k8s:/pods", ResourceID: "unadmitted-name"}
	require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(admitMetricRequest(qctx, &named)))
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	qctx.Context = canceled
	require.ErrorIs(t, admitMetricRequest(qctx, &batch), context.Canceled)
}

func TestPrometheusNativeRequestsRespectCancellation(t *testing.T) {
	cases := []struct {
		name   string
		native bool
		query  func(context.Context, *prometheusClient, string, kubernetes.Interface) error
	}{
		{"direct instant", false, func(ctx context.Context, c *prometheusClient, url string, _ kubernetes.Interface) error {
			_, err := c.queryDirect(ctx, url, "up")
			return err
		}},
		{"direct range", false, func(ctx context.Context, c *prometheusClient, url string, _ kubernetes.Interface) error {
			_, err := c.queryRangeDirect(ctx, url, "up", time.Unix(1, 0), time.Unix(61, 0), time.Second)
			return err
		}},
		{"native proxy instant", true, func(ctx context.Context, c *prometheusClient, _ string, client kubernetes.Interface) error {
			_, err := c.queryViaProxy(ctx, client, &DetectionResult{Namespace: "monitoring", Service: "prometheus", Port: 9090}, "up")
			return err
		}},
		{"native proxy range", true, func(ctx context.Context, c *prometheusClient, _ string, client kubernetes.Interface) error {
			_, err := c.queryRangeViaProxy(ctx, client, &DetectionResult{Namespace: "monitoring", Service: "prometheus", Port: 9090}, "up", time.Unix(1, 0), time.Unix(61, 0), time.Second)
			return err
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			entered, stopped, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tc.native && r.Header.Get("Authorization") != "Bearer owned-metric-fixture" {
					t.Error("native proxy dropped authentication")
					http.Error(w, "authentication required", http.StatusUnauthorized)
					return
				}
				close(entered)
				select {
				case <-r.Context().Done():
					close(stopped)
				case <-release:
				}
			}))
			defer func() { close(release); server.Close() }()
			client, err := kubernetes.NewForConfig(&rest.Config{Host: server.URL, BearerToken: "owned-metric-fixture"})
			require.NoError(t, err)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			result := make(chan error, 1)
			go func() { result <- tc.query(ctx, &prometheusClient{}, server.URL, client) }()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("native request did not reach owned server")
			}
			cancel()
			select {
			case err := <-result:
				require.ErrorIs(t, err, context.Canceled)
			case <-time.After(3 * time.Second):
				t.Fatal("metric cancellation did not retire native request")
			}
			select {
			case <-stopped:
			case <-time.After(3 * time.Second):
				t.Fatal("owned server did not observe cancellation")
			}
		})
	}
}

func TestPrometheusDetectionCancellationDoesNotCacheAbsence(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer func() { close(release); server.Close() }()
	client, err := kubernetes.NewForConfig(&rest.Config{Host: server.URL})
	require.NoError(t, err)
	detector := NewPrometheusDetector(DetectorOpts{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		detector.Detect(ctx, "owned-cluster", &kubeServiceChecker{clientset: client}, "prometheus", "monitoring", 9090)
		close(done)
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("native detection request did not start")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("native detection did not retire")
	}
	require.Zero(t, detector.CacheLen(), "canceled detection is not evidence that Prometheus is absent")
}

func TestPrometheusGlobalSettingsRemainLive(t *testing.T) {
	provider := settings.NewProvider(settings.ProviderOpts{
		PluginID: "kubernetes",
		PluginSettings: []settings.Category{{
			ID: "plugin",
			Settings: map[string]settings.Setting{
				"prometheus_service_name":      {ID: "prometheus_service_name", Type: settings.Text, Default: "prometheus-server"},
				"prometheus_service_namespace": {ID: "prometheus_service_namespace", Type: settings.Text, Default: "monitoring"},
				"prometheus_service_port":      {ID: "prometheus_service_port", Type: settings.Integer, Default: 9090},
			},
		}},
	})
	client := &prometheusClient{settings: provider}
	cfg, err := client.getConfig(nil)
	require.NoError(t, err)
	require.Equal(t, prometheusConfig{Service: "prometheus-server", Namespace: "monitoring", Port: 9090}, cfg)
	require.NoError(t, provider.SetSettings(map[string]any{
		"prometheus_service_name":      "hydrated-prometheus",
		"prometheus_service_namespace": "observability",
		"prometheus_service_port":      9091,
	}))
	cfg, err = client.getConfig(nil)
	require.NoError(t, err)
	require.Equal(t, prometheusConfig{Service: "hydrated-prometheus", Namespace: "observability", Port: 9091}, cfg)
	require.NoError(t, provider.SetSetting("prometheus_service_port", 9092))
	cfg, err = client.getConfig(nil)
	require.NoError(t, err)
	require.Equal(t, 9092, cfg.Port)
	cfg, err = client.getConfig(map[string]string{
		"prometheus_service_name":      "cluster-prometheus",
		"prometheus_service_namespace": "cluster-monitoring",
		"prometheus_service_port":      "9093",
	})
	require.NoError(t, err)
	require.Equal(t, prometheusConfig{Service: "cluster-prometheus", Namespace: "cluster-monitoring", Port: 9093}, cfg)
}
