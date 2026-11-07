package metric

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsclientset "k8s.io/metrics/pkg/client/clientset/versioned"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"

	"github.com/omniview/kubernetes/pkg/utils"
)

// compositeQuery is the top-level QueryFunc that routes to either metrics-server
// or Prometheus based on the metric IDs requested or the resource key.
func compositeQuery(
	promClient *prometheusClient,
	qctx *sdkmetric.QueryContext,
	req sdkmetric.QueryRequest,
) (*sdkmetric.QueryResponse, error) {
	if err := admitMetricRequest(qctx, &req); err != nil {
		return nil, err
	}
	// Cluster-level metrics are Prometheus-only.
	if req.ResourceKey == "cluster::metrics" {
		var response *sdkmetric.QueryResponse
		var err error
		if req.Shape == sdkmetric.ShapeTimeseries {
			response, err = promClient.queryClusterPrometheusTimeseries(qctx, req)
		} else {
			response, err = promClient.queryClusterPrometheus(qctx, req)
		}
		if canceled := metricQueryContext(qctx).Err(); canceled != nil {
			return nil, canceled
		}
		return response, err
	}

	// If specific metric IDs are requested, check whether they're all Prometheus
	// or all metrics-server or mixed.
	hasProm := false
	hasMS := false
	for _, id := range req.MetricIDs {
		if strings.HasPrefix(id, "prom_") {
			hasProm = true
		} else {
			hasMS = true
		}
	}
	if req.ResourceKey == "k8s:/pods" && hasMS {
		return nil, resourcev2.NewError("UNSUPPORTED", "Native Pod metrics require finite QueryResources with namespaced metric IDs")
	}

	// Empty IDs retain genuine legacy Node and Prometheus query-all behavior.
	wantAll := len(req.MetricIDs) == 0

	var msResp, promResp *sdkmetric.QueryResponse
	var msErr, promErr error

	// Native Pod collection has moved entirely to finite QueryResources.
	if req.ResourceKey == "k8s:/nodes" && (wantAll || hasMS) {
		msResp, msErr = queryMetricsServer(qctx, req)
	}

	// Prometheus query — route to range-query variants for time-series requests.
	// For batch mode (empty ResourceID), use the batch Prometheus handler.
	if wantAll || hasProm {
		if req.Shape == sdkmetric.ShapeTimeseries {
			switch req.ResourceKey {
			case "k8s:/pods":
				promResp, promErr = promClient.queryPodPrometheusTimeseries(qctx, req)
			case "k8s:/nodes":
				promResp, promErr = promClient.queryNodePrometheusTimeseries(qctx, req)
			case "cluster::metrics":
				promResp, promErr = promClient.queryClusterPrometheusTimeseries(qctx, req)
			}
		} else {
			switch req.ResourceKey {
			case "k8s:/pods":
				if req.ResourceID == "" {
					promResp, promErr = promClient.queryAllPodPrometheus(qctx, req)
				} else {
					promResp, promErr = promClient.queryPodPrometheus(qctx, req)
				}
			case "k8s:/nodes":
				promResp, promErr = promClient.queryNodePrometheus(qctx, req)
			}
		}
	}

	if err := metricQueryContext(qctx).Err(); err != nil {
		return nil, err
	}
	// Merge results.
	return mergeResponses(msResp, msErr, promResp, promErr)
}

func metricQueryContext(qctx *sdkmetric.QueryContext) context.Context {
	if qctx != nil && qctx.Context != nil {
		return qctx.Context
	}
	return context.Background()
}

