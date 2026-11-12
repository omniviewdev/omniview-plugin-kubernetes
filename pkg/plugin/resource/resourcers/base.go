package resourcers

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
)

// MetaAccessor describes native metadata used by specialized Kubernetes helpers.
type MetaAccessor interface {
	GetName() string
	GetNamespace() string
	GetLabels() map[string]string
}

// KubernetesResourcerBase holds optional native update and relationship behavior.
// Finite operations belong to the provider's shared native dispatch.
type KubernetesResourcerBase[T MetaAccessor] struct {
	sync.RWMutex
	log           *zap.SugaredLogger
	resourceType  schema.GroupVersionResource
	relationships []resource.RelationshipDescriptor
}
type Option func(*baseOptions)
type baseOptions struct {
	relationships []resource.RelationshipDescriptor
}

func WithRelationships(r []resource.RelationshipDescriptor) Option {
	return func(o *baseOptions) { o.relationships = r }
}
func NewKubernetesResourcerBase[T MetaAccessor](logger *zap.SugaredLogger, nativeType schema.GroupVersionResource, opts ...Option) *KubernetesResourcerBase[T] {
	o := baseOptions{}
	for _, apply := range opts {
		apply(&o)
	}
	return &KubernetesResourcerBase[T]{log: logger.With("service", nativeType.Resource+"Service"), resourceType: nativeType, relationships: o.relationships}
}
func (s *KubernetesResourcerBase[T]) GroupVersionResource() schema.GroupVersionResource {
	return s.resourceType
}
func (s *KubernetesResourcerBase[T]) DeclareRelationships() []resource.RelationshipDescriptor {
	return s.relationships
}

// nativeRequestNamespace accepts only the exact native namespace dimension.
// An empty scope denotes a cluster-scoped object; an explicit namespace is nonempty.
func nativeRequestNamespace(scope []resource.ScopeEntry) (string, error) {
	if len(scope) == 0 {
		return "", nil
	}
	if len(scope) != 1 || scope[0].Dimension != "namespace" || scope[0].Value == "" {
		return "", resource.NewError("INVALID_REQUEST", "Kubernetes scope must contain only one nonempty namespace dimension")
	}
	return scope[0].Value, nil
}

func extractMetadata(u *unstructured.Unstructured) resource.ResourceMetadata {
	m := resource.ResourceMetadata{Labels: u.GetLabels()}
	if t := u.GetCreationTimestamp(); !t.IsZero() {
		m.CreatedAt = &t.Time
	}
	return m
}

type watchErrorClassification struct {
	code    string
	message string
}

func watchErrorCode(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "TIMEOUT"
	}
	var classified *resource.ResourceOperationError
	if errors.As(err, &classified) && classified != nil && resource.IsErrorCode(classified.Code) {
		return classified.Code
	}
	return "PROVIDER_ERROR"
}

func classifyWatchError(err error) watchErrorClassification {
	var status *k8serrors.StatusError
	if errors.As(err, &status) {
		switch status.ErrStatus.Code {
		case 403:
			return watchErrorClassification{code: "FORBIDDEN", message: "Access denied"}
		case 401:
			return watchErrorClassification{code: "UNAUTHORIZED", message: "Authentication failed"}
		case 404:
			return watchErrorClassification{code: "NOT_FOUND", message: "Resource type not found"}
		case 405:
			return watchErrorClassification{code: "UNSUPPORTED", message: "Resource does not support this method"}
		}
	}
	code := watchErrorCode(err)
	if code == "PROVIDER_ERROR" {
		if transient, ok := classifyTransientWatchError(err); ok {
			return transient
		}
	}
	return watchErrorClassification{code: code, message: err.Error()}
}

