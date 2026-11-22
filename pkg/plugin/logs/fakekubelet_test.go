package logs

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// kubeletTimeFormat is the timestamp the kubelet puts before a line: always nine fractional
// digits, so that a line of a given text is always the same number of bytes.
const kubeletTimeFormat = "2006-01-02T15:04:05.000000000Z07:00"

// fakeKubelet serves the pods/log endpoint of an API server and the kubelet behind it, as far
// as the plugin's requests depend on it:
//
//   - a request is served from the log file that is current when it arrives, and an open
//     follow stream keeps the file it was opened on (a rotation between two requests is
//     visible to the second one only);
//   - tailLines selects the last lines of the file, then sinceTime / sinceSeconds drop the
//     lines older than the instant, then limitBytes cuts the bytes written (the timestamp
//     prefix counts) and ends the response, mid-line if it must, follow or not;
//   - follow=false ends the response at the end of the file and writes a last record that
//     has no line feed yet (the kubelet's "Incomplete line"); follow=true holds that record
//     back until it is complete, then keeps the response open for new lines;
//   - a container that has not started, a missing previous instance and a missing container
//     name are 400s, a refusal is a 403, a missing pod a 404, as the real ones read.
//
// Everything else of the real endpoint (authentication, the proxy hop, the runtime's log
// format) is out of scope: the plugin sees HTTP, as it does in production.
type fakeKubelet struct {
	t      *testing.T
	server *httptest.Server

	mu         sync.Mutex
	containers map[string]*fakeContainer // "namespace/pod/container"
	order      map[string][]string       // "namespace/pod" -> container names, in the order created
	requests   []fakeRequest
	onRequest  func(ordinal int, query url.Values) // runs when a request arrives, before it is served
	nowFn      func() time.Time                    // the kubelet's clock for sinceSeconds; nil: the last line stamped
	clock      time.Time
}

// fakeRequest is one request the kubelet received.
type fakeRequest struct {
	Ordinal   int
	Pod       string
	Container string
	Query     url.Values
}

type fakeContainer struct {
	current  *fakeLog
	previous *fakeLog // nil: the container has no previous instance

	// status, when set, answers every request for the container with it.
	status int
	// waiting, when set, is the reason the container has not started.
	waiting string
	// serve, when set, answers every request for the container itself.
	serve func(w http.ResponseWriter, r *http.Request)
}

func newFakeKubelet(t *testing.T) *fakeKubelet {
	t.Helper()
	k := &fakeKubelet{
		t:          t,
		containers: make(map[string]*fakeContainer),
		order:      make(map[string][]string),
		clock:      time.Date(2026, 11, 22, 10, 0, 0, 0, time.UTC),
	}
	k.server = httptest.NewServer(http.HandlerFunc(k.serveHTTP))
	t.Cleanup(k.server.Close)
	return k
}

// client is a clientset that talks to the fake, as the plugin's does to a cluster.
func (k *fakeKubelet) client() *kubernetes.Clientset {
	k.t.Helper()
	client, err := kubernetes.NewForConfig(&rest.Config{Host: k.server.URL, QPS: -1})
	require.NoError(k.t, err)
	return client
}

// container returns the container of a pod, creating it (with an empty log) on first use.
func (k *fakeKubelet) container(namespace, pod, name string) *fakeContainer {
	k.mu.Lock()
	defer k.mu.Unlock()
	key := namespace + "/" + pod + "/" + name
	c, ok := k.containers[key]
	if !ok {
		c = &fakeContainer{current: newFakeLog()}
		k.containers[key] = c
		k.order[namespace+"/"+pod] = append(k.order[namespace+"/"+pod], name)
	}
	return c
}

// stamp returns the next timestamp of the kubelet's clock: one millisecond per line, so lines
// are in order and no two share an instant.
func (k *fakeKubelet) stamp() time.Time {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.clock = k.clock.Add(time.Millisecond)
	return k.clock
}

// write appends complete lines to the container's current log.
func (k *fakeKubelet) write(c *fakeContainer, texts ...string) {
	for _, text := range texts {
		c.current.append(fakeLine{at: k.stamp(), text: text})
	}
}

// writeNumbered appends n lines "<prefix> 000001" and so on, and returns their texts.
func (k *fakeKubelet) writeNumbered(c *fakeContainer, prefix string, from, n int) []string {
	texts := make([]string, 0, n)
	for i := range n {
		texts = append(texts, fmt.Sprintf("%s %06d", prefix, from+i))
	}
	k.write(c, texts...)
	return texts
}

// rotate makes a new, empty file the container's current log. A stream that is open keeps the
// old one.
func (k *fakeKubelet) rotate(c *fakeContainer) {
	k.mu.Lock()
	defer k.mu.Unlock()
	c.current = newFakeLog()
}

