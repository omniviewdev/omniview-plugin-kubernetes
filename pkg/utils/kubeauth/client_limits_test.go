package kubeauth

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/pluginid"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	utilnet "k8s.io/apimachinery/pkg/util/net"
	"k8s.io/client-go/util/flowcontrol"
)

// countingLimiter never blocks and records every token request.
type countingLimiter struct {
	waits atomic.Int64
}

func (l *countingLimiter) TryAccept() bool            { l.waits.Add(1); return true }
func (l *countingLimiter) Accept()                    { l.waits.Add(1) }
func (l *countingLimiter) Wait(context.Context) error { l.waits.Add(1); return nil }
func (l *countingLimiter) Stop()                      {}
func (l *countingLimiter) QPS() float32               { return 0 }

func useCountingLimiter(t *testing.T) (*countingLimiter, *int) {
	t.Helper()
	limiter := &countingLimiter{}
	built := new(int)
	previous := newConnectionRateLimiter
	newConnectionRateLimiter = func() flowcontrol.RateLimiter { *built++; return limiter }
	t.Cleanup(func() { newConnectionRateLimiter = previous })
	return limiter, built
}

type userAgentLog struct {
	mu     sync.Mutex
	agents map[string]string
}

func (l *userAgentLog) record(path, agent string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.agents[path] = agent
}

func (l *userAgentLog) get(path string) string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.agents[path]
}

func writeLimitKubeconfig(t *testing.T) (string, *userAgentLog) {
	t.Helper()
	log := &userAgentLog{agents: map[string]string{}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.record(r.URL.Path, r.Header.Get("User-Agent"))
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/api/v1/namespaces/ns/pods/") {
			io.WriteString(w, `{"apiVersion":"v1","kind":"Pod","metadata":{"name":"one","namespace":"ns"}}`)
			return
		}
		io.WriteString(w, `{}`)
	}))
	t.Cleanup(server.Close)
	path := filepath.Join(t.TempDir(), "config")
	config := fmt.Sprintf("apiVersion: v1\nkind: Config\nclusters:\n- name: limits\n  cluster:\n    server: %s\nusers:\n- name: limits\n  user:\n    token: limits-secret\ncontexts:\n- name: limits\n  context:\n    cluster: limits\n    user: limits\ncurrent-context: limits\n", server.URL)
	if err := os.WriteFile(path, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	return path, log
}

var podsGVR = schema.GroupVersionResource{Version: "v1", Resource: "pods"}

func wantUserAgent() string { return userAgent() }

func TestUserAgentNamesPlugin(t *testing.T) {
	ua := userAgent()
	if !strings.HasPrefix(ua, "omniview-"+pluginid.ID+"/"+pluginid.Version+" ") {
		t.Fatalf("user agent %q does not identify plugin and version", ua)
	}
	if strings.HasPrefix(ua, "plugin/") {
		t.Fatalf("user agent %q is the binary default", ua)
	}
}

func TestResourceBundleClientsShareOneRateLimiterAndUserAgent(t *testing.T) {
	limiter, built := useCountingLimiter(t)
	path, log := writeLimitKubeconfig(t)
	clients, err := LoadResourceKubeClients(context.Background(), path, "limits")
	if err != nil {
		t.Fatal(err)
	}
	if *built != 1 {
		t.Fatalf("bundle built %d limiters, want 1", *built)
	}
	if clients.RestConfig.RateLimiter != flowcontrol.RateLimiter(limiter) {
		t.Fatal("bundle RestConfig does not carry the shared limiter")
	}
	ctx := context.Background()
	calls := []struct {
		name string
		path string
		do   func() error
	}{
		{"clientset", "/api/v1/namespaces/ns/pods/one", func() error {
			_, err := clients.Clientset.CoreV1().Pods("ns").Get(ctx, "one", metav1.GetOptions{})
			return err
		}},
		{"streaming", "/api/v1/namespaces/ns/pods/streaming", func() error {
			_, err := clients.StreamingClientset.CoreV1().Pods("ns").Get(ctx, "streaming", metav1.GetOptions{})
			return err
		}},
		{"dynamic", "/api/v1/namespaces/ns/pods/dynamic", func() error {
			_, err := clients.Dynamic.Resource(podsGVR).Namespace("ns").Get(ctx, "dynamic", metav1.GetOptions{})
			return err
		}},
		{"discovery", "/version", func() error {
			return clients.Discovery.RESTClient().Get().AbsPath("/version").Do(ctx).Error()
		}},
	}
	for i, call := range calls {
		if err := call.do(); err != nil {
			t.Fatalf("%s: %v", call.name, err)
		}
		if got := limiter.waits.Load(); got != int64(i+1) {
			t.Fatalf("after %s the shared limiter saw %d requests, want %d", call.name, got, i+1)
		}
		if got := log.get(call.path); got != wantUserAgent() {
			t.Fatalf("%s user agent = %q, want %q", call.name, got, wantUserAgent())
		}
	}
}

