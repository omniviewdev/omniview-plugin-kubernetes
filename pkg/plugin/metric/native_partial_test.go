package metric

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"testing"
	"testing/synctest"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// nativeHangsAt answers every namespace except the given ones, whose lists do
// not return until their request is canceled.
func nativeHangsAt(hanging ...string) func(*http.Request, string) (*http.Response, error) {
	return func(request *http.Request, namespace string) (*http.Response, error) {
		if slices.Contains(hanging, namespace) {
			<-request.Context().Done()
			return nil, request.Context().Err()
		}
		return nativeAnswers(request, namespace)
	}
}

// nativeStatuses lists the status of each result by row token, in query order.
func nativeStatuses(response *sdkmetric.ResourceMetricsResponse) []string {
	statuses := make([]string, len(response.Results))
	for index, result := range response.Results {
		statuses[index] = result.ResourceToken + "=" + result.Status
	}
	return statuses
}

func TestNativeDeadlineDeliversTheNamespacesThatFinished(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		api := newNativeFakeAPI(nativeHangsAt("ns-04"))
		provider := nativeTestProvider(t, api.RoundTrip)
		pc := nativeSelectedPC()
		before := scanSeries(t)
		start := time.Now()

		response, err := provider.query(pc, nativeNamespaceQuery(pc, 5))
		if err != nil {
			t.Fatalf("a query that reached its own deadline returned %v, want the namespaces that finished", err)
		}
		if elapsed := time.Since(start); elapsed != nativeTimeout {
			t.Fatalf("query took %v, want the %v deadline", elapsed, nativeTimeout)
		}
		want := []string{"row-ns-00=ok", "row-ns-01=ok", "row-ns-02=ok", "row-ns-03=ok", "row-ns-04=failed"}
		if got := nativeStatuses(response); !slices.Equal(got, want) {
			t.Fatalf("statuses = %v, want %v", got, want)
		}
		if response.Complete || !slices.Equal(response.Warnings, []string{nativeDeadlineMessage}) {
			t.Fatalf("complete=%v warnings=%v, want an incomplete response with one warning", response.Complete, response.Warnings)
		}
		after := scanSeries(t)
		if got := after["scans|outcome=ok"] - before["scans|outcome=ok"]; got != 4 {
			t.Fatalf("%v scans finished ok, want 4", got)
		}
		if got := after["scans|outcome=timeout"] - before["scans|outcome=timeout"]; got != 1 {
			t.Fatalf("%v scans timed out, want 1", got)
		}
		// The query delivered, so it is not an abandoned query.
		for _, reason := range []string{"caller", "deadline", "retired"} {
			if after["cancellations|reason="+reason] != before["cancellations|reason="+reason] {
				t.Fatalf("a delivered query counted as a %s cancellation", reason)
			}
		}
	})
}

func TestNativeDeadlineWarnsForEveryNamespaceThatDidNotFinish(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		api := newNativeFakeAPI(nativeAnswers)
		provider := nativeTestProvider(t, api.RoundTrip)
		pc := nativeSelectedPC()
		query := nativeNamespaceQuery(pc, 6)
		// A first query shows that the API answers, so the next one reads
		// namespaces in parallel.
		if _, err := provider.query(pc, query); err != nil {
			t.Fatal(err)
		}
		answered := api.total()

		// Now no list returns. Only as many as can be in flight are started; the
		// rest never begin, and the deadline passes with nothing finished.
		api.setServe(nativeHangsAt("ns-00", "ns-01", "ns-02", "ns-03", "ns-04", "ns-05"))
		response, err := provider.query(pc, query)
		if err != nil {
			t.Fatal(err)
		}
		if started := api.total() - answered; started != nativeParallelism {
			t.Fatalf("%d lists were started, want the %d that fit", started, nativeParallelism)
		}
		for _, result := range response.Results {
			if result.Status != "failed" {
				t.Fatalf("statuses = %v", nativeStatuses(response))
			}
		}
		want := []string{nativeDeadlineMessage, nativeDeadlineMessage, nativeDeadlineMessage, nativeDeadlineMessage, nativeDeadlineMessage, nativeDeadlineMessage}
		if response.Complete || !slices.Equal(response.Warnings, want) {
			t.Fatalf("complete=%v warnings=%v, want one warning for each of the 6 namespaces that did not finish", response.Complete, response.Warnings)
		}
	})
}

