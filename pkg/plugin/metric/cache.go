package metric

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"

	"github.com/omniview/kubernetes/pkg/utils"
)

const (
	// DefaultClientTTL is how long a cached kube client stays alive after last use.
	DefaultClientTTL = 10 * time.Minute
	// DefaultReapInterval is how often the background reaper checks for stale entries.
	DefaultReapInterval = 1 * time.Minute
)

// clientEntry holds a cached kube client bundle with access tracking.
type clientEntry struct {
	clients     *kubeauth.KubeClientBundle
	lastAccess  time.Time
	ready       chan struct{}
	readyClosed bool
	err         error
	cancel      context.CancelFunc
}

// ClientFactory builds kube clients from a connection. Factored out for testability.
type ClientFactory func(ctx context.Context, conn *types.Connection) (*kubeauth.KubeClientBundle, error)

// DefaultClientFactory uses the standard KubeClientsFromContext path.
func DefaultClientFactory(ctx context.Context, conn *types.Connection) (*kubeauth.KubeClientBundle, error) {
	if conn == nil {
		return nil, fmt.Errorf("connection is nil")
	}

	return utils.KubeClientsFromContext(&types.PluginContext{Context: ctx, Connection: conn})
}

// ClientCache provides per-connection kube client caching with TTL-based eviction.
type ClientCache struct {
	mu      sync.RWMutex
	entries map[string]*clientEntry
	ttl     time.Duration
	factory ClientFactory
	stopCh  chan struct{}
	nowFunc func() time.Time // for testing
	stopped bool
}

// ClientCacheOpts configures a ClientCache.
type ClientCacheOpts struct {
	TTL     time.Duration
	Factory ClientFactory
	NowFunc func() time.Time // nil = time.Now
}

// NewClientCache creates a client cache and starts the background reaper.
func NewClientCache(opts ClientCacheOpts) *ClientCache {
	ttl := opts.TTL
	if ttl == 0 {
		ttl = DefaultClientTTL
	}
	factory := opts.Factory
	if factory == nil {
		factory = DefaultClientFactory
	}
	nowFunc := opts.NowFunc
	if nowFunc == nil {
		nowFunc = time.Now
	}

	c := &ClientCache{
		entries: make(map[string]*clientEntry),
		ttl:     ttl,
		factory: factory,
		stopCh:  make(chan struct{}),
		nowFunc: nowFunc,
	}

	go c.reapLoop()
	return c
}

// Get returns cached kube clients for the connection, creating them if absent.
// Each successful Get refreshes the TTL.
func (c *ClientCache) Get(ctx context.Context, connectionID string, conn *types.Connection) (*kubeauth.KubeClientBundle, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	c.mu.Lock()
	if c.stopped {
		c.mu.Unlock()
		return nil, resourcev2.NewError("UNAVAILABLE", "Metric client cache is closed")
	}
	if entry := c.entries[connectionID]; entry != nil {
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-entry.ready:
		}
		c.mu.Lock()
		defer c.mu.Unlock()
		if entry.err != nil {
			return nil, entry.err
		}
		if c.entries[connectionID] != entry {
			return nil, resourcev2.NewError("RESET_REQUIRED", "Metric client generation was retired")
		}
		entry.lastAccess = c.nowFunc()
		return entry.clients, nil
	}
	buildCtx, cancel := context.WithCancel(ctx)
	entry := &clientEntry{ready: make(chan struct{}), cancel: cancel}
	c.entries[connectionID] = entry
	c.mu.Unlock()
	buildStarted := time.Now()
	clients, err := c.factory(buildCtx, conn)
	cancel()
	if err != nil {
		promLog().Warnw(ctx, "metric client build failed",
			append([]any{"connection", connectionID, "duration_ms", time.Since(buildStarted).Milliseconds()}, diag.ClassifyError(err, false).LogFields()...)...)
	} else {
		promLog().Debugw(ctx, "metric client built", "connection", connectionID, "duration_ms", time.Since(buildStarted).Milliseconds())
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries[connectionID] != entry {
		return nil, resourcev2.NewError("RESET_REQUIRED", "Metric client generation was retired")
	}
	entry.clients, entry.err, entry.lastAccess = clients, err, c.nowFunc()
	entry.cancel = nil
	entry.readyClosed = true
	close(entry.ready)
	if err != nil {
		delete(c.entries, connectionID)
	}
	return clients, err
}

// Evict removes a specific connection from the cache.
func (c *ClientCache) Evict(connectionID string) {
	c.mu.Lock()
	entry := c.entries[connectionID]
	delete(c.entries, connectionID)
	if entry != nil && !entry.readyClosed {
		entry.err = resourcev2.NewError("RESET_REQUIRED", "Metric client generation was retired")
		entry.readyClosed = true
		close(entry.ready)
	}
	var cancel context.CancelFunc
	if entry != nil {
		cancel = entry.cancel
	}
	c.mu.Unlock()
	if entry != nil {
		promLog().Debugw(context.Background(), "metric client evicted", "connection", connectionID)
	}
	if cancel != nil {
		cancel()
	}
}

func (c *ClientCache) isCurrent(connectionID string, clients *kubeauth.KubeClientBundle) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entry := c.entries[connectionID]
	return entry != nil && entry.readyClosed && entry.err == nil && entry.clients == clients
}

// Len returns the number of cached entries.
func (c *ClientCache) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.entries)
}

// Stop shuts down the background reaper and clears the cache.
func (c *ClientCache) Stop() {
	c.mu.Lock()
	if c.stopped {
		c.mu.Unlock()
		return
	}
	c.stopped = true
	close(c.stopCh)
	var cancel []context.CancelFunc
	for _, entry := range c.entries {
		if !entry.readyClosed {
			entry.err = resourcev2.NewError("UNAVAILABLE", "Metric client cache is closed")
			entry.readyClosed = true
			close(entry.ready)
		}
		if entry.cancel != nil {
			cancel = append(cancel, entry.cancel)
		}
	}
	c.entries = nil
	c.mu.Unlock()
	for _, stop := range cancel {
		stop()
	}
}

// reapLoop periodically removes entries that haven't been accessed within the TTL.
func (c *ClientCache) reapLoop() {
	ticker := time.NewTicker(DefaultReapInterval)
	defer ticker.Stop()

	for {
		select {
		case <-c.stopCh:
			return
		case <-ticker.C:
			c.reap()
		}
	}
}

// reap removes stale entries.
func (c *ClientCache) reap() {
	now := c.nowFunc()
	c.mu.Lock()
	defer c.mu.Unlock()

	reaped := 0
	for id, entry := range c.entries {
		if entry.readyClosed && now.Sub(entry.lastAccess) > c.ttl {
			delete(c.entries, id)
			reaped++
		}
	}
	if reaped > 0 {
		promLog().Debugw(context.Background(), "idle metric clients reaped", "count", reaped)
	}
}
