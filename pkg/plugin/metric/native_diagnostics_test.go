package metric

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	sdkdiag "github.com/omniviewdev/plugin-sdk/pkg/diagnostics"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	lifecyclepb "github.com/omniviewdev/plugin-sdk/proto/v1/lifecycle"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

const scanMetricPrefix = "omniview.plugin.self.native_scan."

// scanSeries reads every native scan counter series the plugin would report to
// the host, keyed "metric|key=value" without the metric prefix. The registry is
// process-wide, so tests compare snapshots instead of absolute values.
func scanSeries(t *testing.T) map[string]float64 {
	t.Helper()
	metrics, truncated := sdkdiag.Default().Snapshot()
	if truncated {
		t.Fatal("diagnostics dropped an observation")
	}
	series := map[string]float64{}
	for _, metric := range metrics {
		name, ok := strings.CutPrefix(metric.GetName(), scanMetricPrefix)
		if !ok {
			continue
		}
		for _, point := range metric.GetPoints() {
			attrs := make([]string, 0, len(point.GetAttrs()))
			for _, a := range point.GetAttrs() {
				attrs = append(attrs, strings.ToLower(strings.TrimPrefix(a.GetKey().String(), "DIAG_KEY_"))+"="+a.GetValue())
			}
			sort.Strings(attrs)
			series[name+"|"+strings.Join(attrs, ",")] = point.GetValue()
		}
	}
	return series
}

// scanChanges lists every series that moved since before as sorted
// "series +increase" lines. A counter that moves backwards would make every
// capture across it incomparable, so it fails the test outright.
func scanChanges(t *testing.T, before map[string]float64) []string {
	t.Helper()
	changes := []string{}
	for key, value := range scanSeries(t) {
		switch {
		case value < before[key]:
			t.Fatalf("counter %s went backwards: %v -> %v", key, before[key], value)
		case value > before[key]:
			changes = append(changes, key+" +"+strconv.FormatFloat(value-before[key], 'f', -1, 64))
		}
	}
	sort.Strings(changes)
	return changes
}

func nativeTestRESTClient(t *testing.T, transport nativeTestTransport) rest.Interface {
	t.Helper()
	clientset, err := kubernetes.NewForConfigAndClient(&rest.Config{Host: "https://owned.invalid"}, &http.Client{Transport: transport})
	if err != nil {
		t.Fatal(err)
	}
	return clientset.CoreV1().RESTClient()
}

func nativeSinglePodQuery(pc *types.PluginContext, namespace, name string) sdkmetric.ResourceMetricsQuery {
	return sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeCPU}, Targets: []sdkmetric.ResourceMetricTarget{nativeTestTarget("row", namespace, name)}}
}

func TestNativeProviderReportsEveryScanSeriesFromStartup(t *testing.T) {
	nativeTestProvider(t, func(*http.Request) (*http.Response, error) {
		t.Error("constructing a provider must not scan")
		return nil, errors.New("unexpected request")
	})
	series := scanSeries(t)
	for _, key := range []string{
		"api_calls|operation=namespace", "api_calls|operation=node",
		"pages|operation=namespace", "pages|operation=node",
		"objects|operation=namespace", "objects|operation=node",
		"bytes|operation=namespace", "bytes|operation=node",
		"scans|outcome=ok", "scans|outcome=denied", "scans|outcome=budget",
		"scans|outcome=canceled", "scans|outcome=timeout", "scans|outcome=failed",
		"cancellations|reason=caller", "cancellations|reason=deadline", "cancellations|reason=retired",
	} {
		if _, ok := series[key]; !ok {
			t.Errorf("series %q is absent until its first event, so a capture straddling that event is incomplete", key)
		}
	}
}

func TestNativeScanDiagnosticsCountPagesObjectsBytesAndOutcome(t *testing.T) {
	other := strings.ReplaceAll(nativeSample, `"name":"same"`, `"name":"other"`)
	last := strings.ReplaceAll(nativeSample, `"name":"same"`, `"name":"last"`)
	first := `{"apiVersion":"metrics.k8s.io/v1beta1","kind":"PodMetricsList","metadata":{"continue":"opaque-continuation"},"items":[` + nativeSample + "," + other + `]}`
	second := nativePage(last)
	requests := 0
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		requests++
		if requests == 1 {
			return nativeTestResponse(request, first), nil
		}
		return nativeTestResponse(request, second), nil
	})
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	query := nativeSinglePodQuery(pc, "one", "same")
	query.Targets = append(query.Targets, nativeTestTarget("second", "one", "other"), nativeTestTarget("third", "one", "last"))
	before := scanSeries(t)

	response, err := provider.query(pc, query)
	if err != nil || !response.Complete || requests != 2 {
		t.Fatalf("paged scan did not complete: requests=%d response=%+v err=%v", requests, response, err)
	}
	want := []string{
		"api_calls|operation=namespace +2",
		"bytes|operation=namespace +" + strconv.Itoa(len(first)+len(second)),
		"objects|operation=namespace +3",
		"pages|operation=namespace +2",
		"scans|outcome=ok +1",
	}
	if got := scanChanges(t, before); !reflect.DeepEqual(got, want) {
		t.Fatalf("scan cost = %v, want %v", got, want)
	}
}

