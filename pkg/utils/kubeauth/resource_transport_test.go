package kubeauth

import (
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestResourceConstructorPreservesAuth(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer boundary-secret" {
			http.Error(w, "missing authentication", 401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"apiVersion":"v1","kind":"Pod","metadata":{"name":"one","namespace":"ns"}}`)
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "config")
	config := fmt.Sprintf("apiVersion: v1\nkind: Config\nclusters:\n- name: test\n  cluster:\n    server: %s\n    insecure-skip-tls-verify: true\nusers:\n- name: test\n  user:\n    token: boundary-secret\ncontexts:\n- name: test\n  context:\n    cluster: test\n    user: test\ncurrent-context: test\n", server.URL)
	if err := os.WriteFile(path, []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	clients, err := LoadResourceKubeClients(context.Background(), path, "test")
	if err != nil {
		t.Fatal(err)
	}
	pod, err := clients.Dynamic.Resource(schema.GroupVersionResource{Version: "v1", Resource: "pods"}).Namespace("ns").Get(context.Background(), "one", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if pod.GetName() != "one" {
		t.Fatal("unexpected pod")
	}
}

func TestResourceFiniteHTTPBoundary(t *testing.T) {
	for _, mode := range []string{"plain", "gzip", "oversize", "gzip-oversize", "truncated"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if mode == "truncated" {
					w.Header().Set("Content-Length", "100")
					io.WriteString(w, "short")
					return
				}
				var out io.Writer = w
				if strings.HasPrefix(mode, "gzip") {
					w.Header().Set("Content-Encoding", "gzip")
					gz := gzip.NewWriter(w)
					defer gz.Close()
					out = gz
				}
				if strings.Contains(mode, "oversize") {
					io.CopyN(out, endlessResourceBytes{}, ResourceResponseLimit+1)
					return
				}
				io.WriteString(out, "finite")
			}))
			defer server.Close()
			req, err := http.NewRequestWithContext(context.Background(), "GET", server.URL, nil)
			if err != nil {
				t.Fatal(err)
			}
			// Explicit encoding exercises our decoder, not net/http's decoder.
			req.Header.Set("Accept-Encoding", "gzip")
			response, err := (&resourceResponseTransport{base: http.DefaultTransport}).RoundTrip(req)
			if strings.Contains(mode, "oversize") {
				if resourcev2.ErrorCode(err) != "RESOURCE_LIMIT" {
					t.Fatalf("expected resource limit, got %v", err)
				}
				return
			}
			if mode == "truncated" {
				if !errors.Is(err, io.ErrUnexpectedEOF) {
					t.Fatalf("expected unexpected EOF, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil || string(body) != "finite" {
				t.Fatalf("body %q, error %v", body, err)
			}
		})
	}
}

type endlessResourceBytes struct{}

func (endlessResourceBytes) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 'x'
	}
	return len(p), nil
}

func TestResourceHTTPContextCancellation(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	go func() { <-started; cancel() }()
	_, err = (&resourceResponseTransport{base: http.DefaultTransport}).RoundTrip(req)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}

func TestResourceWatchFrameBoundary(t *testing.T) {
	for _, mode := range []string{"many", "oversize", "gzip-oversize", "truncated", "unsupported"} {
		t.Run(mode, func(t *testing.T) {
			frame := `{"type":"ADDED","object":{"quoted":"brace } and quote \" and slash \\","data":"` + strings.Repeat("x", 65536) + `"}}`
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if mode == "unsupported" {
					w.Header().Set("Content-Type", "application/vnd.kubernetes.protobuf")
					return
				}
				var out io.Writer = w
				if mode == "gzip-oversize" {
					w.Header().Set("Content-Encoding", "gzip")
					gz := gzip.NewWriter(w)
					defer gz.Close()
					out = gz
				}
				if mode == "many" {
					for range 513 {
						if _, err := io.WriteString(out, frame+"\n"); err != nil {
							return
						}
					}
					return
				}
				io.WriteString(out, `{"type":"ADDED","object":{"data":"`)
				if mode == "truncated" {
					return
				}
				io.CopyN(out, endlessResourceBytes{}, ResourceResponseLimit+1)
				io.WriteString(out, `"}}`)
			}))
			defer server.Close()
			req, err := http.NewRequest("GET", server.URL+"?watch=true", nil)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Accept-Encoding", "gzip")
			response, err := (&resourceResponseTransport{base: http.DefaultTransport}).RoundTrip(req)
			if mode == "unsupported" {
				if err == nil {
					response.Body.Close()
					t.Fatal("unsupported framing accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			// Odd-sized reads exercise frame and string state across arbitrary chunks.
			n, err := io.CopyBuffer(struct{ io.Writer }{io.Discard}, response.Body, make([]byte, 4093))
			switch mode {
			case "many":
				want := int64((len(frame) + 1) * 513)
				if err != nil || n != want || n <= ResourceResponseLimit {
					t.Fatalf("watch bytes %d/%d, error %v", n, want, err)
				}
			case "truncated":
				if !errors.Is(err, io.ErrUnexpectedEOF) {
					t.Fatalf("expected truncated frame, got %v", err)
				}
			default:
				if resourcev2.ErrorCode(err) != "RESOURCE_LIMIT" || n > ResourceResponseLimit {
					t.Fatalf("unbounded frame bytes %d, error %v", n, err)
				}
			}
		})
	}
}

func TestResourceWatchCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"type":"ADDED","object":`)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", server.URL+"?watch=true", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := (&resourceResponseTransport{base: http.DefaultTransport}).RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	cancel()
	_, err = io.ReadAll(response.Body)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected watch cancellation, got %v", err)
	}
}

// Discovery uses context.TODO internally. The slot lifetime passed at actual
// construction must therefore cancel its network request independently of any
// per-operation caller context, and fence later requests on the retired bundle.
func TestResourceClientLifetimeCancelsDiscoveryAndFencesFutureHTTP(t *testing.T) {
	lifetime, cancel := context.WithCancel(context.Background())
	entered := make(chan struct{}, 1)
	serverCanceled := make(chan struct{}, 1)
	var requests atomic.Int64
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Header.Get("Authorization") != "Bearer lifetime-secret" {
			http.Error(w, "authentication required", http.StatusUnauthorized)
			return
		}
		if r.URL.Path == "/api" || r.URL.Path == "/apis" {
			select {
			case entered <- struct{}{}:
			default:
			}
			<-r.Context().Done()
			select {
			case serverCanceled <- struct{}{}:
			default:
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"apiVersion":"v1","kind":"Pod","metadata":{"name":"one","namespace":"ns"}}`)
	}))
	t.Cleanup(server.Close)
	t.Cleanup(cancel)
	path := filepath.Join(t.TempDir(), "config")
	config := fmt.Sprintf("apiVersion: v1\nkind: Config\nclusters:\n- name: lifetime\n  cluster:\n    server: %s\n    insecure-skip-tls-verify: true\nusers:\n- name: lifetime\n  user:\n    token: lifetime-secret\ncontexts:\n- name: lifetime\n  context:\n    cluster: lifetime\n    user: lifetime\ncurrent-context: lifetime\n", server.URL)
	if err := os.WriteFile(path, []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	clients, err := LoadResourceKubeClients(lifetime, path, "lifetime")
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() { _, err := clients.Discovery.ServerGroups(); finished <- err }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("authenticated discovery request did not enter owned server")
	}
	cancel()
	select {
	case err := <-finished:
		if err == nil {
			t.Fatal("discovery succeeded after its connection lifetime was canceled")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("connection cancellation did not abort discovery's internal TODO request")
	}
	select {
	case <-serverCanceled:
	case <-time.After(5 * time.Second):
		t.Fatal("owned API server did not observe discovery request cancellation")
	}
	before := requests.Load()
	requestCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	_, err = clients.Dynamic.Resource(schema.GroupVersionResource{Version: "v1", Resource: "pods"}).Namespace("ns").Get(requestCtx, "one", metav1.GetOptions{})
	if err == nil {
		t.Fatal("retired resource bundle accepted a later dynamic request")
	}
	if requestCtx.Err() != nil {
		t.Fatal("later request waited for its own deadline instead of honoring retired lifetime")
	}
	if got := requests.Load(); got != before {
		t.Fatalf("retired bundle issued later HTTP: requests %d -> %d", before, got)
	}
}
