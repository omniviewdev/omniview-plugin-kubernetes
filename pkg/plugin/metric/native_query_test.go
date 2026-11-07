package metric

import (
	"context"
	"io"
	"math"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

type nativeTestTransport func(*http.Request) (*http.Response, error)

func (f nativeTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func nativeTestProvider(t *testing.T, transport nativeTestTransport) *nativeProvider {
	t.Helper()
	provider := newNativeProvider()
	t.Cleanup(provider.cache.Stop)
	clientset, err := kubernetes.NewForConfigAndClient(&rest.Config{Host: "https://owned.invalid"}, &http.Client{Transport: transport})
	if err != nil {
		t.Fatal(err)
	}
	provider.cache.factory = func(ctx context.Context, _ *types.Connection) (*kubeauth.KubeClientBundle, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return &kubeauth.KubeClientBundle{Clientset: clientset}, nil
	}
	return provider
}

func nativeTestTarget(token, namespace, name string) sdkmetric.ResourceMetricTarget {
	return sdkmetric.ResourceMetricTarget{Token: token, Route: resourcev2.AccessRoute{Connection: "selected"}, Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "admitted", Type: "k8s:/pods", ID: name, Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: namespace}}}}}
}

func nativeTestResponse(request *http.Request, body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: request}
}

func TestNativeQueryGroupsNamespacesAndMatchesExactTargets(t *testing.T) {
	calls := map[string]int{}
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		calls[request.URL.Path]++
		if request.Method != "GET" || !strings.HasSuffix(request.URL.Path, "/pods") {
			t.Fatalf("per-object fallback request: %s %s", request.Method, request.URL.Path)
		}
		item := nativeSample
		if strings.Contains(request.URL.Path, "/two/") {
			item = strings.ReplaceAll(strings.ReplaceAll(item, `"namespace":"one"`, `"namespace":"two"`), `"250m"`, `"500m"`)
		}
		extra := strings.ReplaceAll(item, `"name":"same"`, `"name":"unrequested"`)
		// Real metrics-server can ignore limit and return arbitrary order/extras.
		return nativeTestResponse(request, nativePage(extra+","+item)), nil
	})
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	query := sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeMemory, nativeCPU}, Targets: []sdkmetric.ResourceMetricTarget{
		nativeTestTarget("second-namespace", "two", "same"), nativeTestTarget("first-namespace", "one", "same"), nativeTestTarget("not-measured", "one", "absent"),
	}}
	response, err := provider.query(pc, query)
	if err != nil {
		t.Fatal(err)
	}
	if !response.Complete || len(response.Results) != 6 || len(calls) != 2 {
		t.Fatalf("namespace work or pair coverage wrong: calls=%v response=%+v", calls, response)
	}
	for _, count := range calls {
		if count != 1 {
			t.Fatalf("namespace LIST repeated: %v", calls)
		}
	}
	for _, result := range response.Results {
		if result.ResourceToken == "not-measured" {
			if result.Status != "missing" || result.Value != nil {
				t.Fatalf("unseen completed target not missing: %+v", result)
			}
			continue
		}
		if result.Status != "ok" || result.Value == nil {
			t.Fatalf("target result missing: %+v", result)
		}
		if result.MetricID == nativeCPU {
			expected := 0.250123456
			if result.ResourceToken == "second-namespace" {
				expected = 0.500123456
			}
			if math.Abs(*result.Value-expected) > 1e-12 {
				t.Fatalf("namespace/target join crossed identities: %+v", result)
			}
		}
	}
}

func TestNativeRetirementCancelsInFlightSourceAndFencesPublication(t *testing.T) {
	started := make(chan struct{})
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		close(started)
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	query := sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeCPU}, Targets: []sdkmetric.ResourceMetricTarget{nativeTestTarget("row", "one", "same")}}
	finished := make(chan error, 1)
	go func() { _, err := provider.query(pc, query); finished <- err }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("native query did not enter request")
	}
	provider.retireConnection("selected")
	select {
	case err := <-finished:
		if err == nil {
			t.Fatal("retired source published a response")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("retirement did not cancel source request")
	}
	if provider.cache.Len() != 0 {
		t.Fatal("retired source kept its clients")
	}
}