// classifyTransientWatchError maps API server and transport failures that clear
// without user action to the codes the host reopens a source on: UNAVAILABLE,
// CONNECTION_ERROR and TIMEOUT. Any other code is terminal for the host.
// Certificate failures do not clear by retrying and keep their own code.
func classifyTransientWatchError(err error) (watchErrorClassification, bool) {
	var status *k8serrors.StatusError
	if errors.As(err, &status) {
		switch code := status.ErrStatus.Code; {
		case code == http.StatusRequestTimeout || code == http.StatusGatewayTimeout:
			return watchErrorClassification{code: "TIMEOUT", message: "Kubernetes API server did not respond in time"}, true
		case code == http.StatusTooManyRequests || code >= http.StatusInternalServerError:
			return watchErrorClassification{code: "UNAVAILABLE", message: "Kubernetes API server is temporarily unavailable"}, true
		}
		return watchErrorClassification{}, false
	}
	var (
		unknownAuthority x509.UnknownAuthorityError
		invalid          x509.CertificateInvalidError
		hostname         x509.HostnameError
		verification     *tls.CertificateVerificationError
	)
	if errors.As(err, &unknownAuthority) || errors.As(err, &invalid) || errors.As(err, &hostname) || errors.As(err, &verification) {
		return watchErrorClassification{code: "CERTIFICATE_ERROR", message: "Kubernetes API server certificate could not be verified"}, true
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return watchErrorClassification{code: "UNAVAILABLE", message: "Kubernetes API server is temporarily unavailable"}, true
	}
	// net.Error covers dial, reset and DNS failures, the TLS handshake timeout
	// and url.Error around any of them.
	var network net.Error
	if errors.As(err, &network) {
		if network.Timeout() {
			return watchErrorClassification{code: "TIMEOUT", message: "Kubernetes API server did not respond in time"}, true
		}
		return watchErrorClassification{code: "CONNECTION_ERROR", message: "Unable to connect to the Kubernetes API server"}, true
	}
	return watchErrorClassification{}, false
}

func watchRecord(target resource.ReadTarget, representation resource.Representation, u *unstructured.Unstructured) (resource.Record, error) {
	body, err := resource.ValueFromNative(u.Object)
	if err != nil {
		return resource.Record{}, err
	}
	address := resource.ResourceAddress{Provider: target.Provider, Authority: target.Authority, Type: target.Type, ID: u.GetName(), Scope: []resource.ScopeEntry{}}
	if namespace := u.GetNamespace(); namespace != "" {
		address.Scope = []resource.ScopeEntry{{Dimension: "namespace", Value: namespace}}
	}
	ref := resource.ResourceReference{Address: address}
	if uid := string(u.GetUID()); uid != "" {
		ref.Incarnation = &uid
	}
	record := resource.Record{Reference: ref, Body: body, Representation: representation, Coverage: resource.Coverage{Kind: "complete", Paths: []string{}}}
	if revision := u.GetResourceVersion(); revision != "" {
		record.SourceRevision = &revision
	}
	if err := resource.ValidateRecord(record); err != nil {
		return resource.Record{}, err
	}
	return record, nil
}

var errSourceBindingChanged = errors.New("source binding changed")

func compactWatchRecord(record resource.Record, binding resource.Representation) (resource.SourceRecord, error) {
	if !reflect.DeepEqual(record.Representation, binding) {
		return resource.SourceRecord{}, errSourceBindingChanged
	}
	return resource.CompactSourceRecord(record), nil
}

const sourceQueueCapacity = 4096

type sourceEvent struct {
	kind   string
	object *unstructured.Unstructured
}