func TestNativeNamespaceThatTimedOutIsNotReadAgainAtOnce(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		api := newNativeFakeAPI(nativeHangsAt("ns-04"))
		provider := nativeTestProvider(t, api.RoundTrip)
		pc := nativeSelectedPC()
		query := nativeNamespaceQuery(pc, 5)
		// poll runs one query and checks how long it took and how many times the
		// hung namespace has been read. Reading it spends the whole deadline.
		poll := func(wantElapsed time.Duration, wantHungReads int) *sdkmetric.ResourceMetricsResponse {
			t.Helper()
			start := time.Now()
			response, err := provider.query(pc, query)
			if err != nil {
				t.Fatal(err)
			}
			if elapsed := time.Since(start); elapsed != wantElapsed {
				t.Fatalf("poll took %v, want %v", elapsed, wantElapsed)
			}
			if got := api.namespaceCalls("ns-04"); got != wantHungReads {
				t.Fatalf("the hung namespace has been read %d times, want %d", got, wantHungReads)
			}
			if response.Complete || response.Results[4].Status != "failed" || !slices.Contains(response.Warnings, nativeDeadlineMessage) {
				t.Fatalf("complete=%v statuses=%v warnings=%v", response.Complete, nativeStatuses(response), response.Warnings)
			}
			return response
		}
		// answered checks a poll that was answered from memory: everything else is current.
		answered := func(response *sdkmetric.ResourceMetricsResponse) {
			t.Helper()
			want := []string{"row-ns-00=ok", "row-ns-01=ok", "row-ns-02=ok", "row-ns-03=ok", "row-ns-04=failed"}
			if got := nativeStatuses(response); !slices.Equal(got, want) || !slices.Equal(response.Warnings, []string{nativeDeadlineMessage}) {
				t.Fatalf("statuses = %v warnings = %v", got, response.Warnings)
			}
		}

		// The first poll is cut off by the hung namespace, which comes last.
		poll(nativeTimeout, 1)
		// The next ones are answered without reading it, and take no time.
		answered(poll(0, 1))
		time.Sleep(nativePersistentFailureTTL - time.Nanosecond)
		answered(poll(0, 1))
		// Its window ends 30 s after it timed out. Reading it again times out
		// again, and the next window is twice as long.
		time.Sleep(time.Nanosecond)
		poll(nativeTimeout, 2)
		time.Sleep(2*nativePersistentFailureTTL - time.Nanosecond)
		answered(poll(0, 2))
		time.Sleep(time.Nanosecond)
		poll(nativeTimeout, 3)
	})
}

func TestNativeCallerGivingUpStillReturnsTheError(t *testing.T) {
	for _, test := range []struct {
		name string
		// start returns the caller's context and a way to make it end.
		start func() (context.Context, func())
		want  error
	}{
		{
			name: "canceled",
			start: func() (context.Context, func()) {
				ctx, cancel := context.WithCancel(context.Background())
				return ctx, cancel
			},
			want: context.Canceled,
		},
		{
			// Its own deadline falls before the 15 s one, so nobody is left to deliver to.
			name: "caller deadline",
			start: func() (context.Context, func()) {
				ctx, cancel := context.WithTimeout(context.Background(), nativeTimeout/3)
				return ctx, func() {
					defer cancel()
					time.Sleep(nativeTimeout / 2)
				}
			},
			want: context.DeadlineExceeded,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				api := newNativeFakeAPI(nativeHangsAt("ns-04"))
				provider := nativeTestProvider(t, api.RoundTrip)
				ctx, end := test.start()
				pc := &types.PluginContext{Context: ctx, Connection: &types.Connection{ID: "selected"}}

				type outcome struct {
					response *sdkmetric.ResourceMetricsResponse
					err      error
				}
				done := make(chan outcome, 1)
				go func() {
					response, err := provider.query(pc, nativeNamespaceQuery(pc, 5))
					done <- outcome{response, err}
				}()
				// Everything that can finish has; the query waits on ns-04.
				synctest.Wait()
				end()
				got := <-done
				if got.response != nil || !errors.Is(got.err, test.want) {
					t.Fatalf("response=%+v err=%v, want no response and %v", got.response, got.err, test.want)
				}
				// Nothing was remembered against the namespace: the caller left, it did not time out.
				if err := provider.scanFailure(provider.lanes["selected"], nativeScanKey{resource: "k8s:/pods", namespace: "ns-04", name: "same"}); err != nil {
					t.Fatalf("an abandoned read was remembered as %v", err)
				}
			})
		})
	}
}
