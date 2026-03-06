package resourcers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/kubernetes"
)

// NodeResourcer wraps KubernetesResourcerBase for CRUD and adds node-specific
// actions: cordon, uncordon, drain, add-taint, remove-taint, get-conditions.
type NodeResourcer struct {
	// Embed base for all CRUD operations (uses MetaAccessor which corev1.Node satisfies).
	*KubernetesResourcerBase[MetaAccessor]
	log *zap.SugaredLogger
}

// Compile-time interface checks.
var (
	_ resource.Resourcer[clients.ClientSet]            = (*NodeResourcer)(nil)
	_ resource.ActionResourcer[clients.ClientSet]       = (*NodeResourcer)(nil)
	_ resource.RelationshipDeclarer                     = (*NodeResourcer)(nil)
	_ resource.RelationshipResolver[clients.ClientSet]  = (*NodeResourcer)(nil)
)

// NewNodeResourcer creates a NodeResourcer for core::v1::Node.
func NewNodeResourcer(logger *zap.SugaredLogger) *NodeResourcer {
	base := NewKubernetesResourcerBase[MetaAccessor](
		logger,
		corev1.SchemeGroupVersion.WithResource("nodes"),
		WithRelationships([]resource.RelationshipDescriptor{
			{
				Type:              resource.RelRunsOn,
				TargetResourceKey: "core::v1::Pod",
				Label:             "runs",
				InverseLabel:      "runs on",
				Cardinality:       "one-to-many",
			},
		}),
	)
	return &NodeResourcer{
		KubernetesResourcerBase: base,
		log:                     logger.Named("NodeResourcer"),
	}
}

// ResolveRelationships resolves runtime relationship instances for a Node.
func (n *NodeResourcer) ResolveRelationships(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	id string,
	_ string,
) ([]resource.ResolvedRelationship, error) {
	podList, err := client.KubeClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: fields.SelectorFromSet(fields.Set{"spec.nodeName": id}).String(),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods on node %s: %w", id, err)
	}

	if len(podList.Items) == 0 {
		return nil, nil
	}

	targets := make([]resource.ResourceRef, 0, len(podList.Items))
	for _, pod := range podList.Items {
		targets = append(targets, makeRef("core::v1::Pod", pod.Name, pod.Namespace))
	}

	return []resource.ResolvedRelationship{
		{
			Descriptor: n.DeclareRelationships()[0], // RelRunsOn → Pod
			Targets:    targets,
		},
	}, nil
}

// ====================== ACTION INTERFACE ====================== //

func (n *NodeResourcer) GetActions(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
) ([]resource.ActionDescriptor, error) {
	return []resource.ActionDescriptor{
		{
			ID:          "cordon",
			Label:       "Cordon Node",
			Description: "Mark the node as unschedulable",
			Icon:        "LuShieldBan",
			Scope:       resource.ActionScopeInstance,
		},
		{
			ID:          "uncordon",
			Label:       "Uncordon Node",
			Description: "Mark the node as schedulable",
			Icon:        "LuShieldCheck",
			Scope:       resource.ActionScopeInstance,
		},
		{
			ID:          "drain",
			Label:       "Drain Node",
			Description: "Safely evict all pods from the node",
			Icon:        "LuArrowDownToLine",
			Scope:       resource.ActionScopeInstance,
			Dangerous:   true,
			ParamsSchema: &resource.Schema{
				Properties: map[string]resource.SchemaProperty{
					"gracePeriodSeconds": {Type: resource.SchemaInteger, Default: 30, Description: "Seconds to wait for graceful termination"},
					"ignoreDaemonSets":  {Type: resource.SchemaBoolean, Default: true, Description: "Ignore DaemonSet-managed pods"},
					"deleteEmptyDirData": {Type: resource.SchemaBoolean, Default: true, Description: "Delete pods using emptyDir volumes"},
					"force":             {Type: resource.SchemaBoolean, Default: false, Description: "Force-delete pods that fail eviction"},
				},
			},
		},
		{
			ID:          "add-taint",
			Label:       "Add Taint",
			Description: "Add a taint to the node",
			Icon:        "LuTag",
			Scope:       resource.ActionScopeInstance,
			ParamsSchema: &resource.Schema{
				Properties: map[string]resource.SchemaProperty{
					"key":    {Type: resource.SchemaString, Description: "Taint key"},
					"value":  {Type: resource.SchemaString, Description: "Taint value"},
					"effect": {Type: resource.SchemaString, Enum: []string{"NoSchedule", "PreferNoSchedule", "NoExecute"}, Description: "Taint effect"},
				},
				Required: []string{"key", "effect"},
			},
		},
		{
			ID:          "remove-taint",
			Label:       "Remove Taint",
			Description: "Remove a taint from the node",
			Icon:        "LuTagX",
			Scope:       resource.ActionScopeInstance,
			ParamsSchema: &resource.Schema{
				Properties: map[string]resource.SchemaProperty{
					"key":    {Type: resource.SchemaString, Description: "Taint key to remove"},
					"effect": {Type: resource.SchemaString, Enum: []string{"NoSchedule", "PreferNoSchedule", "NoExecute"}, Description: "Taint effect to match (optional)"},
				},
				Required: []string{"key"},
			},
		},
		{
			ID:          "get-conditions",
			Label:       "Get Conditions",
			Description: "Get node status conditions",
			Icon:        "LuHeartPulse",
			Scope:       resource.ActionScopeInstance,
		},
	}, nil
}

