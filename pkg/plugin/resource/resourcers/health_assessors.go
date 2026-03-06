package resourcers

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// Compile-time checks for HealthAssessor.
var (
	_ resource.HealthAssessor[clients.ClientSet] = (*NodeResourcer)(nil)
	_ resource.HealthAssessor[clients.ClientSet] = (*DeploymentResourcer)(nil)
	_ resource.HealthAssessor[clients.ClientSet] = (*StatefulSetResourcer)(nil)
	_ resource.HealthAssessor[clients.ClientSet] = (*DaemonSetResourcer)(nil)
)

// Compile-time checks for EventRetriever.
var (
	_ resource.EventRetriever[clients.ClientSet] = (*NodeResourcer)(nil)
	_ resource.EventRetriever[clients.ClientSet] = (*DeploymentResourcer)(nil)
	_ resource.EventRetriever[clients.ClientSet] = (*StatefulSetResourcer)(nil)
	_ resource.EventRetriever[clients.ClientSet] = (*DaemonSetResourcer)(nil)
)

// ====================== NODE HEALTH ====================== //

func (n *NodeResourcer) AssessHealth(_ context.Context, _ *clients.ClientSet, _ resource.ResourceMeta, data json.RawMessage) (*resource.ResourceHealth, error) {
	var node corev1.Node
	if err := json.Unmarshal(data, &node); err != nil {
		return nil, fmt.Errorf("failed to unmarshal node: %w", err)
	}

	health := &resource.ResourceHealth{Status: resource.HealthUnknown}

	for _, c := range node.Status.Conditions {
		lt := c.LastTransitionTime.Time
		health.Conditions = append(health.Conditions, resource.HealthCondition{
			Type:               string(c.Type),
			Status:             string(c.Status),
			Reason:             c.Reason,
			Message:            c.Message,
			LastTransitionTime: &lt,
		})

		switch c.Type {
		case corev1.NodeReady:
			if c.Status == corev1.ConditionTrue {
				health.Status = resource.HealthHealthy
				health.Reason = "Ready"
			} else {
				health.Status = resource.HealthUnhealthy
				health.Reason = "NotReady"
				health.Message = c.Message
			}
		case corev1.NodeMemoryPressure, corev1.NodeDiskPressure, corev1.NodePIDPressure:
			if c.Status == corev1.ConditionTrue && health.Status == resource.HealthHealthy {
				health.Status = resource.HealthDegraded
				health.Reason = string(c.Type)
				health.Message = c.Message
			}
		}
	}

	return health, nil
}

func (n *NodeResourcer) GetEvents(ctx context.Context, client *clients.ClientSet, _ resource.ResourceMeta, id string, namespace string, limit int32) ([]resource.ResourceEvent, error) {
	fieldSelector := fmt.Sprintf("involvedObject.name=%s,involvedObject.kind=Node", id)
	return getK8sEvents(ctx, client, "", fieldSelector, limit)
}

// ====================== DEPLOYMENT HEALTH ====================== //

func (d *DeploymentResourcer) AssessHealth(_ context.Context, _ *clients.ClientSet, _ resource.ResourceMeta, data json.RawMessage) (*resource.ResourceHealth, error) {
	var dep appsv1.Deployment
	if err := json.Unmarshal(data, &dep); err != nil {
		return nil, fmt.Errorf("failed to unmarshal deployment: %w", err)
	}

	health := &resource.ResourceHealth{Status: resource.HealthUnknown}

	desired := int32(1)
	if dep.Spec.Replicas != nil {
		desired = *dep.Spec.Replicas
	}

	if dep.Status.AvailableReplicas == desired {
		health.Status = resource.HealthHealthy
		health.Reason = "Available"
		health.Message = fmt.Sprintf("%d/%d replicas available", dep.Status.AvailableReplicas, desired)
	} else if dep.Status.AvailableReplicas > 0 {
		health.Status = resource.HealthDegraded
		health.Reason = "PartiallyAvailable"
		health.Message = fmt.Sprintf("%d/%d replicas available", dep.Status.AvailableReplicas, desired)
	} else {
		health.Status = resource.HealthUnhealthy
		health.Reason = "Unavailable"
		health.Message = fmt.Sprintf("0/%d replicas available", desired)
	}

	for _, c := range dep.Status.Conditions {
		lt := c.LastTransitionTime.Time
		health.Conditions = append(health.Conditions, resource.HealthCondition{
			Type:               string(c.Type),
			Status:             string(c.Status),
			Reason:             c.Reason,
			Message:            c.Message,
			LastTransitionTime: &lt,
		})
	}

	return health, nil
}

