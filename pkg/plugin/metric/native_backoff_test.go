package metric

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// nativeFakeAPI is a metrics API that counts the namespace lists reaching it and
// answers each with whatever serve says. Node lists count under the empty
// namespace. serve may block, for example until the request is canceled.
type nativeFakeAPI struct {
	mu    sync.Mutex
	calls map[string]int
	serve func(request *http.Request, namespace string) (*http.Response, error)
}

func newNativeFakeAPI(serve func(*http.Request, string) (*http.Response, error)) *nativeFakeAPI {
	return &nativeFakeAPI{calls: map[string]int{}, serve: serve}
}

func (a *nativeFakeAPI) RoundTrip(request *http.Request) (*http.Response, error) {
	namespace := ""
	if rest, ok := strings.CutPrefix(request.URL.Path, "/apis/metrics.k8s.io/v1beta1/namespaces/"); ok {
		namespace = strings.TrimSuffix(rest, "/pods")
	}
	a.mu.Lock()
	a.calls[namespace]++
	serve := a.serve
	a.mu.Unlock()
	return serve(request, namespace)
}

func (a *nativeFakeAPI) setServe(serve func(*http.Request, string) (*http.Response, error)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.serve = serve
}

func (a *nativeFakeAPI) total() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	total := 0
	for _, count := range a.calls {
		total += count
	}
	return total
}

func (a *nativeFakeAPI) namespaceCalls(namespace string) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.calls[namespace]
}

// nativeAnswers is a metrics API that serves the sample Pod in every namespace.
func nativeAnswers(request *http.Request, namespace string) (*http.Response, error) {
	sample := strings.ReplaceAll(nativeSample, `"namespace":"one"`, `"namespace":"`+namespace+`"`)
	return nativeTestResponse(request, nativePage(sample)), nil
}

// nativeRefuses answers every list with the Kubernetes failure of that code.
func nativeRefuses(code int, reason string) func(*http.Request, string) (*http.Response, error) {
	return func(request *http.Request, _ string) (*http.Response, error) {
		return nativeFailureStatus(request, code, reason), nil
	}
}

func nativeSelectedPC() *types.PluginContext {
	return &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
}

func TestNativeAbsentMetricsAPIIsProbedOncePerBackoffWindow(t *testing.T) {
	api := newNativeFakeAPI(nativeRefuses(http.StatusNotFound, "NotFound"))
	provider := nativeTestProvider(t, api.RoundTrip)
	start := time.Now()
	now := start
	provider.now = func() time.Time { return now }
	pc := nativeSelectedPC()
	query := nativeNamespaceQuery(pc, 20)
	poll := func(at time.Duration, wantRequests int) *sdkmetric.ResourceMetricsResponse {
		t.Helper()
		now = start.Add(at)
		response, err := provider.query(pc, query)
		if err != nil {
			t.Fatal(err)
		}
		if got := api.total(); got != wantRequests {
			t.Fatalf("after the poll at %v: %d requests have reached the API, want %d", at, got, wantRequests)
		}
		return response
	}
	absent := func(response *sdkmetric.ResourceMetricsResponse) {
		t.Helper()
		if response.Complete || len(response.Warnings) != 20 {
			t.Fatalf("complete=%v warnings=%d, want an incomplete response with a warning per namespace", response.Complete, len(response.Warnings))
		}
		for _, result := range response.Results {
			if result.Status != "failed" || result.Value != nil {
				t.Fatalf("absence must settle as failed, never as a value: %+v", result)
			}
		}
	}

	// One open table polls every minute for ten minutes. Only the first
	// namespace is probed, when the window of the previous failure (30 s, 1, 2, 4
	// and 8 minutes) has ended; no other namespace is read at all.
	for minute, want := range []int{1, 2, 3, 3, 4, 4, 4, 4, 5, 5} {
		absent(poll(time.Duration(minute)*time.Minute, want))
	}

	// The API starts answering. The window opened at minute 8 lasts 8 minutes,
	// so polls are still answered from memory until minute 16.
	api.setServe(nativeAnswers)
	for minute := 10; minute < 16; minute++ {
		absent(poll(time.Duration(minute)*time.Minute, 5))
	}
	for _, minute := range []int{16, 17} {
		response := poll(time.Duration(minute)*time.Minute, 5+20*(minute-15))
		if !response.Complete || len(response.Warnings) != 0 {
			t.Fatalf("minute %d: scanning did not resume: %+v", minute, response)
		}
		for _, result := range response.Results {
			if result.Status != "ok" {
				t.Fatalf("minute %d: %+v", minute, result)
			}
		}
	}

	// A new failure starts from the first window again, not where the last one ended.
	api.setServe(nativeRefuses(http.StatusNotFound, "NotFound"))
	absent(poll(18*time.Minute, 46))
	absent(poll(18*time.Minute+29*time.Second, 46))
	absent(poll(18*time.Minute+30*time.Second, 47))
}