func (n *NodeResourcer) ExecuteAction(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	actionID string,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	switch actionID {
	case "cordon":
		return n.executeCordon(ctx, client, input, true)
	case "uncordon":
		return n.executeCordon(ctx, client, input, false)
	case "drain":
		return n.executeDrain(ctx, client, input)
	case "add-taint":
		return n.executeAddTaint(ctx, client, input)
	case "remove-taint":
		return n.executeRemoveTaint(ctx, client, input)
	case "get-conditions":
		return n.executeGetConditions(ctx, client, input)
	default:
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
}

func (n *NodeResourcer) StreamAction(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	_ string,
	_ resource.ActionInput,
	_ chan<- resource.ActionEvent,
) error {
	return fmt.Errorf("streaming actions not supported for nodes")
}

// ====================== ACTION IMPLEMENTATIONS ====================== //

// executeCordon patches spec.unschedulable on the node.
func (n *NodeResourcer) executeCordon(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionInput,
	unschedulable bool,
) (*resource.ActionResult, error) {
	patch := fmt.Sprintf(`{"spec":{"unschedulable":%t}}`, unschedulable)
	_, err := client.KubeClient.CoreV1().Nodes().Patch(
		ctx, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to patch node %s: %w", input.ID, err)
	}

	verb := "cordoned"
	if !unschedulable {
		verb = "uncordoned"
	}
	return &resource.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Node %s %s", input.ID, verb),
	}, nil
}

// executeDrain evicts all non-DaemonSet, non-mirror pods from the node, then cordons it.
func (n *NodeResourcer) executeDrain(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	// Parse optional params.
	gracePeriod := int64(30)
	if v, ok := input.Params["gracePeriodSeconds"].(float64); ok {
		gracePeriod = int64(v)
	}
	ignoreDaemonSets := true
	if v, ok := input.Params["ignoreDaemonSets"].(bool); ok {
		ignoreDaemonSets = v
	}
	deleteEmptyDirData := true
	if v, ok := input.Params["deleteEmptyDirData"].(bool); ok {
		deleteEmptyDirData = v
	}
	force, _ := input.Params["force"].(bool)

	// Step 1: Cordon the node.
	cordonPatch := `{"spec":{"unschedulable":true}}`
	_, err := client.KubeClient.CoreV1().Nodes().Patch(
		ctx, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(cordonPatch), metav1.PatchOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to cordon node %s: %w", input.ID, err)
	}

	// Step 2: List pods on this node.
	podList, err := client.KubeClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: fields.SelectorFromSet(fields.Set{"spec.nodeName": input.ID}).String(),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods on node %s: %w", input.ID, err)
	}

	// Step 3: Evict pods, skipping DaemonSet-managed and mirror pods.
	var evictErrors []string
	evicted := 0
	for i := range podList.Items {
		pod := &podList.Items[i]

		// Skip mirror pods (static pods).
		if _, isMirror := pod.Annotations[corev1.MirrorPodAnnotationKey]; isMirror {
			continue
		}

		// Skip DaemonSet pods if requested.
		if ignoreDaemonSets && isDaemonSetPod(pod) {
			continue
		}

		// Skip pods in Succeeded or Failed phase — they're already done.
		if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
			continue
		}

		// Evict the pod.
		eviction := &policyv1.Eviction{
			ObjectMeta: metav1.ObjectMeta{
				Name:      pod.Name,
				Namespace: pod.Namespace,
			},
			DeleteOptions: &metav1.DeleteOptions{
				GracePeriodSeconds: &gracePeriod,
			},
		}
		if err := client.KubeClient.PolicyV1().Evictions(pod.Namespace).Evict(ctx, eviction); err != nil {
			if force {
				// Force-delete the pod.
				zero := int64(0)
				if delErr := client.KubeClient.CoreV1().Pods(pod.Namespace).Delete(ctx, pod.Name, metav1.DeleteOptions{
					GracePeriodSeconds: &zero,
				}); delErr != nil {
					evictErrors = append(evictErrors, fmt.Sprintf("%s/%s: force-delete failed: %v", pod.Namespace, pod.Name, delErr))
					continue
				}
			} else {
				evictErrors = append(evictErrors, fmt.Sprintf("%s/%s: %v", pod.Namespace, pod.Name, err))
				continue
			}
		}
		evicted++
	}

	_ = deleteEmptyDirData // used by kubectl drain for filtering — we evict all non-DS pods

	msg := fmt.Sprintf("Node %s drained: %d pods evicted", input.ID, evicted)
	if len(evictErrors) > 0 {
		msg += fmt.Sprintf(", %d failed", len(evictErrors))
	}

	return &resource.ActionResult{
		Success: len(evictErrors) == 0,
		Message: msg,
		Data: map[string]interface{}{
			"evicted": evicted,
			"errors":  evictErrors,
		},
	}, nil
}

