package metric

import (
	"context"
	"errors"
	"fmt"
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
	"k8s.io/apimachinery/pkg/fields"
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
	// Client-side throttling would make tests that issue hundreds of requests wait on the wall clock.
	clientset, err := kubernetes.NewForConfigAndClient(&rest.Config{Host: "https://owned.invalid", QPS: -1}, &http.Client{Transport: transport})
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

func TestNativeNameSelectionReducesScanWithoutSplittingBatches(t *testing.T) {
	for _, test := range []struct {
		name    string
		targets []string
		scanned float64
	}{
		{name: "singleton", targets: []string{"same"}, scanned: 1},
		{name: "batch", targets: []string{"same", "peer"}, scanned: 3},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
				calls++
				selector, err := fields.ParseSelector(request.URL.Query().Get("fieldSelector"))
				if err != nil {
					t.Fatal(err)
				}
				var items []string
				for _, name := range []string{"unrequested", "same", "peer"} {
					if selector.Matches(fields.Set{"metadata.name": name}) {
						items = append(items, strings.ReplaceAll(nativeSample, `"name":"same"`, `"name":"`+name+`"`))
					}
				}
				return nativeTestResponse(request, nativePage(strings.Join(items, ","))), nil
			})
			pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
			query := sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeCPU, nativeMemory}}
			for _, name := range test.targets {
				query.Targets = append(query.Targets, nativeTestTarget(name, "one", name))
			}
			before := scanSeries(t)
			response, err := provider.query(pc, query)
			if err != nil {
				t.Fatal(err)
			}
			if !response.Complete || len(response.Results) != 2*len(test.targets) || calls != 1 {
				t.Fatalf("namespace batch changed: calls=%d response=%+v", calls, response)
			}
			for _, result := range response.Results {
				if result.Status != "ok" || result.Value == nil {
					t.Fatalf("requested measurement lost by name selection: %+v", result)
				}
			}
			if got := scanSeries(t)["objects|operation=namespace"] - before["objects|operation=namespace"]; got != test.scanned {
				t.Fatalf("decoded %v objects, want %v", got, test.scanned)
			}
		})
	}
}

func TestNativeNameSelectionSurvivesContinuationUnderNameScopedAccess(t *testing.T) {
	calls := 0
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		calls++
		// Name-scoped LIST access requires the same predicate on every page.
		if request.URL.Query().Get("fieldSelector") != "metadata.name=same" {
			response := nativeTestResponse(request, `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","code":403}`)
			response.StatusCode = http.StatusForbidden
			return response, nil
		}
		if request.URL.Query().Get("continue") == "" {
			page := strings.Replace(nativePage(""), `"metadata":{}`, `"metadata":{"continue":"next"}`, 1)
			return nativeTestResponse(request, page), nil
		}
		return nativeTestResponse(request, nativePage(nativeSample)), nil
	})
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	query := sdkmetric.ResourceMetricsQuery{
		Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeCPU},
		Targets: []sdkmetric.ResourceMetricTarget{nativeTestTarget("row", "one", "same")},
	}
	response, err := provider.query(pc, query)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || !response.Complete || len(response.Results) != 1 || response.Results[0].Status != "ok" || response.Results[0].Value == nil {
		t.Fatalf("filtered continuation lost the admitted sample: calls=%d response=%+v", calls, response)
	}
}

func TestNativeUnavailableEndpointDoesNotRefetchForScrollingTargets(t *testing.T) {
	calls := 0
	available := false
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		calls++
		if available {
			return nativeTestResponse(request, nativePage(nativeSample)), nil
		}
		response := nativeTestResponse(request, `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"NotFound","code":404,"message":"the server could not find the requested resource"}`)
		response.StatusCode = http.StatusNotFound
		return response, nil
	})
	now := time.Now()
	provider.now = func() time.Time { return now }
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	query := sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeCPU}, Targets: []sdkmetric.ResourceMetricTarget{nativeTestTarget("first", "one", "same")}}
	first, err := provider.query(pc, query)
	if err != nil || first.Results[0].Status != "failed" {
		t.Fatalf("absence must settle as failed, not zero or missing: response=%+v err=%v", first, err)
	}
	// New row tokens cannot bypass availability. Cache reads cannot extend expiry.
	now = now.Add(nativePersistentFailureTTL / 2)
	query.Targets[0].Token = "scrolled"
	second, err := provider.query(pc, query)
	if err != nil || calls != 1 || second.Results[0].ResourceToken != "scrolled" || second.Results[0].Status != "failed" {
		t.Fatalf("scroll retried unavailable source: calls=%d response=%+v err=%v", calls, second, err)
	}
	available = true
	now = now.Add(nativePersistentFailureTTL/2 + time.Millisecond)
	recovered, err := provider.query(pc, query)
	if err != nil || calls != 2 || recovered.Results[0].Status != "ok" {
		t.Fatalf("availability did not recover at original expiry: calls=%d response=%+v err=%v", calls, recovered, err)
	}
	available = false
	if _, err := provider.query(pc, query); err != nil {
		t.Fatal(err)
	}
	provider.retireConnection("selected")
	available = true
	reconnected, err := provider.query(pc, query)
	if err != nil || calls != 4 || reconnected.Results[0].Status != "ok" {
		t.Fatalf("reconnect retained old unavailability: calls=%d response=%+v err=%v", calls, reconnected, err)
	}
}

