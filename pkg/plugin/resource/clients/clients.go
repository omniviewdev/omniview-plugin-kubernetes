package clients

import (
	"sync"
	"time"

	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

const (
	DefaultResyncPeriod = 30 * time.Minute
)

// Use a custom type here since we want multiple clients to use for each namespace context.
type ClientSet struct {
	Clientset              *kubernetes.Clientset
	KubeClient             kubernetes.Interface
	DiscoveryClient        discovery.DiscoveryInterface
	DynamicClient          dynamic.Interface
	DynamicInformerFactory dynamicinformer.DynamicSharedInformerFactory
	RESTConfig             *rest.Config
	factoryStartOnce sync.Once
	factoryStopOnce  sync.Once
	factoryStopCh    chan struct{}

	// nsFactories holds per-namespace informer factories for scoped watching.
	nsFactories   map[string]dynamicinformer.DynamicSharedInformerFactory
	nsFactoriesMu sync.Mutex
}

// EnsureFactoryStarted idempotently starts the DynamicInformerFactory.
// factory.Start() only starts informers already registered via ForResource(),
// so callers should register their informer BEFORE calling this method.
// Start() is safe to call repeatedly — it skips already-running informers.
//
// The factory uses a dedicated stop channel managed by the ClientSet lifecycle
// (closed by Shutdown/StopFactory). This ensures that individual resource
// watch goroutines being cancelled does NOT stop the shared factory — only an
// explicit shutdown or client destruction does.
func (cs *ClientSet) EnsureFactoryStarted() {
	cs.factoryStartOnce.Do(func() {
		cs.factoryStopCh = make(chan struct{})
	})
	cs.DynamicInformerFactory.Start(cs.factoryStopCh)
}

// StopFactory closes the factory stop channel, signaling all informers to stop.
// Safe to call multiple times. Called by DestroyClient before Shutdown().
func (cs *ClientSet) StopFactory() {
	cs.factoryStopOnce.Do(func() {
		if cs.factoryStopCh != nil {
			close(cs.factoryStopCh)
		}
	})
}

// GetOrCreateNamespaceFactory returns a DynamicSharedInformerFactory scoped to a
// single namespace. Factories are created lazily and cached for reuse.
// The returned factory is NOT started — callers must call Start() after registering
// informers via ForResource().
func (cs *ClientSet) GetOrCreateNamespaceFactory(ns string) dynamicinformer.DynamicSharedInformerFactory {
	cs.nsFactoriesMu.Lock()
	defer cs.nsFactoriesMu.Unlock()

	if cs.nsFactories == nil {
		cs.nsFactories = make(map[string]dynamicinformer.DynamicSharedInformerFactory)
	}
	if f, ok := cs.nsFactories[ns]; ok {
		return f
	}

	f := dynamicinformer.NewFilteredDynamicSharedInformerFactory(
		cs.DynamicClient,
		DefaultResyncPeriod,
		ns,
		nil,
	)
	cs.nsFactories[ns] = f
	return f
}

// ShutdownNamespaceFactories stops all per-namespace informer factories.
func (cs *ClientSet) ShutdownNamespaceFactories() {
	cs.nsFactoriesMu.Lock()
	snapshot := make(map[string]dynamicinformer.DynamicSharedInformerFactory, len(cs.nsFactories))
	for ns, f := range cs.nsFactories {
		snapshot[ns] = f
	}
	cs.nsFactories = make(map[string]dynamicinformer.DynamicSharedInformerFactory)
	cs.nsFactoriesMu.Unlock()

	for _, f := range snapshot {
		f.Shutdown()
	}
}