// A native utility selector is not resource identity. Targeted resource metrics
// use the admitted observation/reference without acquiring new GET permission.
func admitMetricRequest(qctx *sdkmetric.QueryContext, req *sdkmetric.QueryRequest) error {
	if qctx == nil || qctx.Connection == nil || qctx.ConnectionID == "" || qctx.Connection.ID != qctx.ConnectionID {
		return resourcev2.NewError("UNAVAILABLE", "An explicit selected metric connection is required")
	}
	if err := metricQueryContext(qctx).Err(); err != nil {
		return err
	}
	if raw := req.Params["prometheus_service_port"]; raw != "" {
		port, err := strconv.Atoi(raw)
		if err != nil || port < 1 || port > 65535 {
			return resourcev2.NewError("INVALID_REQUEST", "Prometheus service port must be an integer from 1 to 65535")
		}
	}
	intent := req.ResourceData != nil || req.Reference != nil || req.Route != nil
	if req.ResourceKey == "cluster::metrics" {
		if intent {
			return resourcev2.NewError("INVALID_REQUEST", "Cluster metrics do not accept resource identity or observation data")
		}
		return nil
	}
	if !intent {
		if req.ResourceID != "" {
			return resourcev2.NewError("INVALID_REQUEST", "Targeted resource metrics require an observation or reference")
		}
		return nil
	}
	if req.ResourceKey != "k8s:/pods" && req.ResourceKey != "k8s:/nodes" {
		return resourcev2.NewError("UNSUPPORTED", "This native metric selector does not support resource intent")
	}
	name, namespace, err := utils.NativeResourceTarget(&types.PluginContext{Context: metricQueryContext(qctx), Connection: qctx.Connection}, req.ResourceData, req.Reference, req.Route, req.ResourceKey, req.ResourceKey == "k8s:/pods")
	if err != nil {
		return err
	}
	if req.ResourceID != "" && req.ResourceID != name || req.ResourceNamespace != "" && req.ResourceNamespace != namespace {
		return resourcev2.NewError("INVALID_REQUEST", "Metric selector does not match the admitted native resource")
	}
	req.ResourceID, req.ResourceNamespace = name, namespace
	return nil
}

// mergeResponses combines the results from metrics-server and Prometheus.
func mergeResponses(
	msResp *sdkmetric.QueryResponse, msErr error,
	promResp *sdkmetric.QueryResponse, promErr error,
) (*sdkmetric.QueryResponse, error) {
	// If both failed, return the first error.
	if msErr != nil && promErr != nil {
		return nil, msErr
	}

	results := make([]sdkmetric.MetricResult, 0)
	if msResp != nil && msResp.Success {
		results = append(results, msResp.Results...)
	}
	if promResp != nil && promResp.Success {
		results = append(results, promResp.Results...)
	}

	// If we got at least one source, return success.
	if len(results) > 0 || msErr == nil || promErr == nil {
		return &sdkmetric.QueryResponse{
			Success: true,
			Results: results,
		}, nil
	}

	return &sdkmetric.QueryResponse{
		Success: false,
		Error:   "no metrics available",
	}, nil
}

// queryMetricsServer handles metric queries using the Kubernetes metrics-server API.
func queryMetricsServer(qctx *sdkmetric.QueryContext, req sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
	switch req.ResourceKey {
	case "k8s:/nodes":
		return queryNodeMetrics(qctx, req)
	default:
		return &sdkmetric.QueryResponse{
			Success: false,
			Error:   fmt.Sprintf("unsupported resource key: %s", req.ResourceKey),
		}, nil
	}
}

func getMetricsClient(qctx *sdkmetric.QueryContext) (metricsclientset.Interface, error) {
	if qctx.Connection == nil {
		return nil, fmt.Errorf("no connection available in query context")
	}

	ctx := &types.PluginContext{
		Context:    metricQueryContext(qctx),
		Connection: qctx.Connection,
	}

	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get kube clients: %w", err)
	}

	metricsClient, err := metricsclientset.NewForConfig(clients.RestConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}

	return metricsClient, nil
}

