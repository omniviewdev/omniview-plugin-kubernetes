package resourcers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"go.uber.org/zap"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/watch"
)

// StatefulSetResourcer wraps KubernetesResourcerBase for CRUD and adds
// statefulset-specific actions: restart, scale.
type StatefulSetResourcer struct {
	*KubernetesResourcerBase[MetaAccessor]
	log *zap.SugaredLogger
}

// Compile-time interface checks.
var (
	_ resource.Resourcer[clients.ClientSet]            = (*StatefulSetResourcer)(nil)
	_ resource.ActionResourcer[clients.ClientSet]       = (*StatefulSetResourcer)(nil)
	_ resource.RelationshipDeclarer                     = (*StatefulSetResourcer)(nil)
	_ resource.RelationshipResolver[clients.ClientSet]  = (*StatefulSetResourcer)(nil)
)

// NewStatefulSetResourcer creates a StatefulSetResourcer for apps::v1::StatefulSet.
func NewStatefulSetResourcer(logger *zap.SugaredLogger) *StatefulSetResourcer {
	base := NewKubernetesResourcerBase[MetaAccessor](
		logger,
		appsv1.SchemeGroupVersion.WithResource("statefulsets"),
		WithRelationships([]resource.RelationshipDescriptor{
			{
				Type:              resource.RelOwns,
				TargetResourceKey: "core::v1::Pod",
				Label:             "owns",
				InverseLabel:      "owned by",
				Cardinality:       "one-to-many",
				Extractor:         &resource.RelationshipExtractor{Method: "ownerRef", OwnerRefKind: "StatefulSet"},
			},
			{
				Type:              resource.RelUses,
				TargetResourceKey: "core::v1::PersistentVolumeClaim",
				Label:             "uses",
				InverseLabel:      "used by",
				Cardinality:       "one-to-many",
				Extractor:         &resource.RelationshipExtractor{Method: "fieldPath", FieldPath: "spec.volumeClaimTemplates[*].metadata.name"},
			},
			{
				Type:              resource.RelUses,
				TargetResourceKey: "core::v1::ConfigMap",
				Label:             "uses",
				InverseLabel:      "used by",
				Cardinality:       "many-to-many",
				Extractor:         &resource.RelationshipExtractor{Method: "fieldPath", FieldPath: "spec.template.spec.volumes[*].configMap.name"},
			},
			{
				Type:              resource.RelUses,
				TargetResourceKey: "core::v1::Secret",
				Label:             "uses",
				InverseLabel:      "used by",
				Cardinality:       "many-to-many",
				Extractor:         &resource.RelationshipExtractor{Method: "fieldPath", FieldPath: "spec.template.spec.volumes[*].secret.secretName"},
			},
		}),
	)
	return &StatefulSetResourcer{
		KubernetesResourcerBase: base,
		log:                     logger.Named("StatefulSetResourcer"),
	}
}

// ResolveRelationships resolves runtime relationship instances for a StatefulSet.
func (s *StatefulSetResourcer) ResolveRelationships(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	id string,
	namespace string,
) ([]resource.ResolvedRelationship, error) {
	result, err := s.Get(ctx, client, meta, resource.GetInput{ID: id, Namespace: namespace})
	if err != nil {
		return nil, fmt.Errorf("failed to get statefulset %s: %w", id, err)
	}

	var sts appsv1.StatefulSet
	if err := json.Unmarshal(result.Result, &sts); err != nil {
		return nil, fmt.Errorf("failed to unmarshal statefulset: %w", err)
	}

	var rels []resource.ResolvedRelationship
	descriptors := s.DeclareRelationships()

	// Pod relationships via ownerRef.
	pods, err := listPodsByOwner(ctx, client, namespace, "StatefulSet", id, string(sts.UID))
	if err == nil && len(pods) > 0 {
		targets := make([]resource.ResourceRef, 0, len(pods))
		for _, pod := range pods {
			targets = append(targets, makeRef("core::v1::Pod", pod.Name, namespace))
		}
		rels = append(rels, resource.ResolvedRelationship{
			Descriptor: descriptors[0], // RelOwns → Pod
			Targets:    targets,
		})
	}

	// PVC relationships from volumeClaimTemplates.
	if len(sts.Spec.VolumeClaimTemplates) > 0 {
		targets := make([]resource.ResourceRef, 0, len(sts.Spec.VolumeClaimTemplates))
		for _, vct := range sts.Spec.VolumeClaimTemplates {
			targets = append(targets, makeRef("core::v1::PersistentVolumeClaim", vct.Name, namespace))
		}
		rels = append(rels, resource.ResolvedRelationship{
			Descriptor: descriptors[1], // RelUses → PVC
			Targets:    targets,
		})
	}

	// ConfigMap relationships from volumes.
	if cms := extractVolumeConfigMaps(sts.Spec.Template.Spec); len(cms) > 0 {
		targets := make([]resource.ResourceRef, 0, len(cms))
		for _, name := range cms {
			targets = append(targets, makeRef("core::v1::ConfigMap", name, namespace))
		}
		rels = append(rels, resource.ResolvedRelationship{
			Descriptor: descriptors[2], // RelUses → ConfigMap
			Targets:    targets,
		})
	}

	// Secret relationships from volumes.
	if secrets := extractVolumeSecrets(sts.Spec.Template.Spec); len(secrets) > 0 {
		targets := make([]resource.ResourceRef, 0, len(secrets))
		for _, name := range secrets {
			targets = append(targets, makeRef("core::v1::Secret", name, namespace))
		}
		rels = append(rels, resource.ResolvedRelationship{
			Descriptor: descriptors[3], // RelUses → Secret
			Targets:    targets,
		})
	}

	return rels, nil
}