func makeSourceHandler(ctx context.Context, events chan<- sourceEvent, overflow *atomic.Bool) cache.ResourceEventHandlerFuncs {
	enqueue := func(obj interface{}, kind string) {
		// Events after cancellation or overflow are intentionally dropped: the session is ending or already resetting.
		if ctx.Err() != nil || overflow.Load() {
			return
		}
		u, ok := obj.(*unstructured.Unstructured)
		if !ok || u == nil {
			tombstone, found := obj.(cache.DeletedFinalStateUnknown)
			if !found {
				zap.S().Named("source").Debugw("source event ignored", "reason", "unexpected_object_type", "kind", kind)
				return
			}
			u, ok = tombstone.Obj.(*unstructured.Unstructured)
			if !ok || u == nil {
				zap.S().Named("source").Debugw("source event ignored", "reason", "unexpected_tombstone_type", "kind", kind)
				return
			}
		}
		select {
		case events <- sourceEvent{kind: kind, object: u}:
		default:
			overflow.Store(true)
			zap.S().Named("source").Debugw("source event queue full", "reason", "queue_overflow", "kind", kind)
		}
	}
	return cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) { enqueue(obj, "add") },
		UpdateFunc: func(oldObj, newObj interface{}) {
			u, ok := newObj.(*unstructured.Unstructured)
			if !ok || u == nil {
				zap.S().Named("source").Debugw("source update ignored", "reason", "unexpected_object_type")
				return
			}
			// Informer resyncs can replay the same version without changing the object.
			// Keep empty versions and replacement objects: neither proves a no-op.
			if old, ok := oldObj.(*unstructured.Unstructured); ok && old != nil {
				if version := u.GetResourceVersion(); version != "" &&
					version == old.GetResourceVersion() &&
					u.GetUID() == old.GetUID() &&
					u.GetName() == old.GetName() &&
					u.GetNamespace() == old.GetNamespace() &&
					u.GetAPIVersion() == old.GetAPIVersion() &&
					u.GetKind() == old.GetKind() {
					return
				}
			}
			enqueue(u, "update")
		},
		DeleteFunc: func(obj interface{}) { enqueue(obj, "delete") },
	}
}

func watchNamespaces(scope resource.QueryScope) ([]string, error) {
	if len(scope) == 0 {
		return nil, nil
	}
	if len(scope) != 1 || scope[0].Dimension != "namespace" {
		return nil, resource.NewError("INVALID_REQUEST", "unsupported Kubernetes watch scope")
	}
	constraint := scope[0]
	switch constraint.Match {
	case resource.ScopeAny:
		if constraint.Values != nil {
			return nil, resource.NewError("INVALID_REQUEST", "any namespace scope must not contain values")
		}
		return nil, nil
	case resource.ScopeOneOf:
		if constraint.Values == nil || len(*constraint.Values) == 0 {
			return nil, resource.NewError("INVALID_REQUEST", "namespace scope requires values")
		}
		seen := make(map[string]struct{}, len(*constraint.Values))
		for _, namespace := range *constraint.Values {
			if namespace == "" {
				return nil, resource.NewError("INVALID_REQUEST", "namespace must not be empty")
			}
			if _, exists := seen[namespace]; exists {
				return nil, resource.NewError("INVALID_REQUEST", "namespace scope contains duplicates")
			}
			seen[namespace] = struct{}{}
		}
		return *constraint.Values, nil
	default:
		return nil, resource.NewError("INVALID_REQUEST", "unsupported Kubernetes scope match")
	}
}

// sourceLivenessInterval is the nominal gap between two API server probes; each
// wait is jittered to 80-120% so connections do not probe in step.
var sourceLivenessInterval = 10 * time.Second

const (
	// sourceLivenessTimeout bounds one probe. client-go allows the TLS handshake
	// alone 10 s and an overloaded control plane takes seconds to answer, so a
	// tighter bound would report a slow server as unreachable.
	sourceLivenessTimeout = 15 * time.Second
	// sourceLivenessFailures is how many probes in a row must get no HTTP
	// response, with no informer progress in between, before the sources of a
	// connection are reset. One failed probe is routine on a loaded control
	// plane and two in a row happen on one that keeps serving; three span at
	// least two probe intervals with no answer and no watch event.
	sourceLivenessFailures = 3
)

// watchProgress is the part of an informer the liveness monitor reads. The
// resource version moves whenever the reflector receives a watch event or
// bookmark, or completes a list. On a cluster with no changes it only moves
// with a bookmark, which the server sends about once a minute.
type watchProgress interface {
	LastSyncResourceVersion() string
}

