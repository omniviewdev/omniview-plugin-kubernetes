package helm

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (h *HelmAncillary) GetActions(ctx context.Context, c *clients.ClientSet, t string) ([]resource.ActionDescriptor, error) {
	switch t {
	case ReleaseType:
		return h.release.GetActions(ctx, c)
	case RepositoryType:
		return h.repository.GetActions(ctx, c)
	case ChartType:
		return h.chart.GetActions(ctx, c)
	}
	return nil, fmt.Errorf("unknown Helm type")
}

func (h *HelmAncillary) StreamAction(context.Context, *clients.ClientSet, resource.ActionRequest, chan<- resource.ActionEvent) error {
	return resource.NewError("UNSUPPORTED", "Helm exposes no streaming actions")
}

func (h *HelmAncillary) Action(ctx context.Context, c *clients.ClientSet, r resource.ActionRequest) (result resource.Value, resultErr error) {
	ctx, span := otel.Tracer("omniview.plugin.kubernetes").Start(ctx, "kubernetes.helm.action")
	defer span.End()
	stage, actionName, resourceType := "admission", "unknown", "unknown"
	defer func() {
		outcome, classification, reason, status := "success", "", "", 0
		if resultErr != nil {
			outcome, classification = "failure", "other"
			switch {
			case errors.Is(resultErr, context.Canceled):
				outcome, classification = "canceled", "canceled"
			case errors.Is(resultErr, context.DeadlineExceeded):
				outcome, classification = "canceled", "deadline_exceeded"
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
				} else if stage == "admission" {
					classification = "validation"
				}
			}
			span.SetStatus(codes.Error, classification)
		}
		attrs := []attribute.KeyValue{
			attribute.String("action", actionName), attribute.String("plugin", "kubernetes"),
			attribute.String("connection", r.Route.Connection), attribute.String("resource.type", resourceType),
			attribute.String("resource.id", r.Reference.Address.ID), attribute.String("stage", stage),
			attribute.String("outcome", outcome),
		}
		fields := []interface{}{"action", actionName, "plugin", "kubernetes", "connection", r.Route.Connection,
			"resource_type", resourceType, "resource_id", r.Reference.Address.ID, "stage", stage, "outcome", outcome}
		if resultErr != nil {
			attrs = append(attrs, attribute.String("error.class", classification))
			fields = append(fields, "error_class", classification)
			if classification == "kubernetes" {
				attrs = append(attrs, attribute.Int("k8s.status_code", status), attribute.String("k8s.reason", reason))
				fields = append(fields, "k8s_status_code", status, "k8s_reason", reason)
			}
		}
		span.SetAttributes(attrs...)
		if span.SpanContext().IsValid() {
			fields = append(fields, "trace_id", span.SpanContext().TraceID().String(), "span_id", span.SpanContext().SpanID().String())
		}
		h.release.log.Infow("Helm action finished", fields...)
	}()
	span.AddEvent("admission")
	t := r.Reference.Address.Type
	if r.TypeTarget != nil {
		t = r.TypeTarget.Type
	}
	switch t {
	case ReleaseType, RepositoryType, ChartType:
		resourceType = t
	}
	if r.TypeTarget != nil {
		if r.Reference.Address.Type != "" || r.Reference.Address.ID != "" || r.Reference.Address.Provider != "" || r.Reference.Address.Authority != "" || len(r.Reference.Address.Scope) != 0 || r.Reference.Incarnation != nil {
			return resource.Value{}, resource.NewError("INVALID_REQUEST", "Helm action requires exactly one target")
		}
		t = r.TypeTarget.Type
		if _, e := actionNamespace(r); e != nil {
			return resource.Value{}, e
		}
	} else if e := validateReference(r.Reference); e != nil {
		return resource.Value{}, e
	}
	descriptors, e := h.GetActions(ctx, c, t)
	if e != nil {
		return resource.Value{}, resource.NewError("INVALID_REQUEST", "Unknown Helm type")
	}
	found := false
	for _, descriptor := range descriptors {
		if descriptor.ID == r.Action {
			actionName = descriptor.ID
			if e := resource.ValidateActionDescriptorRequest(r, descriptor, false); e != nil {
				return resource.Value{}, e
			}
			found = true
			break
		}
	}
	if !found {
		return resource.Value{}, resource.NewError("INVALID_REQUEST", "Unknown Helm action")
	}
	if e := validateActionInput(r); e != nil {
		return resource.Value{}, e
	}
	stage = "execution"
	span.AddEvent("execution")
	switch t {
	case ReleaseType:
		return h.release.Action(ctx, c, r)
	case RepositoryType:
		return h.repository.Action(ctx, c, r)
	case ChartType:
		return h.chart.Action(ctx, c, r)
	}
	return resource.Value{}, fmt.Errorf("unknown Helm type")
}
func (h *HelmAncillary) Mutate(ctx context.Context, c *clients.ClientSet, r resource.MutationRequest) (resource.Record, error) {
	if e := validateReference(r.Reference); e != nil {
		return resource.Record{}, e
	}
	if r.ExpectedRevision != nil {
		return resource.Record{}, fmt.Errorf("Helm conditional mutations unsupported")
	}
	if r.Operation == "delete" {
		switch r.Reference.Address.Type {
		case ReleaseType:
			cfg, e := h.release.getConfig(ctx, c, namespaceOf(r.Reference))
			if e != nil {
				return resource.Record{}, e
			}
			_, e = action.NewUninstall(cfg).Run(r.Reference.Address.ID)
			if e != nil {
				return resource.Record{}, e
			}
		case RepositoryType:
			f, e := loadRepoFile()
			if e != nil {
				return resource.Record{}, e
			}
			if !f.Remove(r.Reference.Address.ID) {
				return resource.Record{}, fmt.Errorf("repository not found")
			}
			if e = f.WriteFile(repoFile(), 0600); e != nil {
				return resource.Record{}, e
			}
			_ = os.Remove(filepath.Join(cli.New().RepositoryCache, r.Reference.Address.ID+"-index.yaml"))
		default:
			return resource.Record{}, fmt.Errorf("unsupported Helm mutation")
		}
		return helmRecord(r.Reference, map[string]interface{}{"name": r.Reference.Address.ID})
	}
	actionID := ""
	if r.Operation == "create" {
		if r.Reference.Address.Type == ReleaseType {
			actionID = "install"
		} else if r.Reference.Address.Type == RepositoryType {
			actionID = "add"
		}
	}
	if actionID == "" {
		return resource.Record{}, fmt.Errorf("unsupported Helm mutation")
	}
	params, e := nativeObject(r.Input)
	if e != nil {
		return resource.Record{}, e
	}
	if params == nil {
		params = make(map[string]interface{})
	}
	params["name"] = r.Reference.Address.ID
	input, e := resource.ValueFromNative(params)
	if e != nil {
		return resource.Record{}, e
	}
	values := []string{r.Reference.Address.Scope[0].Value}
	target := &resource.TypeActionTarget{
		Provider: r.Reference.Address.Provider, Authority: r.Reference.Address.Authority, Type: r.Reference.Address.Type,
		Scope: resource.QueryScope{{Dimension: r.Reference.Address.Scope[0].Dimension, Match: resource.ScopeOneOf, Values: &values}},
	}
	v, e := h.Action(ctx, c, resource.ActionRequest{Route: r.Route, TypeTarget: target, Action: actionID, Input: input})
	if e != nil {
		return resource.Record{}, e
	}
	return resource.Record{Reference: r.Reference, Body: v.Map["data"], Representation: helmRepresentationDescriptor(), Coverage: resource.Coverage{Kind: "complete"}}, nil
}
