package resource

import (
	"context"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// labelConnectStart tags CPU profile samples of connection start and catalog
// acquisition with the connect phase and the connection ID.
func labelConnectStart(next func(context.Context, types.Connection, *clients.ClientSet) error) func(context.Context, types.Connection, *clients.ClientSet) error {
	return func(ctx context.Context, connection types.Connection, client *clients.ClientSet) (err error) {
		diag.Do(ctx, diag.PhaseConnect, connection.ID, func(ctx context.Context) { err = next(ctx, connection, client) })
		return err
	}
}

// labelSource tags CPU profile samples of a source session (informer attach,
// snapshot delivery and the live loop) with the source phase and the connection ID.
func labelSource(next func(context.Context, *clients.ClientSet, resourcev2.SourceRequest, resourcev2.SourceEmitter) error) func(context.Context, *clients.ClientSet, resourcev2.SourceRequest, resourcev2.SourceEmitter) error {
	return func(ctx context.Context, client *clients.ClientSet, request resourcev2.SourceRequest, emit resourcev2.SourceEmitter) (err error) {
		diag.Do(ctx, diag.PhaseSource, request.Target.Route.Connection, func(ctx context.Context) { err = next(ctx, client, request, emit) })
		return err
	}
}