func TestNativeAbsentMetricsAPIBackoffDoublesToTheCeiling(t *testing.T) {
	api := newNativeFakeAPI(nativeRefuses(http.StatusNotFound, "NotFound"))
	provider := nativeTestProvider(t, api.RoundTrip)
	start := time.Now()
	now := start
	provider.now = func() time.Time { return now }
	pc := nativeSelectedPC()
	query := nativeNamespaceQuery(pc, 3)
	poll := func(at time.Duration, wantRequests int) {
		t.Helper()
		now = start.Add(at)
		if _, err := provider.query(pc, query); err != nil {
			t.Fatal(err)
		}
		if got := api.total(); got != wantRequests {
			t.Fatalf("after the poll at %v: %d requests have reached the API, want %d", at, got, wantRequests)
		}
	}

	// Each window is twice the one before: 30 s, 60 s, 2, 4 and 8 minutes. The
	// next would be 16 minutes, but the ceiling is 10.
	probes := []time.Duration{0, 30 * time.Second, 90 * time.Second, 210 * time.Second, 450 * time.Second, 930 * time.Second, 1530 * time.Second, 2130 * time.Second}
	for index, at := range probes {
		if index > 0 {
			poll(at-time.Second, index)
		}
		poll(at, index+1)
	}
	if got, want := probes[len(probes)-1]-probes[len(probes)-2], nativeMaxFailureTTL; got != want {
		t.Fatalf("the last window was %v, want the ceiling %v", got, want)
	}

	// After a quiet period longer than the ceiling, nothing is left of the
	// history: the failure starts over at the first window and doubles again.
	quiet := probes[len(probes)-1] + nativeMaxFailureTTL + nativeMaxFailureTTL + time.Second
	poll(quiet, 9)
	poll(quiet+nativePersistentFailureTTL-time.Second, 9)
	poll(quiet+nativePersistentFailureTTL, 10)
	poll(quiet+nativePersistentFailureTTL+2*nativePersistentFailureTTL-time.Second, 10)
	poll(quiet+nativePersistentFailureTTL+2*nativePersistentFailureTTL, 11)
}

func TestNativeDeniedNamespaceBacksOffWithoutHoldingBackTheOthers(t *testing.T) {
	api := newNativeFakeAPI(func(request *http.Request, namespace string) (*http.Response, error) {
		if namespace == "ns-03" {
			return nativeFailureStatus(request, http.StatusForbidden, "Forbidden"), nil
		}
		return nativeAnswers(request, namespace)
	})
	provider := nativeTestProvider(t, api.RoundTrip)
	start := time.Now()
	now := start
	provider.now = func() time.Time { return now }
	pc := nativeSelectedPC()
	query := nativeNamespaceQuery(pc, 5)

	polls := 0
	for at := time.Duration(0); at <= 140*time.Second; at += 20 * time.Second {
		now = start.Add(at)
		response, err := provider.query(pc, query)
		if err != nil {
			t.Fatal(err)
		}
		polls++
		denied := 0
		for _, result := range response.Results {
			switch {
			case result.ResourceToken == "row-ns-03" && result.Status == "denied":
				denied++
			case result.ResourceToken != "row-ns-03" && result.Status == "ok":
			default:
				t.Fatalf("at %v: %+v", at, result)
			}
		}
		if denied != 1 || response.Complete || len(response.Warnings) != 1 {
			t.Fatalf("at %v: denied=%d complete=%v warnings=%d", at, denied, response.Complete, len(response.Warnings))
		}
	}
	// The denied namespace is read when its window ends: 30 s after the first
	// failure, 60 s after the second, 2 minutes after the third. Namespaces that
	// answer are read on every poll.
	if got := api.namespaceCalls("ns-03"); got != 3 {
		t.Fatalf("the denied namespace was read %d times in %d polls, want 3", got, polls)
	}
	for _, namespace := range []string{"ns-00", "ns-01", "ns-02", "ns-04"} {
		if got := api.namespaceCalls(namespace); got != polls {
			t.Fatalf("%s was read %d times in %d polls", namespace, got, polls)
		}
	}
}