func TestNativeNodeScanDiagnosticsUseTheNodeOperation(t *testing.T) {
	body := `{"apiVersion":"metrics.k8s.io/v1beta1","kind":"NodeMetricsList","items":[{"metadata":{"name":"node-a"},"timestamp":"2026-11-05T10:00:00Z","window":"20s","usage":{"cpu":"250m","memory":"2Mi"}},{"metadata":{"name":"unrequested"},"timestamp":"2026-11-05T10:00:00Z","window":"20s","usage":{"cpu":"1","memory":"1Mi"}}]}`
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		return nativeTestResponse(request, body), nil
	})
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	target := nativeTestTarget("node", "", "node-a")
	target.Reference.Address.Type = "k8s:/nodes"
	target.Reference.Address.Scope = nil
	before := scanSeries(t)

	response, err := provider.query(pc, sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeNodeCPU}, Targets: []sdkmetric.ResourceMetricTarget{target}})
	if err != nil || !response.Complete {
		t.Fatalf("node scan failed: response=%+v err=%v", response, err)
	}
	want := []string{
		"api_calls|operation=node +1",
		"bytes|operation=node +" + strconv.Itoa(len(body)),
		"objects|operation=node +2",
		"pages|operation=node +1",
		"scans|outcome=ok +1",
	}
	if got := scanChanges(t, before); !reflect.DeepEqual(got, want) {
		t.Fatalf("node scan cost = %v, want %v", got, want)
	}
}