func TestNativeNodeListPreservesTimeUnitsAndUID(t *testing.T) {
	calls := 0
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		calls++
		if request.Method != "GET" || request.URL.Path != "/apis/metrics.k8s.io/v1beta1/nodes" {
			t.Fatalf("unexpected Node request: %s %s", request.Method, request.URL.Path)
		}
		return nativeTestResponse(request, `{"apiVersion":"metrics.k8s.io/v1beta1","kind":"NodeMetricsList","items":[{"metadata":{"name":"node-a","uid":"uid-a"},"timestamp":"2026-11-05T10:00:00Z","window":"20s","usage":{"cpu":"250123456n","memory":"2Mi"}},{"metadata":{"name":"unrequested"},"timestamp":"2026-11-05T10:00:00Z","window":"20s","usage":{"cpu":"999","memory":"999"}}]}`), nil
	})
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	node := func(token, name, uid string) sdkmetric.ResourceMetricTarget {
		return sdkmetric.ResourceMetricTarget{Token: token, Route: resourcev2.AccessRoute{Connection: "selected"}, Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "admitted", Type: "k8s:/nodes", ID: name}, Incarnation: &uid}}
	}
	query := sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeNodeCPU, nativeNodeMemory}, Targets: []sdkmetric.ResourceMetricTarget{node("measured", "node-a", "uid-a"), node("absent", "node-b", "uid-b")}}
	catalog, err := provider.catalog(pc, sdkmetric.ResourceMetricsCatalogRequest{Source: nativeSource(pc), ResourceKey: "k8s:/nodes"})
	if err != nil || len(catalog.Metrics) != 2 {
		t.Fatalf("catalog=%+v err=%v", catalog, err)
	}
	response, err := provider.query(pc, query)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 || !response.Complete || len(response.Results) != 4 {
		t.Fatalf("calls=%d response=%+v", calls, response)
	}
	for _, result := range response.Results {
		if result.ResourceToken == "absent" {
			if result.Status != "missing" || result.Value != nil {
				t.Fatalf("%+v", result)
			}
			continue
		}
		if result.Status != "ok" || result.Value == nil || result.IdentityScope != "incarnation" || result.ObservedAt == nil || !result.ObservedAt.Equal(time.Date(2026, time.November, 5, 10, 0, 0, 0, time.UTC)) || result.Window != 20*time.Second || result.Dimensions["node"] != "node-a" {
			t.Fatalf("%+v", result)
		}
		expected := float64(2 * 1024 * 1024)
		if result.MetricID == nativeNodeCPU {
			expected = 0.250123456
		}
		if math.Abs(*result.Value-expected) > 1e-12 {
			t.Fatalf("wrong physical units: %+v", result)
		}
	}
	query.Targets = query.Targets[:1]
	wrong := "recreated"
	query.Targets[0].Reference.Incarnation = &wrong
	response, err = provider.query(pc, query)
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range response.Results {
		if result.Status != "invalid_context" || result.Value != nil {
			t.Fatalf("wrong UID joined: %+v", result)
		}
	}
}

func TestNativeNodeDuplicateAndMissingMeasurement(t *testing.T) {
	for _, test := range []struct{ name, items, status string }{
		{"duplicate", `{"metadata":{"name":"node-a"}},{"metadata":{"name":"node-a"}}`, "ambiguous"},
		{"missing-time", `{"metadata":{"name":"node-a"},"usage":{"cpu":"1","memory":"2Mi"}}`, "missing"},
		{"missing-cpu", `{"metadata":{"name":"node-a"},"timestamp":"2026-11-05T10:00:00Z","window":"20s","usage":{"memory":"2Mi"}}`, "missing"},
		{"null-cpu", `{"metadata":{"name":"node-a"},"timestamp":"2026-11-05T10:00:00Z","window":"20s","usage":{"cpu":null,"memory":"2Mi"}}`, "failed"},
	} {
		t.Run(test.name, func(t *testing.T) {
			provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
				return nativeTestResponse(request, `{"apiVersion":"metrics.k8s.io/v1beta1","kind":"NodeMetricsList","items":[`+test.items+`]}`), nil
			})
			pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
			target := nativeTestTarget("node", "", "node-a")
			target.Reference.Address.Type = "k8s:/nodes"
			target.Reference.Address.Scope = nil
			response, err := provider.query(pc, sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeNodeCPU}, Targets: []sdkmetric.ResourceMetricTarget{target}})
			if err != nil {
				t.Fatal(err)
			}
			if result := response.Results[0]; result.Status != test.status || result.Value != nil || result.ObservedAt != nil {
				t.Fatalf("%+v", result)
			}
		})
	}
}

