package metric

import (
	"context"
	"errors"
	"runtime/pprof"
	"strings"
	"testing"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

func goroutineProfile(t *testing.T) string {
	t.Helper()
	var out strings.Builder
	if err := pprof.Lookup("goroutine").WriteTo(&out, 1); err != nil {
		t.Fatal(err)
	}
	return out.String()
}

func TestLabelMetricsScanTagsPhaseAndConnection(t *testing.T) {
	t.Cleanup(func() { diag.SetProfileLabels(false) })
	sentinel := errors.New("scan failed")
	want := &sdkmetric.ResourceMetricsResponse{}
	var profile string
	wrapped := labelMetricsScan(func(*types.PluginContext, sdkmetric.ResourceMetricsQuery) (*sdkmetric.ResourceMetricsResponse, error) {
		profile = goroutineProfile(t)
		return want, sentinel
	})
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "ctx-a"}}

	diag.SetProfileLabels(false)
	if got, err := wrapped(pc, sdkmetric.ResourceMetricsQuery{}); got != want || err != sentinel || strings.Contains(profile, `"phase"`) {
		t.Fatalf("disabled: got=%v err=%v labeled=%v", got, err, strings.Contains(profile, `"phase"`))
	}
	diag.SetProfileLabels(true)
	if got, err := wrapped(pc, sdkmetric.ResourceMetricsQuery{}); got != want || err != sentinel {
		t.Fatalf("enabled: got=%v err=%v", got, err)
	}
	if !strings.Contains(profile, `{"connection":"ctx-a", "phase":"metrics_scan"}`) {
		t.Fatalf("scan not labeled:\n%s", profile)
	}
	// A request without a plugin context is passed through for the callee to reject.
	profile = ""
	if got, err := wrapped(nil, sdkmetric.ResourceMetricsQuery{}); got != want || err != sentinel || profile == "" {
		t.Fatalf("nil context: got=%v err=%v", got, err)
	}
}
