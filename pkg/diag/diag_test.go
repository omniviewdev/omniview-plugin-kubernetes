package diag

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	sdkdiag "github.com/omniviewdev/plugin-sdk/pkg/diagnostics"
	lifecyclepb "github.com/omniviewdev/plugin-sdk/proto/v1/lifecycle"
)

func point(t *testing.T, name string, attrs map[string]string) *lifecyclepb.DiagPoint {
	t.Helper()
	metrics, _ := sdkdiag.Default().Snapshot()
	for _, m := range metrics {
		if m.Name != name {
			continue
		}
	points:
		for _, p := range m.Points {
			if len(p.Attrs) != len(attrs) {
				continue
			}
			for _, a := range p.Attrs {
				if attrs[lower(a.Key.String())] != a.Value {
					continue points
				}
			}
			return p
		}
	}
	return nil
}

func lower(s string) string {
	out := []byte(s[len("DIAG_KEY_"):])
	for i, c := range out {
		if c >= 'A' && c <= 'Z' {
			out[i] = c + 32
		}
	}
	return string(out)
}

func TestTransportClassifiesCallsWithoutRecordingTheRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/denied":
			w.WriteHeader(http.StatusForbidden)
		case "/limited":
			w.WriteHeader(http.StatusTooManyRequests)
		case "/broken":
			w.WriteHeader(http.StatusBadGateway)
		}
	}))
	defer server.Close()
	client := &http.Client{Transport: Transport(nil)}
	for _, path := range []string{"/api/v1/namespaces/secret-ns/pods/secret-pod", "/denied", "/limited", "/broken"} {
		resp, err := client.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
	}
	for want, attrs := range map[string]map[string]string{
		"ok": {"operation": "read", "outcome": "ok"}, "client_error": {"operation": "read", "outcome": "client_error"},
		"throttled": {"operation": "read", "outcome": "throttled"}, "server_error": {"operation": "read", "outcome": "server_error"},
	} {
		if p := point(t, "omniview.plugin.self.api.calls", attrs); p == nil || p.Value < 1 {
			t.Errorf("%s not counted", want)
		}
	}
	if _, err := (&http.Client{Transport: Transport(nil)}).Get("http://127.0.0.1:1/"); err == nil {
		t.Fatal("expected dial failure")
	}
	if point(t, "omniview.plugin.self.api.calls", map[string]string{"operation": "read", "outcome": "failed"}) == nil {
		t.Error("transport failure not counted")
	}
	// Whatever was requested must not appear in any value.
	metrics, truncated := sdkdiag.Default().Snapshot()
	if truncated {
		t.Error("instruments dropped observations")
	}
	for _, m := range metrics {
		for _, p := range m.Points {
			for _, a := range p.Attrs {
				if a.Value == "secret-ns" || a.Value == "secret-pod" {
					t.Fatalf("request detail leaked: %v", a)
				}
			}
		}
	}
}

func TestWatchStreamGaugeFollowsOpenStreams(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		<-release
	}))
	defer server.Close()
	defer close(release)
	client := &http.Client{Transport: Transport(nil)}
	open := func() io.Closer {
		resp, err := client.Get(server.URL + "/api/v1/pods?watch=true")
		if err != nil {
			t.Fatal(err)
		}
		return resp.Body
	}
	value := func() float64 {
		p := point(t, "omniview.plugin.self.watch.streams", map[string]string{"state": "open"})
		if p == nil {
			t.Fatal("gauge absent")
		}
		return p.Value
	}
	a, b := open(), open()
	if value() != 2 {
		t.Fatalf("open = %v", value())
	}
	a.Close()
	a.Close() // closing twice must not double-decrement
	if value() != 1 {
		t.Fatalf("after close = %v", value())
	}
	b.Close()
	if value() != 0 {
		t.Fatalf("after all closed = %v", value())
	}
	if point(t, "omniview.plugin.self.api.calls", map[string]string{"operation": "watch", "outcome": "ok"}) == nil {
		t.Error("watch call not counted")
	}
}

func TestConnectionStatesAreClosedVocabulary(t *testing.T) {
	ConnectionChecked("CONNECTED")
	ConnectionChecked("some arbitrary error: pods/default/secret")
	if point(t, "omniview.plugin.self.connection.checks", map[string]string{"state": "connected"}) == nil ||
		point(t, "omniview.plugin.self.connection.checks", map[string]string{"state": "unknown"}) == nil {
		t.Fatal("states not recorded")
	}
}
