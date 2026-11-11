package resourcers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
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

// NewNodeResourcer creates a NodeResourcer for core::v1::Node.
func NewNodeResourcer(logger *zap.SugaredLogger, opts ...Option) *NodeResourcer {
	base := NewKubernetesResourcerBase[MetaAccessor](
		logger,
		corev1.SchemeGroupVersion.WithResource("nodes"),
		opts...,
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
	request resource.RelationshipResolutionRequest,
) ([]resource.ResolvedRelationship, error) {
	source := request.Source
	id := source.Reference.Address.ID
	if _, err := nativeRequestNamespace(source.Reference.Address.Scope); err != nil {
		return nil, err
	}
	podList, err := client.KubeClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: fields.SelectorFromSet(fields.Set{"spec.nodeName": id}).String(),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods on node %s: %w", id, err)
	}

	if len(podList.Items) == 0 {
		return nil, nil
	}

	targets := make([]resource.RelationshipTarget, 0, len(podList.Items))
	for _, pod := range podList.Items {
		target, err := makeRef(request, "k8s:/pods", pod.Name, pod.Namespace, string(pod.UID))
		if err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}

	byTarget := descriptorByTarget(n.DeclareRelationships())
	desc, ok := byTarget["k8s:/pods"]
	if !ok {
		return nil, fmt.Errorf("missing relationship descriptor for k8s:/pods")
	}

	return []resource.ResolvedRelationship{
		{
			Descriptor: desc,
			Targets:    targets,
		},
	}, nil
}

// ====================== ACTION INTERFACE ====================== //