// nativeFailureStatus is the Kubernetes API's own failure response for code.
func nativeFailureStatus(request *http.Request, code int, reason string) *http.Response {
	response := nativeTestResponse(request, fmt.Sprintf(`{"kind":"Status","apiVersion":"v1","status":"Failure","reason":%q,"code":%d}`, reason, code))
	response.StatusCode = code
	return response
}

// Access can be granted to one metadata.name while the namespace as a whole is
// refused, so a denial belongs to the exact selector that was refused.
func TestNativeDenialOfOneSelectorDoesNotSuppressAnotherSelector(t *testing.T) {
	requests := map[string]int{}
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		selector := request.URL.Query().Get("fieldSelector")
		requests[selector]++
		if selector != "metadata.name=granted" {
			return nativeFailureStatus(request, http.StatusForbidden, "Forbidden"), nil
		}
		return nativeTestResponse(request, nativePage(strings.ReplaceAll(nativeSample, `"name":"same"`, `"name":"granted"`))), nil
	})
	now := time.Now()
	provider.now = func() time.Time { return now }
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	scan := func(want string, names ...string) {
		t.Helper()
		query := sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeCPU}}
		for _, name := range names {
			query.Targets = append(query.Targets, nativeTestTarget(name, "one", name))
		}
		response, err := provider.query(pc, query)
		if err != nil {
			t.Fatal(err)
		}
		statuses := make([]string, len(response.Results))
		for index, result := range response.Results {
			statuses[index] = result.Status
		}
		if got := strings.Join(statuses, ","); got != want {
			t.Fatalf("%v: statuses %s, want %s", names, got, want)
		}
	}
	read := func(selector string, want int) {
		t.Helper()
		if requests[selector] != want {
			t.Fatalf("selector %q was read %d times, want %d: %v", selector, requests[selector], want, requests)
		}
	}
	scan("denied", "refused")
	read("metadata.name=refused", 1)
	// The refusal of one Pod's selector cannot answer for an authorized Pod.
	scan("ok", "granted")
	read("metadata.name=granted", 1)
	// The unselected namespace list is its own endpoint; neither singleton answered for it.
	scan("denied,denied", "refused", "granted")
	read("", 1)
	// Successes are never remembered, and the namespace refusal does not reach a selector.
	scan("ok", "granted")
	read("metadata.name=granted", 2)
	// Each refusal still suppresses repeats of exactly that endpoint.
	scan("denied", "refused")
	scan("denied,denied", "refused", "granted")
	read("metadata.name=refused", 1)
	read("", 1)
}

func TestNativeMissingListEndpointSharesCooldownAcrossSelectors(t *testing.T) {
	calls := 0
	available := false
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		calls++
		if !available {
			return nativeFailureStatus(request, http.StatusNotFound, "NotFound"), nil
		}
		name := strings.TrimPrefix(request.URL.Query().Get("fieldSelector"), "metadata.name=")
		return nativeTestResponse(request, nativePage(strings.ReplaceAll(nativeSample, `"name":"same"`, fmt.Sprintf(`"name":%q`, name)))), nil
	})
	now := time.Now()
	provider.now = func() time.Time { return now }
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	scan := func(namespace, name, status string, wantCalls int) {
		t.Helper()
		response, err := provider.query(pc, nativeSinglePodQuery(pc, namespace, name))
		if err != nil {
			t.Fatal(err)
		}
		if response.Results[0].Status != status || calls != wantCalls {
			t.Fatalf("%s/%s: status=%s calls=%d, want status=%s calls=%d", namespace, name, response.Results[0].Status, calls, status, wantCalls)
		}
	}
	scan("one", "first", "failed", 1)
	// Scrolling to another singleton must not probe a missing metrics API again.
	scan("one", "second", "failed", 1)
	// A missing namespace must not suppress a different namespace's endpoint.
	scan("two", "third", "failed", 2)
	available = true
	now = now.Add(nativePersistentFailureTTL)
	scan("one", "second", "ok", 3)
}

