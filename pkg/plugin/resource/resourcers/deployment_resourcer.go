package resourcers

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"go.uber.org/zap"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/watch"
)

// DeploymentResourcer wraps KubernetesResourcerBase for CRUD and adds
// deployment-specific actions: restart, scale, pause, resume.
type DeploymentResourcer struct {
	*KubernetesResourcerBase[MetaAccessor]
	log *zap.SugaredLogger
}

// Compile-time interface checks.
var (
	_ resource.Resourcer[clients.ClientSet]            = (*DeploymentResourcer)(nil)
	_ resource.ActionResourcer[clients.ClientSet]       = (*DeploymentResourcer)(nil)
	_ resource.RelationshipDeclarer                     = (*DeploymentResourcer)(nil)
	_ resource.RelationshipResolver[clients.ClientSet]  = (*DeploymentResourcer)(nil)
)

// NewDeploymentResourcer creates a DeploymentResourcer for apps::v1::Deployment.
func NewDeploymentResourcer(logger *zap.SugaredLogger) *DeploymentResourcer {
	base := NewKubernetesResourcerBase[MetaAccessor](
		logger,
		appsv1.SchemeGroupVersion.WithResource("deployments"),
		WithRelationships([]resource.RelationshipDescriptor{
			{
				Type:              resource.RelManages,
				TargetResourceKey: "apps::v1::ReplicaSet",
				Label:             "manages",
				InverseLabel:      "managed by",
				Cardinality:       "one-to-many",
				Extractor:         &resource.RelationshipExtractor{Method: "ownerRef", OwnerRefKind: "Deployment"},
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
	return &DeploymentResourcer{
		KubernetesResourcerBase: base,
		log:                     logger.Named("DeploymentResourcer"),
	}
}

// ResolveRelationships resolves runtime relationship instances for a Deployment.
func (d *DeploymentResourcer) ResolveRelationships(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	id string,
	namespace string,
) ([]resource.ResolvedRelationship, error) {
	result, err := d.Get(ctx, client, meta, resource.GetInput{ID: id, Namespace: namespace})
	if err != nil {
		return nil, fmt.Errorf("failed to get deployment %s: %w", id, err)
	}

	var dep appsv1.Deployment
	if err := json.Unmarshal(result.Result, &dep); err != nil {
		return nil, fmt.Errorf("failed to unmarshal deployment: %w", err)
	}

	var rels []resource.ResolvedRelationship
	byTarget := descriptorByTarget(d.DeclareRelationships())

	// ReplicaSet relationships via label selector.
	if dep.Spec.Selector != nil {
		selector, err := metav1.LabelSelectorAsSelector(dep.Spec.Selector)
		if err == nil {
			rsList, err := client.KubeClient.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{
				LabelSelector: selector.String(),
			})
			if err == nil && len(rsList.Items) > 0 {
				targets := make([]resource.ResourceRef, 0, len(rsList.Items))
				for _, rs := range rsList.Items {
					// Only include ReplicaSets owned by this Deployment.
					for _, ref := range rs.OwnerReferences {
						if ref.Kind == "Deployment" && ref.Name == id {
							targets = append(targets, makeRef("apps::v1::ReplicaSet", rs.Name, namespace))
							break
						}
					}
				}
				if len(targets) > 0 {
					rels = append(rels, resource.ResolvedRelationship{
						Descriptor: byTarget["apps::v1::ReplicaSet"],
						Targets:    targets,
					})
				}
			}
		}
	}

	// ConfigMap relationships from volumes.
	if cms := extractVolumeConfigMaps(dep.Spec.Template.Spec); len(cms) > 0 {
		targets := make([]resource.ResourceRef, 0, len(cms))
		for _, name := range cms {
			targets = append(targets, makeRef("core::v1::ConfigMap", name, namespace))
		}
		rels = append(rels, resource.ResolvedRelationship{
			Descriptor: byTarget["core::v1::ConfigMap"],
			Targets:    targets,
		})
	}

	// Secret relationships from volumes.
	if secrets := extractVolumeSecrets(dep.Spec.Template.Spec); len(secrets) > 0 {
		targets := make([]resource.ResourceRef, 0, len(secrets))
		for _, name := range secrets {
			targets = append(targets, makeRef("core::v1::Secret", name, namespace))
		}
		rels = append(rels, resource.ResolvedRelationship{
			Descriptor: byTarget["core::v1::Secret"],
			Targets:    targets,
		})
	}

	return rels, nil
}

// ====================== ACTION INTERFACE ====================== //

func (d *DeploymentResourcer) GetActions(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
) ([]resource.ActionDescriptor, error) {
	return []resource.ActionDescriptor{
		{
			ID:          "restart",
			Label:       "Rollout Restart",
			Description: "Restart all pods in this deployment via a rolling update",
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
		{
			ID:          "pause",
			Label:       "Pause Rollout",
			Description: "Pause the current rollout",
			Icon:        "LuPause",
			Scope:       resource.ActionScopeInstance,
		},
		{
			ID:          "resume",
			Label:       "Resume Rollout",
			Description: "Resume a paused rollout",
			Icon:        "LuPlay",
			Scope:       resource.ActionScopeInstance,
		},
	}, nil
}

func (d *DeploymentResourcer) ExecuteAction(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	actionID string,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	switch actionID {
	case "restart":
		return d.executeRestart(ctx, client, input)
	case "scale":
		return d.executeScale(ctx, client, input)
	case "pause":
		return d.executePauseResume(ctx, client, input, true)
	case "resume":
		return d.executePauseResume(ctx, client, input, false)
	default:
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
}

func (d *DeploymentResourcer) StreamAction(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	actionID string,
	input resource.ActionInput,
	stream chan<- resource.ActionEvent,
) error {
	switch actionID {
	case "restart":
		return d.streamRestart(ctx, client, input, stream)
	default:
		return fmt.Errorf("streaming not supported for action: %s", actionID)
	}
}

// ====================== ACTION IMPLEMENTATIONS ====================== //

// executeRestart patches the pod template annotation to trigger a rolling restart.
func (d *DeploymentResourcer) executeRestart(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	patch := fmt.Sprintf(
		`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().Format(time.RFC3339),
	)
	_, err := client.KubeClient.AppsV1().Deployments(input.Namespace).Patch(
		ctx, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to restart deployment %s: %w", input.ID, err)
	}

	return &resource.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Rollout restart initiated for deployment %s", input.ID),
	}, nil
}

// streamRestart patches the annotation then watches for rollout completion.
func (d *DeploymentResourcer) streamRestart(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionInput,
	stream chan<- resource.ActionEvent,
) error {
	defer close(stream)

	// Patch to trigger restart.
	patch := fmt.Sprintf(
		`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().Format(time.RFC3339),
	)
	_, err := client.KubeClient.AppsV1().Deployments(input.Namespace).Patch(
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

	// Watch the deployment for rollout completion.
	watcher, err := client.KubeClient.AppsV1().Deployments(input.Namespace).Watch(
		ctx, metav1.ListOptions{
			FieldSelector: fmt.Sprintf("metadata.name=%s", input.ID),
		},
	)
	if err != nil {
		stream <- resource.ActionEvent{
			Type: "error",
			Data: map[string]interface{}{"message": fmt.Sprintf("failed to watch deployment: %v", err)},
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
			dep, ok := event.Object.(*appsv1.Deployment)
			if !ok {
				continue
			}

			desired := int32(1)
			if dep.Spec.Replicas != nil {
				desired = *dep.Spec.Replicas
			}

			stream <- resource.ActionEvent{
				Type: "progress",
				Data: map[string]interface{}{
					"ready":   dep.Status.AvailableReplicas,
					"desired": desired,
					"updated": dep.Status.UpdatedReplicas,
					"message": fmt.Sprintf("%d/%d replicas ready", dep.Status.AvailableReplicas, desired),
				},
			}

			if dep.Status.UpdatedReplicas == desired &&
				dep.Status.AvailableReplicas == desired &&
				dep.Status.Replicas == desired {
				stream <- resource.ActionEvent{
					Type: "complete",
					Data: map[string]interface{}{
						"message": fmt.Sprintf("Deployment %s successfully restarted", input.ID),
					},
				}
				return nil
			}
		}
	}
}

// executeScale patches spec.replicas on the deployment.
func (d *DeploymentResourcer) executeScale(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	replicas, ok := input.Params["replicas"].(float64)
	if !ok {
		return nil, fmt.Errorf("replicas parameter is required and must be a number")
	}
	if replicas != math.Trunc(replicas) || replicas < 0 || replicas > math.MaxInt32 {
		return nil, fmt.Errorf("replicas must be a non-negative whole number")
	}

	replicaCount := int32(replicas)
	patch := fmt.Sprintf(`{"spec":{"replicas":%d}}`, replicaCount)
	_, err := client.KubeClient.AppsV1().Deployments(input.Namespace).Patch(
		ctx, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to scale deployment %s: %w", input.ID, err)
	}

	return &resource.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Deployment %s scaled to %d replicas", input.ID, replicaCount),
	}, nil
}

// executePauseResume patches spec.paused on the deployment.
func (d *DeploymentResourcer) executePauseResume(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionInput,
	paused bool,
) (*resource.ActionResult, error) {
	patch := fmt.Sprintf(`{"spec":{"paused":%t}}`, paused)
	_, err := client.KubeClient.AppsV1().Deployments(input.Namespace).Patch(
		ctx, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		verb := "pause"
		if !paused {
			verb = "resume"
		}
		return nil, fmt.Errorf("failed to %s deployment %s: %w", verb, input.ID, err)
	}

	verb := "paused"
	if !paused {
		verb = "resumed"
	}
	return &resource.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Deployment %s rollout %s", input.ID, verb),
	}, nil
}
