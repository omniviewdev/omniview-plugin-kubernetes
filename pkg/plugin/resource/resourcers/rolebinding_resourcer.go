package resourcers

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"go.uber.org/zap"
	rbacv1 "k8s.io/api/rbac/v1"
)

// RoleBindingResourcer wraps KubernetesResourcerBase for CRUD and adds
// kind-aware relationship resolution for RoleBinding → roleRef (Role or ClusterRole).
type RoleBindingResourcer struct {
	*KubernetesResourcerBase[MetaAccessor]
	log *zap.SugaredLogger
}

// Compile-time interface checks.
var (
	_ resource.Resourcer[clients.ClientSet]            = (*RoleBindingResourcer)(nil)
	_ resource.RelationshipDeclarer                     = (*RoleBindingResourcer)(nil)
	_ resource.RelationshipResolver[clients.ClientSet]  = (*RoleBindingResourcer)(nil)
)

// NewRoleBindingResourcer creates a RoleBindingResourcer for rbac::v1::RoleBinding.
func NewRoleBindingResourcer(logger *zap.SugaredLogger, opts ...Option) *RoleBindingResourcer {
	base := NewKubernetesResourcerBase[MetaAccessor](
		logger,
		rbacv1.SchemeGroupVersion.WithResource("rolebindings"),
		opts...,
	)
	return &RoleBindingResourcer{
		KubernetesResourcerBase: base,
		log:                     logger.Named("RoleBindingResourcer"),
	}
}

// roleRefKindToResourceKey maps roleRef.kind to the internal resource key.
var roleRefKindToResourceKey = map[string]string{
	"Role":        "rbac::v1::Role",
	"ClusterRole": "rbac::v1::ClusterRole",
}

// ResolveRelationships resolves runtime relationship instances for a RoleBinding.
// It inspects roleRef.kind to emit an edge to either Role or ClusterRole.
func (r *RoleBindingResourcer) ResolveRelationships(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	id string,
	namespace string,
) ([]resource.ResolvedRelationship, error) {
	result, err := r.Get(ctx, client, meta, resource.GetInput{ID: id, Namespace: namespace})
	if err != nil {
		return nil, fmt.Errorf("failed to get RoleBinding %s: %w", id, err)
	}

	var rb rbacv1.RoleBinding
	if err := json.Unmarshal(result.Result, &rb); err != nil {
		return nil, fmt.Errorf("failed to unmarshal RoleBinding: %w", err)
	}

	refKind := rb.RoleRef.Kind
	refName := rb.RoleRef.Name

	resourceKey, ok := roleRefKindToResourceKey[refKind]
	if !ok || refName == "" {
		return nil, nil
	}

	byTarget := descriptorByTarget(r.DeclareRelationships())
	desc, ok := byTarget[resourceKey]
	if !ok {
		return nil, nil
	}

	// For ClusterRole targets, the ref is cluster-scoped so namespace is empty.
	targetNamespace := namespace
	if refKind == "ClusterRole" {
		targetNamespace = ""
	}

	return []resource.ResolvedRelationship{
		{
			Descriptor: desc,
			Targets: []resource.ResourceRef{
				makeRef(resourceKey, refName, targetNamespace),
			},
		},
	}, nil
}
