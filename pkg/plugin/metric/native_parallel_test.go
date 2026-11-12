package metric

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// nativeQueryTogether runs the same query as many times at once and returns the
// responses in the order the calls were made.
func nativeQueryTogether(t *testing.T, provider *nativeProvider, pc *types.PluginContext, query sdkmetric.ResourceMetricsQuery, times int) []*sdkmetric.ResourceMetricsResponse {
	t.Helper()
	responses := make([]*sdkmetric.ResourceMetricsResponse, times)
	var group sync.WaitGroup
	for index := range responses {
		group.Add(1)
		go func() {
			defer group.Done()
			response, err := provider.query(pc, query)
			if err != nil {
				t.Errorf("query %d: %v", index, err)
				return
			}
			responses[index] = response
		}()
	}
	group.Wait()
	return responses
}

// nativeSequentialResponse answers query the way a provider that reads one
// namespace at a time does, from an API that answers like serve.
func nativeSequentialResponse(t *testing.T, serve func(*http.Request, string) (*http.Response, error), query sdkmetric.ResourceMetricsQuery) *sdkmetric.ResourceMetricsResponse {
	t.Helper()
	provider := nativeTestProvider(t, newNativeFakeAPI(serve).RoundTrip)
	provider.parallel = 1
	response, err := provider.query(nativeSelectedPC(), query)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func TestNativeConcurrentIdenticalQueriesShareTheirNamespaceLists(t *testing.T) {
	for _, test := range []struct {
		name  string
		serve func(*http.Request, string) (*http.Response, error)
		// status every result of every query must have.
		status string
	}{
		{"answering API", nativeAnswers, "ok"},
		// Not an absent API, which no namespace is read for once one is known to be
		// missing: every namespace refuses on its own.
		{"refusing API", nativeRefuses(http.StatusForbidden, "Forbidden"), "denied"},
	} {
		t.Run(test.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				api := newNativeFakeAPI(test.serve)
				api.latency = 25 * time.Millisecond
				provider := nativeTestProvider(t, api.RoundTrip)
				pc := nativeSelectedPC()
				query := nativeNamespaceQuery(pc, 20)

				responses := nativeQueryTogether(t, provider, pc, query, 4)

				// Four queries over 20 namespaces made 20 requests, not 80, and not
				// the 68 they made when each one could not see the others' reads.
				if got := api.total(); got != 20 {
					t.Fatalf("4 concurrent queries made %d requests, want 20", got)
				}
				for index := range 20 {
					if namespace := fmt.Sprintf("ns-%02d", index); api.namespaceCalls(namespace) != 1 {
						t.Fatalf("%s was listed %d times, want once", namespace, api.namespaceCalls(namespace))
					}
				}
				// Sharing the request changes nothing a query is told.
				want := nativeSequentialResponse(t, test.serve, query)
				for index, response := range responses {
					if response == nil || !reflect.DeepEqual(response, want) {
						t.Fatalf("query %d = %+v, want what a sequential provider returns: %+v", index, response, want)
					}
					for _, result := range response.Results {
						if result.Status != test.status {
							t.Fatalf("query %d: %+v, want every result %s", index, result, test.status)
						}
					}
				}
			})
		})
	}
}

func TestNativeConcurrentQueriesFindOutOnceThatTheAPIIsAbsent(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		api := newNativeFakeAPI(nativeRefuses(http.StatusNotFound, "NotFound"))
		api.latency = 25 * time.Millisecond
		provider := nativeTestProvider(t, api.RoundTrip)
		pc := nativeSelectedPC()

		for index, response := range nativeQueryTogether(t, provider, pc, nativeNamespaceQuery(pc, 20), 4) {
			if response.Complete || len(response.Warnings) != 20 {
				t.Fatalf("query %d: complete=%v warnings=%d", index, response.Complete, len(response.Warnings))
			}
		}
		// Four cold queries made 68 requests when none could see the others'.
		if got := api.total(); got != 1 {
			t.Fatalf("4 concurrent queries made %d requests to an absent API, want 1", got)
		}
	})
}

func TestNativeWarmConcurrentQueriesShareEveryNamespaceListAtOnce(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		api := newNativeFakeAPI(nativeAnswers)
		provider := nativeTestProvider(t, api.RoundTrip)
		// All 20 lists of a query are in flight together, so that every query meets
		// every other query's list wherever its own sweep happens to start.
		provider.parallel = 20
		pc := nativeSelectedPC()
		query := nativeNamespaceQuery(pc, 20)
		if _, err := provider.query(pc, query); err != nil {
			t.Fatal(err)
		}
		warm := api.total()
		api.latency = 25 * time.Millisecond

		nativeQueryTogether(t, provider, pc, query, 4)
		if got := api.total() - warm; got != 20 {
			t.Fatalf("4 concurrent queries made %d requests, want 20", got)
		}
	})
}

