package metric

import (
	"slices"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// metricOwnerCatalog declares Kubernetes semantics and public projection paths.
// Query execution and credentials remain owned by the selected source provider.
func metricOwnerCatalog(*types.PluginContext) (*sdkmetric.MetricOwnerCatalog, error) {
	bindings := []sdkmetric.MetricFieldBinding{
		{Field: "cluster", Label: "cluster", Source: "scope", Required: true},
		{Field: "namespace", Label: "namespace", Source: "resource", ResourcePath: "/metadata/namespace", Required: true},
		{Field: "pod", Label: "pod", Source: "resource", ResourcePath: "/metadata/name", Required: true},
	}
	base := sdkmetric.MetricDefinition{ResourceKeys: []string{"k8s:/pods"}, Semantics: "gauge", QueryLanguage: "promql", FieldBindings: bindings, IdentityLabels: []string{"cluster", "namespace", "pod"}, Reducer: "none", BatchStrategy: "identity", Revision: "kubernetes-cadvisor-v1", SupportedShapes: []string{"current", "range"}}
	clone := func() sdkmetric.MetricDefinition {
		definition := base
		definition.FieldBindings = slices.Clone(base.FieldBindings)
		definition.ResourceKeys = slices.Clone(base.ResourceKeys)
		definition.IdentityLabels = slices.Clone(base.IdentityLabels)
		definition.SupportedShapes = slices.Clone(base.SupportedShapes)
		return definition
	}
	cpu := clone()
	cpu.ID = nativeCPU
	cpu.Name = "CPU usage"
	cpu.Unit = "cores"
	cpu.Semantics = "rate"
	cpu.Native = true
	// Prefer deduplicated container series. Aggregate-only exporters may omit
	// container; the identity join admits their Pod aggregate only as a fallback.
	cpu.Query = `sum by (cluster,namespace,pod) (max by (cluster,namespace,pod,container) (rate(container_cpu_usage_seconds_total{cluster=~"{{cluster}}",namespace=~"{{namespace}}",pod=~"{{pod}}",container!="",container!="POD"}[5m]))) or on (cluster,namespace,pod) max by (cluster,namespace,pod) (rate(container_cpu_usage_seconds_total{cluster=~"{{cluster}}",namespace=~"{{namespace}}",pod=~"{{pod}}",pod!="",container=""}[5m]))`
	memory := clone()
	memory.ID = nativeMemory
	memory.Name = "Memory working set"
	memory.Unit = "bytes"
	memory.Native = true
	memory.Query = `sum by (cluster,namespace,pod) (max by (cluster,namespace,pod,container) (container_memory_working_set_bytes{cluster=~"{{cluster}}",namespace=~"{{namespace}}",pod=~"{{pod}}",container!="",container!="POD"})) or on (cluster,namespace,pod) max by (cluster,namespace,pod) (container_memory_working_set_bytes{cluster=~"{{cluster}}",namespace=~"{{namespace}}",pod=~"{{pod}}",pod!="",container=""})`
	const scope = `cluster=~"{{cluster}}",namespace=~"{{namespace}}",pod=~"{{pod}}"`
	const containers = scope + `,container!="",container!="POD"`
	const group = ` by (cluster,namespace,pod) `
	presets := []struct {
		id, name, semantics, query string
		unit                       string
	}{
		{"memory_rss", "Memory RSS", "gauge", `sum` + group + `(container_memory_rss{` + containers + `})`, "bytes"},
		{"memory_cache", "Memory cache", "gauge", `sum` + group + `(container_memory_cache{` + containers + `})`, "bytes"},
		{"network_receive", "Network receive", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_receive_bytes_total{` + scope + `,interface!="lo"}[5m])))`, "bytes_per_second"},
		{"network_transmit", "Network transmit", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_transmit_bytes_total{` + scope + `,interface!="lo"}[5m])))`, "bytes_per_second"},
		{"disk_read", "Disk read", "rate", `sum` + group + `(rate(container_fs_reads_bytes_total{` + containers + `}[5m]))`, "bytes_per_second"},
		{"disk_write", "Disk write", "rate", `sum` + group + `(rate(container_fs_writes_bytes_total{` + containers + `}[5m]))`, "bytes_per_second"},
		{"cpu_throttling", "CPU throttled periods", "gauge", `100 * sum` + group + `(rate(container_cpu_cfs_throttled_periods_total{` + containers + `}[5m])) / (sum` + group + `(rate(container_cpu_cfs_periods_total{` + containers + `}[5m])) > 0)`, "percent"},
		{"restarts", "Container restarts", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (kube_pod_container_status_restarts_total{` + scope + `}))`, "count"},
		{"cpu_requests", "CPU requests", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (kube_pod_container_resource_requests{` + scope + `,resource="cpu",unit="core"}))`, "cores"},
		{"cpu_limits", "CPU limits", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (kube_pod_container_resource_limits{` + scope + `,resource="cpu",unit="core"}))`, "cores"},
		{"memory_requests", "Memory requests", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (kube_pod_container_resource_requests{` + scope + `,resource="memory",unit="byte"}))`, "bytes"},
		{"memory_limits", "Memory limits", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (kube_pod_container_resource_limits{` + scope + `,resource="memory",unit="byte"}))`, "bytes"},
		{"network_receive_packets", "Network receive packets", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_receive_packets_total{` + scope + `,interface!="lo"}[5m])))`, "count_per_second"},
		{"network_transmit_packets", "Network transmit packets", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_transmit_packets_total{` + scope + `,interface!="lo"}[5m])))`, "count_per_second"},
		{"network_receive_drops", "Network receive drops", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_receive_packets_dropped_total{` + scope + `,interface!="lo"}[5m])))`, "count_per_second"},
		{"network_transmit_drops", "Network transmit drops", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_transmit_packets_dropped_total{` + scope + `,interface!="lo"}[5m])))`, "count_per_second"},
		{"network_receive_errors", "Network receive errors", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_receive_errors_total{` + scope + `,interface!="lo"}[5m])))`, "count_per_second"},
		{"network_transmit_errors", "Network transmit errors", "rate", `sum` + group + `(max by (cluster,namespace,pod,interface) (rate(container_network_transmit_errors_total{` + scope + `,interface!="lo"}[5m])))`, "count_per_second"},
		{"memory_total_usage", "Memory total usage", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (container_memory_usage_bytes{` + containers + `}))`, "bytes"},
		{"filesystem_usage", "Filesystem used", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container,device) (container_fs_usage_bytes{` + containers + `}))`, "bytes"},
		{"processes", "Container processes", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (container_processes{` + containers + `}))`, "count"},
		{"threads", "Container threads", "gauge", `sum` + group + `(max by (cluster,namespace,pod,container) (container_threads{` + containers + `}))`, "count"},
	}
	definitions := make([]sdkmetric.MetricDefinition, 2, len(presets)+4)
	definitions[0], definitions[1] = cpu, memory
	for _, preset := range presets {
		definition := clone()
		definition.ID, definition.Name = "kubernetes.pod."+preset.id, preset.name
		definition.Semantics, definition.Query, definition.Unit = preset.semantics, preset.query, preset.unit
		definitions = append(definitions, definition)
	}
	definitions = append(definitions,
		sdkmetric.MetricDefinition{ID: nativeNodeCPU, Name: "CPU usage", ResourceKeys: []string{"k8s:/nodes"}, Unit: "cores", Semantics: "rate", SupportedShapes: []string{"current"}, Revision: "kubernetes-metrics-server-v1", Native: true},
		sdkmetric.MetricDefinition{ID: nativeNodeMemory, Name: "Memory working set", ResourceKeys: []string{"k8s:/nodes"}, Unit: "bytes", Semantics: "gauge", SupportedShapes: []string{"current"}, Revision: "kubernetes-metrics-server-v1", Native: true},
	)
	return &sdkmetric.MetricOwnerCatalog{
		Definitions: definitions,
		ScopeFields: []sdkmetric.MetricScopeField{{Key: "cluster", Name: "Cluster label value", Description: "Value of the cluster label on this Kubernetes connection's exported metrics."}},
	}, nil
}