// ====================== ACTION INTERFACE ====================== //

func (s *StatefulSetResourcer) GetActions(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
) ([]resource.ActionDescriptor, error) {
	return []resource.ActionDescriptor{
		{
			ID:          "restart",
			Label:       "Rollout Restart",
			Description: "Restart all pods in this statefulset via a rolling update",
			Icon:        "LuRefreshCw",
			Scope:       resource.ActionScopeInstance,
			Dangerous:   true,
			Streaming:   true,
		},
		{
			ID:          "scale",
			Label:       "Scale",
			Description: "Change the number of replicas",
			Icon:        "LuScaling",
			Scope:       resource.ActionScopeInstance,
			ParamsSchema: &resource.Schema{
				Properties: map[string]resource.SchemaProperty{
					"replicas": {Type: resource.SchemaInteger, Minimum: resource.PtrFloat64(0), Description: "Desired number of replicas"},
				},
				Required: []string{"replicas"},
			},
		},
	}, nil
}

func (s *StatefulSetResourcer) ExecuteAction(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	actionID string,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	switch actionID {
	case "restart":
		return s.executeRestart(ctx, client, input)
	case "scale":
		return s.executeScale(ctx, client, input)
	default:
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
}

func (s *StatefulSetResourcer) StreamAction(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	actionID string,
	input resource.ActionInput,
	stream chan<- resource.ActionEvent,
) error {
	switch actionID {
	case "restart":
		return s.streamRestart(ctx, client, input, stream)
	default:
		return fmt.Errorf("streaming not supported for action: %s", actionID)
	}
}

// ====================== ACTION IMPLEMENTATIONS ====================== //

func (s *StatefulSetResourcer) executeRestart(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	patch := fmt.Sprintf(
		`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().Format(time.RFC3339),
	)
	_, err := client.KubeClient.AppsV1().StatefulSets(input.Namespace).Patch(
		ctx, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to restart statefulset %s: %w", input.ID, err)
	}

	return &resource.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Rollout restart initiated for statefulset %s", input.ID),
	}, nil
}

func (s *StatefulSetResourcer) streamRestart(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionInput,
	stream chan<- resource.ActionEvent,
) error {
	defer close(stream)

	patch := fmt.Sprintf(
		`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().Format(time.RFC3339),
	)
	_, err := client.KubeClient.AppsV1().StatefulSets(input.Namespace).Patch(
		ctx, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		stream <- resource.ActionEvent{
			Type: "error",
			Data: map[string]interface{}{"message": fmt.Sprintf("failed to restart: %v", err)},
		}
		return err
	}

	stream <- resource.ActionEvent{
		Type: "progress",
		Data: map[string]interface{}{"message": "Rollout restart initiated"},
	}

	watcher, err := client.KubeClient.AppsV1().StatefulSets(input.Namespace).Watch(
		ctx, metav1.ListOptions{
			FieldSelector: fmt.Sprintf("metadata.name=%s", input.ID),
		},
	)
	if err != nil {
		stream <- resource.ActionEvent{
			Type: "error",
			Data: map[string]interface{}{"message": fmt.Sprintf("failed to watch statefulset: %v", err)},
		}
		return err
	}
	defer watcher.Stop()

	timeout := time.After(5 * time.Minute)
	for {
		select {
		case <-timeout:
			stream <- resource.ActionEvent{
				Type: "error",
				Data: map[string]interface{}{"message": "rollout restart timed out after 5 minutes"},
			}
			return fmt.Errorf("rollout restart timed out")

		case <-ctx.Done():
			return ctx.Err()

		case event, ok := <-watcher.ResultChan():
			if !ok {
				stream <- resource.ActionEvent{
					Type: "error",
					Data: map[string]interface{}{"message": "watch channel closed unexpectedly"},
				}
				return fmt.Errorf("watch channel closed")
			}
			if event.Type != watch.Modified {
				continue
			}
			sts, ok := event.Object.(*appsv1.StatefulSet)
			if !ok {
				continue
			}

			desired := int32(1)
			if sts.Spec.Replicas != nil {
				desired = *sts.Spec.Replicas
			}

			stream <- resource.ActionEvent{
				Type: "progress",
				Data: map[string]interface{}{
					"ready":   sts.Status.ReadyReplicas,
					"desired": desired,
					"updated": sts.Status.UpdatedReplicas,
					"message": fmt.Sprintf("%d/%d replicas ready", sts.Status.ReadyReplicas, desired),
				},
			}

			if sts.Status.UpdatedReplicas == desired &&
				sts.Status.ReadyReplicas == desired &&
				sts.Status.Replicas == desired {
				stream <- resource.ActionEvent{
					Type: "complete",
					Data: map[string]interface{}{
						"message": fmt.Sprintf("StatefulSet %s successfully restarted", input.ID),
					},
				}
				return nil
			}
		}
	}
}

func (s *StatefulSetResourcer) executeScale(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	replicas, ok := input.Params["replicas"].(float64)
	if !ok {
		return nil, fmt.Errorf("replicas parameter is required and must be a number")
	}

	replicaCount := int32(replicas)
	patch := fmt.Sprintf(`{"spec":{"replicas":%d}}`, replicaCount)
	_, err := client.KubeClient.AppsV1().StatefulSets(input.Namespace).Patch(
		ctx, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to scale statefulset %s: %w", input.ID, err)
	}

	return &resource.ActionResult{
		Success: true,
		Message: fmt.Sprintf("StatefulSet %s scaled to %d replicas", input.ID, replicaCount),
	}, nil
}