func TestNativeQueryReadsAtMostFourNamespacesAtOnce(t *testing.T) {
	for _, test := range []struct {
		name     string
		parallel int
		peak     int
		elapsed  time.Duration
	}{
		{"sequential", 1, 1, 20 * 25 * time.Millisecond},
		{"default", nativeParallelism, nativeParallelism, 5 * 25 * time.Millisecond},
	} {
		t.Run(test.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				api := newNativeFakeAPI(nativeAnswers)
				provider := nativeTestProvider(t, api.RoundTrip)
				provider.parallel = test.parallel
				pc := nativeSelectedPC()
				query := nativeNamespaceQuery(pc, 20)
				// The first query shows that the API answers.
				if _, err := provider.query(pc, query); err != nil {
					t.Fatal(err)
				}
				api.latency = 25 * time.Millisecond
				api.mu.Lock()
				api.peak = 0
				api.mu.Unlock()

				start := time.Now()
				response, err := provider.query(pc, query)
				if err != nil || !response.Complete {
					t.Fatalf("response=%+v err=%v", response, err)
				}
				if got := api.peakInFlight(); got != test.peak {
					t.Fatalf("%d lists were in flight at once, want %d", got, test.peak)
				}
				if elapsed := time.Since(start); elapsed != test.elapsed {
					t.Fatalf("20 namespaces took %v, want %v", elapsed, test.elapsed)
				}
			})
		})
	}
}

// A parallel sweep must tell the caller exactly what a sequential one does.
func TestNativeParallelSweepReturnsWhatASequentialSweepReturns(t *testing.T) {
	// Namespaces that answer in every way the join has to handle.
	serve := func(request *http.Request, namespace string) (*http.Response, error) {
		sample := func(name, itemNamespace string) string {
			item := strings.ReplaceAll(nativeSample, `"name":"same"`, `"name":"`+name+`"`)
			return strings.ReplaceAll(item, `"namespace":"one"`, `"namespace":"`+itemNamespace+`"`)
		}
		switch namespace {
		case "ns-00": // Two targets, both measured, plus a Pod nobody asked for.
			return nativeTestResponse(request, nativePage(sample("a", namespace)+","+sample("b", namespace)+","+sample("extra", namespace))), nil
		case "ns-01": // A target the source has no measurement for.
			return nativeTestResponse(request, nativePage("")), nil
		case "ns-02":
			return nativeFailureStatus(request, http.StatusForbidden, "Forbidden"), nil
		case "ns-03": // The same Pod twice.
			return nativeTestResponse(request, nativePage(sample("same", namespace)+","+sample("same", namespace))), nil
		case "ns-04": // A Pod of another namespace under this one's name.
			return nativeTestResponse(request, nativePage(sample("same", "elsewhere"))), nil
		case "ns-05":
			return nativeFailureStatus(request, http.StatusInternalServerError, "InternalError"), nil
		}
		return nativeAnswers(request, namespace)
	}
	pc := nativeSelectedPC()
	query := sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeCPU, nativeMemory}}
	for _, target := range []struct{ namespace, name string }{
		{"ns-00", "a"}, {"ns-00", "b"}, {"ns-01", "same"}, {"ns-02", "same"}, {"ns-03", "same"}, {"ns-04", "same"}, {"ns-05", "same"},
		{"ns-06", "same"}, {"ns-07", "same"}, {"ns-08", "same"}, {"ns-09", "same"},
	} {
		query.Targets = append(query.Targets, nativeTestTarget("row-"+target.namespace+"-"+target.name, target.namespace, target.name))
	}

	want := nativeSequentialResponse(t, serve, query)
	for _, parallel := range []int{2, nativeParallelism, 16} {
		provider := nativeTestProvider(t, newNativeFakeAPI(serve).RoundTrip)
		provider.parallel = parallel
		got, err := provider.query(pc, query)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%d at a time: %+v\nwant what one at a time returns: %+v", parallel, got, want)
		}
	}
	// The scenario must exercise the join, or equality proves nothing.
	statuses := map[string]bool{}
	for _, result := range want.Results {
		statuses[result.Status] = true
	}
	for _, status := range []string{"ok", "missing", "denied", "ambiguous", "failed"} {
		if !statuses[status] {
			t.Fatalf("no result is %s: %v", status, nativeStatuses(want))
		}
	}
}

