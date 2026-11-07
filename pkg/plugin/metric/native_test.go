package metric

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"k8s.io/apimachinery/pkg/api/resource"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

const nativeSample = `{"metadata":{"name":"same","namespace":"one"},"timestamp":"2026-11-05T10:00:00Z","window":"20s","containers":[{"name":"app","usage":{"cpu":"123456n","memory":"2Mi"}},{"name":"sidecar","usage":{"cpu":"250m","memory":"1024"}}]}`

func sampleNativePod(t *testing.T) *metricsv1beta1.PodMetrics {
	t.Helper()
	var item metricsv1beta1.PodMetrics
	if err := json.Unmarshal([]byte(nativeSample), &item); err != nil {
		t.Fatal(err)
	}
	return &item
}

func TestNativePreservesPhysicalUnitsAndSourceTime(t *testing.T) {
	item := sampleNativePod(t)
	cpu := sdkmetric.ResourceMetricResult{MetricID: nativeCPU}
	fillNativeResult(&cpu, item, nil)
	if cpu.Status != "ok" || cpu.Value == nil || math.Abs(*cpu.Value-0.250123456) > 1e-12 {
		t.Fatalf("CPU cores lost nanocore precision: %+v", cpu)
	}
	if cpu.ObservedAt == nil || !cpu.ObservedAt.Equal(item.Timestamp.Time) || cpu.Window != 20*time.Second {
		t.Fatalf("source time/window changed: %+v", cpu)
	}
	if cpu.IdentityScope != "name" {
		t.Fatalf("source without UID claimed incarnation attribution: %+v", cpu)
	}
	memory := sdkmetric.ResourceMetricResult{MetricID: nativeMemory}
	fillNativeResult(&memory, item, nil)
	if memory.Status != "ok" || memory.Value == nil || *memory.Value != 2*1024*1024+1024 {
		t.Fatalf("memory bytes changed: %+v", memory)
	}
}

func TestNativeMissingQuantityDoesNotBecomeZero(t *testing.T) {
	item := sampleNativePod(t)
	delete(item.Containers[0].Usage, "cpu")
	result := sdkmetric.ResourceMetricResult{MetricID: nativeCPU}
	fillNativeResult(&result, item, nil)
	if result.Status != "missing" || result.Value != nil || result.ObservedAt != nil {
		t.Fatalf("absent CPU became sample: %+v", result)
	}
	item.Timestamp.Time = time.Time{}
	result.MetricID = nativeMemory
	fillNativeResult(&result, item, nil)
	if result.Status != "missing" || result.Value != nil || result.ObservedAt != nil {
		t.Fatalf("missing source time became receipt time: %+v", result)
	}
}

func TestNativeIncarnationAttributionRequiresSourceUID(t *testing.T) {
	item := sampleNativePod(t)
	uid := "new-pod"
	result := sdkmetric.ResourceMetricResult{MetricID: nativeCPU}
	item.UID = "old-pod"
	fillNativeResult(&result, item, &uid)
	if result.Status != "invalid_context" || result.Value != nil {
		t.Fatalf("old incarnation leaked: %+v", result)
	}
	item.UID = "new-pod"
	fillNativeResult(&result, item, &uid)
	if result.Status != "ok" || result.IdentityScope != "incarnation" {
		t.Fatalf("verified source UID not preserved: %+v", result)
	}
	item.UID = ""
	fillNativeResult(&result, item, &uid)
	if result.Status != "ok" || result.IdentityScope != "name" {
		t.Fatalf("host reference was mistaken for source proof: %+v", result)
	}
}

func nativePage(items string) string {
	return `{"apiVersion":"metrics.k8s.io/v1beta1","kind":"PodMetricsList","metadata":{},"items":[` + items + `]}`
}

func TestNativeUnpaginatedScanEnforcesObjectAndByteBudgets(t *testing.T) {
	page := nativePage(nativeSample + "," + nativeSample)
	objects := nativeScanBudget{bytes: 1 << 20, objects: 1}
	visited := 0
	_, err := decodeNativePage(context.Background(), &nativeBudgetReader{source: strings.NewReader(page), budget: &objects}, &objects, func(*metricsv1beta1.PodMetrics) { visited++ })
	if !errors.Is(err, errNativeBudget) || visited != 0 {
		t.Fatalf("ignored server limit escaped object budget: visits=%d err=%v", visited, err)
	}
	bytes := nativeScanBudget{bytes: 64, objects: 100}
	_, err = decodeNativePage(context.Background(), &nativeBudgetReader{source: strings.NewReader(page), budget: &bytes}, &bytes, func(*metricsv1beta1.PodMetrics) {})
	if !errors.Is(err, errNativeBudget) || bytes.bytes != 0 {
		t.Fatalf("byte budget did not stop ingestion: %+v err=%v", bytes, err)
	}
}

