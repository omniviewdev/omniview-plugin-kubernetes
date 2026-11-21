package kubeauth

import "context"

type connectionIDKey struct{}

// WithConnectionID returns ctx labelled with the ID of the connection whose clients are built
// under it. The ID is only a label: it names the connection in the spans, logs and profiler
// samples of the build, so that they line up with every other diagnostic of the connection.
// It never selects anything. The kube context that does is a separate argument of the
// builders, and the ID of a connection is not the name of a context.
//
// A nil ctx stays nil, so that a builder still reports the missing context itself.
func WithConnectionID(ctx context.Context, id string) context.Context {
	if ctx == nil {
		return nil
	}
	return context.WithValue(ctx, connectionIDKey{}, id)
}

// connectionLabel is the connection that a build under ctx is labelled with: the ID that
// WithConnectionID gave, and else the kube context that the clients are built for.
func connectionLabel(ctx context.Context, kubeContext string) string {
	if id, ok := ctx.Value(connectionIDKey{}).(string); ok && id != "" {
		return id
	}
	return kubeContext
}