// sourceHealthMonitor decides when the API server of one connection is
// unreachable. A reset closes every informer of the connection and the reopen
// relists everything against a server that may already be struggling, so it is
// the last resort: a probe that gets any HTTP response (429, 5xx, 401...) shows
// a live server and clears the failure count, and so does a failed probe while
// an informer still receives watch events.
type sourceHealthMonitor struct {
	cancel    context.CancelFunc
	unhealthy chan struct{}
	done      chan struct{}
	refs      int
	// watched counts the sessions observing each informer.
	// Guarded by sourceHealthMonitors.
	watched map[watchProgress]int
}

var sourceHealthMonitors = struct {
	sync.Mutex
	clients map[*clients.ClientSet]*sourceHealthMonitor
}{clients: make(map[*clients.ClientSet]*sourceHealthMonitor)}

// acquireSourceHealth shares a cancellable probe across all following sessions.
// watched lists the informers backing the session; their watch progress is
// evidence that the API server is reachable even when a probe fails.
func acquireSourceHealth(ctx context.Context, client *clients.ClientSet, watched []watchProgress) (<-chan struct{}, func(), error) {
	for {
		sourceHealthMonitors.Lock()
		monitor := sourceHealthMonitors.clients[client]
		if monitor != nil && monitor.refs == 0 {
			done := monitor.done
			sourceHealthMonitors.Unlock()
			select {
			case <-done:
				continue
			case <-ctx.Done():
				return nil, nil, ctx.Err()
			}
		}
		if monitor == nil {
			monitorCtx, cancel := context.WithCancel(context.Background())
			monitor = &sourceHealthMonitor{cancel: cancel, unhealthy: make(chan struct{}), done: make(chan struct{}), watched: make(map[watchProgress]int)}
			sourceHealthMonitors.clients[client] = monitor
			interval := sourceLivenessInterval
			go runSourceHealth(monitorCtx, client, monitor, interval)
		}
		monitor.refs++
		for _, informer := range watched {
			monitor.watched[informer]++
		}
		sourceHealthMonitors.Unlock()
		return monitor.unhealthy, func() {
			sourceHealthMonitors.Lock()
			monitor.refs--
			for _, informer := range watched {
				if monitor.watched[informer] <= 1 {
					delete(monitor.watched, informer)
				} else {
					monitor.watched[informer]--
				}
			}
			if monitor.refs == 0 {
				monitor.cancel()
			}
			sourceHealthMonitors.Unlock()
		}, nil
	}
}

// observeWatches returns the current resource version of every watched informer
// and whether any informer already present in previous has moved since.
// Informers seen for the first time only establish a baseline.
func (m *sourceHealthMonitor) observeWatches(previous map[watchProgress]string) (map[watchProgress]string, bool) {
	sourceHealthMonitors.Lock()
	informers := make([]watchProgress, 0, len(m.watched))
	for informer := range m.watched {
		informers = append(informers, informer)
	}
	sourceHealthMonitors.Unlock()
	current := make(map[watchProgress]string, len(informers))
	progressed := false
	for _, informer := range informers {
		version := informer.LastSyncResourceVersion()
		current[informer] = version
		if before, known := previous[informer]; known && before != version {
			progressed = true
		}
	}
	return current, progressed
}