func TestKubeClientBundleClientsShareOneRateLimiterAndUserAgent(t *testing.T) {
	limiter, built := useCountingLimiter(t)
	path, log := writeLimitKubeconfig(t)
	clients, err := LoadKubeClients(context.Background(), path, "limits")
	if err != nil {
		t.Fatal(err)
	}
	if *built != 1 {
		t.Fatalf("bundle built %d limiters, want 1", *built)
	}
	if clients.RestConfig.RateLimiter != flowcontrol.RateLimiter(limiter) {
		t.Fatal("bundle RestConfig does not carry the shared limiter")
	}
	ctx := context.Background()
	calls := []struct {
		name string
		path string
		do   func() error
	}{
		{"clientset", "/api/v1/namespaces/ns/pods/one", func() error {
			_, err := clients.Clientset.CoreV1().Pods("ns").Get(ctx, "one", metav1.GetOptions{})
			return err
		}},
		{"dynamic", "/api/v1/namespaces/ns/pods/dynamic", func() error {
			_, err := clients.Dynamic.Resource(podsGVR).Namespace("ns").Get(ctx, "dynamic", metav1.GetOptions{})
			return err
		}},
		{"discovery", "/version", func() error {
			return clients.Discovery.RESTClient().Get().AbsPath("/version").Do(ctx).Error()
		}},
	}
	for i, call := range calls {
		if err := call.do(); err != nil {
			t.Fatalf("%s: %v", call.name, err)
		}
		if got := limiter.waits.Load(); got != int64(i+1) {
			t.Fatalf("after %s the shared limiter saw %d requests, want %d", call.name, got, i+1)
		}
		if got := log.get(call.path); got != wantUserAgent() {
			t.Fatalf("%s user agent = %q, want %q", call.name, got, wantUserAgent())
		}
	}
}

func TestDefaultConnectionLimiterIsSharedTokenBucket(t *testing.T) {
	limiter := newConnectionRateLimiter()
	if limiter.QPS() != ConnectionQPS {
		t.Fatalf("limiter QPS = %v, want %v", limiter.QPS(), ConnectionQPS)
	}
}

func TestUserAgentTransportKeepsExistingHeader(t *testing.T) {
	var seen []string
	base := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		seen = append(seen, r.Header.Get("User-Agent"))
		return &http.Response{StatusCode: 200, Body: http.NoBody, Header: http.Header{}}, nil
	})
	transport := &userAgentTransport{base: base}
	plain, _ := http.NewRequest("GET", "http://example.invalid/", nil)
	if _, err := transport.RoundTrip(plain); err != nil {
		t.Fatal(err)
	}
	if plain.Header.Get("User-Agent") != "" {
		t.Fatal("transport mutated the caller's request")
	}
	custom, _ := http.NewRequest("GET", "http://example.invalid/", nil)
	custom.Header.Set("User-Agent", "custom/1")
	if _, err := transport.RoundTrip(custom); err != nil {
		t.Fatal(err)
	}
	if seen[0] != userAgent() || seen[1] != "custom/1" {
		t.Fatalf("user agents = %q", seen)
	}
}

