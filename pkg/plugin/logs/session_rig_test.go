package logs

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// A rig that runs the plugin's own log handlers (what Register installs) under the SDK's real log
// manager, over the fake kubelet.

// sinkItem is a line or an event, in the order the manager sent it.
type sinkItem struct {
	line  *sdklogs.LogLine
	event *sdklogs.LogStreamEvent
}

// orderedSink records what a manager sends in the one order it sent it.
type orderedSink struct {
	mu    sync.Mutex
	items []sinkItem
}

func (s *orderedSink) OnLine(line sdklogs.LogLine) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items = append(s.items, sinkItem{line: &line})
}

func (s *orderedSink) OnEvent(_ string, event sdklogs.LogStreamEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items = append(s.items, sinkItem{event: &event})
}

func (s *orderedSink) snapshot() []sinkItem {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]sinkItem(nil), s.items...)
}

// waitFor blocks until what the sink holds satisfies ok.
func (s *orderedSink) waitFor(t *testing.T, what string, ok func([]sinkItem) bool) []sinkItem {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for {
		items := s.snapshot()
		if ok(items) {
			return items
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s; the sink holds %s", what, describe(items))
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func describe(items []sinkItem) string {
	counts := map[string]int{}
	for _, item := range items {
		switch {
		case item.line != nil:
			counts["line "+item.line.SourceID]++
		case item.event != nil:
			counts["event "+item.event.Type.String()+" "+item.event.SourceID]++
		}
	}
	return fmt.Sprint(counts)
}

type sessionRig struct {
	t       *testing.T
	kubelet *fakeKubelet
	manager *sdklogs.Manager
	sink    *orderedSink
}

func newSessionRig(t *testing.T) *sessionRig {
	t.Helper()
	return newSessionRigResolving(t, nil)
}

// newSessionRigResolving is a rig whose group resources resolve to the sources the resolvers say; nil
// keeps the plugin's own resolvers.
func newSessionRigResolving(t *testing.T, resolved map[string]sdklogs.SourceResolver) *sessionRig {
	t.Helper()
	return newSessionRigBound(t, resolved, replayCountBound)
}

// newSessionRigBound is a rig whose replay count is bounded by bound.
func newSessionRigBound(t *testing.T, resolved map[string]sdklogs.SourceResolver, bound time.Duration) *sessionRig {
	t.Helper()
	k := newFakeKubelet(t)
	leases := newLeases(k)
	sink := &orderedSink{}
	// RegisterPlugin keys the handlers of a plugin by "plugin/resource"; so does the rig.
	keyed := map[string]sdklogs.Handler{}
	for key, handler := range handlersWithin(leases.borrow, bound, nil) {
		keyed[handler.Plugin+"/"+key] = handler
	}
	groups := resolvers(leases.borrow)
	if resolved != nil {
		groups = resolved
	}
	manager := sdklogs.NewManager(sdklogs.ManagerConfig{
		Handlers:  keyed,
		Resolvers: groups,
		Sink:      sink,
	})
	manager.BindConnectionContextProvider(admittedConnections{})
	t.Cleanup(manager.Close)
	return &sessionRig{t: t, kubelet: k, manager: manager, sink: sink}
}

// admittedConnections admits every route the way the resource registry admits a started connection.
type admittedConnections struct{}

func (admittedConnections) WithConnection(ctx context.Context, route resourcev2.AccessRoute, use func(context.Context, types.Connection) error) error {
	return use(ctx, types.Connection{ID: route.Connection})
}

// podResource is the Pod's resource data the way a source builder reads it.
func podResource(namespace, pod string, init, containers, ephemeral []string) *resourcev2.Value {
	named := func(names []string) []any {
		out := make([]any, 0, len(names))
		for _, name := range names {
			out = append(out, map[string]any{"name": name})
		}
		return out
	}
	return taggedFixture(map[string]any{
		"metadata": map[string]any{"name": pod, "namespace": namespace},
		"spec": map[string]any{
			"nodeName":            "node-1",
			"initContainers":      named(init),
			"containers":          named(containers),
			"ephemeralContainers": named(ephemeral),
		},
	})
}

func (r *sessionRig) create(data *resourcev2.Value, options sdklogs.LogSessionOptions) *sdklogs.LogSession {
	r.t.Helper()
	ctx := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	session, err := r.manager.CreateResourceSession(ctx, sdklogs.CreateSessionOptions{
		ResourceKey: "k8s:/pods", ResourceID: "pod", ResourceData: data, Options: options,
	})
	require.NoError(r.t, err)
	return session
}

// bySource splits what the sink holds per source, keeping the order.
func bySource(items []sinkItem) map[string][]sinkItem {
	out := map[string][]sinkItem{}
	for _, item := range items {
		switch {
		case item.line != nil:
			out[item.line.SourceID] = append(out[item.line.SourceID], item)
		case item.event != nil && item.event.SourceID != "":
			out[item.event.SourceID] = append(out[item.event.SourceID], item)
		}
	}
	return out
}

// lineKey is what a reader gets of a line, apart from the replay flag.
func lineKey(l *sdklogs.LogLine) string {
	return fmt.Sprintf("%s|%s|%s|%d|%v", l.SourceID, l.Timestamp.UTC().Format(time.RFC3339Nano), l.Content, l.Origin, l.Labels)
}

func linesOf(items []sinkItem) []string {
	var out []string
	for _, item := range items {
		if item.line != nil {
			out = append(out, lineKey(item.line))
		}
	}
	return out
}