func runSourceHealth(ctx context.Context, client *clients.ClientSet, monitor *sourceHealthMonitor, interval time.Duration) {
	defer func() {
		sourceHealthMonitors.Lock()
		if sourceHealthMonitors.clients[client] == monitor {
			delete(sourceHealthMonitors.clients, client)
		}
		close(monitor.done)
		sourceHealthMonitors.Unlock()
	}()
	probe, setupErr := newSourceHealthProbe(client)
	if setupErr != nil {
		// Without a probe there is no evidence the API server is down, so the
		// sources keep running; only their own watches can end them.
		zap.S().Named("source_health").Warnw("source health probe unavailable; liveness resets are disabled for this connection", diag.ClassifyError(setupErr, false).LogFields()...)
		<-ctx.Done()
		return
	}
	watched, _ := monitor.observeWatches(nil)
	failures := 0
	for {
		// Spread connection probes over 80–120% of the nominal interval.
		delay := time.Duration(float64(interval) * (0.8 + rand.Float64()*0.4))
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		probeCtx, cancel := context.WithTimeout(ctx, sourceLivenessTimeout)
		err := probe(probeCtx)
		cancel()
		if ctx.Err() != nil {
			return
		}
		var progressed bool
		watched, progressed = monitor.observeWatches(watched)
		if err == nil || progressed {
			if err != nil {
				zap.S().Named("source_health").Debugw("source health probe failed while informers still receive events", append([]any{"consecutive_failures", failures}, diag.ClassifyError(err, false).LogFields()...)...)
			}
			failures = 0
			continue
		}
		failures++
		c := diag.ClassifyError(err, false)
		zap.S().Named("source_health").Debugw("source health probe failed", append([]any{"consecutive_failures", failures}, c.LogFields()...)...)
		if failures >= sourceLivenessFailures {
			close(monitor.unhealthy)
			// Keep the monitor until all subscribers have released it.
			<-ctx.Done()
			return
		}
	}
}

