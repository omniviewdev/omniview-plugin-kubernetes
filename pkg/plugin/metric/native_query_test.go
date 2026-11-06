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
