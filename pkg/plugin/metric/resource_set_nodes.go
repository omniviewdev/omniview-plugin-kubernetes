package metric

import (
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/omniview/kubernetes/pkg/utils"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type nativeResultUpdate func(nativeIdentity, string, *sdkmetric.MetricResult, error)

func (c *prometheusClient) queryNodeSet(qctx *sdkmetric.QueryContext, req sdkmetric.ResourceSetQueryRequest, identities []nativeIdentity, update nativeResultUpdate) {
	needed := false
	for _, id := range req.MetricIDs {
		if id == "cpu_capacity" || id == "memory_capacity" || strings.HasPrefix(id, "prom_") {
			needed = true
		}
	}
	if !needed {
		return
	}
	clients, err := utils.KubeClientsFromContext(&types.PluginContext{Context: metricQueryContext(qctx), Connection: qctx.Connection})
	var nodes *corev1.NodeList
	if err == nil {
		nodes, err = clients.Clientset.CoreV1().Nodes().List(metricQueryContext(qctx), metav1.ListOptions{})
	}
	queryNodeSetCapacity(req, identities, nodes, err, update)
	c.queryNodeSetPrometheus(qctx, req, identities, nodes, err, update)
}

// Node capacity comes from one authoritative inventory list, not an observation
// projection or one GET per table row. Metrics-server is not a capacity source.
func queryNodeSetCapacity(req sdkmetric.ResourceSetQueryRequest, identities []nativeIdentity, nodes *corev1.NodeList, err error, update nativeResultUpdate) {
	var ids []string
	for _, id := range req.MetricIDs {
		if id == "cpu_capacity" || id == "memory_capacity" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return
	}
	if req.Shape != sdkmetric.ShapeCurrent {
		err = resourcev2.NewError("UNSUPPORTED", "Node capacity does not provide historical samples")
	}
	if err != nil {
		for _, identity := range identities {
			for _, id := range ids {
				update(identity, id, nil, err)
			}
		}
		return
	}
	for _, node := range nodes.Items {
		identity := nativeIdentity{"k8s:/nodes", "", node.Name}
		for _, id := range ids {
			resource := corev1.ResourceCPU
			if id == "memory_capacity" {
				resource = corev1.ResourceMemory
			}
			quantity, exists := node.Status.Capacity[resource]
			if !exists {
				continue
			}
			value := float64(quantity.MilliValue())
			if resource == corev1.ResourceMemory {
				value = float64(quantity.Value())
			}
			result := sdkmetric.MetricResult{CurrentValue: &sdkmetric.CurrentValue{MetricID: id, Value: value, Timestamp: time.Now(), Labels: map[string]string{"node": node.Name}}}
			update(identity, id, &result, nil)
		}
	}
}

func (c *prometheusClient) queryNodeSetPrometheus(qctx *sdkmetric.QueryContext, req sdkmetric.ResourceSetQueryRequest, identities []nativeIdentity, nodes *corev1.NodeList, err error, update nativeResultUpdate) {
	var ids []string
	for _, id := range req.MetricIDs {
		if strings.HasPrefix(id, "prom_") {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return
	}
	fail := func(err error) {
		for _, identity := range identities {
			for _, id := range ids {
				update(identity, id, nil, err)
			}
		}
	}
	// Resolve exact native addresses from the one authoritative NodeList. Never
	// infer an exporter address from a name or fall back after lookup failure.
	if err != nil {
		fail(err)
		return
	}
	owners := make(map[string]string)
	wanted := make(map[string]bool)
	for _, identity := range identities {
		wanted[identity.name] = true
	}
	for _, node := range nodes.Items {
		if !wanted[node.Name] {
			continue
		}
		for _, entry := range node.Status.Addresses {
			if entry.Type != corev1.NodeInternalIP && entry.Type != corev1.NodeExternalIP {
				continue
			}
			address := entry.Address
			if net.ParseIP(address) == nil {
				continue
			}
			if previous, exists := owners[address]; exists && previous != node.Name {
				fail(nativeAmbiguityError("Multiple nodes share an exporter address"))
				return
			}
			owners[address] = node.Name
		}
	}
	var addresses []string
	for address := range owners {
		host := regexp.QuoteMeta(address)
		if strings.Contains(address, ":") {
			host = regexp.QuoteMeta("[" + address + "]")
		}
		addresses = append(addresses, host+`:[0-9]+`)
	}
	if len(addresses) == 0 {
		return
	}
	for _, id := range ids {
		expression, err := nativeNodeExpression(strings.Join(addresses, "|"), id)
		if err != nil {
			for _, identity := range identities {
				update(identity, id, nil, err)
			}
			continue
		}
		results := make(map[string][]sdkmetric.MetricResult)
		if req.Shape == sdkmetric.ShapeTimeseries {
			data, queryErr := c.queryRange(metricQueryContext(qctx), qctx.ConnectionID, qctx.Connection, expression, nil, req.StartTime, req.EndTime, req.Step)
			err = queryErr
			if err == nil {
				for _, series := range data.Data.Result {
					host, _, parseErr := net.SplitHostPort(series.Metric["instance"])
					if parseErr != nil || owners[host] == "" {
						continue
					}
					points, sampleErr := nativePromPoints(id, series.Values, req)
					if sampleErr != nil {
						err = sampleErr
						break
					}
					if len(points) > 0 {
						results[owners[host]] = append(results[owners[host]], sdkmetric.MetricResult{TimeSeries: &sdkmetric.TimeSeries{MetricID: id, DataPoints: points, Labels: map[string]string{"node": owners[host], "instance": series.Metric["instance"]}}})
					}
				}
			}
		} else {
			data, queryErr := c.query(metricQueryContext(qctx), qctx.ConnectionID, qctx.Connection, expression, nil)
			err = queryErr
			if err == nil {
				for _, series := range data.Data.Result {
					host, _, parseErr := net.SplitHostPort(series.Metric["instance"])
					if parseErr != nil || owners[host] == "" {
						continue
					}
					result, sampleErr := nativePromCurrent(id, map[string]string{"node": owners[host], "instance": series.Metric["instance"]}, series.Value)
					if sampleErr != nil {
						err = sampleErr
						break
					}
					results[owners[host]] = append(results[owners[host]], *result)
				}
			}
		}
		for _, identity := range identities {
			if err != nil {
				update(identity, id, nil, err)
				continue
			}
			values := results[identity.name]
			if len(values) > 1 {
				update(identity, id, nil, nativeAmbiguityError("Multiple exporter series match one node"))
			} else if len(values) == 1 {
				update(identity, id, &values[0], nil)
			}
		}
	}
}

func nativeNodeExpression(instances, id string) (string, error) {
	selector := `instance=~` + strconv.Quote(instances)
	metric := func(name, labels string) string { return name + `{` + selector + labels + `}` }
	sumRate := func(name, labels string) string {
		return `sum by (instance, job) (rate(` + metric(name, labels) + `[5m]))`
	}
	switch id {
	case "prom_cpu_utilization":
		return `100 - avg by (instance, job) (rate(` + metric("node_cpu_seconds_total", `,mode="idle"`) + `[5m])) * 100`, nil
	case "prom_memory_utilization":
		return `(1 - ` + metric("node_memory_MemAvailable_bytes", "") + ` / ` + metric("node_memory_MemTotal_bytes", "") + `) * 100`, nil
	case "prom_memory_total":
		return metric("node_memory_MemTotal_bytes", ""), nil
	case "prom_disk_utilization":
		return `(1 - ` + metric("node_filesystem_avail_bytes", `,mountpoint="/"`) + ` / ` + metric("node_filesystem_size_bytes", `,mountpoint="/"`) + `) * 100`, nil
	case "prom_disk_total":
		return metric("node_filesystem_size_bytes", `,mountpoint="/"`), nil
	case "prom_network_receive_rate":
		return sumRate("node_network_receive_bytes_total", `,device!="lo"`), nil
	case "prom_network_transmit_rate":
		return sumRate("node_network_transmit_bytes_total", `,device!="lo"`), nil
	case "prom_load_avg_1m":
		return metric("node_load1", ""), nil
	case "prom_load_avg_5m":
		return metric("node_load5", ""), nil
	case "prom_load_avg_15m":
		return metric("node_load15", ""), nil
	case "prom_pod_count":
		return metric("kubelet_running_pods", ""), nil
	case "prom_disk_read_rate":
		return sumRate("node_disk_read_bytes_total", ""), nil
	case "prom_disk_write_rate":
		return sumRate("node_disk_written_bytes_total", ""), nil
	case "prom_network_errors":
		return sumRate("node_network_receive_errs_total", `,device!="lo"`) + ` + ` + sumRate("node_network_transmit_errs_total", `,device!="lo"`), nil
	case "prom_context_switches":
		return sumRate("node_context_switches_total", ""), nil
	default:
		return "", resourcev2.NewError("UNSUPPORTED", fmt.Sprintf("metric %s has no grouped node mapping", id))
	}
}