func queryNodeMetrics(qctx *sdkmetric.QueryContext, req sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
	metricsClient, err := getMetricsClient(qctx)
	if err != nil {
		return &sdkmetric.QueryResponse{
			Success: false,
			Error:   err.Error(),
		}, nil
	}

	name := req.ResourceID

	nodeMetrics, err := metricsClient.MetricsV1beta1().NodeMetricses().Get(
		metricQueryContext(qctx), name, metav1.GetOptions{},
	)
	if err != nil {
		return &sdkmetric.QueryResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to get node metrics: %v", err),
		}, nil
	}

	return buildNodeMetricResponse(nodeMetrics, req.MetricIDs, req.ResourceData), nil
}

func buildNodeMetricResponse(
	nodeMetrics *metricsv1beta1.NodeMetrics,
	metricIDs []string,
	resourceData *resourcev2.Value,
) *sdkmetric.QueryResponse {
	now := time.Now()
	results := make([]sdkmetric.MetricResult, 0)

	wantAll := len(metricIDs) == 0
	wantMetric := func(id string) bool {
		if wantAll {
			return true
		}
		for _, mid := range metricIDs {
			if mid == id {
				return true
			}
		}
		return false
	}

	cpuUsage := nodeMetrics.Usage.Cpu().MilliValue()
	memUsage := nodeMetrics.Usage.Memory().Value()

	labels := map[string]string{
		"node": nodeMetrics.Name,
	}

	if wantMetric("cpu_usage") {
		results = append(results, sdkmetric.MetricResult{
			CurrentValue: &sdkmetric.CurrentValue{
				MetricID:  "cpu_usage",
				Value:     float64(cpuUsage),
				Timestamp: now,
				Labels:    labels,
			},
		})
	}

	if wantMetric("memory_usage") {
		results = append(results, sdkmetric.MetricResult{
			CurrentValue: &sdkmetric.CurrentValue{
				MetricID:  "memory_usage",
				Value:     float64(memUsage),
				Timestamp: now,
				Labels:    labels,
			},
		})
	}

	// Capacity metrics from the node's status (passed in resourceData)
	if wantMetric("cpu_capacity") {
		if cpuCap := extractNodeCapacity(resourceData, "cpu"); cpuCap > 0 {
			results = append(results, sdkmetric.MetricResult{
				CurrentValue: &sdkmetric.CurrentValue{
					MetricID:  "cpu_capacity",
					Value:     cpuCap,
					Timestamp: now,
					Labels:    labels,
				},
			})
		}
	}

	if wantMetric("memory_capacity") {
		if memCap := extractNodeCapacity(resourceData, "memory"); memCap > 0 {
			results = append(results, sdkmetric.MetricResult{
				CurrentValue: &sdkmetric.CurrentValue{
					MetricID:  "memory_capacity",
					Value:     memCap,
					Timestamp: now,
					Labels:    labels,
				},
			})
		}
	}

	return &sdkmetric.QueryResponse{
		Success: true,
		Results: results,
	}
}

// extractNodeCapacity extracts capacity values from the node's resource data.
// The data is expected to be a full Node object with status.capacity.
func extractNodeCapacity(resourceData *resourcev2.Value, resource string) float64 {
	value, ok := utils.TaggedField(resourceData, "status", "capacity", resource)
	if !ok {
		return 0
	}
	switch value.Kind {
	case "double":
		if resource == "cpu" {
			return value.Double * 1000
		}
		return value.Double
	case "string":
		return parseQuantityString(value.String, resource)
	}
	return 0
}

func parseQuantityString(s string, resource string) float64 {
	// Simplified k8s quantity parsing
	// For a full implementation, use k8s.io/apimachinery/pkg/api/resource
	var val float64
	var unit string
	fmt.Sscanf(s, "%f%s", &val, &unit)

	if resource == "cpu" {
		switch unit {
		case "m":
			return val
		case "":
			return val * 1000 // cores to millicores
		}
	}
	if resource == "memory" {
		switch unit {
		case "Ki":
			return val * 1024
		case "Mi":
			return val * 1024 * 1024
		case "Gi":
			return val * 1024 * 1024 * 1024
		case "Ti":
			return val * 1024 * 1024 * 1024 * 1024
		case "":
			return val
		}
	}
	return val
}
