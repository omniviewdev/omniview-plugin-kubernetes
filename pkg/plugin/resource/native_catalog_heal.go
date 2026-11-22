package resource

import (
	"context"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// A catalog that lacks an API group because it did not answer discovery is read again while the connection is open, so that the kinds of the group appear when it recovers
// without a reconnect. INTERIM: the intended end state is an SDK coverage that can say "complete except these named groups" and a host that admits it (see
// discoverNativeSupport); the heal and the connection fact below go with the workaround.
//
// An attempt is the explicit catalog refresh (refreshNativeCatalog), which keeps its own bounds: one discovery at a time for a connection, at most one every 30 seconds, and a
// merge that never takes a kind away on the strength of a group that did not answer or of an index that lists none of the extension groups the catalog knew
// (mergeNativeDiscovery, withAbsentNativeExtensions). One wait is pending for a connection, whatever the number of groups: the heal has no timer or goroutine for each of them, and
// none once the connection stops. (An attempt on a server without aggregated discovery does start one goroutine and one timeout for each extension group version, for at most one bound.)
//
// What an attempt costs: the discovery, which is two requests on a server with aggregated discovery (every group, version and resource is in /api and /apis) and one more for
// every group version on a server without it; and one request for the cluster identity (the kube-system namespace). Three requests on a current server, and more with
// watchScopeMode auto, which lists the namespaces. A group that never answers costs that every 5 minutes. On a server without aggregated discovery a group whose read hangs
// holds its request open for one bound (nativeGroupReadBound, at most 5 s, the same for all the groups that hang together) and then is named again with the reason timeout; the
// attempt waits on nothing else, ends when the connection stops, and leaves no goroutine behind.
//
// A group that answers changes the catalog's revision and not its binding epoch (the SDK's catalog_revision.go), so the host's open sources and watches keep running and the host
// reads the new kinds at its next demand. It does not push them: an open graph observation answers RESET_REQUIRED once ("Graph declaration membership changed"), drops its demand and
// stays failed until it is synchronised again, and growth while it is failed produces nothing more; a list or a detail page pins no revision and notices nothing.

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
// (the acquisition timeout) from the start or the refresh that began the attempts.
// The entry stays the connection's pending attempt while it runs, so that a refresh
// that installs a catalog meanwhile finds a heal and does not begin a second one.
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

// followCatalogHealLocked is what an installed catalog asks of the heal: a wait to be
// pending while it lacks a group, which is begun if none is (at the first attempt's
// interval) and otherwise kept with its backoff; none once it lacks nothing. The
// caller holds p.mu.
func (p *kubernetesProvider) followCatalogHealLocked(ctx context.Context, connectionID string, snapshot *nativeCatalogSnapshot) {
	if len(snapshot.unavailable) == 0 {
		p.stopCatalogHealLocked(connectionID)
		return
	}
	if p.catalogHeals[connectionID] != nil {
		return
	}
	session, _ := resourcev2.SessionFromContext(ctx)
	p.armCatalogHealLocked(connectionID, session, 0)
}

// healCatalog runs one attempt, then arms the next while the installed catalog
// still lacks a group.
func (p *kubernetesProvider) healCatalog(connectionID string, heal *nativeCatalogHeal) {
	p.mu.Lock()
	pending := p.catalogHeals[connectionID] == heal
	p.mu.Unlock()
	if !pending {
		return
	}

	ctx := resourcev2.WithSession(context.Background(), heal.session)
	err := p.WithClient(ctx, resourcev2.AccessRoute{Connection: connectionID}, func(ctx context.Context, client *clients.ClientSet) error {
		return p.refreshNativeCatalog(ctx, connectionID, client)
	})

	p.mu.Lock()
	if p.catalogHeals[connectionID] == heal {
		// Nothing stopped, restarted or ended the loop meanwhile: wait longer while the installed catalog still lacks a group, and end the loop when it lacks none.
		if after := p.catalogs[connectionID]; after != nil && len(after.unavailable) != 0 {
			p.armCatalogHealLocked(connectionID, heal.session, heal.attempt+1)
		} else {
			delete(p.catalogHeals, connectionID)
		}
	}
	p.mu.Unlock()
	if err != nil {
		providerLog(p).Debugw("native catalog heal attempt failed", "attempt", heal.attempt+1, "error_code", resourcev2.ErrorCode(err))
	}
}

// invalidateConnectionFacts asks the SDK to observe the connection's facts again:
// the groups that do not answer are one of them (unavailableGroupsKey).
func (p *kubernetesProvider) invalidateConnectionFacts(ctx context.Context, connectionID string) {
	if p.Controller == nil {
		return
	}
	if err := p.InvalidateConnectionMetadata(context.WithoutCancel(ctx), connectionID); err != nil {
		providerLog(p).Debugw("native catalog could not update the connection fact", "error_code", resourcev2.ErrorCode(err))
	}
}

// unavailableGroupsKey is the connection fact that names the API group versions the catalog lacks because they did not answer. It is absent while every group answers. Its value is
// an object: count, how many group versions do not answer, and groups, the first unavailableGroupsListed of them in order, each {groupVersion, reason}.
// INTERIM: see discoverNativeSupport.
const unavailableGroupsKey = "kubernetes.unavailable_api_groups"

// unavailableGroupsListed is how many group versions the fact names; the rest are counted. The SDK refuses a metadata value over 16 KiB (resourcev2.MaxConnectionMetadataEntryBytes)
// and then fails the observation of every fact of the connection, the server address and the version among them, so the fact has to be bounded whatever the cluster has.
// 32 names whose JSON is as long as the longest legal name (a group of 253 characters, a version of 63, and the reason and the JSON around them) are about 12 KiB; clipGroupVersion
// holds every name to that, by its JSON and not by its length.
const unavailableGroupsListed = 32

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
	listed := unavailable[:min(len(unavailable), unavailableGroupsListed)]
	groups := make([]any, 0, len(listed))
	for _, group := range listed {
		groups = append(groups, map[string]any{"groupVersion": clipGroupVersion(group.GroupVersion), "reason": group.Reason})
	}
	update.Set[unavailableGroupsKey] = resourcev2.ConnectionMetadataObservation{
		State: "success", Value: map[string]any{"count": len(unavailable), "groups": groups}, ObservedAt: time.Now().UTC(),
	}
	return update, nil
}