// newSourceHealthProbe returns a GET of the API server's /version. The returned
// function reports an error only when no HTTP response arrived: throttling,
// authentication and server errors all prove the server is reachable.
func newSourceHealthProbe(client *clients.ClientSet) (func(context.Context) error, error) {
	if client.RESTConfig == nil {
		return nil, fmt.Errorf("Kubernetes REST configuration is unavailable")
	}
	// Resolve the host exactly as client-go does, so host:port forms work.
	endpoint, _, err := rest.DefaultServerUrlFor(client.RESTConfig)
	if err != nil {
		return nil, err
	}
	endpoint.Path = strings.TrimSuffix(endpoint.Path, "/") + "/version"
	request, err := http.NewRequest(http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	httpClient := client.HTTPClient
	if httpClient == nil {
		httpClient, err = rest.HTTPClientFor(client.RESTConfig)
		if err != nil {
			return nil, err
		}
	}
	return func(ctx context.Context) error {
		response, err := httpClient.Do(request.Clone(ctx))
		if err != nil {
			return err
		}
		// The status is ignored on purpose: any HTTP response proves the server is reachable.
		_ = response.Body.Close()
		return nil
	}, nil
}

// Source leases informer handlers for one source session.
func (s *KubernetesResourcerBase[T]) Source(ctx context.Context, client *clients.ClientSet, request resource.SourceRequest, emit resource.SourceEmitter) (retErr error) {
	_, snapshotSpan := diag.Tracer().Start(ctx, "kubernetes.source.snapshot")
	snapshotSpan.SetAttributes(attribute.String("k8s.resource", s.resourceType.Resource))
	sourceLog := s.log.With("resource_type", s.resourceType.Resource)
	snapshotStart := time.Now()
	snapshotEnded, snapshotCompleted := false, false
	// failureCause keeps the native error whose class the resource.NewError returned to the host hides.
	var failureCause error
	finishSnapshot := func(err error) {
		if snapshotEnded {
			return
		}
		snapshotEnded = true
		if failureCause != nil {
			err = failureCause
		}
		elapsed := time.Since(snapshotStart)
		snapshotSpan.SetAttributes(attribute.Int64("sync_ms", elapsed.Milliseconds()))
		c := diag.EndSpan(snapshotSpan, err, false)
		diag.SourceSync(elapsed, c.Outcome)
		switch c.Outcome {
		case "failure":
			sourceLog.Warnw("source snapshot failed", append([]any{"sync_ms", elapsed.Milliseconds()}, c.LogFields()...)...)
		case "canceled":
			sourceLog.Debugw("source snapshot canceled", append([]any{"sync_ms", elapsed.Milliseconds()}, c.LogFields()...)...)
		}
	}
	defer func() {
		finishSnapshot(retErr)
		if snapshotCompleted {
			// Session ended after a delivered snapshot: cancellation is the normal close.
			c := diag.ClassifyError(retErr, false)
			if c.Outcome == "failure" {
				sourceLog.Warnw("source session ended with error", c.LogFields()...)
			} else {
				sourceLog.Debugw("source session ended", c.LogFields()...)
			}
		}
	}()
	if client == nil || client.DynamicClient == nil || emit == nil {
		return fmt.Errorf("client and source emitter are required")
	}
	lifetime := client.InformerShutdown()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		select {
		case <-ctx.Done():
		case <-lifetime:
			cancel()
		}
	}()
	namespaces, err := watchNamespaces(request.Target.Scope)
	if err != nil {
		return err
	}
	if len(namespaces) == 0 {
		namespaces = []string{""}
	}
	events := make(chan sourceEvent, sourceQueueCapacity)
	var overflow atomic.Bool
	handler := makeSourceHandler(ctx, events, &overflow)
	// Initial delivery can exceed the live-change queue. Retain its shared cache
	// pointers directly; handler HasSynced guarantees all initial adds finished.
	var initialMu sync.Mutex
	initial := make(map[string]*unstructured.Unstructured)
	initialHandler := cache.ResourceEventHandlerDetailedFuncs{
		AddFunc: func(obj interface{}, isInitial bool) {
			if !isInitial {
				handler.AddFunc(obj)
				return
			}
			u, ok := obj.(*unstructured.Unstructured)
			if !ok || u == nil || ctx.Err() != nil {
				return
			}
			initialMu.Lock()
			initial[u.GetNamespace()+"/"+u.GetName()] = u
			initialMu.Unlock()
		},
		UpdateFunc: handler.UpdateFunc,
		DeleteFunc: handler.DeleteFunc,
	}
	leases := make([]*clients.InformerLease, 0, len(namespaces))
	defer func() {
		for _, lease := range leases {
			if err := lease.Close(); err != nil {
				s.log.Warnw("failed to retire watch source", diag.ClassifyError(err, false).LogFields()...)
			}
		}
	}()
	probe := func(ctx context.Context, namespace string) error {
		native := client.DynamicClient.Resource(s.resourceType)
		if namespace == "" {
			_, err := native.List(ctx, metav1.ListOptions{Limit: 1})
			return err
		}
		_, err := native.Namespace(namespace).List(ctx, metav1.ListOptions{Limit: 1})
		return err
	}
	for _, namespace := range namespaces {
		err = probe(ctx, namespace)
		if err != nil {
			failureCause = err
			if errors.Is(err, context.Canceled) {
				return err
			}
			classified := classifyWatchError(err)
			c := diag.ClassifyError(err, false)
			snapshotSpan.AddEvent("probe_failed", trace.WithAttributes(attribute.String("error.class", c.Class), attribute.String("k8s.reason", c.Reason), attribute.String("watch.code", classified.code)))
			sourceLog.Warnw("source probe failed", append([]any{"watch_code", classified.code}, c.LogFields()...)...)
			return resource.NewError(classified.code, classified.message)
		}
		lease, err := client.AcquireInformer(ctx, namespace, s.resourceType, initialHandler)
		if err != nil {
			failureCause = err
			sourceLog.Warnw("source informer acquisition failed", diag.ClassifyError(err, false).LogFields()...)
			return err
		}
		leases = append(leases, lease)
	}
	syncCtx, stopSync := context.WithTimeout(ctx, 30*time.Second)
	defer stopSync()
	for _, lease := range leases {
		if !cache.WaitForCacheSync(syncCtx.Done(), lease.HasSynced) {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			snapshotSpan.AddEvent("sync_timeout", trace.WithAttributes(attribute.Int64("timeout_ms", 30000)))
			sourceLog.Warnw("informer cache sync timed out", "reason", "sync_timeout", "timeout_ms", 30000)
			return resource.NewError("UNAVAILABLE", "informer cache sync timed out")
		}
	}
	reset := func() error {
		snapshotSpan.AddEvent("overflow")
		sourceLog.Warnw("source event queue overflowed; requesting reset", "reason", "queue_overflow", "capacity", sourceQueueCapacity)
		return emit.Reset(ctx, resource.SourceResetOverflow, "informer event queue exceeded 4096 items")
	}
	if overflow.Load() {
		return reset()
	}
	initialMu.Lock()
	staging := initial
	initial = nil
	initialMu.Unlock()
	for n := len(events); n > 0; n-- {
		event := <-events
		key := event.object.GetNamespace() + "/" + event.object.GetName()
		if event.kind == "delete" {
			delete(staging, key)
		} else {
			staging[key] = event.object
		}
	}
	observation := func(u *unstructured.Unstructured) (resource.SourceObservation, error) {
		record, err := watchRecord(request.Target, request.Representation, u)
		if err != nil {
			return resource.SourceObservation{}, err
		}
		compact, err := compactWatchRecord(record, request.Representation)
		if err != nil {
			return resource.SourceObservation{}, err
		}
		result := resource.SourceObservation{Record: compact}
		metadata := extractMetadata(u)
		if len(metadata.Labels) != 0 || metadata.CreatedAt != nil {
			result.Metadata = &metadata
		}
		return result, nil
	}
	batch := make([]resource.SourceObservation, 0, resource.MaxSourceBatchItems)
	for _, u := range staging {
		item, err := observation(u)
		if err != nil {
			if errors.Is(err, errSourceBindingChanged) {
				return emit.Reset(ctx, resource.SourceResetBindingChanged, "Source binding changed.")
			}
			return err
		}
		batch = append(batch, item)
		if len(batch) == resource.MaxSourceBatchItems {
			if overflow.Load() {
				return reset()
			}
			if err := emit.Snapshot(ctx, batch); err != nil {
				return err
			}
			batch = make([]resource.SourceObservation, 0, resource.MaxSourceBatchItems)
		}
	}
	if overflow.Load() {
		return reset()
	}
	if len(batch) != 0 {
		if err := emit.Snapshot(ctx, batch); err != nil {
			return err
		}
	}
	if overflow.Load() {
		return reset()
	}
	coverage := resource.SourceCoverage{
		Enumeration: resource.EnumerationExhausted,
		Consistency: resource.ConsistencyBestEffort,
		Limitations: []string{"informer cache readiness is not a point-in-time snapshot", "startup events are reconciled by key, not by native revision handoff"},
	}
	if err := emit.EndSnapshot(ctx, coverage, resource.ContinuityBestEffort); err != nil {
		return err
	}
	finishSnapshot(nil)
	snapshotCompleted = true
	sourceLog.Debugw("source snapshot delivered", "sync_ms", time.Since(snapshotStart).Milliseconds(), "namespaces", len(namespaces))
	watched := make([]watchProgress, len(leases))
	for i, lease := range leases {
		watched[i] = lease.Informer
	}
	unhealthy, releaseHealth, err := acquireSourceHealth(ctx, client, watched)
	if err != nil {
		return err
	}
	defer releaseHealth()
	for {
		if overflow.Load() {
			return reset()
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-unhealthy:
			snapshotSpan.AddEvent("source.continuity_lost")
			sourceLog.Warnw("source continuity lost; Kubernetes API health probes failed repeatedly", "reason", "health_probe_failed")
			return emit.Reset(ctx, resource.SourceResetContinuityLost, "Kubernetes API is unreachable; informer events are not being delivered")
		case first := <-events:
			item, err := observation(first.object)
			if errors.Is(err, errSourceBindingChanged) {
				return emit.Reset(ctx, resource.SourceResetBindingChanged, "Source binding changed.")
			}
			if err != nil {
				return err
			}
			var change resource.SourceChange
			if first.kind == "delete" {
				change = resource.SourceChange{Kind: resource.SourceChangeRemove, Reference: &item.Record.Reference, SourceRevision: item.Record.SourceRevision}
			} else {
				change = resource.SourceChange{Kind: resource.SourceChangeUpsert, Observation: &item}
			}
			if overflow.Load() {
				return reset()
			}
			if err := emit.Changes(ctx, []resource.SourceChange{change}, nil); err != nil {
				return err
			}
		}
	}
}