func TestNativeExactByteBudgetAllowsEOF(t *testing.T) {
	page := nativePage(nativeSample)
	for _, extra := range []string{"", " "} {
		budget := nativeScanBudget{bytes: int64(len(page)), objects: 100}
		visited := 0
		_, err := decodeNativePage(context.Background(), &nativeBudgetReader{source: strings.NewReader(page + extra), budget: &budget}, &budget, func(*metricsv1beta1.PodMetrics) { visited++ })
		if extra == "" {
			if err != nil || visited != 1 {
				t.Fatalf("exact budget rejected valid page: visits=%d err=%v", visited, err)
			}
		} else if !errors.Is(err, errNativeBudget) || visited != 0 {
			t.Fatalf("over-budget page committed: visits=%d err=%v", visited, err)
		}
	}
}

func TestNativeDecoderRejectsMalformedEnvelopesAndCancellation(t *testing.T) {
	for _, page := range []string{
		`{"apiVersion":"metrics.k8s.io/v1beta1","kind":"PodMetricsList","items":[` + nativeSample + `],"items":[]}`,
		`{"items":[` + nativeSample + `],"apiVersion":"v1","kind":"PodList"}`,
		nativePage(nativeSample) + `{}`,
		nativePage(strings.Replace(nativeSample, `"cpu":"123456n"`, `"cpu":null`, 1)),
	} {
		budget := nativeScanBudget{bytes: 1 << 20, objects: 100}
		if _, err := decodeNativePage(context.Background(), strings.NewReader(page), &budget, func(*metricsv1beta1.PodMetrics) { t.Fatal("invalid page committed a sample") }); err == nil {
			t.Fatalf("invalid page admitted: %s", page)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	budget := nativeScanBudget{bytes: 1 << 20, objects: 100}
	if _, err := decodeNativePage(ctx, strings.NewReader(nativePage(nativeSample)), &budget, func(*metricsv1beta1.PodMetrics) { t.Fatal("canceled scan visited sample") }); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
}

func TestNativeRangeIsUnsupportedWithoutOpeningClient(t *testing.T) {
	provider := newNativeProvider()
	defer provider.cache.Stop()
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	query := sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), MetricIDs: []string{nativeCPU, nativeMemory}, Shape: "range", StartTime: time.Unix(100, 0), EndTime: time.Unix(200, 0), Step: time.Second,
		Targets: []sdkmetric.ResourceMetricTarget{{Token: "row", Route: resourcev2.AccessRoute{Connection: "selected"}, Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "admitted", Type: "k8s:/pods", ID: "same", Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "one"}}}}}}}
	response, err := provider.query(pc, query)
	if err != nil {
		t.Fatal(err)
	}
	if !response.Complete || len(response.Results) != 2 || provider.cache.Len() != 0 {
		t.Fatalf("range opened clients or lost explicit results: %+v", response)
	}
	for _, result := range response.Results {
		if result.Status != "unsupported" || result.Value != nil || len(result.Points) != 0 {
			t.Fatalf("native history fabricated: %+v", result)
		}
	}
}

func TestNativeMeasuredZeroAndAbsentContainersStayDistinct(t *testing.T) {
	item := sampleNativePod(t)
	for index := range item.Containers {
		item.Containers[index].Usage["cpu"] = resource.MustParse("0")
	}
	result := sdkmetric.ResourceMetricResult{MetricID: nativeCPU}
	fillNativeResult(&result, item, nil)
	if result.Status != "ok" || result.Value == nil || *result.Value != 0 {
		t.Fatalf("measured zero disappeared: %+v", result)
	}
	item.Containers = nil
	fillNativeResult(&result, item, nil)
	if result.Status != "missing" || result.Value != nil || result.ObservedAt != nil {
		t.Fatalf("absent containers became measured zero: %+v", result)
	}
}

func TestLegacyPodNativeIDsCannotInvokeCompatibilityCollection(t *testing.T) {
	qctx := &sdkmetric.QueryContext{Context: context.Background(), ConnectionID: "selected", Connection: &types.Connection{ID: "selected"}}
	for _, id := range []string{"cpu_usage", "memory_usage", nativeCPU, nativeMemory} {
		// A nil Prometheus client makes accidental legacy dispatch observable.
		_, err := compositeQuery(nil, qctx, sdkmetric.QueryRequest{ResourceKey: "k8s:/pods", MetricIDs: []string{id}})
		if resourcev2.ErrorCode(err) != "UNSUPPORTED" {
			t.Fatalf("legacy native ID %q did not fail explicitly: %v", id, err)
		}
	}
}
