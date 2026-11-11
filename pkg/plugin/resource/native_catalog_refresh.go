package resource

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

const nativeCatalogRefreshInterval = 30 * time.Second

type nativeCatalogRefresh struct {
	done chan struct{}
	err  error
}

// Only explicit catalog refreshes enter this bounded discovery acquisition.
// Failures belong to refresh callers, never ordinary snapshot observation.
func (p *kubernetesProvider) refreshNativeCatalog(ctx context.Context, connectionID string, client *clients.ClientSet) error {
	p.mu.Lock()
	previous := p.catalogs[connectionID]
	if previous == nil {
		p.mu.Unlock()
		return resourcev2.NewError("UNAVAILABLE", "Connection catalog is not available")
	}
	if refresh := p.catalogRefreshes[connectionID]; refresh != nil {
		p.mu.Unlock()
		providerLog(p).Debugw("native catalog refresh joined in-flight acquisition")
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-refresh.done:
			return refresh.err
		}
	}
	if time.Now().Before(previous.nextRefresh) {
		err := previous.refreshError
		p.mu.Unlock()
		providerLog(p).Debugw("native catalog refresh throttled", diag.ClassifyError(err, false).LogFields()...)
		return err
	}
	refresh := &nativeCatalogRefresh{done: make(chan struct{})}
	if p.catalogRefreshes == nil {
		p.catalogRefreshes = make(map[string]*nativeCatalogRefresh)
	}
	p.catalogRefreshes[connectionID] = refresh
	p.mu.Unlock()

	var snapshot *nativeCatalogSnapshot
	var changed bool
	refreshStarted := time.Now()
	ctx, span := diag.Tracer().Start(ctx, "kubernetes.catalog.refresh")
	timeout, err := resourcev2.ConnectionAcquisitionTimeout(ctx)
	if err == nil {
		acquisition, cancel := context.WithTimeout(ctx, timeout)
		snapshot, changed, err = p.acquireNativeCatalog(acquisition, connectionID, client, previous)
		cancel()
	}
	p.mu.Lock()
	if p.catalogs[connectionID] != previous || ctx.Err() != nil {
		if err == nil {
			err = resourcev2.NewError("RESET_REQUIRED", "Native connection catalog acquisition was retired")
		}
	} else {
		if err == nil && changed {
			p.catalogs[connectionID] = snapshot
			pruneNativeSchemas(snapshot)
		}
		current := p.catalogs[connectionID]
		current.nextRefresh = time.Now().Add(nativeCatalogRefreshInterval)
		current.refreshError = err
	}
	if p.catalogRefreshes[connectionID] == refresh {
		delete(p.catalogRefreshes, connectionID)
	}
	refresh.err = err
	close(refresh.done)
	p.mu.Unlock()
	if snapshot != nil {
		span.SetAttributes(attribute.Int("served_types", len(snapshot.bindings)))
	}
	span.SetAttributes(attribute.Bool("changed", changed), attribute.Int64("duration_ms", time.Since(refreshStarted).Milliseconds()))
	class := diag.EndSpan(span, err, false)
	diag.CatalogRefresh(class.Outcome)
	if class.Outcome == "failure" {
		providerLog(p).Warnw("native catalog refresh failed", append([]any{"changed", changed, "duration_ms", time.Since(refreshStarted).Milliseconds()}, class.LogFields()...)...)
	} else {
		providerLog(p).Debugw("native catalog refresh finished", append([]any{"changed", changed, "duration_ms", time.Since(refreshStarted).Milliseconds()}, class.LogFields()...)...)
	}
	return err
}

func (p *kubernetesProvider) acquireNativeCatalog(ctx context.Context, connectionID string, client *clients.ClientSet, previous *nativeCatalogSnapshot) (*nativeCatalogSnapshot, bool, error) {
	bindings, coverage, err := discoverNativeTypes(ctx, client.DiscoveryClient)
	if err != nil {
		return nil, false, err
	}
	identity, err := nativeClusterIdentity(ctx, client.KubeClient)
	if err != nil {
		return nil, false, err
	}
	var hint *resourcev2.NativeAuthorityHint
	if identity != nil {
		hint = &resourcev2.NativeAuthorityHint{Scheme: "kubernetes.namespace-uid.v1", ID: *identity, Continuity: resourcev2.ContinuityConnectionLocal}
	}
	if previous != nil && previous.identityHint != nil && (hint == nil || hint.ID != previous.identityHint.ID) {
		return nil, false, resourcev2.NewError("RESET_REQUIRED", "Native Kubernetes backing identity changed; reconnect before acquiring resources")
	}
	watchScope, err := p.connections.ResolveScope(ctx, client)
	if err != nil {
		return nil, false, err
	}
	if previous != nil && coverage.Kind != "complete" {
		return nil, false, resourcev2.NewError("UNAVAILABLE", "Partial discovery cannot replace installed native support")
	}
	encoded, err := json.Marshal(struct {
		Bindings   map[string]nativeType
		Coverage   resourcev2.Coverage
		Identity   *resourcev2.NativeAuthorityHint
		WatchScope resourcev2.QueryScope
	}{bindings, coverage, hint, watchScope})
	if err != nil {
		return nil, false, err
	}
	digest := sha256.Sum256(encoded)
	revision := hex.EncodeToString(digest[:])
	trace.SpanFromContext(ctx).SetAttributes(attribute.Int("served_types", len(bindings)))
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	snapshot, err := p.assembleNativeCatalog(ctx, connectionID, client, bindings, coverage, hint, watchScope)
	if err != nil {
		return nil, false, err
	}
	if previous != nil {
		if previous.discoveryRevision == revision && previous.catalog.Revision == snapshot.catalog.Revision {
			return previous, false, nil
		}
		snapshot.schemas = previous.schemas
	}
	snapshot.discoveryRevision = revision
	return snapshot, true, nil
}