func TestNativeQueryFollowsContinuationBeforeDeclaringMissing(t *testing.T) {
	calls := 0
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		calls++
		if request.URL.Path != "/apis/metrics.k8s.io/v1beta1/namespaces/one/pods" || request.URL.Query().Get("limit") != "1000" {
			t.Fatalf("wrong list request: %s", request.URL)
		}
		switch calls {
		case 1:
			if request.URL.Query().Get("continue") != "" {
				t.Fatalf("first page carried continuation: %s", request.URL)
			}
			return nativeTestResponse(request, `{"apiVersion":"metrics.k8s.io/v1beta1","kind":"PodMetricsList","metadata":{"continue":"next+/="},"items":[]}`), nil
		case 2:
			if request.URL.Query().Get("continue") != "next+/=" {
				t.Fatalf("continuation token changed: %s", request.URL)
			}
			return nativeTestResponse(request, nativePage(nativeSample)), nil
		default:
			t.Fatalf("unexpected extra page: %s", request.URL)
			return nil, nil
		}
	})
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	response, err := provider.query(pc, sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeCPU}, Targets: []sdkmetric.ResourceMetricTarget{nativeTestTarget("row", "one", "same"), nativeTestTarget("absent", "one", "absent")}})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || !response.Complete || response.Results[0].Status != "ok" || response.Results[0].Value == nil || response.Results[1].Status != "missing" {
		t.Fatalf("continuation lost target or completeness: calls=%d response=%+v", calls, response)
	}
}

func TestNativeAdmittedNamespacesReturnBoundedPartialResults(t *testing.T) {
	calls := 0
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		calls++
		return nativeTestResponse(request, nativePage("")), nil
	})
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	targets := make([]sdkmetric.ResourceMetricTarget, 65)
	for index := range targets {
		namespace := "ns-" + strings.Repeat("a", index/26+1) + string(rune('a'+index%26))
		targets[index] = nativeTestTarget(namespace, namespace, "same")
	}
	response, err := provider.query(pc, sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeCPU}, Targets: targets})
	if err != nil {
		t.Fatal(err)
	}
	if response.Complete || len(response.Results) != len(targets) || calls != nativeMaxPages {
		t.Fatalf("admitted batch rejected or escaped page budget: calls=%d response=%+v", calls, response)
	}
	missing, failed := 0, 0
	for _, result := range response.Results {
		switch result.Status {
		case "missing":
			missing++
		case "failed":
			failed++
		default:
			t.Fatalf("unexpected result: %+v", result)
		}
	}
	if missing != nativeMaxPages || failed != 1 {
		t.Fatalf("partial namespace coverage lost: missing=%d failed=%d", missing, failed)
	}
}

func TestNativeQueryRefreshReachesPreviouslyBudgetStarvedNamespace(t *testing.T) {
	calls := 0
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		calls++
		namespace := strings.TrimSuffix(strings.TrimPrefix(request.URL.Path, "/apis/metrics.k8s.io/v1beta1/namespaces/"), "/pods")
		sample := strings.ReplaceAll(nativeSample, `"namespace":"one"`, `"namespace":"`+namespace+`"`)
		return nativeTestResponse(request, nativePage(sample)), nil
	})
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	targets := make([]sdkmetric.ResourceMetricTarget, nativeMaxPages+1)
	for index := range targets {
		namespace := "ns-" + strings.Repeat("a", index/26+1) + string(rune('a'+index%26))
		targets[index] = nativeTestTarget(namespace, namespace, "same")
	}
	query := sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeCPU}, Targets: targets}
	first, err := provider.query(pc, query)
	if err != nil {
		t.Fatal(err)
	}
	starved := ""
	available := 0
	for _, result := range first.Results {
		switch result.Status {
		case "ok":
			available++
		case "failed":
			starved = result.ResourceToken
		default:
			t.Fatalf("unexpected initial sample: %+v", result)
		}
	}
	if first.Complete || available != nativeMaxPages || starved == "" || calls != nativeMaxPages {
		t.Fatalf("unexpected initial budget coverage: calls=%d response=%+v", calls, first)
	}
	second, err := provider.query(pc, query)
	if err != nil {
		t.Fatal(err)
	}
	if second.Complete || calls != 2*nativeMaxPages {
		t.Fatalf("refresh escaped shared budget: calls=%d response=%+v", calls, second)
	}
	for _, result := range second.Results {
		if result.ResourceToken == starved {
			if result.Status != "ok" || result.Value == nil || math.Abs(*result.Value-0.250123456) > 1e-12 {
				t.Fatalf("refresh starved the same namespace: %+v", result)
			}
			return
		}
	}
	t.Fatalf("refresh lost previously starved target %q", starved)
}
