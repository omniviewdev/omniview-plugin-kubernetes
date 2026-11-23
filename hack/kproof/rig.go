package main

// The rig: one launched plugin, its started connection, the canonical records of the pods in the fixtures namespace, and
// the call contexts the host builds for Describe/Options/Open (connection in the plugin context, catalog revision pinned
// by the reference admission). Adapted from the earlier proof harness (harness/logs.go Resources, execproof connect).

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	ep "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	execv2 "github.com/omniviewdev/plugin-sdk/proto/exec/v2"
)

const (
	namespace = "kproof"
	podType   = "k8s:/pods"
	provider  = "kubernetes"
)

// podRec is a pod as the host's data hooks hold it: the canonical record the plugin returned for it.
type podRec struct {
	Name     string
	Record   resourcev2.Record
	Revision string // the catalog revision the record was read under
}

type rig struct {
	P        *plugin
	Variant  string // the launch variant: the suffix of its trace file
	ConnName string
	Conn     types.Connection
	Status   types.ConnectionStatus

	mu   sync.Mutex
	pods map[string]podRec
}

// newRig loads the connections the plugin finds in $HOME/.kube/config and starts the one named connName.
func newRig(ctx context.Context, p *plugin, connName string) (*rig, error) {
	conns, err := p.Resource.LoadConnections(sctx(ctx))
	if err != nil {
		return nil, fmt.Errorf("LoadConnections: %w", err)
	}
	i := slices.IndexFunc(conns, func(c types.Connection) bool { return c.Name == connName })
	if i < 0 {
		names := make([]string, 0, len(conns))
		for _, c := range conns {
			names = append(names, c.Name)
		}
		return nil, fmt.Errorf("connection %q not found among %v", connName, names)
	}
	st, err := p.Resource.StartConnection(sctx(ctx), conns[i].ID)
	if err != nil {
		return nil, fmt.Errorf("StartConnection: %w", err)
	}
	r := &rig{P: p, ConnName: connName, Conn: conns[i], Status: st, pods: map[string]podRec{}}
	if st.Connection != nil {
		r.Conn = *st.Connection
	}
	return r, nil
}

func (r *rig) route() resourcev2.AccessRoute { return resourcev2.AccessRoute{Connection: r.Conn.ID} }

// enumerate lists the records of one resource type in a namespace (the host's list page of that kind), by name.
func (r *rig) enumerate(ctx context.Context, resourceType, ns string) (map[string]podRec, error) {
	route := r.route()
	ctx = sctx(ctx)
	catalog, err := r.P.Resource.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
	if err != nil {
		return nil, fmt.Errorf("Catalog: %w", err)
	}
	di := slices.IndexFunc(catalog.Types, func(t resourcev2.ResourceType) bool { return t.Type == resourceType })
	if di < 0 {
		return nil, fmt.Errorf("catalog has no %s (%d types)", resourceType, len(catalog.Types))
	}
	descriptor := catalog.Types[di]
	representation := descriptor.DefaultRepresentation
	if representation == "" && len(descriptor.Representations) > 0 {
		representation = descriptor.Representations[0].ID
	}
	scope := resourcev2.QueryScope{}
	for _, d := range descriptor.QueryDimensions {
		if d.Name == "namespace" {
			values := []string{ns}
			scope = append(scope, resourcev2.ScopeConstraint{Dimension: d.Name, Match: resourcev2.ScopeOneOf, Values: &values})
			continue
		}
		scope = append(scope, resourcev2.ScopeConstraint{Dimension: d.Name, Match: resourcev2.ScopeAny})
	}
	pinned := resourcev2.WithCatalogRevisionForRoute(resourcev2.WithCatalogRevision(ctx, catalog.Revision), catalog.Provider, route, catalog.Revision)
	out := map[string]podRec{}
	var cursor *string
	for {
		page, err := r.P.Resource.Enumerate(pinned, resourcev2.EnumerateRequest{
			Target: resourcev2.ReadTarget{Route: route, Provider: catalog.Provider, Authority: "kproof",
				Type: resourceType, Scope: scope, Representation: representation},
			PageSize: 200, Cursor: cursor,
		})
		if err != nil {
			return nil, fmt.Errorf("Enumerate %s: %w", resourceType, err)
		}
		for _, rec := range page.Records {
			out[rec.Reference.Address.ID] = podRec{Name: rec.Reference.Address.ID, Record: rec, Revision: catalog.Revision}
		}
		if page.NextCursor == nil || *page.NextCursor == "" {
			return out, nil
		}
		cursor = page.NextCursor
	}
}

