// Package diag holds the small, fixed set of in-plugin measurements this
// plugin reports to the host through plugin-sdk diagnostics. Every attribute
// value comes from a closed vocabulary defined here; never add cluster names,
// namespaces, resource names, paths, queries or error text.
package diag

import (
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	sdkdiag "github.com/omniviewdev/plugin-sdk/pkg/diagnostics"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

var (
	apiCalls, _     = sdkdiag.Default().Counter("omniview.plugin.self.api.calls", "1")
	apiDuration, _  = sdkdiag.Default().Histogram("omniview.plugin.self.api.duration", "s", []float64{0.01, 0.05, 0.1, 0.5, 1, 5, 30})
	watchStreams, _ = sdkdiag.Default().Gauge("omniview.plugin.self.watch.streams", "1")
	connChecks, _   = sdkdiag.Default().Counter("omniview.plugin.self.connection.checks", "1")
	forwards, _     = sdkdiag.Default().Counter("omniview.plugin.self.portforward.sessions", "1")

	openWatches atomic.Int64
)

func attr(key sdkdiag.Key, value string) sdkdiag.Attr { return sdkdiag.Attr{Key: key, Value: value} }

// Transport counts Kubernetes API calls by operation class and outcome class
// and tracks open watch streams. It never inspects URLs beyond the method and
// the watch flag, and records nothing about what was requested.
func Transport(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return &transport{base: base}
}

type transport struct{ base http.RoundTripper }

func operation(req *http.Request) string {
	if req.Method == http.MethodGet && req.URL != nil {
		if watch := req.URL.Query().Get("watch"); watch == "true" || watch == "1" {
			return "watch"
		}
	}
	switch req.Method {
	case http.MethodGet, http.MethodHead:
		return "read"
	case http.MethodPost, http.MethodPut, http.MethodPatch:
		return "write"
	case http.MethodDelete:
		return "delete"
	}
	return "other"
}

func outcome(status int, err error) string {
	switch {
	case err != nil:
		return "failed"
	case status == http.StatusTooManyRequests:
		return "throttled"
	case status >= 500:
		return "server_error"
	case status >= 400:
		return "client_error"
	}
	return "ok"
}

func (t *transport) RoundTrip(req *http.Request) (*http.Response, error) {
	op := operation(req)
	start := time.Now()
	resp, err := t.base.RoundTrip(req)
	status := 0
	if resp != nil {
		status = resp.StatusCode
	}
	result := outcome(status, err)
	apiCalls.Add(1, attr(sdkdiag.KeyOperation, op), attr(sdkdiag.KeyOutcome, result))
	if op != "watch" { // a watch lasts as long as it is open, which says nothing about latency
		apiDuration.Observe(time.Since(start).Seconds(), attr(sdkdiag.KeyOperation, op))
	}
	if op == "watch" && err == nil && resp != nil && resp.Body != nil {
		watchStreams.Set(float64(openWatches.Add(1)), attr(sdkdiag.KeyState, "open"))
		resp.Body = &watchBody{ReadCloser: resp.Body}
	}
	return resp, err
}

type watchBody struct {
	io.ReadCloser
	closed atomic.Bool
}

func (b *watchBody) Close() error {
	if b.closed.CompareAndSwap(false, true) {
		watchStreams.Set(float64(openWatches.Add(-1)), attr(sdkdiag.KeyState, "open"))
	}
	return b.ReadCloser.Close()
}

// ConnectionChecked records the state a connection check resolved to. Anything
// outside the known set is reported as "unknown", never as free text.
func ConnectionChecked(code types.ConnectionStatusCode) {
	state := strings.ToLower(string(code))
	switch state {
	case "connected", "unauthorized", "forbidden", "not_found", "error", "timeout", "unavailable", "failed":
	default:
		state = "unknown"
	}
	connChecks.Add(1, attr(sdkdiag.KeyState, state))
}

// PortForward records a port-forward session transition: started, failed or ended.
func PortForward(state string) { forwards.Add(1, attr(sdkdiag.KeyState, state)) }
