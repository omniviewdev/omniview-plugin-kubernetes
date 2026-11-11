package clients

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
)

const DefaultResyncPeriod = 30 * time.Minute

// ClientSet owns native sources only while consumers hold leases.
type ClientSet struct {
	Clientset       *kubernetes.Clientset
	KubeClient      kubernetes.Interface
	DiscoveryClient discovery.DiscoveryInterface
	DynamicClient   dynamic.Interface
	RESTConfig      *rest.Config
	HTTPClient      *http.Client
	// StreamingClientset borrows the same generation without finite resource budgets.
	StreamingClientset  *kubernetes.Clientset
	StreamingHTTPClient *http.Client

	informersMu     sync.Mutex
	informers       map[informerKey]*informerSource
	informersClosed bool
	informerStop    chan struct{}
}

type informerKey struct {
	namespace string
	resource  schema.GroupVersionResource
}

type informerSource struct {
	key      informerKey
	factory  dynamicinformer.DynamicSharedInformerFactory
	informer cache.SharedIndexInformer
	stopCh   chan struct{}
	done     chan struct{}
	stopOnce sync.Once
	leases   int
	retiring bool
}

// activeInformerSources counts native sources across every ClientSet in the
// process so the informer.sources gauge never reflects a single connection.
var activeInformerSources atomic.Int64

func informerLog() *zap.SugaredLogger { return zap.S().Named("informers") }

func informerLogFields(key informerKey, extra ...any) []any {
	return append([]any{"resource_type", key.resource.Resource, "api_group", key.resource.Group, "namespace", key.namespace}, extra...)
}

// retireSpan covers one wait for a native LIST/WATCH to stop. trigger is one of
// last_lease, reacquire_wait or shutdown.
func retireSpan(ctx context.Context, key informerKey, trigger string, leases int) (context.Context, func(error)) {
	ctx, span := diag.Tracer().Start(ctx, "kubernetes.informer.retire")
	span.SetAttributes(
		attribute.String("resource.type", key.resource.Resource),
		attribute.String("resource.namespace", key.namespace),
		attribute.String("trigger", trigger),
		attribute.Int("leases", leases),
	)
	started := time.Now()
	return ctx, func(err error) {
		span.SetAttributes(attribute.Int64("wait_ms", time.Since(started).Milliseconds()))
		c := diag.EndSpan(span, err, false)
		informerLog().Debugw("informer source retire wait finished", informerLogFields(key, append([]any{"trigger", trigger, "wait_ms", time.Since(started).Milliseconds()}, c.LogFields()...)...)...)
	}
}

func (s *informerSource) stop() {
	s.stopOnce.Do(func() {
		// The caller closes stopCh under informersMu before waiting here.
		s.factory.Shutdown()
		close(s.done)
		diag.InformerSources(int(activeInformerSources.Add(-1)))
		informerLog().Debugw("informer source stopped", informerLogFields(s.key)...)
	})
}

// InformerLease holds one handler's interest in a native namespace/GVR source.
// Close unregisters the handler and waits for the final native source to stop.
type InformerLease struct {
	Informer     cache.SharedIndexInformer
	registration cache.ResourceEventHandlerRegistration
	client       *ClientSet
	key          informerKey
	source       *informerSource
	once         sync.Once
	err          error
}

// HasSynced includes this handler's initial delivery, not just the shared cache.
func (l *InformerLease) HasSynced() bool { return l.registration.HasSynced() }

func (l *InformerLease) Close() error {
	l.once.Do(func() {
		l.err = l.Informer.RemoveEventHandler(l.registration)
		if l.err != nil {
			informerLog().Warnw("informer handler removal failed", informerLogFields(l.key, diag.ClassifyError(l.err, false).LogFields()...)...)
		}
		cs := l.client
		cs.informersMu.Lock()
		l.source.leases--
		remaining := l.source.leases
		last := l.source.leases == 0
		if last && !l.source.retiring {
			l.source.retiring = true
			close(l.source.stopCh)
		}
		cs.informersMu.Unlock()
		informerLog().Debugw("informer lease closed", informerLogFields(l.key, "leases", remaining)...)
		if last {
			_, end := retireSpan(context.Background(), l.key, "last_lease", remaining)
			l.source.stop()
			end(nil)
			cs.informersMu.Lock()
			if cs.informers[l.key] == l.source {
				delete(cs.informers, l.key)
			}
			cs.informersMu.Unlock()
		}
	})
	return l.err
}

// InformerShutdown closes when connection teardown starts. Consumers must still
// close their own leases; shutdown also stops sources whose consumers are late.
func (cs *ClientSet) InformerShutdown() <-chan struct{} {
	cs.informersMu.Lock()
	defer cs.informersMu.Unlock()
	if cs.informerStop == nil {
		cs.informerStop = make(chan struct{})
	}
	return cs.informerStop
}

