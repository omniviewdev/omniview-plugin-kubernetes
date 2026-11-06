package metric

import (
	"context"
	"reflect"
	"strings"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

func TestMetricOwnerCatalogDeclaresAllKubernetesDefinitions(t *testing.T) {
	catalog, err := metricOwnerCatalog(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := sdkmetric.ValidateMetricOwnerCatalog(catalog); err != nil {
		t.Fatalf("invalid owner catalog contract: %v", err)
	}
	if len(catalog.Definitions) != 26 {
		t.Fatalf("owner catalog has %d definitions, want 26", len(catalog.Definitions))
	}
	if len(catalog.ScopeFields) != 1 || catalog.ScopeFields[0].Key != "cluster" || catalog.ScopeFields[0].Name != "Cluster label value" || catalog.ScopeFields[0].Description == "" {
		t.Fatalf("owner scope declaration changed: %+v", catalog.ScopeFields)
	}
	expected := map[string]string{
		nativeCPU: "cores", nativeMemory: "bytes", nativeNodeCPU: "cores", nativeNodeMemory: "bytes",
		"kubernetes.pod.memory_rss": "bytes", "kubernetes.pod.memory_cache": "bytes",
		"kubernetes.pod.network_receive": "bytes_per_second", "kubernetes.pod.network_transmit": "bytes_per_second",
		"kubernetes.pod.disk_read": "bytes_per_second", "kubernetes.pod.disk_write": "bytes_per_second",
		"kubernetes.pod.cpu_throttling": "percent", "kubernetes.pod.restarts": "count",
		"kubernetes.pod.cpu_requests": "cores", "kubernetes.pod.cpu_limits": "cores",
		"kubernetes.pod.memory_requests": "bytes", "kubernetes.pod.memory_limits": "bytes",
		"kubernetes.pod.network_receive_packets": "count_per_second", "kubernetes.pod.network_transmit_packets": "count_per_second",
		"kubernetes.pod.network_receive_drops": "count_per_second", "kubernetes.pod.network_transmit_drops": "count_per_second",
		"kubernetes.pod.network_receive_errors": "count_per_second", "kubernetes.pod.network_transmit_errors": "count_per_second",
		"kubernetes.pod.memory_total_usage": "bytes", "kubernetes.pod.filesystem_usage": "bytes",
		"kubernetes.pod.processes": "count", "kubernetes.pod.threads": "count",
	}
	for _, definition := range catalog.Definitions {
		unit, found := expected[definition.ID]
		if !found || definition.Unit != unit {
			t.Fatalf("unexpected definition or units: %+v", definition)
		}
		delete(expected, definition.ID)
		if err := sdkmetric.ValidateMetricDefinitionContract(definition); err != nil {
			t.Fatalf("invalid owner definition %s: %v", definition.ID, err)
		}
		isNode := definition.ID == nativeNodeCPU || definition.ID == nativeNodeMemory
		if definition.Native != (isNode || definition.ID == nativeCPU || definition.ID == nativeMemory) {
			t.Fatalf("wrong native capability for %s", definition.ID)
		}
		if isNode {
			if !reflect.DeepEqual(definition.ResourceKeys, []string{"k8s:/nodes"}) || !reflect.DeepEqual(definition.SupportedShapes, []string{"current"}) || definition.Query != "" || len(definition.FieldBindings) != 0 {
				t.Fatalf("native Node invented mapping or history: %+v", definition)
			}
			continue
		}
		if !reflect.DeepEqual(definition.ResourceKeys, []string{"k8s:/pods"}) || !reflect.DeepEqual(definition.SupportedShapes, []string{"current", "range"}) || !reflect.DeepEqual(definition.IdentityLabels, []string{"cluster", "namespace", "pod"}) || definition.QueryLanguage != "promql" || definition.Reducer != "none" || definition.BatchStrategy != "identity" || definition.Revision != "kubernetes-cadvisor-v1" {
			t.Fatalf("Pod mapping contract changed: %+v", definition)
		}
		bindings := []sdkmetric.MetricFieldBinding{
			{Field: "cluster", Label: "cluster", Source: "scope", Required: true},
			{Field: "namespace", Label: "namespace", Source: "resource", ResourcePath: "/metadata/namespace", Required: true},
			{Field: "pod", Label: "pod", Source: "resource", ResourcePath: "/metadata/name", Required: true},
		}
		if !reflect.DeepEqual(definition.FieldBindings, bindings) {
			t.Fatalf("unsafe or implicit resource projection: %+v", definition.FieldBindings)
		}
		for _, field := range []string{"cluster", "namespace", "pod"} {
			if !strings.Contains(definition.Query, field+`=~"{{`+field+`}}"`) {
				t.Fatalf("query %s lost exact public scope binding %s", definition.ID, field)
			}
		}
	}
	if len(expected) != 0 {
		t.Fatalf("missing definitions: %v", expected)
	}
}

func TestMetricOwnerCatalogReturnsIndependentMappings(t *testing.T) {
	first, _ := metricOwnerCatalog(nil)
	first.Definitions[0].FieldBindings[0].Field = "changed"
	first.Definitions[0].ResourceKeys[0] = "changed"
	first.Definitions[0].IdentityLabels[0] = "changed"
	first.Definitions[0].SupportedShapes[0] = "changed"
	if first.Definitions[1].FieldBindings[0].Field != "cluster" || first.Definitions[1].ResourceKeys[0] != "k8s:/pods" || first.Definitions[1].IdentityLabels[0] != "cluster" || first.Definitions[1].SupportedShapes[0] != "current" {
		t.Fatal("editing one mapping changed another mapping")
	}
	second, _ := metricOwnerCatalog(nil)
	if second.Definitions[0].FieldBindings[0].Field != "cluster" {
		t.Fatal("editing a response mutated the owner catalog")
	}
}

func TestNativeSourceUsesOnlyOwnerTuple(t *testing.T) {
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	source := nativeSource(pc)
	if source != (sdkmetric.MetricSourceRef{PluginID: "kubernetes", ConnectionID: "selected", Native: true}) {
		t.Fatalf("native source invented datasource identity: %+v", source)
	}
	provider := newNativeProvider()
	defer provider.cache.Stop()
	for _, key := range []string{"k8s:/pods", "k8s:/nodes"} {
		catalog, err := provider.catalog(pc, sdkmetric.ResourceMetricsCatalogRequest{Source: source, ResourceKey: key})
		if err != nil || len(catalog.Metrics) != 2 || catalog.Source != source {
			t.Fatalf("native catalog %s: %+v %v", key, catalog, err)
		}
	}
	for _, invalid := range []sdkmetric.MetricSourceRef{
		{PluginID: "kubernetes", ConnectionID: "selected", DatasourceKind: "metrics-server"},
		{PluginID: "kubernetes", ConnectionID: "other", Native: true},
		{PluginID: "other", ConnectionID: "selected", Native: true},
		{PluginID: "kubernetes", ConnectionID: "selected", Native: true, DatasourceUID: "invented"},
	} {
		if _, err := provider.catalog(pc, sdkmetric.ResourceMetricsCatalogRequest{Source: invalid, ResourceKey: "k8s:/pods"}); resourcev2.ErrorCode(err) != "INVALID_REQUEST" {
			t.Fatalf("native catalog accepted foreign source %+v: %v", invalid, err)
		}
	}
}

func TestMetricOwnerCatalogPreservesPodRecipes(t *testing.T) {
	catalog, _ := metricOwnerCatalog(nil)
	definitions := make(map[string]sdkmetric.MetricDefinition, len(catalog.Definitions))
	for _, definition := range catalog.Definitions {
		definitions[definition.ID] = definition
	}
	for _, recipe := range []struct {
		id, exporter, semantics, fragment string
	}{
		{nativeCPU, "container_cpu_usage_seconds_total", "rate", `rate(container_cpu_usage_seconds_total`},
		{nativeMemory, "container_memory_working_set_bytes", "gauge", `sum by (cluster,namespace,pod) (container_memory_working_set_bytes`},
		{"kubernetes.pod.memory_rss", "container_memory_rss", "gauge", `sum by (cluster,namespace,pod) (container_memory_rss`},
		{"kubernetes.pod.memory_cache", "container_memory_cache", "gauge", `sum by (cluster,namespace,pod) (container_memory_cache`},
		{"kubernetes.pod.network_receive", "container_network_receive_bytes_total", "rate", `max by (cluster,namespace,pod,interface)`},
		{"kubernetes.pod.network_transmit", "container_network_transmit_bytes_total", "rate", `max by (cluster,namespace,pod,interface)`},
		{"kubernetes.pod.disk_read", "container_fs_reads_bytes_total", "rate", `rate(container_fs_reads_bytes_total`},
		{"kubernetes.pod.disk_write", "container_fs_writes_bytes_total", "rate", `rate(container_fs_writes_bytes_total`},
		{"kubernetes.pod.cpu_throttling", "container_cpu_cfs_throttled_periods_total", "gauge", `100 * sum by (cluster,namespace,pod)`},
		{"kubernetes.pod.restarts", "kube_pod_container_status_restarts_total", "gauge", `max by (cluster,namespace,pod,container)`},
		{"kubernetes.pod.cpu_requests", "kube_pod_container_resource_requests", "gauge", `resource="cpu",unit="core"`},
		{"kubernetes.pod.cpu_limits", "kube_pod_container_resource_limits", "gauge", `resource="cpu",unit="core"`},
		{"kubernetes.pod.memory_requests", "kube_pod_container_resource_requests", "gauge", `resource="memory",unit="byte"`},
		{"kubernetes.pod.memory_limits", "kube_pod_container_resource_limits", "gauge", `resource="memory",unit="byte"`},
		{"kubernetes.pod.network_receive_packets", "container_network_receive_packets_total", "rate", `max by (cluster,namespace,pod,interface)`},
		{"kubernetes.pod.network_transmit_packets", "container_network_transmit_packets_total", "rate", `max by (cluster,namespace,pod,interface)`},
		{"kubernetes.pod.network_receive_drops", "container_network_receive_packets_dropped_total", "rate", `max by (cluster,namespace,pod,interface)`},
		{"kubernetes.pod.network_transmit_drops", "container_network_transmit_packets_dropped_total", "rate", `max by (cluster,namespace,pod,interface)`},
		{"kubernetes.pod.network_receive_errors", "container_network_receive_errors_total", "rate", `max by (cluster,namespace,pod,interface)`},
		{"kubernetes.pod.network_transmit_errors", "container_network_transmit_errors_total", "rate", `max by (cluster,namespace,pod,interface)`},
		{"kubernetes.pod.memory_total_usage", "container_memory_usage_bytes", "gauge", `max by (cluster,namespace,pod,container)`},
		{"kubernetes.pod.filesystem_usage", "container_fs_usage_bytes", "gauge", `max by (cluster,namespace,pod,container,device)`},
		{"kubernetes.pod.processes", "container_processes", "gauge", `max by (cluster,namespace,pod,container)`},
		{"kubernetes.pod.threads", "container_threads", "gauge", `max by (cluster,namespace,pod,container)`},
	} {
		t.Run(recipe.id, func(t *testing.T) {
			definition := definitions[recipe.id]
			if definition.Semantics != recipe.semantics || !strings.Contains(definition.Query, recipe.exporter+"{") || !strings.Contains(definition.Query, recipe.fragment) {
				t.Fatalf("recipe semantics changed: %+v", definition)
			}
			if recipe.semantics == "rate" && !strings.Contains(definition.Query, "[5m]") {
				t.Fatalf("rate window changed: %s", definition.Query)
			}
			if strings.HasPrefix(recipe.id, "kubernetes.pod.network_") {
				if !strings.Contains(definition.Query, `interface!="lo"`) || strings.Contains(definition.Query, "container!=") {
					t.Fatalf("network interface deduplication changed: %s", definition.Query)
				}
			}
		})
	}
	throttle := definitions["kubernetes.pod.cpu_throttling"].Query
	if !strings.Contains(throttle, "rate(container_cpu_cfs_periods_total{") || !strings.HasSuffix(throttle, "[5m])) > 0)") {
		t.Fatalf("throttle denominator lost zero guard: %s", throttle)
	}
}