func TestNativeScanDiagnosticsCountDeniedScan(t *testing.T) {
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusForbidden,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"kind":"Status","apiVersion":"v1","status":"Failure","message":"pods.metrics.k8s.io is forbidden: user secret-user cannot list in namespace secret-ns","reason":"Forbidden","code":403}`)),
			Request:    request,
		}, nil
	})
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	before := scanSeries(t)

	response, err := provider.query(pc, nativeSinglePodQuery(pc, "one", "same"))
	if err != nil || response.Complete || response.Results[0].Status != "denied" {
		t.Fatalf("denied scan was not reported as denied: response=%+v err=%v", response, err)
	}
	// An error body is not a page: it costs a request but no page, object or byte.
	want := []string{"api_calls|operation=namespace +1", "scans|outcome=denied +1"}
	if got := scanChanges(t, before); !reflect.DeepEqual(got, want) {
		t.Fatalf("denied scan cost = %v, want %v", got, want)
	}
}

func TestNativeScanDiagnosticsCountBudgetStops(t *testing.T) {
	two := nativePage(nativeSample + "," + strings.ReplaceAll(nativeSample, `"name":"same"`, `"name":"other"`))
	client := nativeTestRESTClient(t, func(request *http.Request) (*http.Response, error) {
		return nativeTestResponse(request, two), nil
	})
	for _, test := range []struct {
		name   string
		budget nativeScanBudget
		// consumed reports what the scan took from its budget; the counters must agree.
		consumed func(t *testing.T, start, end nativeScanBudget) []string
	}{
		{
			name:   "bytes",
			budget: nativeScanBudget{bytes: 64, objects: 100, pages: 8},
			consumed: func(t *testing.T, start, end nativeScanBudget) []string {
				if start.bytes-end.bytes != 64 || start.objects != end.objects {
					t.Fatalf("byte budget stop consumed bytes=%d objects=%d", start.bytes-end.bytes, start.objects-end.objects)
				}
				return []string{"api_calls|operation=namespace +1", "bytes|operation=namespace +64", "scans|outcome=budget +1"}
			},
		},
		{
			name:   "objects",
			budget: nativeScanBudget{bytes: 1 << 20, objects: 1, pages: 8},
			consumed: func(t *testing.T, start, end nativeScanBudget) []string {
				if start.objects-end.objects != 1 || start.bytes == end.bytes {
					t.Fatalf("object budget stop consumed bytes=%d objects=%d", start.bytes-end.bytes, start.objects-end.objects)
				}
				return []string{"api_calls|operation=namespace +1", "bytes|operation=namespace +" + strconv.FormatInt(start.bytes-end.bytes, 10), "objects|operation=namespace +1", "scans|outcome=budget +1"}
			},
		},
		{
			// No request is issued, but the scan still ended and says why.
			name:   "pages",
			budget: nativeScanBudget{bytes: 1 << 20, objects: 100},
			consumed: func(t *testing.T, start, end nativeScanBudget) []string {
				if start != end {
					t.Fatalf("exhausted page budget still consumed work: %+v -> %+v", start, end)
				}
				return []string{"scans|outcome=budget +1"}
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			budget := test.budget
			before := scanSeries(t)
			err := scanNativeNamespace(context.Background(), restFetch(client), "one", "", &budget, func(*metricsv1beta1.PodMetrics) { t.Error("an exhausted scan committed a page") })
			if !errors.Is(err, errNativeBudget) {
				t.Fatalf("scan was not stopped by its budget: %v", err)
			}
			want := test.consumed(t, test.budget, budget)
			if got := scanChanges(t, before); !reflect.DeepEqual(got, want) {
				t.Fatalf("budget stop cost = %v, want %v", got, want)
			}
		})
	}
}

func TestNativeScanDiagnosticsCountFailedScans(t *testing.T) {
	for _, test := range []struct {
		name      string
		transport nativeTestTransport
		readBody  bool
	}{
		{
			name: "transport",
			transport: func(*http.Request) (*http.Response, error) {
				return nil, errors.New("dial tcp secret-host:6443: connection refused")
			},
		},
		{
			name: "envelope",
			transport: func(request *http.Request) (*http.Response, error) {
				return nativeTestResponse(request, `{"apiVersion":"v1","kind":"PodList","items":[]}`), nil
			},
			readBody: true,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := nativeTestRESTClient(t, test.transport)
			budget := nativeScanBudget{bytes: 1 << 20, objects: 100, pages: 8}
			before := scanSeries(t)
			err := scanNativeNamespace(context.Background(), restFetch(client), "one", "", &budget, func(*metricsv1beta1.PodMetrics) { t.Error("an invalid page committed a sample") })
			if err == nil || errors.Is(err, errNativeBudget) {
				t.Fatalf("scan failure was lost or mistaken for budget exhaustion: %v", err)
			}
			want := []string{"api_calls|operation=namespace +1"}
			if test.readBody {
				want = append(want, "bytes|operation=namespace +"+strconv.FormatInt(1<<20-budget.bytes, 10))
			}
			want = append(want, "scans|outcome=failed +1")
			if got := scanChanges(t, before); !reflect.DeepEqual(got, want) {
				t.Fatalf("failed scan cost = %v, want %v", got, want)
			}
		})
	}
}

func TestNativeScanDiagnosticsSayWhyAQueryWasAbandoned(t *testing.T) {
	// run starts a query whose only request blocks, lets interrupt end it, and
	// returns how the counters moved.
	run := func(t *testing.T, ctx context.Context, interrupt func(*nativeProvider)) []string {
		t.Helper()
		started := make(chan struct{})
		var once sync.Once
		provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
			once.Do(func() { close(started) })
			<-request.Context().Done()
			return nil, request.Context().Err()
		})
		pc := &types.PluginContext{Context: ctx, Connection: &types.Connection{ID: "selected"}}
		before := scanSeries(t)
		finished := make(chan error, 1)
		go func() {
			_, err := provider.query(pc, nativeSinglePodQuery(pc, "one", "same"))
			finished <- err
		}()
		select {
		case <-started:
		case <-time.After(2 * time.Second):
			t.Fatal("query did not reach its request")
		}
		interrupt(provider)
		select {
		case err := <-finished:
			if err == nil {
				t.Fatal("an abandoned query published a response")
			}
		case <-time.After(5 * time.Second):
			t.Fatal("query did not stop")
		}
		return scanChanges(t, before)
	}

	t.Run("caller", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		want := []string{"api_calls|operation=namespace +1", "cancellations|reason=caller +1", "scans|outcome=canceled +1"}
		if got := run(t, ctx, func(*nativeProvider) { cancel() }); !reflect.DeepEqual(got, want) {
			t.Fatalf("caller cancellation = %v, want %v", got, want)
		}
	})
	t.Run("deadline", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
		defer cancel()
		want := []string{"api_calls|operation=namespace +1", "cancellations|reason=deadline +1", "scans|outcome=timeout +1"}
		if got := run(t, ctx, func(*nativeProvider) {}); !reflect.DeepEqual(got, want) {
			t.Fatalf("deadline = %v, want %v", got, want)
		}
	})
	t.Run("retired", func(t *testing.T) {
		want := []string{"api_calls|operation=namespace +1", "cancellations|reason=retired +1", "scans|outcome=canceled +1"}
		if got := run(t, context.Background(), func(provider *nativeProvider) { provider.retireConnection("selected") }); !reflect.DeepEqual(got, want) {
			t.Fatalf("source retirement = %v, want %v", got, want)
		}
	})
}

func TestNativeScanDiagnosticsDoNotCountUnscannedQueries(t *testing.T) {
	provider := nativeTestProvider(t, func(*http.Request) (*http.Response, error) {
		t.Error("an unsupported shape must not reach the cluster")
		return nil, errors.New("unexpected request")
	})
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	query := nativeSinglePodQuery(pc, "one", "same")
	query.Shape, query.StartTime, query.EndTime, query.Step = "range", time.Unix(100, 0), time.Unix(200, 0), time.Second
	before := scanSeries(t)

	if _, err := provider.query(pc, query); err != nil {
		t.Fatal(err)
	}
	// A request rejected before a lane exists is not an abandoned query either.
	if _, err := provider.query(&types.PluginContext{Context: context.Background()}, query); err == nil {
		t.Fatal("query without a connection was admitted")
	}
	if got := scanChanges(t, before); len(got) != 0 {
		t.Fatalf("queries that never scanned moved counters: %v", got)
	}
}

// Cluster identity is the data this feature must never carry: namespaces, Pod
// names, continuation tokens and the text of errors that mention them.
func TestNativeScanDiagnosticsNeverCarryClusterIdentity(t *testing.T) {
	secretPod := strings.NewReplacer(`"name":"same"`, `"name":"secret-pod"`, `"namespace":"one"`, `"namespace":"secret-ns"`).Replace(nativeSample)
	page := `{"apiVersion":"metrics.k8s.io/v1beta1","kind":"PodMetricsList","metadata":{"continue":"secret-continuation"},"items":[` + secretPod + `]}`
	requests := 0
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		requests++
		if requests == 1 {
			return nativeTestResponse(request, page), nil
		}
		return nil, errors.New("Get https://secret-host:6443/apis/metrics.k8s.io/v1beta1/namespaces/secret-ns/pods: secret-token rejected")
	})
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	if _, err := provider.query(pc, nativeSinglePodQuery(pc, "secret-ns", "secret-pod")); err != nil {
		t.Fatal(err)
	}

	allowed := map[string]bool{}
	for _, value := range []string{
		string(diag.ScanNamespace), string(diag.ScanNode),
		string(diag.ScanOK), string(diag.ScanDenied), string(diag.ScanBudget), string(diag.ScanCanceled), string(diag.ScanTimeout), string(diag.ScanFailed),
		string(diag.AbandonCaller), string(diag.AbandonDeadline), string(diag.AbandonRetired),
	} {
		allowed[value] = true
	}
	metrics, truncated := sdkdiag.Default().Snapshot()
	if truncated {
		t.Error("instruments dropped observations")
	}
	if len(metrics) > sdkdiag.MaxMetrics {
		t.Errorf("%d metrics exceed the plugin cap of %d", len(metrics), sdkdiag.MaxMetrics)
	}
	checked := 0
	for _, metric := range metrics {
		if !strings.HasPrefix(metric.GetName(), scanMetricPrefix) {
			continue
		}
		if len(metric.GetPoints()) > sdkdiag.MaxPoints {
			t.Errorf("%s has %d series, cap is %d", metric.GetName(), len(metric.GetPoints()), sdkdiag.MaxPoints)
		}
		for _, point := range metric.GetPoints() {
			for _, a := range point.GetAttrs() {
				checked++
				if !allowed[a.GetValue()] {
					t.Errorf("%s carries %q outside the closed vocabulary", metric.GetName(), a.GetValue())
				}
			}
		}
		if text := fmt.Sprint(metric); strings.Contains(text, "secret") {
			t.Errorf("%s leaked request detail: %s", metric.GetName(), text)
		}
	}
	if checked == 0 {
		t.Fatal("no native scan series were inspected")
	}
	// The counters are the only thing that leaves the plugin; pin the wire kind.
	for _, metric := range metrics {
		if strings.HasPrefix(metric.GetName(), scanMetricPrefix) && metric.GetKind() != lifecyclepb.DiagKind_DIAG_KIND_COUNTER {
			t.Errorf("%s is %s, want a cumulative counter", metric.GetName(), metric.GetKind())
		}
	}
}