// Requests returns the requests received so far.
func (k *fakeKubelet) Requests() []fakeRequest {
	k.mu.Lock()
	defer k.mu.Unlock()
	out := make([]fakeRequest, len(k.requests))
	copy(out, k.requests)
	return out
}

// Reads returns the requests received for a container, in order.
func (k *fakeKubelet) Reads(container string) []fakeRequest {
	var out []fakeRequest
	for _, r := range k.Requests() {
		if r.Container == container {
			out = append(out, r)
		}
	}
	return out
}

// serverNow is the instant a request is served at: what sinceSeconds counts back from.
func (k *fakeKubelet) serverNow() time.Time {
	k.mu.Lock()
	fn, last := k.nowFn, k.clock
	k.mu.Unlock()
	if fn != nil {
		return fn()
	}
	return last
}

func (k *fakeKubelet) setNow(fn func() time.Time) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.nowFn = fn
}

func (k *fakeKubelet) setOnRequest(fn func(ordinal int, query url.Values)) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.onRequest = fn
}

func (k *fakeKubelet) serveHTTP(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 7 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "namespaces" || parts[4] != "pods" || parts[6] != "log" {
		fakeStatus(w, http.StatusForbidden, "Forbidden", "the fake kubelet serves only pods/log")
		return
	}
	namespace, pod := parts[3], parts[5]
	query := r.URL.Query()

	k.mu.Lock()
	ordinal := len(k.requests) + 1
	k.requests = append(k.requests, fakeRequest{Ordinal: ordinal, Pod: pod, Container: query.Get("container"), Query: query})
	hook := k.onRequest
	names := k.order[namespace+"/"+pod]
	k.mu.Unlock()
	if hook != nil {
		hook(ordinal, query)
	}

	if len(names) == 0 {
		fakeStatus(w, http.StatusNotFound, "NotFound", fmt.Sprintf("pods %q not found", pod))
		return
	}
	name := query.Get("container")
	if name == "" {
		if len(names) != 1 {
			fakeStatus(w, http.StatusBadRequest, "BadRequest", fmt.Sprintf("a container name must be specified for pod %s, choose one of: %v", pod, names))
			return
		}
		name = names[0]
	}
	k.mu.Lock()
	c := k.containers[namespace+"/"+pod+"/"+name]
	var (
		current, previous *fakeLog
		status            int
		waiting           string
		serve             func(http.ResponseWriter, *http.Request)
	)
	if c != nil {
		current, previous, status, waiting, serve = c.current, c.previous, c.status, c.waiting, c.serve
	}
	k.mu.Unlock()
	switch {
	case c == nil:
		fakeStatus(w, http.StatusBadRequest, "BadRequest", fmt.Sprintf("container %s is not valid for pod %s", name, pod))
		return
	case serve != nil:
		serve(w, r)
		return
	case status != 0:
		fakeStatus(w, status, http.StatusText(status), "refused by the fake kubelet")
		return
	case waiting != "":
		fakeStatus(w, http.StatusBadRequest, "BadRequest", fmt.Sprintf("container %q in pod %q is waiting to start: %s", name, pod, waiting))
		return
	}
	follow := query.Get("follow") == "true"
	log := current
	if query.Get("previous") == "true" {
		if previous == nil {
			fakeStatus(w, http.StatusBadRequest, "BadRequest", fmt.Sprintf("previous terminated container %q in pod %q not found", name, pod))
			return
		}
		log = previous
		follow = false // an instance that has terminated has nothing to follow
	}
	serveLog(w, r, log, query, follow, k.serverNow())
}

// fakeStatus writes a Status the way the API server does, which client-go turns into a
// *StatusError.
func fakeStatus(w http.ResponseWriter, code int, reason, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = fmt.Fprintf(w, `{"kind":"Status","apiVersion":"v1","metadata":{},"status":"Failure","message":%q,"reason":%q,"code":%d}`, message, reason, code)
}