func (d *DeploymentResourcer) GetEvents(ctx context.Context, client *clients.ClientSet, _ resource.ResourceMeta, id string, namespace string, limit int32) ([]resource.ResourceEvent, error) {
	fieldSelector := fmt.Sprintf("involvedObject.name=%s,involvedObject.kind=Deployment", id)
	return getK8sEvents(ctx, client, namespace, fieldSelector, limit)
}

// ====================== STATEFULSET HEALTH ====================== //

func (s *StatefulSetResourcer) AssessHealth(_ context.Context, _ *clients.ClientSet, _ resource.ResourceMeta, data json.RawMessage) (*resource.ResourceHealth, error) {
	var sts appsv1.StatefulSet
	if err := json.Unmarshal(data, &sts); err != nil {
		return nil, fmt.Errorf("failed to unmarshal statefulset: %w", err)
	}

	health := &resource.ResourceHealth{Status: resource.HealthUnknown}

	desired := int32(1)
	if sts.Spec.Replicas != nil {
		desired = *sts.Spec.Replicas
	}

	if sts.Status.ReadyReplicas == desired {
		health.Status = resource.HealthHealthy
		health.Reason = "Ready"
		health.Message = fmt.Sprintf("%d/%d replicas ready", sts.Status.ReadyReplicas, desired)
	} else if sts.Status.ReadyReplicas > 0 {
		health.Status = resource.HealthDegraded
		health.Reason = "PartiallyReady"
		health.Message = fmt.Sprintf("%d/%d replicas ready", sts.Status.ReadyReplicas, desired)
	} else {
		health.Status = resource.HealthUnhealthy
		health.Reason = "NotReady"
		health.Message = fmt.Sprintf("0/%d replicas ready", desired)
	}

	for _, c := range sts.Status.Conditions {
		lt := c.LastTransitionTime.Time
		health.Conditions = append(health.Conditions, resource.HealthCondition{
			Type:               string(c.Type),
			Status:             string(c.Status),
			Reason:             c.Reason,
			Message:            c.Message,
			LastTransitionTime: &lt,
		})
	}

	return health, nil
}

func (s *StatefulSetResourcer) GetEvents(ctx context.Context, client *clients.ClientSet, _ resource.ResourceMeta, id string, namespace string, limit int32) ([]resource.ResourceEvent, error) {
	fieldSelector := fmt.Sprintf("involvedObject.name=%s,involvedObject.kind=StatefulSet", id)
	return getK8sEvents(ctx, client, namespace, fieldSelector, limit)
}

// ====================== DAEMONSET HEALTH ====================== //

func (d *DaemonSetResourcer) AssessHealth(_ context.Context, _ *clients.ClientSet, _ resource.ResourceMeta, data json.RawMessage) (*resource.ResourceHealth, error) {
	var ds appsv1.DaemonSet
	if err := json.Unmarshal(data, &ds); err != nil {
		return nil, fmt.Errorf("failed to unmarshal daemonset: %w", err)
	}

	health := &resource.ResourceHealth{Status: resource.HealthUnknown}

	desired := ds.Status.DesiredNumberScheduled

	if ds.Status.NumberReady == desired && desired > 0 {
		health.Status = resource.HealthHealthy
		health.Reason = "Ready"
		health.Message = fmt.Sprintf("%d/%d nodes ready", ds.Status.NumberReady, desired)
	} else if ds.Status.NumberReady > 0 {
		health.Status = resource.HealthDegraded
		health.Reason = "PartiallyReady"
		health.Message = fmt.Sprintf("%d/%d nodes ready", ds.Status.NumberReady, desired)
	} else if desired == 0 {
		health.Status = resource.HealthHealthy
		health.Reason = "NoScheduled"
		health.Message = "No nodes scheduled"
	} else {
		health.Status = resource.HealthUnhealthy
		health.Reason = "NotReady"
		health.Message = fmt.Sprintf("0/%d nodes ready", desired)
	}

	return health, nil
}

func (d *DaemonSetResourcer) GetEvents(ctx context.Context, client *clients.ClientSet, _ resource.ResourceMeta, id string, namespace string, limit int32) ([]resource.ResourceEvent, error) {
	fieldSelector := fmt.Sprintf("involvedObject.name=%s,involvedObject.kind=DaemonSet", id)
	return getK8sEvents(ctx, client, namespace, fieldSelector, limit)
}
