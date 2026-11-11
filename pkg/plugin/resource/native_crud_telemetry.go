package resource

import (
	"context"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

// nativeCRUDCall traces one native Kubernetes get/list/create/update/delete.
// It records identifiers and counts only; never bodies, selectors or API error text.
type nativeCRUDCall struct {
	span       trace.Span
	verb       string
	resource   string
	namespace  string
	id         string
	startedAt  time.Time
	isMutation bool
}

// nativeCRUDVerb maps a mutation operation to a span verb from a closed set.
func nativeCRUDVerb(operation string) string {
	switch operation {
	case "create", "update", "delete":
		return operation
	default:
		return "mutate"
	}
}

func nativeScopeNamespace(scope []resourcev2.ScopeEntry) string {
	for _, entry := range scope {
		if entry.Dimension == "namespace" {
			return entry.Value
		}
	}
	return ""
}

func startNativeCRUD(ctx context.Context, verb, resourceType, namespace, id string) (context.Context, *nativeCRUDCall) {
	ctx, span := diag.Tracer().Start(ctx, "kubernetes.resource."+verb)
	span.SetAttributes(
		attribute.String("resource.type", resourceType),
		attribute.String("resource.namespace", namespace),
		attribute.String("resource.id", id),
	)
	return ctx, &nativeCRUDCall{
		span: span, verb: verb, resource: resourceType, namespace: namespace, id: id,
		startedAt: time.Now(), isMutation: verb == "create" || verb == "update" || verb == "delete" || verb == "mutate",
	}
}

// end closes the span with the classified outcome and writes the per-call log.
func (c *nativeCRUDCall) end(err error, extra ...attribute.KeyValue) {
	elapsed := time.Since(c.startedAt)
	c.span.SetAttributes(extra...)
	c.span.SetAttributes(attribute.Int64("duration_ms", elapsed.Milliseconds()))
	class := diag.EndSpan(c.span, err, false)
	fields := []any{"operation", c.verb, "resource_type", c.resource, "namespace", c.namespace, "resource_id", c.id, "duration_ms", elapsed.Milliseconds()}
	for _, kv := range extra {
		fields = append(fields, string(kv.Key), kv.Value.AsInterface())
	}
	fields = append(fields, class.LogFields()...)
	log := zap.S().Named("native")
	switch {
	case class.Outcome == "failure" && c.isMutation:
		log.Errorw("native resource mutation failed", fields...)
	case class.Outcome == "failure":
		log.Debugw("native resource read failed", fields...)
	default:
		log.Debugw("native resource call", fields...)
	}
}