func (n *NodeResourcer) GetActions(
	_ context.Context,
	_ *clients.ClientSet,
) ([]resource.ActionDescriptor, error) {
	return []resource.ActionDescriptor{
		{
			ID:           "cordon",
			Label:        "Cordon Node",
			Description:  "Mark the node as unschedulable",
			Icon:         "LuShieldBan",
			Scope:        resource.ActionScopeInstance,
			ParamsSchema: &resource.Schema{},
		},
		{
			ID:           "uncordon",
			Label:        "Uncordon Node",
			Description:  "Mark the node as schedulable",
			Icon:         "LuShieldCheck",
			Scope:        resource.ActionScopeInstance,
			ParamsSchema: &resource.Schema{},
		},
		{
			ID:          "drain",
			Label:       "Drain Node",
			Description: "Safely evict all pods from the node",
			Icon:        "LuArrowDownToLine",
			Scope:       resource.ActionScopeInstance,
			Dangerous:   true,
			Streaming:   true,
			ParamsSchema: &resource.Schema{
				Properties: map[string]resource.SchemaProperty{
					"gracePeriodSeconds": {Type: resource.SchemaInteger, Description: "Seconds to wait for graceful termination (handler default 30); -1 uses each pod's native termination grace period"},
					"ignoreDaemonSets":   {Type: resource.SchemaBoolean, Description: "Ignore DaemonSet-managed pods (handler default true)"},
					"deleteEmptyDirData": {Type: resource.SchemaBoolean, Description: "Delete pods using emptyDir volumes (handler default true)"},
					"force":              {Type: resource.SchemaBoolean, Description: "Force-delete pods that fail eviction (handler default false)"},
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
			ID:           "get-conditions",
			Label:        "Get Conditions",
			Description:  "Get node status conditions",
			Icon:         "LuHeartPulse",
			Scope:        resource.ActionScopeInstance,
			ParamsSchema: &resource.Schema{},
		},
	}, nil
}

func (n *NodeResourcer) ExecuteAction(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionRequest,
) (result resource.Value, resultErr error) {
	var telemetry *nativeActionTelemetry
	switch input.Action {
	case "cordon", "uncordon", "add-taint", "remove-taint", "get-conditions":
		ctx, telemetry = startNativeActionTelemetry(ctx, n.log, "node", input)
		defer func() { telemetry.finish(resultErr) }()
	}
	if _, err := nativeRequestNamespace(input.Reference.Address.Scope); err != nil {
		return resource.Value{}, err
	}
	switch input.Action {
	case "cordon":
		return n.executeCordon(ctx, client, input, true, telemetry)
	case "uncordon":
		return n.executeCordon(ctx, client, input, false, telemetry)
	case "drain":
		return resource.Value{}, resource.NewError("UNSUPPORTED", "Drain requires streaming execution")
	case "add-taint":
		return n.executeAddTaint(ctx, client, input, telemetry)
	case "remove-taint":
		return n.executeRemoveTaint(ctx, client, input, telemetry)
	case "get-conditions":
		return n.executeGetConditions(ctx, client, input, telemetry)
	default:
		return resource.Value{}, fmt.Errorf("unknown action: %s", input.Action)
	}
}

func (n *NodeResourcer) StreamAction(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionRequest,
	stream chan<- resource.ActionEvent,
) error {
	if input.Action != "drain" {
		return resource.NewError("UNSUPPORTED", "Only drain supports streaming execution")
	}
	return n.executeDrain(ctx, client, input, stream)
}

// ====================== ACTION IMPLEMENTATIONS ====================== //

// executeCordon patches spec.unschedulable on the node.
func (n *NodeResourcer) executeCordon(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionRequest,
	unschedulable bool,
	telemetry *nativeActionTelemetry,
) (resource.Value, error) {
	patch := fmt.Sprintf(`{"spec":{"unschedulable":%t}}`, unschedulable)
	telemetry.stage, telemetry.operation = "patching", "patch_node"
	_, err := client.KubeClient.CoreV1().Nodes().Patch(
		ctx, input.Reference.Address.ID, k8stypes.StrategicMergePatchType,
		nativeActionPatch(input, patch), metav1.PatchOptions{},
	)
	if err != nil {
		return resource.Value{}, fmt.Errorf("failed to patch node %s: %w", input.Reference.Address.ID, err)
	}

	verb := "cordoned"
	if !unschedulable {
		verb = "uncordoned"
	}
	return resource.ValueFromNative(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Node %s %s", input.Reference.Address.ID, verb),
	})
}

// executeDrain reports removal of the selected pod incarnations, not eviction admission.
func (n *NodeResourcer) executeDrain(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionRequest,
	stream chan<- resource.ActionEvent,
) (resultErr error) {
	ctx, span := otel.Tracer("omniview.plugin.kubernetes").Start(ctx, "kubernetes.node.drain")
	defer span.End()
	stage, operation := "validation", "validate"
	failedPodName, failedPodNamespace := "", ""
	total, drained, skipped := 0, 0, 0
	selectionKnown, cordonKnown, cordoned := false, false, false
	defer func() {
		outcome, classification, reason, status := "success", "", "", 0
		if resultErr != nil {
			outcome = "failure"
			classification = "other"
			switch {
			case errors.Is(resultErr, context.Canceled):
				outcome, classification = "canceled", "canceled"
			case errors.Is(resultErr, context.DeadlineExceeded):
				outcome, classification = "canceled", "deadline_exceeded"
			case stage == "validation":
				classification = "validation"
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
				}
			}
			span.SetStatus(codes.Error, classification)
		}
		attrs := []attribute.KeyValue{
			attribute.String("action", "drain"), attribute.String("plugin", "kubernetes"),
			attribute.String("connection", input.Route.Connection), attribute.String("resource.type", "k8s:/nodes"),
			attribute.String("resource.id", input.Reference.Address.ID), attribute.String("stage", stage),
			attribute.String("operation", operation), attribute.String("outcome", outcome),
			attribute.Bool("selection.known", selectionKnown), attribute.Int("pods.selected", total),
			attribute.Int("pods.skipped", skipped), attribute.Int("pods.removed", drained),
			attribute.Bool("cordon.known", cordonKnown),
		}
		fields := []interface{}{"action", "drain", "plugin", "kubernetes", "connection", input.Route.Connection,
			"resource_type", "k8s:/nodes", "resource_id", input.Reference.Address.ID, "stage", stage,
			"operation", operation, "outcome", outcome, "selection_known", selectionKnown,
			"selected", total, "skipped", skipped, "removed", drained, "cordon_known", cordonKnown}
		if cordonKnown {
			attrs = append(attrs, attribute.Bool("cordon.succeeded", cordoned))
			fields = append(fields, "cordon_succeeded", cordoned)
		}
		if resultErr != nil {
			attrs = append(attrs, attribute.String("error.class", classification))
			fields = append(fields, "error_class", classification)
			if failedPodName != "" {
				attrs = append(attrs, attribute.String("pod.name", failedPodName), attribute.String("pod.namespace", failedPodNamespace))
				fields = append(fields, "pod_name", failedPodName, "pod_namespace", failedPodNamespace)
			}
			if classification == "kubernetes" {
				attrs = append(attrs, attribute.Int("k8s.status_code", status), attribute.String("k8s.reason", reason))
				fields = append(fields, "k8s_status_code", status, "k8s_reason", reason)
			}
		}
		span.SetAttributes(attrs...)
		if span.SpanContext().IsValid() {
			fields = append(fields, "trace_id", span.SpanContext().TraceID().String(), "span_id", span.SpanContext().SpanID().String())
		}
		n.log.Infow("Node drain finished", fields...)
	}()
	if _, err := nativeRequestNamespace(input.Reference.Address.Scope); err != nil {
		return err
	}
	params, err := nativeActionParams(input.Input)
	if err != nil {
		return err
	}
	for key := range params {
		switch key {
		case "gracePeriodSeconds", "ignoreDaemonSets", "deleteEmptyDirData", "force":
		default:
			return fmt.Errorf("unknown drain parameter %q", key)
		}
	}
	gracePeriod := int64(30)
	if value, ok := params["gracePeriodSeconds"]; ok {
		gracePeriod, err = nativeActionInteger(value, -1, math.MaxInt64)
		if err != nil {
			return fmt.Errorf("gracePeriodSeconds: %w", err)
		}
	}
	boolParam := func(key string, fallback bool) (bool, error) {
		value, ok := params[key]
		if !ok {
			return fallback, nil
		}
		boolean, valid := value.(bool)
		if !valid {
			return false, fmt.Errorf("%s must be a boolean", key)
		}
		return boolean, nil
	}
	ignoreDaemonSets, err := boolParam("ignoreDaemonSets", true)
	if err != nil {
		return err
	}
	deleteEmptyDirData, err := boolParam("deleteEmptyDirData", true)
	if err != nil {
		return err
	}
	force, err := boolParam("force", false)
	if err != nil {
		return err
	}
	var nativeGracePeriod *int64
	if gracePeriod != -1 {
		nativeGracePeriod = &gracePeriod
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case stream <- resource.ActionEvent{Type: "ready"}:
	case <-ctx.Done():
		return ctx.Err()
	}
	stage, operation = "cordoning", "emit_progress"
	emit := func(eventType, stage, message string) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		data, err := nativeActionEventValue(map[string]interface{}{
			"stage": stage, "message": message, "drained": drained, "selected": total, "skipped": skipped,
		})
		if err != nil {
			return err
		}
		progress := &resource.ActivityProgress{Kind: "indeterminate"}
		if total > 0 {
			progress = &resource.ActivityProgress{Kind: "units", Current: fmt.Sprint(drained), Total: fmt.Sprint(total), Unit: "pods"}
		}
		var metrics []resource.ActivityMetric
		if selectionKnown {
			metrics = []resource.ActivityMetric{
				{ID: "drained", Label: "Removed", Value: fmt.Sprint(drained), Unit: "pods"},
				{ID: "remaining", Label: "Remaining", Value: fmt.Sprint(total - drained), Unit: "pods"},
				{ID: "skipped", Label: "Skipped", Value: fmt.Sprint(skipped), Unit: "pods"},
			}
		}
		event := resource.ActionEvent{Type: eventType, Data: data, Activity: &resource.ActivityPresentation{
			Title: "Drain Node " + input.Reference.Address.ID, Message: message, Progress: progress, Metrics: metrics,
		}}
		select {
		case stream <- event:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if err := emit("progress", "cordoning", "Cordoning node"); err != nil {
		return err
	}
	operation = "patch_node"
	node, err := client.KubeClient.CoreV1().Nodes().Patch(ctx, input.Reference.Address.ID,
		k8stypes.StrategicMergePatchType, nativeActionPatch(input, `{"spec":{"unschedulable":true}}`), metav1.PatchOptions{})
	if err != nil {
		return fmt.Errorf("failed to cordon node %s: %w", input.Reference.Address.ID, err)
	}
	cordonKnown, cordoned = true, node.Spec.Unschedulable
	checkNode := func() error {
		operation = "get_node"
		if err := ctx.Err(); err != nil {
			return err
		}
		current, err := client.KubeClient.CoreV1().Nodes().Get(ctx, node.Name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("failed to check drained node: %w", err)
		}
		if current.UID != node.UID {
			operation = "check_node_incarnation"
			return fmt.Errorf("node %s incarnation changed during drain", node.Name)
		}
		return nil
	}
	stage, operation = "selecting", "emit_progress"
	if err := emit("progress", "selecting", "Selecting pods on cordoned node"); err != nil {
		return err
	}
	operation = "list_pods"
	pods, err := client.KubeClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: fields.OneTermEqualSelector("spec.nodeName", node.Name).String(),
	})
	if err != nil {
		return fmt.Errorf("failed to list pods on node %s: %w", node.Name, err)
	}
	operation = "select_pods"
	selected := make([]*corev1.Pod, 0, len(pods.Items))
	for i := range pods.Items {
		pod := &pods.Items[i]
		_, mirror := pod.Annotations[corev1.MirrorPodAnnotationKey]
		if mirror || (ignoreDaemonSets && isDaemonSetPod(pod)) ||
			pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
			skipped++
			continue
		}
		if !deleteEmptyDirData {
			for _, volume := range pod.Spec.Volumes {
				if volume.EmptyDir != nil {
					return fmt.Errorf("pod %s/%s uses emptyDir; deleteEmptyDirData is false", pod.Namespace, pod.Name)
				}
			}
		}
		selected = append(selected, pod)
		total = len(selected)
	}
	total = len(selected)
	selectionKnown = true
	stage = "evicting"
	for _, pod := range selected {
		if err := checkNode(); err != nil {
			return err
		}
		operation = "emit_progress"
		if err := emit("progress", "evicting", "Evicting selected pods"); err != nil {
			return err
		}
		eviction := &policyv1.Eviction{
			ObjectMeta:    metav1.ObjectMeta{Name: pod.Name, Namespace: pod.Namespace},
			DeleteOptions: &metav1.DeleteOptions{GracePeriodSeconds: nativeGracePeriod, Preconditions: nativePodUIDPreconditions(pod)},
		}
		operation = "evict_pod"
		if err := client.KubeClient.PolicyV1().Evictions(pod.Namespace).Evict(ctx, eviction); err != nil && !apierrors.IsNotFound(err) {
			if !force {
				failedPodName, failedPodNamespace = pod.Name, pod.Namespace
				return fmt.Errorf("failed to evict pod %s/%s: %w", pod.Namespace, pod.Name, err)
			}
			if err := checkNode(); err != nil {
				return err
			}
			operation = "delete_pod"
			zero := int64(0)
			if err := client.KubeClient.CoreV1().Pods(pod.Namespace).Delete(ctx, pod.Name, metav1.DeleteOptions{
				GracePeriodSeconds: &zero, Preconditions: nativePodUIDPreconditions(pod),
			}); err != nil && !apierrors.IsNotFound(err) {
				failedPodName, failedPodNamespace = pod.Name, pod.Namespace
				return fmt.Errorf("failed to force-delete pod %s/%s: %w", pod.Namespace, pod.Name, err)
			}
		}
	}
	stage, operation = "observing", "emit_progress"
	if err := emit("progress", "waiting", "Waiting for selected pods to terminate"); err != nil {
		return err
	}
	pending := selected
	err = wait.PollUntilContextCancel(ctx, time.Second, true, func(ctx context.Context) (bool, error) {
		if err := checkNode(); err != nil {
			return false, err
		}
		operation = "get_pod"
		previousDrained := drained
		remaining := pending[:0]
		for _, pod := range pending {
			current, err := client.KubeClient.CoreV1().Pods(pod.Namespace).Get(ctx, pod.Name, metav1.GetOptions{})
			if apierrors.IsNotFound(err) || (err == nil && current.UID != pod.UID) {
				drained++
				continue
			}
			if err != nil {
				failedPodName, failedPodNamespace = pod.Name, pod.Namespace
				return false, fmt.Errorf("failed to observe pod %s/%s termination: %w", pod.Namespace, pod.Name, err)
			}
			remaining = append(remaining, pod)
		}
		pending = remaining
		if drained != previousDrained {
			operation = "emit_progress"
			if err := emit("progress", "waiting", "Waiting for selected pods to terminate"); err != nil {
				return false, err
			}
		}
		return len(pending) == 0, nil
	})
	if err != nil {
		return err
	}
	stage, operation = "complete", "emit_complete"
	return emit("complete", "complete", fmt.Sprintf("Node %s drained: %d pods removed", node.Name, drained))
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
	input resource.ActionRequest,
	telemetry *nativeActionTelemetry,
) (resource.Value, error) {
	params, paramsErr := nativeActionParams(input.Input)
	if paramsErr != nil {
		return resource.Value{}, paramsErr
	}
	key, _ := params["key"].(string)
	value, _ := params["value"].(string)
	effect, _ := params["effect"].(string)

	if key == "" {
		return resource.Value{}, fmt.Errorf("taint key is required")
	}
	if effect == "" {
		return resource.Value{}, fmt.Errorf("taint effect is required (NoSchedule, PreferNoSchedule, NoExecute)")
	}

	// Get the current node to read existing taints.
	telemetry.stage, telemetry.operation = "fetching", "get_node"
	node, err := client.KubeClient.CoreV1().Nodes().Get(ctx, input.Reference.Address.ID, metav1.GetOptions{})
	if err == nil {
		if err := nativeActionObjectMatches(input, node); err != nil {
			return resource.Value{}, err
		}
	}
	if err != nil {
		return resource.Value{}, fmt.Errorf("failed to get node %s: %w", input.Reference.Address.ID, err)
	}

	// Check for duplicate.
	for _, t := range node.Spec.Taints {
		if t.Key == key && string(t.Effect) == effect {
			return resource.ValueFromNative(map[string]interface{}{
				"success": true,
				"message": fmt.Sprintf("Taint %s:%s already exists on node %s", key, effect, input.Reference.Address.ID),
			})
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
		return resource.Value{}, fmt.Errorf("failed to marshal taints: %w", err)
	}

	patch := fmt.Sprintf(`{"spec":{"taints":%s}}`, taintsJSON)
	telemetry.stage, telemetry.operation = "patching", "patch_node"
	_, err = client.KubeClient.CoreV1().Nodes().Patch(
		ctx, input.Reference.Address.ID, k8stypes.StrategicMergePatchType,
		nativeActionPatch(input, patch), metav1.PatchOptions{},
	)
	if err != nil {
		return resource.Value{}, fmt.Errorf("failed to add taint to node %s: %w", input.Reference.Address.ID, err)
	}

	return resource.ValueFromNative(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Taint %s=%s:%s added to node %s", key, value, effect, input.Reference.Address.ID),
	})
}

