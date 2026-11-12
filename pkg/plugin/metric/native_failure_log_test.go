package metric

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const nativeScanFailureMessage = "native metrics namespace scan failed"

// nativeScanFailureLines counts the namespace scan failure records logged at each level.
func nativeScanFailureLines(sink *logtest.RecordingSink) map[logging.Level]int {
	lines := map[logging.Level]int{}
	for _, record := range sink.Records() {
		if record.Message == nativeScanFailureMessage {
			lines[record.Level]++
		}
	}
	return lines
}

// nativeNamespaceQuery asks for one Pod in each of the given number of namespaces.
func nativeNamespaceQuery(pc *types.PluginContext, namespaces int) sdkmetric.ResourceMetricsQuery {
	query := sdkmetric.ResourceMetricsQuery{Source: nativeSource(pc), Shape: "current", MetricIDs: []string{nativeCPU}}
	for index := range namespaces {
		namespace := fmt.Sprintf("ns-%02d", index)
		query.Targets = append(query.Targets, nativeTestTarget("row-"+namespace, namespace, "same"))
	}
	return query
}

func TestNativeAbsentMetricsAPIIsLoggedOncePerConnection(t *testing.T) {
	sink := captureMetricLogs(t)
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		return nativeFailureStatus(request, http.StatusNotFound, "NotFound"), nil
	})
	now := time.Now()
	provider.now = func() time.Time { return now }
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	query := nativeNamespaceQuery(pc, 20)
	poll := func() {
		t.Helper()
		response, err := provider.query(pc, query)
		if err != nil {
			t.Fatal(err)
		}
		// The warnings are the caller's account of an incomplete query. Quieting
		// the log must not change them.
		if response.Complete || len(response.Warnings) != 20 {
			t.Fatalf("complete=%v warnings=%d, want an incomplete response with one warning per namespace", response.Complete, len(response.Warnings))
		}
		for _, warning := range response.Warnings {
			if warning != "Native metrics namespace scan failed" {
				t.Fatalf("warning = %q", warning)
			}
		}
	}

	for range 10 {
		poll()
		now = now.Add(time.Minute)
	}
	want := map[logging.Level]int{logging.LevelWarn: 1}
	if got := nativeScanFailureLines(sink); !reflect.DeepEqual(got, want) {
		t.Fatalf("10 polls a minute apart against 20 namespaces logged %v, want %v", got, want)
	}

	// Ten minutes after the first report the condition still holds. It is
	// repeated once, below warning level, and then falls quiet again.
	poll()
	poll()
	want[logging.LevelDebug] = 1
	if got := nativeScanFailureLines(sink); !reflect.DeepEqual(got, want) {
		t.Fatalf("a reminder ten minutes later logged %v, want %v", got, want)
	}
}

func TestNativeCachedFailureIsNotLoggedAgain(t *testing.T) {
	sink := captureMetricLogs(t)
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		return nativeFailureStatus(request, http.StatusForbidden, "Forbidden"), nil
	})
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	for range 3 {
		response, err := provider.query(pc, nativeSinglePodQuery(pc, "one", "same"))
		if err != nil {
			t.Fatal(err)
		}
		// A remembered denial is still reported to the caller.
		if response.Results[0].Status != "denied" || len(response.Warnings) != 1 {
			t.Fatalf("response=%+v", response)
		}
	}
	// Only the first query reached the cluster. Replaying what it learned is not news.
	if got, want := nativeScanFailureLines(sink), map[logging.Level]int{logging.LevelWarn: 1}; !reflect.DeepEqual(got, want) {
		t.Fatalf("3 queries answered by one request logged %v, want %v", got, want)
	}
}

func TestNativeOtherFailuresAreLoggedOncePerMinutePerNamespaceAndClass(t *testing.T) {
	sink := captureMetricLogs(t)
	provider := nativeTestProvider(t, func(request *http.Request) (*http.Response, error) {
		switch {
		case strings.Contains(request.URL.Path, "/ns-02/"):
			return nativeFailureStatus(request, http.StatusForbidden, "Forbidden"), nil
		default:
			return nativeFailureStatus(request, http.StatusInternalServerError, "InternalError"), nil
		}
	})
	start := time.Now()
	now := start
	provider.now = func() time.Time { return now }
	pc := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	query := nativeNamespaceQuery(pc, 3)
	poll := func(at time.Duration, warn int) {
		t.Helper()
		now = start.Add(at)
		if _, err := provider.query(pc, query); err != nil {
			t.Fatal(err)
		}
		if got, want := nativeScanFailureLines(sink), (map[logging.Level]int{logging.LevelWarn: warn}); !reflect.DeepEqual(got, want) {
			t.Fatalf("after the poll at %v: logged %v, want %v", at, got, want)
		}
	}

	// Two namespaces fail with a server error and one is denied: three
	// different endpoints, each reported once.
	poll(0, 3)
	// Still inside the minute: the server errors are read again after their
	// short cooldown and the denial is replayed, but none of it is repeated.
	poll(10*time.Second, 3)
	// A minute later the failures are still happening and are reported again.
	poll(61*time.Second, 6)
}

func TestNativeFailureLogHistoryIsBoundedAndKeepsStandingConditions(t *testing.T) {
	provider := newNativeProvider()
	t.Cleanup(provider.cache.Stop)
	now := time.Now()
	provider.now = func() time.Time { return now }
	lane := &nativeLane{}
	missing := apierrors.NewNotFound(schema.GroupResource{Group: "metrics.k8s.io", Resource: "pods"}, "")
	denied := apierrors.NewForbidden(schema.GroupResource{Group: "metrics.k8s.io", Resource: "pods"}, "", errors.New("denied"))

	if level, logged := provider.scanFailureLevel(lane, "ns-000", missing, true); !logged || level != logging.LevelWarn {
		t.Fatalf("first sighting of a missing API: level=%v logged=%v", level, logged)
	}
	for index := range 2 * nativeMaxLogged {
		now = now.Add(time.Millisecond)
		provider.scanFailureLevel(lane, fmt.Sprintf("ns-%03d", index), denied, true)
	}
	provider.mu.Lock()
	remembered := len(lane.logged)
	provider.mu.Unlock()
	if remembered > nativeMaxLogged {
		t.Fatalf("%d reports remembered, want at most %d", remembered, nativeMaxLogged)
	}
	// The standing condition outlives the churn: its repeat is quiet, not a second first report.
	now = now.Add(nativeStateLogInterval)
	if level, logged := provider.scanFailureLevel(lane, "ns-000", missing, true); !logged || level != logging.LevelDebug {
		t.Fatalf("repeat of a missing API: level=%v logged=%v, want a debug reminder", level, logged)
	}
	// A cache hit is not news unless it belongs to a standing condition.
	if _, logged := provider.scanFailureLevel(lane, "ns-999", denied, false); logged {
		t.Fatal("a replayed denial was logged")
	}
}
