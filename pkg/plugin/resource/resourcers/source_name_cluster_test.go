package resourcers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/tools/clientcmd"
)

// The proof that a source narrowed to one object asks a REAL API server for that one object, and what it costs next to reading its namespace.
//
// It runs only where OMNIVIEW_PROOF_KUBECONFIG names a cluster (a kind cluster, never one that matters) whose namespace OMNIVIEW_PROOF_NAMESPACE (default "bulk")
// holds many Pods, and it needs OMNIVIEW_PROOF_POD, the name of one of them. Every request the plugin's client makes goes through a counting transport, so the
// numbers are the ones on the wire: the requests and their field selectors, and the bytes of their answers (compression off, so a byte of a body is a byte sent).
// It writes one throwaway Pod to the namespace (a Pending one, which no node takes) to watch an object being deleted, and removes it.

type wireRecord struct {
	method, path, fieldSelector, query string
	bytes                              *atomic.Int64
}

type wireCounter struct {
	mu      sync.Mutex
	records []wireRecord
}

func (c *wireCounter) wrap(inner http.RoundTripper) http.RoundTripper {
	return roundTripFunc(func(request *http.Request) (*http.Response, error) {
		response, err := inner.RoundTrip(request)
		if err != nil {
			return response, err
		}
		record := wireRecord{method: request.Method, path: request.URL.Path, fieldSelector: request.URL.Query().Get("fieldSelector"), query: request.URL.Query().Encode(), bytes: &atomic.Int64{}}
		if request.URL.Query().Get("watch") == "true" || request.URL.Query().Get("watch") == "1" {
			record.method = "WATCH"
		} else if request.Method == http.MethodGet && !strings.HasSuffix(strings.TrimSuffix(request.URL.Path, "/"), "/version") {
			record.method = "LIST"
		}
		c.mu.Lock()
		c.records = append(c.records, record)
		c.mu.Unlock()
		response.Body = &countedBody{ReadCloser: response.Body, bytes: record.bytes}
		return response, nil
	})
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

type countedBody struct {
	io.ReadCloser
	bytes *atomic.Int64
}

func (b *countedBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	b.bytes.Add(int64(n))
	return n, err
}

// about returns what the plugin asked of the Pods endpoints of one namespace, since mark.
func (c *wireCounter) about(namespace string, since int) (requests []string, bytes int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, record := range c.records[since:] {
		if !strings.Contains(record.path, "/namespaces/"+namespace+"/pods") {
			continue
		}
		selector := record.fieldSelector
		if selector == "" {
			selector = "(none)"
		}
		requests = append(requests, fmt.Sprintf("%s %s fieldSelector=%s (query: %s)", record.method, record.path, selector, record.query))
		bytes += record.bytes.Load()
	}
	return requests, bytes
}

func (c *wireCounter) mark() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.records)
}

