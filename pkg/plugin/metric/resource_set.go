package metric

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type nativeIdentity struct{ key, namespace, name string }
type nativeGroup struct{ key, namespace string }

// nativeAmbiguityError is local execution state, not a resource-v2 error code.
type nativeAmbiguityError string

func (e nativeAmbiguityError) Error() string { return string(e) }

func nativeMetricErrorStatus(err error) sdkmetric.MetricResultStatus {
	var ambiguous nativeAmbiguityError
	if errors.As(err, &ambiguous) {
		return sdkmetric.MetricStatusAmbiguous
	}
	if apierrors.IsForbidden(err) || apierrors.IsUnauthorized(err) {
		return sdkmetric.MetricStatusDenied
	}
	if resourcev2.ErrorCode(err) == "UNSUPPORTED" {
		return sdkmetric.MetricStatusUnsupported
	}
	return sdkmetric.MetricStatusFailed
}

// queryResources executes only explicit, host-admitted resources. No failed group
// is retried as individual requests, and returned foreign series are discarded.
func (c *prometheusClient) QueryResources(qctx *sdkmetric.QueryContext, req sdkmetric.ResourceSetQueryRequest) (*sdkmetric.ResourceSetQueryResponse, error) {
	if qctx == nil || qctx.Connection == nil || req.ResourceConnectionID != qctx.ConnectionID {
		return nil, fmt.Errorf("native metrics require the admitted resource connection")
	}
	if req.Shape != sdkmetric.ShapeCurrent && req.Shape != sdkmetric.ShapeTimeseries {
		return nil, fmt.Errorf("native resource sets support current and timeseries shapes only")
	}
	if req.Shape == sdkmetric.ShapeTimeseries && (req.Step <= 0 || !req.EndTime.After(req.StartTime)) {
		return nil, fmt.Errorf("timeseries requires positive step and ordered time bounds")
	}
	metricIDs := make(map[string]bool, len(req.MetricIDs))
	for _, id := range req.MetricIDs {
		if id == "" || metricIDs[id] {
			return nil, fmt.Errorf("metric IDs must be nonempty and unique")
		}
		metricIDs[id] = true
	}
	if len(req.Resources) == 0 || len(req.MetricIDs) == 0 {
		return nil, fmt.Errorf("explicit resources and metric IDs are required")
	}
	resources := make(map[nativeIdentity][]int, len(req.Resources))
	groups := make(map[nativeGroup][]nativeIdentity)
	tokens := make(map[string]bool, len(req.Resources))
	response := &sdkmetric.ResourceSetQueryResponse{}
	for i, resource := range req.Resources {
		if resource.Token == "" || tokens[resource.Token] {
			return nil, fmt.Errorf("resource tokens must be nonempty and unique")
		}
		tokens[resource.Token] = true
		legacy := sdkmetric.QueryRequest{ResourceKey: resource.ResourceKey, ResourceID: resource.ResourceID, ResourceNamespace: resource.ResourceNamespace, ResourceData: resource.PublicData, Reference: resource.Reference, Route: resource.Route}
		if legacy.ResourceID == "" || legacy.Reference == nil && legacy.ResourceData == nil {
			return nil, fmt.Errorf("each native resource requires structural identity")
		}
		if err := admitMetricRequest(qctx, &legacy); err != nil {
			return nil, err
		}
		identity := nativeIdentity{legacy.ResourceKey, legacy.ResourceNamespace, legacy.ResourceID}
		if len(resources[identity]) == 0 {
			group := nativeGroup{identity.key, identity.namespace}
			groups[group] = append(groups[group], identity)
		}
		resources[identity] = append(resources[identity], i)
		for _, id := range req.MetricIDs {
			response.Results = append(response.Results, sdkmetric.ResourceMetricResult{ResourceToken: resource.Token, MetricID: id, Status: sdkmetric.MetricStatusMissing, Provenance: sdkmetric.MetricProvenance{Native: true, Source: req.Source, BindingID: req.BindingID}, MappingRevision: req.MappingRevision})
		}
	}
	update := func(identity nativeIdentity, id string, value *sdkmetric.MetricResult, err error) {
		for _, index := range resources[identity] {
			for offset, metricID := range req.MetricIDs {
				if metricID != id {
					continue
				}
				result := &response.Results[index*len(req.MetricIDs)+offset]
				if result.Status == sdkmetric.MetricStatusAmbiguous {
					continue
				}
				if value != nil && result.Value != nil {
					err = nativeAmbiguityError("Multiple native samples match one resource and metric")
				}
				if err != nil {
					result.Value = nil
					result.Status = nativeMetricErrorStatus(err)
					result.Warnings = []string{err.Error()}
					continue
				}
				if value != nil {
					result.Value = value
					result.Status = sdkmetric.MetricStatusOK
					if value.CurrentValue != nil {
						result.ObservedAt = value.CurrentValue.Timestamp
					}
				}
			}
		}
	}
	for group, identities := range groups {
		if err := metricQueryContext(qctx).Err(); err != nil {
			return nil, err
		}
		if group.key == "k8s:/nodes" {
			c.queryNodeSet(qctx, req, identities, update)
		}
		var nativeIDs []string
		for _, id := range req.MetricIDs {
			if !strings.HasPrefix(id, "prom_") && !(group.key == "k8s:/nodes" && (id == "cpu_capacity" || id == "memory_capacity")) {
				nativeIDs = append(nativeIDs, id)
			}
		}
		if len(nativeIDs) > 0 {
			client, err := getMetricsClient(qctx)
			if req.Shape == sdkmetric.ShapeTimeseries {
				err = fmt.Errorf("metrics-server does not support timeseries")
			}
			values := make(map[nativeIdentity]*sdkmetric.QueryResponse)
			if err == nil {
				switch group.key {
				case "k8s:/pods":
					list, listErr := client.MetricsV1beta1().PodMetricses(group.namespace).List(metricQueryContext(qctx), metav1.ListOptions{})
					err = listErr
					if err == nil {
						for i := range list.Items {
							item := &list.Items[i]
							identity := nativeIdentity{group.key, item.Namespace, item.Name}
							if len(resources[identity]) > 0 {
								values[identity] = buildPodMetricResponse(item, nativeIDs)
							}
						}
					}
				case "k8s:/nodes":
					list, listErr := client.MetricsV1beta1().NodeMetricses().List(metricQueryContext(qctx), metav1.ListOptions{})
					err = listErr
					if err == nil {
						for i := range list.Items {
							item := &list.Items[i]
							identity := nativeIdentity{group.key, "", item.Name}
							if indices := resources[identity]; len(indices) > 0 {
								values[identity] = buildNodeMetricResponse(item, nativeIDs, req.Resources[indices[0]].PublicData)
							}
						}
					}
				default:
					err = fmt.Errorf("unsupported native resource kind %s", group.key)
				}
			}
			for _, identity := range identities {
				for _, id := range nativeIDs {
					update(identity, id, nil, err)
				}
				if value := values[identity]; value != nil {
					for i := range value.Results {
						result := &value.Results[i]
						if result.CurrentValue != nil {
							update(identity, result.CurrentValue.MetricID, result, nil)
						}
					}
				}
			}
		}
		if group.key == "k8s:/nodes" {
			continue
		}
		for _, id := range req.MetricIDs {
			if !strings.HasPrefix(id, "prom_") {
				continue
			}
			expression, err := nativePodExpression(group, identities, id)
			if err != nil {
				for _, identity := range identities {
					update(identity, id, nil, err)
				}
				continue
			}
			if req.Shape == sdkmetric.ShapeTimeseries {
				data, queryErr := c.queryRange(metricQueryContext(qctx), qctx.ConnectionID, qctx.Connection, expression, nil, req.StartTime, req.EndTime, req.Step)
				if queryErr != nil {
					for _, identity := range identities {
						update(identity, id, nil, queryErr)
					}
					continue
				}
				for _, series := range data.Data.Result {
					identity := nativeIdentity{group.key, series.Metric["namespace"], series.Metric["pod"]}
					points, sampleErr := nativePromPoints(id, series.Values, req)
					if sampleErr != nil {
						update(identity, id, nil, sampleErr)
						continue
					}
					if len(points) > 0 {
						value := sdkmetric.MetricResult{TimeSeries: &sdkmetric.TimeSeries{MetricID: id, DataPoints: points, Labels: series.Metric}}
						update(identity, id, &value, nil)
					}
				}
			} else {
				data, queryErr := c.query(metricQueryContext(qctx), qctx.ConnectionID, qctx.Connection, expression, nil)
				if queryErr != nil {
					for _, identity := range identities {
						update(identity, id, nil, queryErr)
					}
					continue
				}
				for _, series := range data.Data.Result {
					identity := nativeIdentity{group.key, series.Metric["namespace"], series.Metric["pod"]}
					result, sampleErr := nativePromCurrent(id, series.Metric, series.Value)
					update(identity, id, result, sampleErr)
				}
			}
		}
	}
	if err := metricQueryContext(qctx).Err(); err != nil {
		return nil, err
	}
	return response, nil
}