// nativeFailingSingletons answers every Pod list with a failure and counts the
// requests each metadata.name selector received. Pods named "flaky..." get a
// server error that can clear by itself; every other Pod is refused until access
// changes. The clock moves only when a test moves it.
type nativeFailingSingletons struct {
	provider *nativeProvider
	pc       *types.PluginContext
	requests map[string]int
	now      time.Time
}

func newNativeFailingSingletons(t *testing.T) *nativeFailingSingletons {
	t.Helper()
	failing := &nativeFailingSingletons{requests: map[string]int{}, now: time.Now()}
	failing.provider = nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		name := strings.TrimPrefix(request.URL.Query().Get("fieldSelector"), "metadata.name=")
		failing.requests[name]++
		if strings.HasPrefix(name, "flaky") {
			return nativeFailureStatus(request, http.StatusServiceUnavailable, "ServiceUnavailable"), nil
		}
		return nativeFailureStatus(request, http.StatusForbidden, "Forbidden"), nil
	})
	failing.provider.now = func() time.Time { return failing.now }
	failing.pc = &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	return failing
}

// expect reads one Pod through its singleton selector, then checks the result
// status and how many requests that selector has received in total.
func (f *nativeFailingSingletons) expect(t *testing.T, name, status string, requests int) {
	t.Helper()
	response, err := f.provider.query(f.pc, nativeSinglePodQuery(f.pc, "one", name))
	if err != nil {
		t.Fatal(err)
	}
	if got := response.Results[0].Status; got != status || f.requests[name] != requests {
		t.Fatalf("%s: status %q after %d requests, want %q after %d", name, got, f.requests[name], status, requests)
	}
}

// retained is how many failed endpoints the connection's cache holds right now.
func (f *nativeFailingSingletons) retained() int {
	f.provider.mu.Lock()
	defer f.provider.mu.Unlock()
	return len(f.provider.lanes["selected"].failures)
}

func TestNativeFailureCacheKeepsNewestFailureWhenFull(t *testing.T) {
	failing := newNativeFailingSingletons(t)
	names := make([]string, nativeMaxFailures+1)
	for index := range names {
		names[index] = fmt.Sprintf("pod-%03d", index)
		failing.now = failing.now.Add(time.Millisecond) // Distinct expiries make the eviction order observable.
		failing.expect(t, names[index], "denied", 1)
	}
	if got := failing.retained(); got != nativeMaxFailures {
		t.Fatalf("cache holds %d failures after %d distinct ones, want exactly its bound %d", got, len(names), nativeMaxFailures)
	}
	// One failure had to give way. The newest must not be it, and neither may
	// any other live failure: each still answers without another request.
	for _, name := range names[1:] {
		failing.expect(t, name, "denied", 1)
	}
	// The failure nearest expiry was evicted, so that endpoint is read again.
	failing.expect(t, names[0], "denied", 2)
}

func TestNativeFailureCachePrunesExpiredFailuresBeforeEvictingLiveOnes(t *testing.T) {
	failing := newNativeFailingSingletons(t)
	live := make([]string, 0, nativeMaxFailures)
	for index := range nativeMaxFailures - 1 {
		name := fmt.Sprintf("held-%03d", index)
		failing.now = failing.now.Add(time.Millisecond)
		failing.expect(t, name, "denied", 1)
		live = append(live, name)
	}
	// A server error is the newest entry yet expires first, and it fills the cache.
	failing.now = failing.now.Add(time.Millisecond)
	failing.expect(t, "flaky", "failed", 1)
	failing.now = failing.now.Add(nativeTransientFailureTTL + time.Second)
	// The expired entry's slot, not a live failure's, must make room for this one.
	failing.expect(t, "fresh", "denied", 1)
	live = append(live, "fresh")
	for _, name := range live {
		failing.expect(t, name, "denied", 1)
	}
	// Reading the expired endpoint again finds a cache full of live failures. Its
	// new failure must still be cached, at the expense of the live one nearest expiry.
	failing.expect(t, "flaky", "failed", 2)
	failing.expect(t, "flaky", "failed", 2)
	failing.expect(t, live[0], "denied", 2)
}