func TestSourceNarrowedToAnObjectOnARealCluster(t *testing.T) {
	kubeconfig := os.Getenv("OMNIVIEW_PROOF_KUBECONFIG")
	if kubeconfig == "" {
		t.Skip("OMNIVIEW_PROOF_KUBECONFIG names no cluster")
	}
	namespace := os.Getenv("OMNIVIEW_PROOF_NAMESPACE")
	if namespace == "" {
		namespace = "bulk"
	}
	podName := os.Getenv("OMNIVIEW_PROOF_POD")
	require.NotEmpty(t, podName, "OMNIVIEW_PROOF_POD names one Pod of the namespace")

	counter := &wireCounter{}
	config, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
	require.NoError(t, err)
	config.QPS, config.Burst, config.DisableCompression = -1, 0, true
	config.Wrap(counter.wrap)
	native, err := dynamic.NewForConfig(config)
	require.NoError(t, err)
	cs := &clients.ClientSet{DynamicClient: native, RESTConfig: config}
	t.Cleanup(cs.ShutdownInformers)
	base := NewKubernetesResourcerBase[MetaAccessor](zap.NewNop().Sugar(), testGVR)
	pods := native.Resource(testGVR).Namespace(namespace)

	everything, err := pods.List(context.Background(), metav1.ListOptions{})
	require.NoError(t, err)
	t.Logf("cluster: namespace %q holds %d Pods; the proof reads %q", namespace, len(everything.Items), podName)
	require.Greater(t, len(everything.Items), 100, "the proof needs a namespace of many Pods")

	type measured struct {
		scope    string
		snapshot int
		held     int
		requests []string
		bytes    int64
	}
	read := func(label string, names *[]string) (measured, openedSource) {
		before := counter.mark()
		opened := openSource(t, base, cs, selection(oneOf(namespace), names))
		// the informer's own cache: what the plugin's process holds of the namespace for this source
		var objectName []clients.InformerOption
		if names != nil {
			objectName = append(objectName, clients.ObjectName((*names)[0]))
		}
		lease, err := cs.AcquireInformer(context.Background(), namespace, testGVR, cache.ResourceEventHandlerFuncs{}, objectName...)
		require.NoError(t, err)
		t.Cleanup(func() { _ = lease.Close() })
		time.Sleep(500 * time.Millisecond)
		requests, bytes := counter.about(namespace, before)
		return measured{scope: label, snapshot: len(opened.snapshot), held: len(lease.Informer.GetStore().List()), requests: requests, bytes: bytes}, opened
	}

	whole, _ := read("namespace (before: what the page asked for)", nil)
	narrow, narrowSource := read("name (after: the Pod alone)", oneOf(podName))

	for _, m := range []measured{whole, narrow} {
		t.Logf("%-44s snapshot records %4d · objects the plugin holds %4d · API requests %d · bytes answered %9d", m.scope, m.snapshot, m.held, len(m.requests), m.bytes)
		for _, request := range m.requests {
			t.Logf("    %s", request)
		}
	}

	require.Equal(t, len(everything.Items), whole.snapshot, "the namespace read holds every Pod")
	require.Equal(t, 1, narrow.snapshot, "the narrowed read holds exactly the Pod")
	require.Equal(t, 1, narrow.held, "and so does the plugin: the informer's cache holds that object, not the namespace")
	require.Equal(t, []string{namespace + "/" + podName}, narrowSource.names())
	require.NotEmpty(t, narrow.requests)
	wantSelector, err := clients.NameSelector(podName)
	require.NoError(t, err)
	for _, request := range narrow.requests {
		require.Contains(t, request, "fieldSelector="+wantSelector, "every request the narrowed source made asked the server for the one Pod")
		require.NotContains(t, request, "fieldSelector=(none)")
	}
	require.Less(t, narrow.bytes*20, whole.bytes, "the narrowed source's answers are a small fraction of the namespace's")

	// live, on the real server: the Pod's change arrives, another Pod's does not, and a deletion is signalled
	annotate := func(name, value string) {
		patch := fmt.Sprintf(`{"metadata":{"annotations":{"d1c-proof":%q}}}`, value)
		_, err := pods.Patch(context.Background(), name, types.MergePatchType, []byte(patch), metav1.PatchOptions{})
		require.NoError(t, err)
	}
	other := ""
	for _, item := range everything.Items {
		if item.GetName() != podName {
			other = item.GetName()
			break
		}
	}
	annotate(other, "not-this-source")
	annotate(podName, "this-source")
	event := nextSourceTestEvent(t, narrowSource.emitter)
	require.Len(t, event.changes, 1)
	require.Equal(t, resource.SourceChangeUpsert, event.changes[0].Kind)
	require.Equal(t, podName, event.changes[0].Observation.Record.Reference.Address.ID, "the first event of the narrowed source is its own Pod's change, not the other Pod's")
	t.Cleanup(func() {
		for _, name := range []string{other, podName} {
			_, _ = pods.Patch(context.Background(), name, types.MergePatchType, []byte(`{"metadata":{"annotations":{"d1c-proof":null}}}`), metav1.PatchOptions{})
		}
	})

	victim := "d1c-proof-victim"
	pod := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1", "kind": "Pod",
		"metadata": map[string]any{"name": victim, "namespace": namespace},
		"spec": map[string]any{
			"nodeSelector": map[string]any{"d1c/none": "true"},
			"containers":   []any{map[string]any{"name": "app", "image": "registry.k8s.io/pause:3.10"}},
		},
	}}
	_, err = pods.Create(context.Background(), pod, metav1.CreateOptions{})
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = pods.Delete(context.Background(), victim, metav1.DeleteOptions{GracePeriodSeconds: new(int64)})
	})
	deleted := openSource(t, base, cs, selection(oneOf(namespace), oneOf(victim)))
	require.Equal(t, []string{namespace + "/" + victim}, deleted.names())
	require.NoError(t, pods.Delete(context.Background(), victim, metav1.DeleteOptions{GracePeriodSeconds: new(int64)}))
	for {
		removal := nextSourceTestEvent(t, deleted.emitter)
		for _, change := range removal.changes {
			if change.Kind == resource.SourceChangeRemove {
				require.Equal(t, victim, change.Reference.Address.ID, "the deletion of the object is signalled")
				return
			}
		}
	}
}