func nativePodExpression(group nativeGroup, resources []nativeIdentity, id string) (string, error) {
	if group.key != "k8s:/pods" {
		return "", resourcev2.NewError("UNSUPPORTED", fmt.Sprintf("metric %s has no grouped native mapping for %s", id, group.key))
	}
	names := make([]string, 0, len(resources))
	for _, resource := range resources {
		names = append(names, regexp.QuoteMeta(resource.name))
	}
	selector := `pod=~` + strconv.Quote(strings.Join(names, "|")) + `,namespace=` + strconv.Quote(group.namespace) + `,container!="POD"`
	base := `pod=~` + strconv.Quote(strings.Join(names, "|")) + `,namespace=` + strconv.Quote(group.namespace)
	sum := func(metric, labels string, rate bool) string {
		expression := metric + `{` + base + labels + `}`
		if rate {
			expression = `rate(` + expression + `[5m])`
		}
		return `sum by (pod, namespace) (` + expression + `)`
	}
	container := `,container!="POD"`
	switch id {
	case "prom_cpu_throttle_rate":
		return sum("container_cpu_cfs_throttled_seconds_total", container, true) + ` / ` + sum("container_cpu_usage_seconds_total", container, true) + ` * 100`, nil
	case "prom_memory_rss":
		return sum("container_memory_rss", container, false), nil
	case "prom_memory_cache":
		return sum("container_memory_cache", container, false), nil
	case "prom_memory_max":
		return sum("container_memory_max_usage_bytes", container, false), nil
	case "prom_network_receive_rate":
		return sum("container_network_receive_bytes_total", "", true), nil
	case "prom_network_transmit_rate":
		return sum("container_network_transmit_bytes_total", "", true), nil
	case "prom_disk_read_bytes":
		return sum("container_fs_reads_bytes_total", container, true), nil
	case "prom_disk_write_bytes":
		return sum("container_fs_writes_bytes_total", container, true), nil
	case "prom_disk_read_iops":
		return sum("container_fs_reads_total", container, true), nil
	case "prom_disk_write_iops":
		return sum("container_fs_writes_total", container, true), nil
	case "prom_fs_usage":
		return sum("container_fs_usage_bytes", container, false), nil
	case "prom_threads":
		return sum("container_threads", container, false), nil
	case "prom_page_faults":
		return sum("container_memory_failures_total", container+`,failure_type="pgfault",scope="container"`, true), nil
	case "prom_major_page_faults":
		return sum("container_memory_failures_total", container+`,failure_type="pgmajfault",scope="container"`, true), nil
	case "prom_cpu_request":
		return sum("kube_pod_container_resource_requests", `,resource="cpu"`, false), nil
	case "prom_cpu_limit":
		return sum("kube_pod_container_resource_limits", `,resource="cpu"`, false), nil
	case "prom_memory_request":
		return sum("kube_pod_container_resource_requests", `,resource="memory"`, false), nil
	case "prom_memory_limit":
		return sum("kube_pod_container_resource_limits", `,resource="memory"`, false), nil
	case "prom_cpu_pct_request":
		return sum("container_cpu_usage_seconds_total", container, true) + ` / ` + sum("kube_pod_container_resource_requests", `,resource="cpu"`, false) + ` * 100`, nil
	case "prom_memory_pct_request":
		return sum("container_memory_working_set_bytes", container, false) + ` / ` + sum("kube_pod_container_resource_requests", `,resource="memory"`, false) + ` * 100`, nil
	case "prom_restart_count":
		return sum("kube_pod_container_status_restarts_total", "", false), nil
	case "prom_pod_uptime":
		return `time() - min by (pod, namespace) (kube_pod_created{` + base + `})`, nil
	case "prom_probe_success_rate":
		return sum("prober_probe_total", `,result="successful"`, true), nil
	case "prom_probe_avg_latency":
		return sum("prober_probe_duration_seconds_sum", "", true) + ` / ` + sum("prober_probe_duration_seconds_count", "", true), nil
	case "prom_log_fs_used":
		return sum("kubelet_container_log_filesystem_used_bytes", "", false), nil
	case "prom_oom_killed_count":
		return sum("kube_pod_container_status_last_terminated_reason", `,reason="OOMKilled"`, false), nil
	case "prom_cpu_usage_rate":
		return `sum by (pod, namespace) (rate(container_cpu_usage_seconds_total{` + selector + `}[5m]))`, nil
	case "prom_memory_working_set":
		return `sum by (pod, namespace) (container_memory_working_set_bytes{` + selector + `})`, nil
	default:
		return "", resourcev2.NewError("UNSUPPORTED", fmt.Sprintf("metric %s has no grouped native mapping", id))
	}
}