// AcquireInformer shares only an exact namespace/GVR source. A retiring source
// cannot be reused: acquisition waits for its native LIST/WATCH to stop first.
func (cs *ClientSet) AcquireInformer(ctx context.Context, namespace string, gvr schema.GroupVersionResource, handler cache.ResourceEventHandler) (*InformerLease, error) {
	key := informerKey{namespace: namespace, resource: gvr}
	for {
		cs.informersMu.Lock()
		if err := ctx.Err(); err != nil {
			cs.informersMu.Unlock()
			return nil, err
		}
		if cs.informersClosed || cs.DynamicClient == nil {
			closed := cs.informersClosed
			cs.informersMu.Unlock()
			informerLog().Warnw("informer acquisition rejected", informerLogFields(key, "reason", map[bool]string{true: "shutdown", false: "no_dynamic_client"}[closed])...)
			return nil, fmt.Errorf("native informer client is unavailable")
		}
		if cs.informers == nil {
			cs.informers = make(map[informerKey]*informerSource)
		}
		source := cs.informers[key]
		if source != nil && source.retiring {
			done := source.done
			cs.informersMu.Unlock()
			_, end := retireSpan(ctx, key, "reacquire_wait", 0)
			select {
			case <-ctx.Done():
				end(ctx.Err())
				return nil, ctx.Err()
			case <-done:
			}
			end(nil)
			cs.informersMu.Lock()
			if cs.informers[key] == source {
				delete(cs.informers, key)
			}
			cs.informersMu.Unlock()
			continue
		}
		if source == nil {
			factory := dynamicinformer.NewFilteredDynamicSharedInformerFactory(cs.DynamicClient, DefaultResyncPeriod, namespace, nil)
			source = &informerSource{key: key, factory: factory, informer: factory.ForResource(gvr).Informer(), stopCh: make(chan struct{}), done: make(chan struct{})}
			cs.informers[key] = source
			diag.InformerSources(int(activeInformerSources.Add(1)))
			informerLog().Debugw("informer source created", informerLogFields(key)...)
		}
		registration, err := source.informer.AddEventHandler(handler)
		if err != nil {
			unused := source.leases == 0
			if unused {
				source.retiring = true
				close(source.stopCh)
				delete(cs.informers, key)
			}
			cs.informersMu.Unlock()
			if unused {
				source.stop()
			}
			informerLog().Warnw("informer handler registration failed", informerLogFields(key, diag.ClassifyError(err, false).LogFields()...)...)
			return nil, err
		}
		source.leases++
		leases := source.leases
		source.factory.Start(source.stopCh)
		cs.informersMu.Unlock()
		informerLog().Debugw("informer lease acquired", informerLogFields(key, "leases", leases)...)
		return &InformerLease{Informer: source.informer, registration: registration, client: cs, key: key, source: source}, nil
	}
}

// ShutdownInformers rejects new leases and waits for every native source,
// including sources already retiring after their final lease was closed.
func (cs *ClientSet) ShutdownInformers() {
	cs.informersMu.Lock()
	if !cs.informersClosed {
		cs.informersClosed = true
		if cs.informerStop == nil {
			cs.informerStop = make(chan struct{})
		}
		close(cs.informerStop)
	}
	type stoppedSource struct {
		key    informerKey
		source *informerSource
		leases int
	}
	sources := make([]stoppedSource, 0, len(cs.informers))
	for key, source := range cs.informers {
		if !source.retiring {
			source.retiring = true
			close(source.stopCh)
		}
		sources = append(sources, stoppedSource{key: key, source: source, leases: source.leases})
	}
	cs.informersMu.Unlock()
	informerLog().Debugw("informer shutdown started", "sources", len(sources))
	for _, stopped := range sources {
		_, end := retireSpan(context.Background(), stopped.key, "shutdown", stopped.leases)
		stopped.source.stop()
		end(nil)
	}
	cs.informersMu.Lock()
	for _, stopped := range sources {
		if cs.informers[stopped.key] == stopped.source {
			delete(cs.informers, stopped.key)
		}
	}
	cs.informersMu.Unlock()
}

// ResetInformerLifecycle permits acquisition after RefreshClient has replaced
// native clients. The controller must retire old consumers before refreshing.
func (cs *ClientSet) ResetInformerLifecycle() {
	cs.informersMu.Lock()
	defer cs.informersMu.Unlock()
	cs.informersClosed = false
	cs.informerStop = nil
	informerLog().Debugw("informer lifecycle reset")
}
