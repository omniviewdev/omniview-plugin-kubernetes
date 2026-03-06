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

// DaemonSetResourcer wraps KubernetesResourcerBase for CRUD and adds
// daemonset-specific actions: restart.
type DaemonSetResourcer struct {
	*KubernetesResourcerBase[MetaAccessor]
	log *zap.SugaredLogger
}

// Compile-time interface checks.
var (
	_ resource.Resourcer[clients.ClientSet]            = (*DaemonSetResourcer)(nil)
	_ resource.ActionResourcer[clients.ClientSet]       = (*DaemonSetResourcer)(nil)
	_ resource.RelationshipDeclarer                     = (*DaemonSetResourcer)(nil)
	_ resource.RelationshipResolver[clients.ClientSet]  = (*DaemonSetResourcer)(nil)
)

// NewDaemonSetResourcer creates a DaemonSetResourcer for apps::v1::DaemonSet.
func NewDaemonSetResourcer(logger *zap.SugaredLogger) *DaemonSetResourcer {
	base := NewKubernetesResourcerBase[MetaAccessor](
		logger,
		appsv1.SchemeGroupVersion.WithResource("daemonsets"),
		WithRelationships([]resource.RelationshipDescriptor{
			{
				Type:              resource.RelOwns,
				TargetResourceKey: "core::v1::Pod",
				Label:             "owns",
				InverseLabel:      "owned by",
				Cardinality:       "one-to-many",
				Extractor:         &resource.RelationshipExtractor{Method: "ownerRef", OwnerRefKind: "DaemonSet"},
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
	return &DaemonSetResourcer{
		KubernetesResourcerBase: base,
		log:                     logger.Named("DaemonSetResourcer"),
	}
}

// ResolveRelationships resolves runtime relationship instances for a DaemonSet.
func (d *DaemonSetResourcer) ResolveRelationships(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	id string,
	namespace string,
) ([]resource.ResolvedRelationship, error) {
	result, err := d.Get(ctx, client, meta, resource.GetInput{ID: id, Namespace: namespace})
	if err != nil {
		return nil, fmt.Errorf("failed to get daemonset %s: %w", id, err)
	}

	var ds appsv1.DaemonSet
	if err := json.Unmarshal(result.Result, &ds); err != nil {
		return nil, fmt.Errorf("failed to unmarshal daemonset: %w", err)
	}

	var rels []resource.ResolvedRelationship
	byTarget := descriptorByTarget(d.DeclareRelationships())

	// Pod relationships via ownerRef.
	pods, err := listPodsByOwner(ctx, client, namespace, "DaemonSet", id, string(ds.UID))
	if err == nil && len(pods) > 0 {
		targets := make([]resource.ResourceRef, 0, len(pods))
		for _, pod := range pods {
			targets = append(targets, makeRef("core::v1::Pod", pod.Name, namespace))
		}
		rels = append(rels, resource.ResolvedRelationship{
			Descriptor: byTarget["core::v1::Pod"],
			Targets:    targets,
		})
	}

	// ConfigMap relationships from volumes.
	if cms := extractVolumeConfigMaps(ds.Spec.Template.Spec); len(cms) > 0 {
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
	if secrets := extractVolumeSecrets(ds.Spec.Template.Spec); len(secrets) > 0 {
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

func (d *DaemonSetResourcer) GetActions(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
) ([]resource.ActionDescriptor, error) {
	return []resource.ActionDescriptor{
		{
			ID:          "restart",
			Label:       "Rollout Restart",
			Description: "Restart all pods in this daemonset via a rolling update",
			Icon:        "LuRefreshCw",
			Scope:       resource.ActionScopeInstance,
			Dangerous:   true,
			Streaming:   true,
		},
	}, nil
}

func (d *DaemonSetResourcer) ExecuteAction(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	actionID string,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	switch actionID {
	case "restart":
		return d.executeRestart(ctx, client, input)
	default:
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
}

func (d *DaemonSetResourcer) StreamAction(
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

func (d *DaemonSetResourcer) executeRestart(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	patch := fmt.Sprintf(
		`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().Format(time.RFC3339),
	)
	_, err := client.KubeClient.AppsV1().DaemonSets(input.Namespace).Patch(
		ctx, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to restart daemonset %s: %w", input.ID, err)
	}

	return &resource.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Rollout restart initiated for daemonset %s", input.ID),
	}, nil
}

func (d *DaemonSetResourcer) streamRestart(
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
	_, err := client.KubeClient.AppsV1().DaemonSets(input.Namespace).Patch(
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

	watcher, err := client.KubeClient.AppsV1().DaemonSets(input.Namespace).Watch(
		ctx, metav1.ListOptions{
			FieldSelector: fmt.Sprintf("metadata.name=%s", input.ID),
		},
	)
	if err != nil {
		stream <- resource.ActionEvent{
			Type: "error",
			Data: map[string]interface{}{"message": fmt.Sprintf("failed to watch daemonset: %v", err)},
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
			ds, ok := event.Object.(*appsv1.DaemonSet)
			if !ok {
				continue
			}

			desired := ds.Status.DesiredNumberScheduled

			stream <- resource.ActionEvent{
				Type: "progress",
				Data: map[string]interface{}{
					"ready":   ds.Status.NumberReady,
					"desired": desired,
					"updated": ds.Status.UpdatedNumberScheduled,
					"message": fmt.Sprintf("%d/%d nodes ready", ds.Status.NumberReady, desired),
				},
			}

			if ds.Status.UpdatedNumberScheduled == desired &&
				ds.Status.NumberReady == desired &&
				ds.Status.NumberAvailable == desired {
				stream <- resource.ActionEvent{
					Type: "complete",
					Data: map[string]interface{}{
						"message": fmt.Sprintf("DaemonSet %s successfully restarted", input.ID),
					},
				}
				return nil
			}
		}
	}
}
