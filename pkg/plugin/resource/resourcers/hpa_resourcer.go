package resourcers

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"go.uber.org/zap"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
)

// HPAResourcer wraps KubernetesResourcerBase for CRUD and adds kind-aware
// relationship resolution for HorizontalPodAutoscaler → scaleTargetRef.
type HPAResourcer struct {
	*KubernetesResourcerBase[MetaAccessor]
	log *zap.SugaredLogger
}

// Compile-time interface checks.
var (
	_ resource.Resourcer[clients.ClientSet]            = (*HPAResourcer)(nil)
	_ resource.RelationshipDeclarer                     = (*HPAResourcer)(nil)
	_ resource.RelationshipResolver[clients.ClientSet]  = (*HPAResourcer)(nil)
)

// NewHPAResourcer creates an HPAResourcer for autoscaling::v2::HorizontalPodAutoscaler.
func NewHPAResourcer(logger *zap.SugaredLogger, opts ...Option) *HPAResourcer {
	base := NewKubernetesResourcerBase[MetaAccessor](
		logger,
		autoscalingv2.SchemeGroupVersion.WithResource("horizontalpodautoscalers"),
		opts...,
	)
	return &HPAResourcer{
		KubernetesResourcerBase: base,
		log:                     logger.Named("HPAResourcer"),
	}
}

// scaleTargetRefToResourceKey maps the HPA scaleTargetRef apiVersion+kind to
// the internal resource key used by the relationship table. Keys use the form
// "apiVersion::Kind" to avoid mis-resolving HPAs that target a different API group.
var scaleTargetRefToResourceKey = map[string]string{
	"apps/v1::Deployment":  "apps::v1::Deployment",
	"apps/v1::StatefulSet": "apps::v1::StatefulSet",
}

// ResolveRelationships resolves runtime relationship instances for an HPA.
// It inspects spec.scaleTargetRef.kind and apiVersion to emit an edge only to the correct target.
func (h *HPAResourcer) ResolveRelationships(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	id string,
	namespace string,
) ([]resource.ResolvedRelationship, error) {
	result, err := h.Get(ctx, client, meta, resource.GetInput{ID: id, Namespace: namespace})
	if err != nil {
		return nil, fmt.Errorf("failed to get HPA %s: %w", id, err)
	}

	var hpa autoscalingv2.HorizontalPodAutoscaler
	if err := json.Unmarshal(result.Result, &hpa); err != nil {
		return nil, fmt.Errorf("failed to unmarshal HPA: %w", err)
	}

	ref := hpa.Spec.ScaleTargetRef
	lookupKey := ref.APIVersion + "::" + ref.Kind

	resourceKey, ok := scaleTargetRefToResourceKey[lookupKey]
	if !ok || ref.Name == "" {
		return nil, nil
	}

	byTarget := descriptorByTarget(h.DeclareRelationships())
	desc, ok := byTarget[resourceKey]
	if !ok {
		return nil, fmt.Errorf("missing relationship descriptor for %s; ensure WithRelationships(RelationshipTable()[\"autoscaling::v2::HorizontalPodAutoscaler\"]) is provided", resourceKey)
	}

	return []resource.ResolvedRelationship{
		{
			Descriptor: desc,
			Targets: []resource.ResourceRef{
				makeRef(resourceKey, ref.Name, namespace),
			},
		},
	}, nil
}