// executeRemoveTaint removes a taint matching key+effect from the node.
func (n *NodeResourcer) executeRemoveTaint(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionRequest,
	telemetry *nativeActionTelemetry,
) (resource.Value, error) {
	params, paramsErr := nativeActionParams(input.Input)
	if paramsErr != nil {
		return resource.Value{}, paramsErr
	}
	key, _ := params["key"].(string)
	effect, _ := params["effect"].(string)

	if key == "" {
		return resource.Value{}, fmt.Errorf("taint key is required")
	}

	telemetry.stage, telemetry.operation = "fetching", "get_node"
	node, err := client.KubeClient.CoreV1().Nodes().Get(ctx, input.Reference.Address.ID, metav1.GetOptions{})
	if err == nil {
		if err := nativeActionObjectMatches(input, node); err != nil {
			return resource.Value{}, err
		}
	}
	if err != nil {
		return resource.Value{}, fmt.Errorf("failed to get node %s: %w", input.Reference.Address.ID, err)
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
		return resource.ValueFromNative(map[string]interface{}{
			"success": true,
			"message": fmt.Sprintf("Taint %s not found on node %s", key, input.Reference.Address.ID),
		})
	}

	taintsJSON, err := json.Marshal(filtered)
	if err != nil {
		return resource.Value{}, fmt.Errorf("failed to marshal taints: %w", err)
	}

	// Use MergePatch (not strategic merge) so that the full taints array is replaced.
	patch := fmt.Sprintf(`{"spec":{"taints":%s}}`, taintsJSON)
	telemetry.stage, telemetry.operation = "patching", "patch_node"
	_, err = client.KubeClient.CoreV1().Nodes().Patch(
		ctx, input.Reference.Address.ID, k8stypes.MergePatchType,
		nativeActionPatch(input, patch), metav1.PatchOptions{},
	)
	if err != nil {
		return resource.Value{}, fmt.Errorf("failed to remove taint from node %s: %w", input.Reference.Address.ID, err)
	}

	return resource.ValueFromNative(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Taint %s removed from node %s", key, input.Reference.Address.ID),
	})
}