func nativePromValue(pair [2]interface{}) (float64, bool) {
	raw, ok := pair[1].(string)
	if !ok {
		return 0, false
	}
	value, err := strconv.ParseFloat(raw, 64)
	return value, err == nil && !math.IsNaN(value) && !math.IsInf(value, 0)
}

// nativePromCurrent preserves provider units and sample time. Invalid samples
// are failures, never fabricated current observations or zero-valued readings.
func nativePromCurrent(id string, labels map[string]string, pair [2]interface{}) (*sdkmetric.MetricResult, error) {
	value, ok := nativePromValue(pair)
	if !ok {
		return nil, fmt.Errorf("metric %s has a nonfinite or invalid value", id)
	}
	seconds, ok := pair[0].(float64)
	if !ok || math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds <= 0 || seconds >= 253402300800 {
		return nil, fmt.Errorf("metric %s has an invalid sample timestamp", id)
	}
	whole, fraction := math.Modf(seconds)
	timestamp := time.Unix(int64(whole), int64(fraction*1e9))
	return &sdkmetric.MetricResult{CurrentValue: &sdkmetric.CurrentValue{MetricID: id, Value: value, Timestamp: timestamp, Labels: labels}}, nil
}

func nativePromPoints(id string, pairs [][2]interface{}, req sdkmetric.ResourceSetQueryRequest) ([]sdkmetric.DataPoint, error) {
	points := make([]sdkmetric.DataPoint, 0, len(pairs))
	for _, pair := range pairs {
		result, err := nativePromCurrent(id, nil, pair)
		if err != nil {
			return nil, err
		}
		sample := result.CurrentValue
		if sample.Timestamp.Before(req.StartTime) || sample.Timestamp.After(req.EndTime) {
			return nil, fmt.Errorf("metric %s has a sample outside requested range", id)
		}
		if len(points) > 0 && !sample.Timestamp.After(points[len(points)-1].Timestamp) {
			return nil, fmt.Errorf("metric %s has unordered sample timestamps", id)
		}
		points = append(points, sdkmetric.DataPoint{Timestamp: sample.Timestamp, Value: sample.Value})
	}
	return points, nil
}