func TestNativeSuccessEndsTheBackoffOfANamespace(t *testing.T) {
	api := newNativeFakeAPI(nativeRefuses(http.StatusForbidden, "Forbidden"))
	provider := nativeTestProvider(t, api.RoundTrip)
	start := time.Now()
	now := start
	provider.now = func() time.Time { return now }
	pc := nativeSelectedPC()
	query := nativeNamespaceQuery(pc, 1)
	read := func(at time.Duration, wantRequests int) {
		t.Helper()
		now = start.Add(at)
		if _, err := provider.query(pc, query); err != nil {
			t.Fatal(err)
		}
		if got := api.total(); got != wantRequests {
			t.Fatalf("after the read at %v: %d requests, want %d", at, got, wantRequests)
		}
	}

	read(0, 1)
	read(30*time.Second, 2) // The second failure doubles the window to 60 s.
	read(89*time.Second, 2)
	api.setServe(nativeAnswers)
	read(90*time.Second, 3)
	api.setServe(nativeRefuses(http.StatusForbidden, "Forbidden"))
	// Access is refused again. The success in between forgot the doubled
	// window, so this failure holds for 30 s, not 2 minutes.
	read(100*time.Second, 4)
	read(129*time.Second, 4)
	read(130*time.Second, 5)
}

func TestNativeUnavailableMetricsAPIAndServerErrorsAreNotProbedPerSelector(t *testing.T) {
	for _, test := range []struct {
		name         string
		code         int
		reason       string
		wantRequests int
	}{
		// An aggregated API without a backend is missing for every namespace.
		{"unavailable", http.StatusServiceUnavailable, "ServiceUnavailable", 1},
		// A failing server is failing for every selector in a namespace.
		{"server error", http.StatusInternalServerError, "InternalError", 20},
		{"throttled", http.StatusTooManyRequests, "TooManyRequests", 20},
	} {
		t.Run(test.name, func(t *testing.T) {
			api := newNativeFakeAPI(nativeRefuses(test.code, test.reason))
			provider := nativeTestProvider(t, api.RoundTrip)
			now := time.Now()
			provider.now = func() time.Time { return now }
			pc := nativeSelectedPC()
			// Scrolling shows other Pods of the same 20 namespaces in every
			// query: each singleton has a new selector.
			for scroll := range 5 {
				query := sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeCPU}}
				for index := range 20 {
					namespace := fmt.Sprintf("ns-%02d", index)
					query.Targets = append(query.Targets, nativeTestTarget(fmt.Sprintf("row-%d-%d", scroll, index), namespace, fmt.Sprintf("pod-%d", scroll)))
				}
				response, err := provider.query(pc, query)
				if err != nil {
					t.Fatal(err)
				}
				if response.Complete || len(response.Warnings) != 20 {
					t.Fatalf("scroll %d: complete=%v warnings=%d", scroll, response.Complete, len(response.Warnings))
				}
			}
			if got := api.total(); got != test.wantRequests {
				t.Fatalf("5 queries with new selectors made %d requests, want %d", got, test.wantRequests)
			}
		})
	}
}

func TestNativePodsAndNodesRememberTheirAbsenceSeparately(t *testing.T) {
	api := newNativeFakeAPI(nativeRefuses(http.StatusNotFound, "NotFound"))
	provider := nativeTestProvider(t, api.RoundTrip)
	now := time.Now()
	provider.now = func() time.Time { return now }
	pc := nativeSelectedPC()
	node := nativeTestTarget("node", "", "node-a")
	node.Reference.Address.Type = "k8s:/nodes"
	node.Reference.Address.Scope = nil
	nodes := sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeNodeCPU}, Targets: []sdkmetric.ResourceMetricTarget{node}}
	pods := nativeNamespaceQuery(pc, 4)
	for range 2 {
		if _, err := provider.query(pc, pods); err != nil {
			t.Fatal(err)
		}
		if _, err := provider.query(pc, nodes); err != nil {
			t.Fatal(err)
		}
	}
	if got := api.total(); got != 2 {
		t.Fatalf("%d requests reached the API, want one for Pods and one for Nodes", got)
	}
}