// serveLog answers a log request from one file: the window the request selects, then, for a
// follow, the lines that complete after it.
func serveLog(w http.ResponseWriter, r *http.Request, log *fakeLog, query url.Values, follow bool, now time.Time) {
	timestamps := query.Get("timestamps") == "true"
	limit := int64(-1)
	if v := query.Get("limitBytes"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 1 {
			fakeStatus(w, http.StatusBadRequest, "BadRequest", "limitBytes must be a positive integer")
			return
		}
		limit = n
	}
	var since time.Time
	switch {
	case query.Get("sinceTime") != "" && query.Get("sinceSeconds") != "":
		fakeStatus(w, http.StatusBadRequest, "BadRequest", "only one of sinceTime or sinceSeconds may be specified")
		return
	case query.Get("sinceTime") != "":
		at, err := time.Parse(time.RFC3339, query.Get("sinceTime"))
		if err != nil {
			fakeStatus(w, http.StatusBadRequest, "BadRequest", "sinceTime is not RFC 3339")
			return
		}
		since = at
	case query.Get("sinceSeconds") != "":
		seconds, err := strconv.ParseInt(query.Get("sinceSeconds"), 10, 64)
		if err != nil || seconds < 1 {
			fakeStatus(w, http.StatusBadRequest, "BadRequest", "sinceSeconds must be a positive integer")
			return
		}
		// The kubelet counts back from the instant it serves the request at: each request has its own.
		since = now.Add(-time.Duration(seconds) * time.Second)
	}
	tail := int64(-1)
	if v := query.Get("tailLines"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			fakeStatus(w, http.StatusBadRequest, "BadRequest", "tailLines must be a non-negative integer")
			return
		}
		tail = n
	}

	lines, partial, updates, release := log.open(follow)
	defer release()

	// The window: the last tail lines of the file, then the lines not older than since.
	if tail >= 0 && int64(len(lines)) > tail {
		lines = lines[int64(len(lines))-tail:]
	}
	var window []fakeLine
	for _, line := range lines {
		if !since.IsZero() && line.at.Before(since) {
			continue
		}
		window = append(window, line)
	}

	flusher, _ := w.(http.Flusher)
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	remain := limit
	// emit writes b, cut at the byte limit; it reports whether the response has ended.
	emit := func(b string) bool {
		if limit >= 0 {
			if int64(len(b)) > remain {
				b = b[:remain]
			}
			remain -= int64(len(b))
		}
		_, _ = w.Write([]byte(b))
		return limit >= 0 && remain <= 0
	}
	render := func(line fakeLine) string {
		if timestamps {
			return line.at.UTC().Format(kubeletTimeFormat) + " " + line.text + "\n"
		}
		return line.text + "\n"
	}
	for _, line := range window {
		if emit(render(line)) {
			return
		}
	}
	if !follow {
		if partial != "" {
			prefix := ""
			if timestamps {
				prefix = time.Now().UTC().Format(kubeletTimeFormat) + " "
			}
			emit(prefix + partial)
		}
		return
	}
	if flusher != nil {
		flusher.Flush()
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case batch := <-updates:
			for _, line := range batch {
				if emit(render(line)) {
					return
				}
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
	}
}

// fakeLine is a complete line of a container's log. A CRLF line keeps its CR in its text.
type fakeLine struct {
	at   time.Time
	text string
}

// fakeLog is one file of a container's log.
type fakeLog struct {
	mu        sync.Mutex
	lines     []fakeLine
	partial   string // a record with no line feed yet
	followers map[*fakeFollower]struct{}
}

type fakeFollower struct {
	out chan []fakeLine
}

func newFakeLog() *fakeLog { return &fakeLog{followers: make(map[*fakeFollower]struct{})} }

func (l *fakeLog) append(line fakeLine) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.partial = ""
	l.lines = append(l.lines, line)
	for f := range l.followers {
		f.out <- []fakeLine{line}
	}
}

// writePartial puts an incomplete record at the end of the file: bytes with no line feed yet.
func (l *fakeLog) writePartial(text string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.partial = text
}

// open returns the file as it is now (its complete lines and its incomplete record) and, for a
// follow, the channel of the lines that complete after it. The two
// are taken together, so no line is in both or in neither.
func (l *fakeLog) open(follow bool) (lines []fakeLine, partial string, updates <-chan []fakeLine, release func()) {
	l.mu.Lock()
	defer l.mu.Unlock()
	lines = append([]fakeLine(nil), l.lines...)
	partial = l.partial
	release = func() {}
	if !follow {
		return lines, partial, nil, release
	}
	f := &fakeFollower{out: make(chan []fakeLine, 1<<16)}
	l.followers[f] = struct{}{}
	release = func() {
		l.mu.Lock()
		defer l.mu.Unlock()
		delete(l.followers, f)
	}
	return lines, "", f.out, release
}

// leases is a ClientBorrower over the fake that counts what it lends.
type leases struct {
	client *kubernetes.Clientset
	held   atomic.Int32
	taken  atomic.Int32

	mu     sync.Mutex
	routes []resourcev2.AccessRoute
}

func newLeases(k *fakeKubelet) *leases {
	return &leases{client: k.client()}
}

// Routes returns the routes the clients were borrowed by, in order.
func (l *leases) Routes() []resourcev2.AccessRoute {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]resourcev2.AccessRoute(nil), l.routes...)
}

func (l *leases) borrow(ctx context.Context, route resourcev2.AccessRoute, use func(context.Context, *kubernetes.Clientset) error) error {
	l.held.Add(1)
	l.taken.Add(1)
	defer l.held.Add(-1)
	l.mu.Lock()
	l.routes = append(l.routes, route)
	l.mu.Unlock()
	return use(ctx, l.client)
}