func TestFiniteVerbsGetRequestCeilingAndWatchesDoNot(t *testing.T) {
	type observed struct {
		deadline bool
		remains  time.Duration
	}
	cases := []struct {
		name         string
		method, url  string
		wantDeadline bool
	}{
		{"list", "GET", "http://example.invalid/api/v1/pods", true},
		{"get", "GET", "http://example.invalid/api/v1/namespaces/ns/pods/one", true},
		{"create", "POST", "http://example.invalid/api/v1/namespaces/ns/pods", true},
		{"update", "PUT", "http://example.invalid/api/v1/namespaces/ns/pods/one", true},
		{"patch", "PATCH", "http://example.invalid/api/v1/namespaces/ns/pods/one", true},
		{"delete", "DELETE", "http://example.invalid/api/v1/namespaces/ns/pods/one", true},
		{"watch true", "GET", "http://example.invalid/api/v1/pods?watch=true&resourceVersion=1", false},
		{"watch 1", "GET", "http://example.invalid/api/v1/pods?watch=1", false},
		{"list watch=false", "GET", "http://example.invalid/api/v1/pods?watch=false", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got observed
			base := roundTripFunc(func(r *http.Request) (*http.Response, error) {
				deadline, ok := r.Context().Deadline()
				got = observed{deadline: ok}
				if ok {
					got.remains = time.Until(deadline)
				}
				header := http.Header{"Content-Type": []string{"application/json"}}
				return &http.Response{StatusCode: 200, Header: header, Body: io.NopCloser(strings.NewReader(`{}`))}, nil
			})
			transport := &resourceResponseTransport{base: base, lifetime: context.Background(), finiteTimeout: ResourceRequestTimeout}
			req, _ := http.NewRequest(tc.method, tc.url, nil)
			response, err := transport.RoundTrip(req)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if got.deadline != tc.wantDeadline {
				t.Fatalf("deadline present = %v, want %v", got.deadline, tc.wantDeadline)
			}
			if tc.wantDeadline && (got.remains <= 0 || got.remains > ResourceRequestTimeout) {
				t.Fatalf("remaining budget %v outside (0, %v]", got.remains, ResourceRequestTimeout)
			}
		})
	}
}

func TestFiniteRequestCeilingAppliesWithoutLifetimeContext(t *testing.T) {
	var deadline bool
	base := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		_, deadline = r.Context().Deadline()
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{}`))}, nil
	})
	req, _ := http.NewRequest("GET", "http://example.invalid/api/v1/pods", nil)
	if _, err := (&resourceResponseTransport{base: base, finiteTimeout: ResourceRequestTimeout}).RoundTrip(req); err != nil {
		t.Fatal(err)
	}
	if !deadline {
		t.Fatal("finite request had no deadline")
	}
}

func TestHungFiniteRequestTimesOutAndWatchStaysOpen(t *testing.T) {
	watchOpen := make(chan struct{})
	watchEnded := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("watch") == "true" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(200)
			w.(http.Flusher).Flush()
			close(watchOpen)
			<-r.Context().Done()
			close(watchEnded)
			return
		}
		<-r.Context().Done()
	}))
	defer server.Close()
	transport := &resourceResponseTransport{base: http.DefaultTransport, lifetime: context.Background(), finiteTimeout: 50 * time.Millisecond}
	client := &http.Client{Transport: transport}

	watchReq, _ := http.NewRequest("GET", server.URL+"/api/v1/pods?watch=true", nil)
	watchCtx, stopWatch := context.WithCancel(context.Background())
	defer stopWatch()
	response, err := client.Do(watchReq.WithContext(watchCtx))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	<-watchOpen

	listReq, _ := http.NewRequest("GET", server.URL+"/api/v1/pods", nil)
	_, err = client.Do(listReq)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("hung LIST error = %v, want deadline exceeded", err)
	}
	// The list outlived the finite ceiling; the already-open watch must not have been cut.
	if err := watchCtx.Err(); err != nil {
		t.Fatalf("watch context ended: %v", err)
	}
	select {
	case <-watchEnded:
		t.Fatal("watch connection was closed by the finite-verb ceiling")
	default:
	}
}

type closeTrackingTransport struct{ closed atomic.Int64 }

func (c *closeTrackingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("unused")
}

func (c *closeTrackingTransport) CloseIdleConnections() { c.closed.Add(1) }

func TestUserAgentTransportClosesIdleConnectionsOfWrappedTransport(t *testing.T) {
	fake := &closeTrackingTransport{}
	utilnet.CloseIdleConnectionsFor(&userAgentTransport{base: fake})
	if got := fake.closed.Load(); got != 1 {
		t.Fatalf("wrapped transport CloseIdleConnections calls = %d, want 1", got)
	}
	if (&userAgentTransport{}).WrappedRoundTripper() != http.DefaultTransport {
		t.Fatal("nil base must unwrap to http.DefaultTransport")
	}
}