// refresh re-reads the pods of the fixtures namespace (a pod that was deleted and recreated has a new reference).
func (r *rig) refresh(ctx context.Context) error {
	pods, err := r.enumerate(ctx, podType, namespace)
	if err != nil {
		return err
	}
	r.mu.Lock()
	r.pods = pods
	r.mu.Unlock()
	return nil
}

func (r *rig) pod(name string) (podRec, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	p, ok := r.pods[name]
	if !ok {
		return podRec{}, fmt.Errorf("pod %s/%s is not in the plugin's enumeration (%d pods)", namespace, name, len(r.pods))
	}
	return p, nil
}

// callCtx is the context the host builds for a call that addresses a pod: the connection in the plugin context and the
// catalog revision the reference was admitted under, pinned on it.
func (r *rig) callCtx(ctx context.Context, revision string) context.Context {
	admitted := resourcev2.WithCatalogRevision(sctx(ctx), revision)
	conn := r.Conn
	pc := types.NewPluginContextWithConnection(admitted, "kproof", nil, nil, &conn)
	return pc.Context
}

// describe calls Describe on the SDK's client.
func (r *rig) describe(ctx context.Context) (*execv2.DescribeResponse, error) {
	return r.P.V2.Describe(sctx(ctx))
}

// options calls Options on the SDK's client for one pod.
func (r *rig) options(ctx context.Context, pod podRec) (*ep.OptionsResult, error) {
	return r.P.V2.Options(r.callCtx(ctx, pod.Revision), ep.TargetRef{Reference: pod.Record.Reference, Route: r.route()})
}

// optionsWire calls Options on the raw gRPC stub, to read the whole wire message (every capability field).
func (r *rig) optionsWire(ctx context.Context, pod podRec) (*execv2.OptionsResponse, error) {
	ref, err := resourcev2.ToProtoResourceReference(pod.Record.Reference)
	if err != nil {
		return nil, err
	}
	route, err := resourcev2.ToProtoAccessRoute(r.route())
	if err != nil {
		return nil, err
	}
	ctx, err = resourceplugin.OutgoingSessionContext(r.callCtx(ctx, pod.Revision))
	if err != nil {
		return nil, err
	}
	return execv2.NewExecClient(r.P.Conn).Options(ctx, &execv2.OptionsRequest{Target: &execv2.TargetRef{Reference: ref, Route: route}})
}

// spec is what one Open asks for.
type spec struct {
	Pod         string
	Container   string // empty: no container in the selection
	Mode        string // empty: no mode in the selection
	Argv        []string
	TTY         bool
	Cols, Rows  uint32
	ReplayBytes uint32
	SessionID   string
	Selection   []*execv2.NameValue           // non-nil replaces Container and Mode
	Reference   *resourcev2.ResourceReference // non-nil replaces the pod's reference
	SizeAnyway  bool                          // send Cols x Rows although the session has no terminal
}

func (s spec) selection() []*execv2.NameValue {
	if s.Selection != nil {
		return s.Selection
	}
	var sel []*execv2.NameValue
	if s.Container != "" {
		sel = append(sel, &execv2.NameValue{Name: "container", Value: s.Container})
	}
	if s.Mode != "" {
		sel = append(sel, &execv2.NameValue{Name: "mode", Value: s.Mode})
	}
	return sel
}

// openRequest builds the first frame of an Open stream: the wire TargetRef is built from the pod's canonical
// ResourceReference and the AccessRoute of the connection (the mapping of the SDK's unexported targetRefToProto, plus
// the selection).
func (r *rig) openRequest(pod podRec, s spec) (*execv2.OpenRequest, error) {
	reference := pod.Record.Reference
	if s.Reference != nil {
		reference = *s.Reference
	}
	ref, err := resourcev2.ToProtoResourceReference(reference)
	if err != nil {
		return nil, err
	}
	route, err := resourcev2.ToProtoAccessRoute(r.route())
	if err != nil {
		return nil, err
	}
	start := &execv2.Start{
		Target: &execv2.TargetRef{Reference: ref, Route: route, Selection: s.selection()},
		Argv:   s.Argv, Tty: s.TTY, ReplayBytes: s.ReplayBytes,
	}
	if (s.Cols > 0 || s.Rows > 0) && (s.TTY || s.SizeAnyway) {
		start.Size = &execv2.Size{Cols: s.Cols, Rows: s.Rows}
	}
	return &execv2.OpenRequest{SessionId: s.SessionID, Kind: &execv2.OpenRequest_Start{Start: start}}, nil
}

// isResetRequired says whether err is the resource lane's stale-catalog-pin refusal.
func isResetRequired(err error) bool {
	var op *resourcev2.ResourceOperationError
	return errors.As(err, &op) && resourcev2.ErrorCode(err) == "RESET_REQUIRED"
}
