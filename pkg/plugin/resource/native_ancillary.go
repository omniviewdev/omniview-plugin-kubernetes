package resource

import (
	"context"
	"errors"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (p *kubernetesProvider) ScopeValues(ctx context.Context, route resourcev2.AccessRoute, dimension string) (values []string, err error) {
	if dimension != "namespace" {
		return nil, resourcev2.NewError("UNSUPPORTED", "Kubernetes does not declare this scope dimension")
	}
	err = p.WithClient(ctx, route, func(ctx context.Context, client *clients.ClientSet) error {
		values, err = p.connections.GetNamespaces(ctx, client)
		return err
	})
	return values, err
}

func (p *kubernetesProvider) WatchConnections(ctx context.Context, stream chan<- []types.Connection) error {
	updates, err := p.connections.WatchConnections(ctx)
	if err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case connections, ok := <-updates:
			if !ok {
				return ctx.Err()
			}
			if err := p.ApplyConnections(ctx, connections); err != nil {
				return err
			}
			current, err := p.ListConnections(ctx)
			if err != nil {
				return err
			}
			select {
			case stream <- current:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
}

func (p *kubernetesProvider) GetActions(ctx context.Context, route resourcev2.AccessRoute, token string) (actions []resourcev2.ActionDescriptor, err error) {
	err = p.WithClient(ctx, route, func(ctx context.Context, client *clients.ClientSet) error {
		snapshot, snapshotErr := p.snapshot(route)
		if snapshotErr != nil {
			return snapshotErr
		}
		found := false
		for _, descriptor := range snapshot.catalog.Types {
			if descriptor.Type == token {
				found = true
				break
			}
		}
		if !found {
			return resourcev2.NewError("NOT_FOUND", "Resource type is not present in this connection catalog")
		}
		if token == editorQueryType {
			actions = editorQueryRegistration().Actions
			return nil
		}
		if binding, ok := snapshot.bindings[token]; ok {
			actions = binding.Actions
			return nil
		}
		for _, descriptor := range p.helmTypes {
			if descriptor.Type == token {
				actions, err = p.helmAncillary.GetActions(ctx, client, token)
				return err
			}
		}
		return resourcev2.NewError("UNSUPPORTED", "Resource type does not provide actions")
	})
	return actions, err
}

func (p *kubernetesProvider) StreamAction(ctx context.Context, request resourcev2.ActionRequest, stream chan<- resourcev2.ActionEvent) (resultErr error) {
	operation, delegated := "admit", false
	if request.Action == "drain" && request.Reference.Address.Type == "k8s:/nodes" {
		var span trace.Span
		ctx, span = otel.Tracer("omniview.plugin.kubernetes").Start(ctx, "kubernetes.node.drain.preflight")
		defer span.End()
		defer func() {
			if delegated || resultErr == nil {
				return
			}
			classification, reason, status := "other", "", 0
			switch {
			case errors.Is(resultErr, context.Canceled):
				classification = "canceled"
			case errors.Is(resultErr, context.DeadlineExceeded):
				classification = "deadline_exceeded"
			default:
				var apiStatus apierrors.APIStatus
				if errors.As(resultErr, &apiStatus) {
					classification = "kubernetes"
					s := apiStatus.Status()
					status = int(s.Code)
					switch s.Reason {
					case metav1.StatusReasonUnauthorized, metav1.StatusReasonForbidden, metav1.StatusReasonNotFound,
						metav1.StatusReasonAlreadyExists, metav1.StatusReasonConflict, metav1.StatusReasonInvalid,
						metav1.StatusReasonTooManyRequests, metav1.StatusReasonTimeout, metav1.StatusReasonServerTimeout,
						metav1.StatusReasonServiceUnavailable, metav1.StatusReasonInternalError, metav1.StatusReasonBadRequest,
						metav1.StatusReasonMethodNotAllowed, metav1.StatusReasonGone, metav1.StatusReasonExpired:
						reason = string(s.Reason)
					default:
						reason = "Other"
					}
				} else if operation == "admit" {
					classification = "validation"
				}
			}
			outcome := "failure"
			if classification == "canceled" || classification == "deadline_exceeded" {
				outcome = "canceled"
			}
			attrs := []attribute.KeyValue{attribute.String("action", "drain"), attribute.String("plugin", "kubernetes"),
				attribute.String("connection", request.Route.Connection), attribute.String("resource.type", "k8s:/nodes"),
				attribute.String("resource.id", request.Reference.Address.ID), attribute.String("stage", "preflight"),
				attribute.String("operation", operation), attribute.String("outcome", outcome), attribute.String("error.class", classification)}
			fields := []interface{}{"action", "drain", "plugin", "kubernetes", "connection", request.Route.Connection,
				"resource_type", "k8s:/nodes", "resource_id", request.Reference.Address.ID, "stage", "preflight",
				"operation", operation, "outcome", outcome, "error_class", classification, "cordon_known", false, "selection_known", false}
			if classification == "kubernetes" {
				attrs = append(attrs, attribute.Int("k8s.status_code", status), attribute.String("k8s.reason", reason))
				fields = append(fields, "k8s_status_code", status, "k8s_reason", reason)
			}
			span.SetAttributes(attrs...)
			span.SetStatus(codes.Error, classification)
			if span.SpanContext().IsValid() {
				fields = append(fields, "trace_id", span.SpanContext().TraceID().String(), "span_id", span.SpanContext().SpanID().String())
			}
			p.logger.Infow("Node drain preflight failed", fields...)
		}()
	}
	if _, err := resourcev2.AdmitStreamingAction(ctx, p, request); err != nil {
		return err
	}
	operation = "lookup_helper"
	helper, ok := p.helpers[request.Reference.Address.Type].(nativeStreamingActionHelper)
	if !ok {
		return resourcev2.NewError("UNSUPPORTED", "Resource type does not provide streaming actions")
	}
	operation = "lookup_catalog"
	snapshot, err := p.snapshot(request.Route)
	if err != nil {
		return err
	}
	binding, ok := snapshot.bindings[request.Reference.Address.Type]
	if !ok {
		return resourcev2.NewError("NOT_FOUND", "Resource type is not present in this connection catalog")
	}
	operation = "acquire_client"
	return p.WithClient(ctx, request.Route, func(ctx context.Context, client *clients.ClientSet) error {
		operation = "get_node"
		if _, err := NativeGet(ctx, client.DynamicClient, binding.GVR, binding.API.Namespaced, resourcev2.GetRequest{Route: request.Route, Reference: request.Reference, Representation: binding.Descriptor.DefaultRepresentation}, binding.Descriptor.Representations[0]); err != nil {
			return err
		}
		delegated = true
		return helper.StreamAction(ctx, client, request, stream)
	})
}

type nativeStreamingActionHelper interface {
	StreamAction(context.Context, *clients.ClientSet, resourcev2.ActionRequest, chan<- resourcev2.ActionEvent) error
}

func (p *kubernetesProvider) Features(ctx context.Context) (resourcev2.FeatureSet, error) {
	features, err := p.Controller.Features(ctx)
	if err != nil {
		return resourcev2.FeatureSet{}, err
	}
	for _, feature := range []resourcev2.Feature{
		resourcev2.FeatureConnectionBrowser,
		resourcev2.FeatureScopeValues,
		resourcev2.FeaturePresentation,
		resourcev2.FeatureEditorSchemas,
		resourcev2.FeatureSchemaDocuments,
		resourcev2.FeatureRelationships,
		resourcev2.FeatureHealth,
		resourcev2.FeatureActionCatalog,
		resourcev2.FeatureStreamingActions,
	} {
		if !features.Has(feature) {
			features.Traits = append(features.Traits, feature)
		}
	}
	return features, resourcev2.ValidateFeatures(features)
}