func TestNativeFailureCooldownFollowsWhetherTheFailureCanClear(t *testing.T) {
	api := func(code int, reason string) nativeTestTransport {
		return func(request *http.Request) (*http.Response, error) {
			return nativeFailureStatus(request, code, reason), nil
		}
	}
	for _, test := range []struct {
		name       string
		failure    nativeTestTransport
		want       string // Result status while the failure is cached.
		persistent bool
	}{
		{"not found", api(http.StatusNotFound, "NotFound"), "failed", true},
		{"forbidden", api(http.StatusForbidden, "Forbidden"), "denied", true},
		{"unauthorized", api(http.StatusUnauthorized, "Unauthorized"), "denied", true},
		{"server error", api(http.StatusInternalServerError, "InternalError"), "failed", false},
		{"unavailable", api(http.StatusServiceUnavailable, "ServiceUnavailable"), "failed", false},
		{"transport", func(*http.Request) (*http.Response, error) {
			return nil, errors.New("dial tcp 10.0.0.1:6443: connect: connection refused")
		}, "failed", false},
		{"truncated body", func(request *http.Request) (*http.Response, error) {
			page := nativePage(nativeSample)
			return nativeTestResponse(request, page[:len(page)/2]), nil
		}, "failed", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			healthy := false
			provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
				calls++
				if healthy {
					return nativeTestResponse(request, nativePage(nativeSample)), nil
				}
				return test.failure(request)
			})
			start := time.Now()
			now := start
			provider.now = func() time.Time { return now }
			pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
			query := nativeSinglePodQuery(pc, "one", "same")
			scan := func(status string, wantCalls int) {
				t.Helper()
				response, err := provider.query(pc, query)
				if err != nil {
					t.Fatal(err)
				}
				if got := response.Results[0].Status; got != status || calls != wantCalls {
					t.Fatalf("%v after the failure: status %q from %d requests, want %q from %d", now.Sub(start), got, calls, status, wantCalls)
				}
			}
			scan(test.want, 1)
			// A different row token inside the short window cannot reach the API.
			now = start.Add(nativeTransientFailureTTL / 2)
			query.Targets[0].Token = "scrolled"
			scan(test.want, 1)
			healthy = true
			now = start.Add(nativeTransientFailureTTL + time.Millisecond)
			if test.persistent {
				// A missing API or a refused caller is not retried after the short window.
				scan(test.want, 1)
				now = start.Add(nativePersistentFailureTTL + time.Millisecond)
			}
			scan("ok", 2)
		})
	}
}

// The final byte of a body is the hardest place for a budget stop to hide:
// json.Decoder.More consumes it as the over-budget probe and discards the error,
// and the retry used to find a clean EOF. The scan then ended as an ordinary
// source failure that was cached, hiding a source that fits after a refresh.
func TestNativeBudgetStopAtFinalDelimiterIsNotCachedAndRecovers(t *testing.T) {
	envelope := nativePage(nativeSample)
	envelope = envelope[:len(envelope)-1] // Everything but the closing brace.
	// Valid JSON whose only over-budget byte is the final closing brace.
	overrun := envelope + strings.Repeat(" ", nativeMaxBytes-len(envelope)) + "}"
	requests := 0
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		requests++
		if requests == 1 {
			return nativeTestResponse(request, overrun), nil
		}
		return nativeTestResponse(request, nativePage(nativeSample)), nil
	})
	now := time.Now()
	provider.now = func() time.Time { return now }
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	before := scanSeries(t)
	first, err := provider.query(pc, nativeSinglePodQuery(pc, "one", "same"))
	if err != nil || first.Complete || first.Results[0].Status != "failed" {
		t.Fatalf("over-budget body did not end as an incomplete failed read: response=%+v err=%v", first, err)
	}
	after := scanSeries(t)
	if after["scans|outcome=budget"]-before["scans|outcome=budget"] != 1 || after["scans|outcome=failed"] != before["scans|outcome=failed"] {
		t.Fatalf("budget stop was not counted as a budget stop: before=%v after=%v", before, after)
	}
	// Nothing was remembered: the next read reaches the source and succeeds.
	second, err := provider.query(pc, nativeSinglePodQuery(pc, "one", "same"))
	if err != nil || requests != 2 || !second.Complete || second.Results[0].Status != "ok" {
		t.Fatalf("budget stop suppressed recovery: requests=%d response=%+v err=%v", requests, second, err)
	}
}

func TestNativeCallerCancellationDoesNotSuppressTheNextRead(t *testing.T) {
	started := make(chan struct{})
	calls := 0
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		calls++
		if calls > 1 {
			return nativeTestResponse(request, nativePage(nativeSample)), nil
		}
		close(started)
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	caller := &types.PluginContext{Context: ctx, Connection: &types.Connection{ID: "selected"}}
	finished := make(chan error, 1)
	go func() {
		_, err := provider.query(caller, nativeSinglePodQuery(caller, "one", "same"))
		finished <- err
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("query did not reach its request")
	}
	cancel()
	select {
	case err := <-finished:
		if err == nil {
			t.Fatal("a canceled query published a response")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("a canceled query did not stop")
	}
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	response, err := provider.query(pc, nativeSinglePodQuery(pc, "one", "same"))
	if err != nil || calls != 2 || response.Results[0].Status != "ok" {
		t.Fatalf("cancellation suppressed the next read: calls=%d response=%+v err=%v", calls, response, err)
	}
}