// isDaemonSetPod checks if a pod is managed by a DaemonSet.
func isDaemonSetPod(pod *corev1.Pod) bool {
	for _, ref := range pod.OwnerReferences {
		if ref.Kind == "DaemonSet" {
			return true
		}
	}
	return false
}

// executeAddTaint appends a taint to the node's spec.taints.
func (n *NodeResourcer) executeAddTaint(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	key, _ := input.Params["key"].(string)
	value, _ := input.Params["value"].(string)
	effect, _ := input.Params["effect"].(string)

	if key == "" {
		return nil, fmt.Errorf("taint key is required")
	}
	if effect == "" {
		return nil, fmt.Errorf("taint effect is required (NoSchedule, PreferNoSchedule, NoExecute)")
	}

	// Get the current node to read existing taints.
	node, err := client.KubeClient.CoreV1().Nodes().Get(ctx, input.ID, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get node %s: %w", input.ID, err)
	}

	// Check for duplicate.
	for _, t := range node.Spec.Taints {
		if t.Key == key && string(t.Effect) == effect {
			return &resource.ActionResult{
				Success: true,
				Message: fmt.Sprintf("Taint %s:%s already exists on node %s", key, effect, input.ID),
			}, nil
		}
	}

	newTaint := corev1.Taint{
		Key:    key,
		Value:  value,
		Effect: corev1.TaintEffect(effect),
	}
	node.Spec.Taints = append(node.Spec.Taints, newTaint)

	taintsJSON, err := json.Marshal(node.Spec.Taints)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal taints: %w", err)
	}

	patch := fmt.Sprintf(`{"spec":{"taints":%s}}`, taintsJSON)
	_, err = client.KubeClient.CoreV1().Nodes().Patch(
		ctx, input.ID, k8stypes.StrategicMergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to add taint to node %s: %w", input.ID, err)
	}

	return &resource.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Taint %s=%s:%s added to node %s", key, value, effect, input.ID),
	}, nil
}

// executeRemoveTaint removes a taint matching key+effect from the node.
func (n *NodeResourcer) executeRemoveTaint(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	key, _ := input.Params["key"].(string)
	effect, _ := input.Params["effect"].(string)

	if key == "" {
		return nil, fmt.Errorf("taint key is required")
	}

	node, err := client.KubeClient.CoreV1().Nodes().Get(ctx, input.ID, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get node %s: %w", input.ID, err)
	}

	filtered := make([]corev1.Taint, 0, len(node.Spec.Taints))
	removed := false
	for _, t := range node.Spec.Taints {
		if t.Key == key && (effect == "" || string(t.Effect) == effect) {
			removed = true
			continue
		}
		filtered = append(filtered, t)
	}

	if !removed {
		return &resource.ActionResult{
			Success: true,
			Message: fmt.Sprintf("Taint %s not found on node %s", key, input.ID),
		}, nil
	}

	taintsJSON, err := json.Marshal(filtered)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal taints: %w", err)
	}

	// Use MergePatch (not strategic merge) so that the full taints array is replaced.
	patch := fmt.Sprintf(`{"spec":{"taints":%s}}`, taintsJSON)
	_, err = client.KubeClient.CoreV1().Nodes().Patch(
		ctx, input.ID, k8stypes.MergePatchType,
		[]byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to remove taint from node %s: %w", input.ID, err)
	}

	return &resource.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Taint %s removed from node %s", key, input.ID),
	}, nil
}

// executeGetConditions returns the node's status conditions in a structured format.
func (n *NodeResourcer) executeGetConditions(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	node, err := client.KubeClient.CoreV1().Nodes().Get(ctx, input.ID, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get node %s: %w", input.ID, err)
	}

	conditions := make([]interface{}, 0, len(node.Status.Conditions))
	for _, c := range node.Status.Conditions {
		conditions = append(conditions, map[string]interface{}{
			"type":               string(c.Type),
			"status":             string(c.Status),
			"reason":             c.Reason,
			"message":            c.Message,
			"lastHeartbeatTime":  c.LastHeartbeatTime.Format(time.RFC3339),
			"lastTransitionTime": c.LastTransitionTime.Format(time.RFC3339),
		})
	}

	return &resource.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"conditions": conditions,
		},
	}, nil
}

// WaitForPodRunning polls until the pod is in Running phase or timeout.
// Used by the node shell handler for debug pod readiness.
func WaitForPodRunning(ctx context.Context, client kubernetes.Interface, namespace, name string, timeout time.Duration) error {
	return wait.PollUntilContextTimeout(ctx, 2*time.Second, timeout, true, func(ctx context.Context) (bool, error) {
		pod, err := client.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return false, nil
		}
		return pod.Status.Phase == corev1.PodRunning, nil
	})
}
