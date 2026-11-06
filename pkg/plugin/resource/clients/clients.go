package clients

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

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
	factory  dynamicinformer.DynamicSharedInformerFactory
	informer cache.SharedIndexInformer
	stopCh   chan struct{}
	done     chan struct{}
	stopOnce sync.Once
	leases   int
	retiring bool
}

func (s *informerSource) stop() {
	s.stopOnce.Do(func() {
		// The caller closes stopCh under informersMu before waiting here.
		s.factory.Shutdown()
		close(s.done)
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
		cs := l.client
		cs.informersMu.Lock()
		l.source.leases--
		last := l.source.leases == 0
		if last && !l.source.retiring {
			l.source.retiring = true
			close(l.source.stopCh)
		}
		cs.informersMu.Unlock()
		if last {
			l.source.stop()
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
			cs.informersMu.Unlock()
			return nil, fmt.Errorf("native informer client is unavailable")
		}
		if cs.informers == nil {
			cs.informers = make(map[informerKey]*informerSource)
		}
		source := cs.informers[key]
		if source != nil && source.retiring {
			done := source.done
			cs.informersMu.Unlock()
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-done:
			}
			cs.informersMu.Lock()
			if cs.informers[key] == source {
				delete(cs.informers, key)
			}
			cs.informersMu.Unlock()
			continue
		}
		if source == nil {
			factory := dynamicinformer.NewFilteredDynamicSharedInformerFactory(cs.DynamicClient, DefaultResyncPeriod, namespace, nil)
			source = &informerSource{factory: factory, informer: factory.ForResource(gvr).Informer(), stopCh: make(chan struct{}), done: make(chan struct{})}
			cs.informers[key] = source
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
			return nil, err
		}
		source.leases++
		source.factory.Start(source.stopCh)
		cs.informersMu.Unlock()
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
	}
	sources := make([]stoppedSource, 0, len(cs.informers))
	for key, source := range cs.informers {
		if !source.retiring {
			source.retiring = true
			close(source.stopCh)
		}
		sources = append(sources, stoppedSource{key: key, source: source})
	}
	cs.informersMu.Unlock()
	for _, stopped := range sources {
		stopped.source.stop()
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
}