// executeGetConditions returns the node's status conditions in a structured format.
func (n *NodeResourcer) executeGetConditions(
	ctx context.Context,
	client *clients.ClientSet,
	input resource.ActionRequest,
	telemetry *nativeActionTelemetry,
) (resource.Value, error) {
	telemetry.stage, telemetry.operation = "fetching", "get_node"
	node, err := client.KubeClient.CoreV1().Nodes().Get(ctx, input.Reference.Address.ID, metav1.GetOptions{})
	if err == nil {
		if err := nativeActionObjectMatches(input, node); err != nil {
			return resource.Value{}, err
		}
	}
	if err != nil {
		return resource.Value{}, fmt.Errorf("failed to get node %s: %w", input.Reference.Address.ID, err)
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

	return resource.ValueFromNative(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"conditions": conditions,
		},
	})
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

// nativeActionParams decodes canonical values without losing integer intent.
func nativeActionParams(value resource.Value) (map[string]any, error) {
	native, err := resource.NativeFromValue(value)
	if err != nil {
		return nil, err
	}
	if native == nil {
		return nil, nil
	}
	params, ok := native.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("action input must be an object")
	}
	return params, nil
}

func nativeActionInteger(value any, minimum, maximum int64) (int64, error) {
	var number int64
	switch v := value.(type) {
	case int64:
		number = v
	case uint64:
		if v > uint64(maximum) {
			return 0, fmt.Errorf("integer exceeds native range")
		}
		number = int64(v)
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Trunc(v) != v || v < float64(minimum) || v >= 9223372036854775808.0 {
			return 0, fmt.Errorf("expected an integer in native range")
		}
		number = int64(v)
	default:
		return 0, fmt.Errorf("expected an integer")
	}
	if number < minimum || number > maximum {
		return 0, fmt.Errorf("integer exceeds native range")
	}
	return number, nil
}

// nativeActionEventValue encodes internally constructed event payloads.
func nativeActionEventValue(payload any) (*resource.Value, error) {
	value, err := resource.ValueFromNative(payload)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

// nativeActionPatch pins native mutations to the requested incarnation.
func nativeActionPatch(request resource.ActionRequest, patch string) []byte {
	if request.Reference.Incarnation == nil {
		return []byte(patch)
	}
	uid, _ := json.Marshal(*request.Reference.Incarnation)
	return []byte("{\"metadata\":{\"uid\":" + string(uid) + "}," + patch[1:])
}

func nativeActionObjectMatches(request resource.ActionRequest, object metav1.Object) error {
	if request.Reference.Incarnation != nil && string(object.GetUID()) != *request.Reference.Incarnation {
		return resource.NewError("CONFLICT", "resource incarnation changed")
	}
	return nil
}

func nativePodUIDPreconditions(pod *corev1.Pod) *metav1.Preconditions {
	if pod.UID == "" {
		return nil
	}
	uid := pod.UID
	return &metav1.Preconditions{UID: &uid}
}
