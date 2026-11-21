package resource

import (
	"context"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// A catalog that lacks an API group because it did not answer at connection start
// is read again while the connection is open, so that the kinds of the group
// appear when it recovers without a reconnect. The attempts run the explicit
// catalog refresh (refreshNativeCatalog), which keeps its own bounds: one
// discovery at a time per connection, at most one every 30 seconds, and a result
// that could not read every group may only add support to the installed catalog.
// A group that answers again changes the catalog's revision, not its binding
// epoch, so the host takes the new kinds at its next observation and retires
// nothing that is open.

// nativeHealMaxInterval is the longest wait between two attempts.
const nativeHealMaxInterval = 5 * time.Minute

// nativeHealInterval is the wait before attempt n, the first being 0: the refresh
// throttle, then doubling up to nativeHealMaxInterval. Tests replace it.
var nativeHealInterval = func(attempt int) time.Duration {
	return min(nativeCatalogRefreshInterval<<min(attempt, 4), nativeHealMaxInterval)
}

// nativeHealAfter runs f once after d and returns what cancels it. Tests replace it.
var nativeHealAfter = func(d time.Duration, f func()) (stop func() bool) {
	return time.AfterFunc(d, f).Stop
}

// nativeCatalogHeal is one pending attempt. session carries the plugin's settings
// (the acquisition timeout) from the start that began the attempts.
type nativeCatalogHeal struct {
	session resourcev2.Session
	attempt int
	stop    func() bool
}

// armCatalogHealLocked schedules attempt n for a connection, replacing a pending
// one. The caller holds p.mu.
func (p *kubernetesProvider) armCatalogHealLocked(connectionID string, session resourcev2.Session, attempt int) {
	p.stopCatalogHealLocked(connectionID)
	if p.catalogHeals == nil {
		p.catalogHeals = make(map[string]*nativeCatalogHeal)
	}
	heal := &nativeCatalogHeal{session: session, attempt: attempt}
	heal.stop = nativeHealAfter(nativeHealInterval(attempt), func() { p.healCatalog(connectionID, heal) })
	p.catalogHeals[connectionID] = heal
}

// stopCatalogHealLocked cancels the pending attempt of a connection. An attempt
// already running finds that it is no longer the pending one and ends the loop.
// The caller holds p.mu.
func (p *kubernetesProvider) stopCatalogHealLocked(connectionID string) {
	if heal := p.catalogHeals[connectionID]; heal != nil {
		heal.stop()
		delete(p.catalogHeals, connectionID)
	}
}

// healCatalog runs one attempt, then arms the next while the installed catalog
// still lacks a group.
func (p *kubernetesProvider) healCatalog(connectionID string, heal *nativeCatalogHeal) {
	p.mu.Lock()
	if p.catalogHeals[connectionID] != heal {
		p.mu.Unlock()
		return
	}
	delete(p.catalogHeals, connectionID)
	before := p.catalogs[connectionID]
	p.mu.Unlock()

	ctx := resourcev2.WithSession(context.Background(), heal.session)
	err := p.WithClient(ctx, resourcev2.AccessRoute{Connection: connectionID}, func(ctx context.Context, client *clients.ClientSet) error {
		return p.refreshNativeCatalog(ctx, connectionID, client)
	})

	p.mu.Lock()
	after := p.catalogs[connectionID]
	again := after != nil && len(after.unavailable) != 0 && p.catalogHeals[connectionID] == nil
	if again {
		p.armCatalogHealLocked(connectionID, heal.session, heal.attempt+1)
	}
	p.mu.Unlock()

	if err != nil {
		providerLog(p).Debugw("native catalog heal attempt failed", "attempt", heal.attempt+1, "error_code", resourcev2.ErrorCode(err))
	}
	if after != nil && after != before {
		// The set of unavailable groups, or the kinds, changed: the connection fact that names them follows.
		if err := p.InvalidateConnectionMetadata(ctx, connectionID); err != nil {
			providerLog(p).Debugw("native catalog heal could not update the connection fact", "error_code", resourcev2.ErrorCode(err))
		}
	}
}

// unavailableGroupsKey is the connection fact that names the API group versions
// the catalog lacks because they did not answer. It is absent while every group
// answers. Its value is a list of {groupVersion, reason}.
const unavailableGroupsKey = "kubernetes.unavailable_api_groups"

// connectionMetadataFacts observes the public server facts of a connection and
// the API groups its catalog lacks.
func (p *kubernetesProvider) connectionMetadataFacts(ctx context.Context, connection types.Connection, client *clients.ClientSet) (resourcev2.ConnectionMetadataUpdate, error) {
	update, err := connectionMetadata(ctx, connection, client)
	if err != nil {
		return update, err
	}
	p.mu.RLock()
	var unavailable []nativeUnavailable
	if snapshot := p.catalogs[connection.ID]; snapshot != nil {
		unavailable = snapshot.unavailable
	}
	p.mu.RUnlock()
	if len(unavailable) == 0 {
		update.Remove = append(update.Remove, unavailableGroupsKey)
		return update, nil
	}
	groups := make([]any, 0, len(unavailable))
	for _, group := range unavailable {
		groups = append(groups, map[string]any{"groupVersion": group.GroupVersion, "reason": group.Reason})
	}
	update.Set[unavailableGroupsKey] = resourcev2.ConnectionMetadataObservation{State: "success", Value: groups, ObservedAt: time.Now().UTC()}
	return update, nil
}
