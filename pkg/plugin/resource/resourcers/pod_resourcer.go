package resourcers

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// Compile-time checks.
var (
	_ resource.Resourcer[clients.ClientSet]           = (*PodResourcer)(nil)
	_ resource.Watcher[clients.ClientSet]             = (*PodResourcer)(nil)
	_ resource.HealthAssessor[clients.ClientSet]       = (*PodResourcer)(nil)
	_ resource.EventRetriever[clients.ClientSet]       = (*PodResourcer)(nil)
	_ resource.RelationshipDeclarer                    = (*PodResourcer)(nil)
	_ resource.RelationshipResolver[clients.ClientSet] = (*PodResourcer)(nil)
)

// PodResourcer wraps KubernetesResourcerBase for Pods with health, events, and relationships.
type PodResourcer struct {
	*KubernetesResourcerBase[MetaAccessor]
	log *zap.SugaredLogger
}

// NewPodResourcer creates a PodResourcer for core::v1::Pod.
func NewPodResourcer(logger *zap.SugaredLogger) *PodResourcer {
	base := NewKubernetesResourcerBase[MetaAccessor](
		logger,
		corev1.SchemeGroupVersion.WithResource("pods"),
	)
	return &PodResourcer{
		KubernetesResourcerBase: base,
		log:                     logger.Named("PodResourcer"),
	}
}

// DeclareRelationships overrides the base to declare Pod-specific relationships.
func (p *PodResourcer) DeclareRelationships() []resource.RelationshipDescriptor {
	return []resource.RelationshipDescriptor{
		{
			Type:              resource.RelRunsOn,
			TargetResourceKey: "core::v1::Node",
			Label:             "runs on",
			InverseLabel:      "runs",
			Cardinality:       "many-to-one",
			Extractor:         &resource.RelationshipExtractor{Method: "fieldPath", FieldPath: "spec.nodeName"},
		},
		{
			Type:              resource.RelUses,
			TargetResourceKey: "core::v1::PersistentVolumeClaim",
			Label:             "uses",
			InverseLabel:      "used by",
			Cardinality:       "many-to-many",
			Extractor:         &resource.RelationshipExtractor{Method: "fieldPath", FieldPath: "spec.volumes[*].persistentVolumeClaim.claimName"},
		},
		{
			Type:              resource.RelUses,
			TargetResourceKey: "core::v1::ConfigMap",
			Label:             "uses",
			InverseLabel:      "used by",
			Cardinality:       "many-to-many",
			Extractor:         &resource.RelationshipExtractor{Method: "fieldPath", FieldPath: "spec.volumes[*].configMap.name"},
		},
		{
			Type:              resource.RelUses,
			TargetResourceKey: "core::v1::Secret",
			Label:             "uses",
			InverseLabel:      "used by",
			Cardinality:       "many-to-many",
			Extractor:         &resource.RelationshipExtractor{Method: "fieldPath", FieldPath: "spec.volumes[*].secret.secretName"},
		},
		{
			Type:              resource.RelUses,
			TargetResourceKey: "core::v1::ServiceAccount",
			Label:             "uses",
			InverseLabel:      "used by",
			Cardinality:       "many-to-one",
			Extractor:         &resource.RelationshipExtractor{Method: "fieldPath", FieldPath: "spec.serviceAccountName"},
		},
	}
}

// ResolveRelationships resolves runtime relationship instances for a Pod.
func (p *PodResourcer) ResolveRelationships(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	id string,
	namespace string,
) ([]resource.ResolvedRelationship, error) {
	result, err := p.Get(ctx, client, meta, resource.GetInput{ID: id, Namespace: namespace})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod %s: %w", id, err)
	}

	var pod corev1.Pod
	if err := json.Unmarshal(result.Result, &pod); err != nil {
		return nil, fmt.Errorf("failed to unmarshal pod: %w", err)
	}

	var rels []resource.ResolvedRelationship
	descriptors := p.DeclareRelationships()

	// Node relationship.
	if pod.Spec.NodeName != "" {
		rels = append(rels, resource.ResolvedRelationship{
			Descriptor: descriptors[0], // RelRunsOn → Node
			Targets:    []resource.ResourceRef{makeRef("core::v1::Node", pod.Spec.NodeName, "")},
		})
	}

	// PVC relationships.
	if pvcs := extractVolumePVCs(pod.Spec); len(pvcs) > 0 {
		targets := make([]resource.ResourceRef, 0, len(pvcs))
		for _, name := range pvcs {
			targets = append(targets, makeRef("core::v1::PersistentVolumeClaim", name, namespace))
		}
		rels = append(rels, resource.ResolvedRelationship{
			Descriptor: descriptors[1], // RelUses → PVC
			Targets:    targets,
		})
	}

	// ConfigMap relationships.
	if cms := extractVolumeConfigMaps(pod.Spec); len(cms) > 0 {
		targets := make([]resource.ResourceRef, 0, len(cms))
		for _, name := range cms {
			targets = append(targets, makeRef("core::v1::ConfigMap", name, namespace))
		}
		rels = append(rels, resource.ResolvedRelationship{
			Descriptor: descriptors[2], // RelUses → ConfigMap
			Targets:    targets,
		})
	}

	// Secret relationships.
	if secrets := extractVolumeSecrets(pod.Spec); len(secrets) > 0 {
		targets := make([]resource.ResourceRef, 0, len(secrets))
		for _, name := range secrets {
			targets = append(targets, makeRef("core::v1::Secret", name, namespace))
		}
		rels = append(rels, resource.ResolvedRelationship{
			Descriptor: descriptors[3], // RelUses → Secret
			Targets:    targets,
		})
	}

	// ServiceAccount relationship.
	if pod.Spec.ServiceAccountName != "" {
		rels = append(rels, resource.ResolvedRelationship{
			Descriptor: descriptors[4], // RelUses → ServiceAccount
			Targets:    []resource.ResourceRef{makeRef("core::v1::ServiceAccount", pod.Spec.ServiceAccountName, namespace)},
		})
	}

	return rels, nil
}