func TestNativeQueryWaitingOnAnotherQuerysListSurvivesItsCancellation(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var requests atomic.Int32
		api := newNativeFakeAPI(func(request *http.Request, namespace string) (*http.Response, error) {
			if requests.Add(1) == 1 {
				// The first request is the one the first query makes, and it is
				// abandoned with that query.
				<-request.Context().Done()
				return nil, request.Context().Err()
			}
			return nativeAnswers(request, namespace)
		})
		provider := nativeTestProvider(t, api.RoundTrip)
		query := nativeNamespaceQuery(nativeSelectedPC(), 1)

		leaderCtx, abandon := context.WithCancel(context.Background())
		leaderPC := &types.PluginContext{Context: leaderCtx, Connection: &types.Connection{ID: "selected"}}
		leader := make(chan error, 1)
		go func() {
			_, err := provider.query(leaderPC, query)
			leader <- err
		}()
		synctest.Wait()

		waiter := make(chan *sdkmetric.ResourceMetricsResponse, 1)
		go func() {
			response, err := provider.query(nativeSelectedPC(), query)
			if err != nil {
				t.Error(err)
			}
			waiter <- response
		}()
		synctest.Wait()
		if got := api.total(); got != 1 {
			t.Fatalf("%d requests were made, want the one both queries wait on", got)
		}

		abandon()
		if err := <-leader; !errors.Is(err, context.Canceled) {
			t.Fatalf("the query that gave up returned %v", err)
		}
		// Its cancellation says nothing about the cluster: the other query asks again.
		response := <-waiter
		if response == nil || !response.Complete || response.Results[0].Status != "ok" {
			t.Fatalf("the waiting query was failed by another query's cancellation: %+v", response)
		}
		if got := api.total(); got != 2 {
			t.Fatalf("%d requests were made, want the abandoned one and the retry", got)
		}
	})
}

func TestNativeParallelScansShareOneBudget(t *testing.T) {
	// Ten namespaces of 3,000 objects each: 30,000 objects against a budget of
	// 20,000, read four at a time.
	page := func(namespace string) string {
		var items strings.Builder
		for index := range 3000 {
			if index > 0 {
				items.WriteByte(',')
			}
			fmt.Fprintf(&items, `{"metadata":{"name":"pod-%04d","namespace":%q},"timestamp":"2026-11-05T10:00:00Z","window":"20s","containers":[{"name":"c","usage":{"cpu":"1","memory":"1"}}]}`, index, namespace)
		}
		return nativePage(items.String())
	}
	pages := map[string]string{}
	for index := range 10 {
		namespace := fmt.Sprintf("ns-%02d", index)
		pages[namespace] = page(namespace)
	}
	api := newNativeFakeAPI(func(request *http.Request, namespace string) (*http.Response, error) {
		return nativeTestResponse(request, pages[namespace]), nil
	})
	provider := nativeTestProvider(t, api.RoundTrip)
	pc := nativeSelectedPC()
	before := scanSeries(t)

	response, err := provider.query(pc, nativeNamespaceQuery(pc, 10))
	if err != nil {
		t.Fatal(err)
	}
	if response.Complete {
		t.Fatal("a sweep that ran out of budget claims to be complete")
	}
	after := scanSeries(t)
	// However the scans interleave, what they decoded adds up to exactly the budget.
	if got := after["objects|operation=namespace"] - before["objects|operation=namespace"]; got != nativeMaxObjects {
		t.Fatalf("scans decoded %v objects, want exactly the budget of %d", got, nativeMaxObjects)
	}
	if got := after["scans|outcome=budget"] - before["scans|outcome=budget"]; got < 1 {
		t.Fatalf("no scan was stopped by the budget")
	}
}

// The query's handler recovers panics; a goroutine of the sweep's own would not.
func TestNativeQueryRaisesAPanicInAReadInTheCaller(t *testing.T) {
	var explode atomic.Bool
	explode.Store(true)
	api := newNativeFakeAPI(func(request *http.Request, namespace string) (*http.Response, error) {
		if explode.Load() {
			panic("list went wrong")
		}
		return nativeAnswers(request, namespace)
	})
	provider := nativeTestProvider(t, api.RoundTrip)
	pc := nativeSelectedPC()
	query := nativeNamespaceQuery(pc, 3)

	func() {
		defer func() {
			if recovered := recover(); recovered != "list went wrong" {
				t.Fatalf("the caller recovered %v, want the panic of the read", recovered)
			}
		}()
		provider.query(pc, query)
		t.Fatal("the query returned after a read panicked")
	}()

	// The panic left nothing behind for later queries to wait on.
	explode.Store(false)
	response, err := provider.query(pc, query)
	if err != nil || !response.Complete {
		t.Fatalf("response=%+v err=%v", response, err)
	}
}
