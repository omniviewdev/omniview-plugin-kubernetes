package diag

import (
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"

	sdkdiag "github.com/omniviewdev/plugin-sdk/pkg/diagnostics"
	lifecyclepb "github.com/omniviewdev/plugin-sdk/proto/v1/lifecycle"
)

const nativeScanPrefix = "omniview.plugin.self.native_scan."

// nativeScanSnapshot returns every native scan series in the process registry,
// keyed "metric|key=value,key=value" without the metric prefix.
func nativeScanSnapshot(t *testing.T) map[string]float64 {
	t.Helper()
	metrics, truncated := sdkdiag.Default().Snapshot()
	if truncated {
		t.Fatal("diagnostics dropped an observation")
	}
	series := map[string]float64{}
	for _, metric := range metrics {
		name, ok := strings.CutPrefix(metric.GetName(), nativeScanPrefix)
		if !ok {
			continue
		}
		for _, point := range metric.GetPoints() {
			attrs := make([]string, 0, len(point.GetAttrs()))
			for _, a := range point.GetAttrs() {
				attrs = append(attrs, lower(a.GetKey().String())+"="+a.GetValue())
			}
			sort.Strings(attrs)
			series[name+"|"+strings.Join(attrs, ",")] = point.GetValue()
		}
	}
	return series
}

// nativeScanChanges lists every series that moved since before as sorted
// "series +increase" lines, so expectations read as one line per series.
func nativeScanChanges(before, after map[string]float64) []string {
	changes := []string{}
	for key, value := range after {
		if value != before[key] {
			changes = append(changes, key+" +"+strconv.FormatFloat(value-before[key], 'f', -1, 64))
		}
	}
	sort.Strings(changes)
	return changes
}

func TestDeclareNativeScanCreatesEverySeriesOnceAndStaysBounded(t *testing.T) {
	DeclareNativeScan()
	declared := nativeScanSnapshot(t)
	want := []string{
		"api_calls|operation=namespace", "api_calls|operation=node",
		"pages|operation=namespace", "pages|operation=node",
		"objects|operation=namespace", "objects|operation=node",
		"bytes|operation=namespace", "bytes|operation=node",
		"scans|outcome=ok", "scans|outcome=denied", "scans|outcome=budget",
		"scans|outcome=canceled", "scans|outcome=timeout", "scans|outcome=failed",
		"cancellations|reason=caller", "cancellations|reason=deadline", "cancellations|reason=retired",
	}
	for _, key := range want {
		if _, ok := declared[key]; !ok {
			t.Errorf("series %q is not declared, so a capture would see it appear mid-run", key)
		}
	}
	if len(declared) != len(want) {
		t.Errorf("declared %d series, want exactly %d: %v", len(declared), len(want), declared)
	}

	// Declaring again must neither change a value nor add a series.
	DeclareNativeScan()
	if after := nativeScanSnapshot(t); !reflect.DeepEqual(after, declared) {
		t.Errorf("redeclaration changed state: before=%v after=%v", declared, after)
	}

	metrics, _ := sdkdiag.Default().Snapshot()
	if len(metrics) > sdkdiag.MaxMetrics {
		t.Fatalf("%d metrics exceed the plugin cap of %d", len(metrics), sdkdiag.MaxMetrics)
	}
	native := 0
	for _, metric := range metrics {
		if !strings.HasPrefix(metric.GetName(), nativeScanPrefix) {
			continue
		}
		native++
		if !sdkdiag.ValidName(metric.GetName()) || !sdkdiag.ValidUnit(metric.GetUnit()) {
			t.Errorf("%s (%s) would be rejected by the host", metric.GetName(), metric.GetUnit())
		}
		if metric.GetKind() != lifecyclepb.DiagKind_DIAG_KIND_COUNTER {
			t.Errorf("%s is %s, want a counter", metric.GetName(), metric.GetKind())
		}
		if len(metric.GetPoints()) > sdkdiag.MaxPoints {
			t.Errorf("%s has %d series, cap is %d", metric.GetName(), len(metric.GetPoints()), sdkdiag.MaxPoints)
		}
	}
	if native != 6 {
		t.Errorf("registered %d native scan metrics, want 6; a nil instrument means registration failed", native)
	}
}