// AssessHealth determines the health status of a Pod.
func (p *PodResourcer) AssessHealth(_ context.Context, _ *clients.ClientSet, _ resource.ResourceMeta, data json.RawMessage) (*resource.ResourceHealth, error) {
	var pod corev1.Pod
	if err := json.Unmarshal(data, &pod); err != nil {
		return nil, fmt.Errorf("failed to unmarshal pod: %w", err)
	}

	health := &resource.ResourceHealth{
		Status: resource.HealthUnknown,
	}

	// Check phase
	switch pod.Status.Phase {
	case corev1.PodRunning:
		health.Status = resource.HealthHealthy
		health.Reason = "Running"
	case corev1.PodSucceeded:
		health.Status = resource.HealthHealthy
		health.Reason = "Succeeded"
	case corev1.PodPending:
		health.Status = resource.HealthPending
		health.Reason = "Pending"
	case corev1.PodFailed:
		health.Status = resource.HealthUnhealthy
		health.Reason = "Failed"
		if pod.Status.Message != "" {
			health.Message = pod.Status.Message
		}
	}

	// Check container statuses for CrashLoopBackOff or restarts
	assessContainerStatus := func(cs corev1.ContainerStatus) {
		if cs.State.Waiting != nil {
			switch cs.State.Waiting.Reason {
			case "CrashLoopBackOff":
				health.Status = resource.HealthUnhealthy
				health.Reason = "CrashLoopBackOff"
				health.Message = fmt.Sprintf("Container %s is in CrashLoopBackOff", cs.Name)
			case "ImagePullBackOff", "ErrImagePull":
				health.Status = resource.HealthUnhealthy
				health.Reason = cs.State.Waiting.Reason
				health.Message = fmt.Sprintf("Container %s: %s", cs.Name, cs.State.Waiting.Message)
			case "ContainerCreating", "PodInitializing":
				if health.Status != resource.HealthUnhealthy {
					health.Status = resource.HealthPending
					health.Reason = cs.State.Waiting.Reason
				}
			}
		}

		if cs.RestartCount > 5 && health.Status == resource.HealthHealthy {
			health.Status = resource.HealthDegraded
			health.Reason = "HighRestarts"
			health.Message = fmt.Sprintf("Container %s has restarted %d times", cs.Name, cs.RestartCount)
		}
	}

	for _, cs := range pod.Status.InitContainerStatuses {
		assessContainerStatus(cs)
	}
	for _, cs := range pod.Status.ContainerStatuses {
		assessContainerStatus(cs)
	}

	// Conditions — also use the Ready condition to inform overall health.
	for _, c := range pod.Status.Conditions {
		lt := c.LastTransitionTime.Time
		health.Conditions = append(health.Conditions, resource.HealthCondition{
			Type:               string(c.Type),
			Status:             string(c.Status),
			Reason:             c.Reason,
			Message:            c.Message,
			LastTransitionTime: &lt,
		})

		if c.Type == corev1.PodReady && c.Status != corev1.ConditionTrue && health.Status != resource.HealthUnhealthy {
			health.Status = resource.HealthDegraded
			health.Reason = c.Reason
			if health.Reason == "" {
				health.Reason = "NotReady"
			}
			health.Message = c.Message
		}
	}

	if pod.Status.StartTime != nil {
		t := pod.Status.StartTime.Time
		health.Since = &t
	}

	return health, nil
}

// GetEvents returns Kubernetes events for a Pod.
func (p *PodResourcer) GetEvents(ctx context.Context, client *clients.ClientSet, _ resource.ResourceMeta, id string, namespace string, limit int32) ([]resource.ResourceEvent, error) {
	fieldSelector := fmt.Sprintf("involvedObject.name=%s,involvedObject.kind=Pod", id)
	return getK8sEvents(ctx, client, namespace, fieldSelector, limit)
}

// getK8sEvents is a shared helper for fetching Kubernetes events.
func getK8sEvents(ctx context.Context, client *clients.ClientSet, namespace, fieldSelector string, limit int32) ([]resource.ResourceEvent, error) {
	opts := metav1.ListOptions{
		FieldSelector: fieldSelector,
	}
	if limit > 0 {
		opts.Limit = int64(limit)
	}

	events, err := client.KubeClient.CoreV1().Events(namespace).List(ctx, opts)
	if err != nil {
		return nil, fmt.Errorf("failed to list events: %w", err)
	}

	result := make([]resource.ResourceEvent, 0, len(events.Items))
	for _, e := range events.Items {
		severity := resource.SeverityNormal
		if e.Type == "Warning" {
			severity = resource.SeverityWarning
		}

		re := resource.ResourceEvent{
			Type:    severity,
			Reason:  e.Reason,
			Message: e.Message,
			Source:  e.Source.Component,
			Count:   e.Count,
		}
		if !e.FirstTimestamp.IsZero() {
			re.FirstSeen = e.FirstTimestamp.Time
		} else if !e.EventTime.IsZero() {
			re.FirstSeen = e.EventTime.Time
		}
		if !e.LastTimestamp.IsZero() {
			re.LastSeen = e.LastTimestamp.Time
		} else {
			re.LastSeen = re.FirstSeen
		}
		result = append(result, re)
	}

	return result, nil
}