func TestNativeScanRecordersAddUp(t *testing.T) {
	DeclareNativeScan()
	before := nativeScanSnapshot(t)

	ScanRequest(ScanNamespace)
	ScanRequest(ScanNamespace)
	ScanRequest(ScanNode)
	ScanPage(ScanNamespace)
	ScanVolume(ScanNamespace, 7, 4096)
	ScanVolume(ScanNode, 2, 512)
	for _, result := range []ScanOutcome{ScanOK, ScanOK, ScanDenied, ScanBudget, ScanCanceled, ScanTimeout, ScanFailed} {
		ScanFinished(result)
	}
	for _, reason := range []ScanAbandon{AbandonCaller, AbandonCaller, AbandonDeadline, AbandonRetired} {
		ScanAbandoned(reason)
	}

	want := []string{
		"api_calls|operation=namespace +2",
		"api_calls|operation=node +1",
		"bytes|operation=namespace +4096",
		"bytes|operation=node +512",
		"cancellations|reason=caller +2",
		"cancellations|reason=deadline +1",
		"cancellations|reason=retired +1",
		"objects|operation=namespace +7",
		"objects|operation=node +2",
		"pages|operation=namespace +1",
		"scans|outcome=budget +1",
		"scans|outcome=canceled +1",
		"scans|outcome=denied +1",
		"scans|outcome=failed +1",
		"scans|outcome=ok +2",
		"scans|outcome=timeout +1",
	}
	if got := nativeScanChanges(before, nativeScanSnapshot(t)); !reflect.DeepEqual(got, want) {
		t.Fatalf("recorded changes = %v, want %v", got, want)
	}
}

// Values come from plugin code, not from clusters, but a cast or a future
// caller must still never put a namespace, Pod, token or error into a label.
func TestNativeScanRecordersRejectValuesOutsideTheClosedVocabulary(t *testing.T) {
	DeclareNativeScan()
	before := nativeScanSnapshot(t)

	ScanRequest("secret-ns")
	ScanPage("pods/secret-pod")
	ScanVolume("", 5, 5)
	ScanVolume("kube-system", 5, 5)
	ScanAbandoned("context canceled: secret-token")
	// Non-positive volume is dropped rather than wrapped into a huge uint64.
	ScanVolume(ScanNamespace, -1, -1)
	ScanVolume(ScanNamespace, 0, 0)
	if got := nativeScanChanges(before, nativeScanSnapshot(t)); len(got) != 0 {
		t.Fatalf("out-of-vocabulary input changed counters: %v", got)
	}

	ScanFinished(`forbidden: pods "secret-pod" is forbidden for token secret-token`)
	want := []string{"scans|outcome=failed +1"}
	if got := nativeScanChanges(before, nativeScanSnapshot(t)); !reflect.DeepEqual(got, want) {
		t.Fatalf("unknown outcome must count as failed only: got %v", got)
	}

	allowed := map[string]bool{}
	for _, op := range scanOperations {
		allowed[string(op)] = true
	}
	for _, result := range scanOutcomeSet {
		allowed[string(result)] = true
	}
	for _, reason := range scanAbandonSet {
		allowed[string(reason)] = true
	}
	metrics, truncated := sdkdiag.Default().Snapshot()
	if truncated {
		t.Error("instruments dropped observations")
	}
	for _, metric := range metrics {
		if !strings.HasPrefix(metric.GetName(), nativeScanPrefix) {
			continue
		}
		for _, point := range metric.GetPoints() {
			if len(point.GetAttrs()) != 1 {
				t.Errorf("%s point carries %d attributes, want 1", metric.GetName(), len(point.GetAttrs()))
			}
			for _, a := range point.GetAttrs() {
				if !allowed[a.GetValue()] {
					t.Errorf("%s carries %q outside the closed vocabulary", metric.GetName(), a.GetValue())
				}
			}
		}
	}
}
