package resourcers

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

// newNodeResourcer creates a NodeResourcer for testing.
func newTestNodeResourcer() *NodeResourcer {
	return NewNodeResourcer(zap.NewNop().Sugar())
}

// newNodeClientSet creates a ClientSet with a fake typed clientset seeded with the given objects.
func newNodeClientSet(objects ...runtime.Object) *clients.ClientSet {
	fakeClient := fake.NewSimpleClientset(objects...)
	return &clients.ClientSet{
		KubeClient: fakeClient,
	}
}

// testNode creates a Node object for testing.
func testNode(name string, opts ...func(*corev1.Node)) *corev1.Node {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: name},
		Spec:       corev1.NodeSpec{},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionTrue,
					Reason: "KubeletReady",
				},
			},
		},
	}
	for _, o := range opts {
		o(node)
	}
	return node
}

func withUnschedulable(n *corev1.Node) {
	n.Spec.Unschedulable = true
}

func withTaints(taints ...corev1.Taint) func(*corev1.Node) {
	return func(n *corev1.Node) {
		n.Spec.Taints = taints
	}
}

// testPodOnNode creates a Pod on a given node for drain tests.
func testPodOnNode(name, namespace, nodeName string, opts ...func(*corev1.Pod)) *corev1.Pod {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
		},
		Spec: corev1.PodSpec{
			NodeName: nodeName,
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}
	for _, o := range opts {
		o(pod)
	}
	return pod
}

func withDaemonSetOwner(pod *corev1.Pod) {
	pod.OwnerReferences = []metav1.OwnerReference{
		{Kind: "DaemonSet", Name: "some-ds", APIVersion: "apps/v1"},
	}
}

func withMirrorAnnotation(pod *corev1.Pod) {
	if pod.Annotations == nil {
		pod.Annotations = make(map[string]string)
	}
	pod.Annotations[corev1.MirrorPodAnnotationKey] = "some-hash"
}

// ===================== GetActions =====================

func TestNodeResourcer_GetActions(t *testing.T) {
	r := newTestNodeResourcer()
	actions, err := r.GetActions(context.Background(), nil)
	require.NoError(t, err)
	require.Len(t, actions, 6)

	ids := make([]string, len(actions))
	for i, a := range actions {
		ids[i] = a.ID
	}
	assert.Contains(t, ids, "cordon")
	assert.Contains(t, ids, "uncordon")
	assert.Contains(t, ids, "drain")
	assert.Contains(t, ids, "add-taint")
	assert.Contains(t, ids, "remove-taint")
	assert.Contains(t, ids, "get-conditions")

	for _, a := range actions {
		assert.Equal(t, resource.ActionScopeInstance, a.Scope)
		assert.NotEmpty(t, a.Label)
		assert.NotEmpty(t, a.Description)
		assert.Equal(t, a.ID == "drain", a.Streaming)
	}
}

// ===================== Cordon =====================

func TestNodeResourcer_Cordon(t *testing.T) {
	node := testNode("worker-1")
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("cordon", "worker-1", "", nil))

	require.NoError(t, err)
	require.Equal(t, "map", result.Kind)
	assert.True(t, result.Map["success"].Bool)
	assert.Contains(t, result.Map["message"].String, "cordoned")

	// Verify the node is now unschedulable.
	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "worker-1", metav1.GetOptions{})
	require.NoError(t, err)
	assert.True(t, updated.Spec.Unschedulable)
}

func TestNodeResourcer_Cordon_AlreadyCordoned(t *testing.T) {
	node := testNode("worker-1", withUnschedulable)
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("cordon", "worker-1", "", nil))

	require.NoError(t, err)
	require.Equal(t, "map", result.Kind)
	assert.True(t, result.Map["success"].Bool)

	// Still unschedulable.
	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "worker-1", metav1.GetOptions{})
	require.NoError(t, err)
	assert.True(t, updated.Spec.Unschedulable)
}

func TestNodeResourcer_Cordon_NotFound(t *testing.T) {
	cs := newNodeClientSet() // no nodes
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("cordon", "nonexistent", "", nil))

	require.Error(t, err)
	assert.Equal(t, resource.Value{}, result)
	assert.Contains(t, err.Error(), "failed to patch node")
}

// ===================== Uncordon =====================

func TestNodeResourcer_Uncordon(t *testing.T) {
	node := testNode("worker-1", withUnschedulable)
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("uncordon", "worker-1", "", nil))

	require.NoError(t, err)
	require.Equal(t, "map", result.Kind)
	assert.True(t, result.Map["success"].Bool)
	assert.Contains(t, result.Map["message"].String, "uncordoned")

	// Verify the node is now schedulable.
	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "worker-1", metav1.GetOptions{})
	require.NoError(t, err)
	assert.False(t, updated.Spec.Unschedulable)
}

// ===================== Drain =====================

func TestNodeResourcer_Drain_ReadyBeforeProgressAndMutation(t *testing.T) {
	cs := newNodeClientSet(testNode("worker"))
	stream := make(chan resource.ActionEvent, 32)
	var events []resource.ActionEvent
	cs.KubeClient.(*fake.Clientset).PrependReactor("patch", "nodes", func(k8stesting.Action) (bool, runtime.Object, error) {
		// The real handler must establish readiness before it mutates Kubernetes.
		require.Len(t, stream, 2)
		events = append(events, <-stream, <-stream)
		require.Equal(t, "ready", events[0].Type)
		require.Equal(t, "progress", events[1].Type)
		require.Equal(t, "cordoning", events[1].Data.Map["stage"].String)
		return false, nil, nil
	})
	require.NoError(t, newTestNodeResourcer().StreamAction(context.Background(), cs, workloadActionRequest("drain", "worker", "", nil), stream))
	close(stream)
	for event := range stream {
		events = append(events, event)
	}
	require.NotEmpty(t, events)
	require.Equal(t, "ready", events[0].Type)
	readyCount := 0
	for i, event := range events {
		switch event.Type {
		case "ready":
			readyCount++
			require.Zero(t, i, "ready must precede every action event")
		case "progress", "complete":
			require.Equal(t, 1, readyCount, "SDK requires exactly one ready before action events")
			require.NotNil(t, event.Activity)
			require.NoError(t, resource.ValidateActivityPresentation(*event.Activity))
		default:
			t.Fatalf("unexpected action event %q", event.Type)
		}
	}
	require.Equal(t, 1, readyCount)
	require.Equal(t, "complete", events[len(events)-1].Type)
}

func TestNodeResourcer_Drain_CanceledBeforeReadyNeverMutates(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	stream := make(chan resource.ActionEvent, 16)
	err := newTestNodeResourcer().StreamAction(ctx, nil, workloadActionRequest("drain", "worker", "", nil), stream)
	require.ErrorIs(t, err, context.Canceled)
	require.Empty(t, stream)
}

func TestNodeResourcer_Drain_CanceledAfterReadyNeverMutates(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream := make(chan resource.ActionEvent)
	done := make(chan error, 1)
	go func() {
		done <- newTestNodeResourcer().StreamAction(ctx, nil, workloadActionRequest("drain", "worker", "", nil), stream)
	}()
	select {
	case event := <-stream:
		require.Equal(t, "ready", event.Type)
	case <-time.After(5 * time.Second):
		t.Fatal("drain did not become ready")
	}
	cancel()
	select {
	case err := <-done:
		require.ErrorIs(t, err, context.Canceled)
	case <-time.After(5 * time.Second):
		t.Fatal("drain did not stop after cancellation")
	}
}

func TestNodeResourcer_Drain_GracePeriodOptions(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value *resource.Value
		want  *int64
	}{
		{name: "drawer pod defaults", value: &resource.Value{Kind: "int64", Int: "-1"}},
		{name: "absent retains thirty seconds", want: ptrInt64(30)},
		{name: "immediate", value: &resource.Value{Kind: "int64", Int: "0"}, want: ptrInt64(0)},
		{name: "explicit", value: &resource.Value{Kind: "int64", Int: "45"}, want: ptrInt64(45)},
		{name: "maximum", value: &resource.Value{Kind: "int64", Int: "9223372036854775807"}, want: ptrInt64(9223372036854775807)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pod := testPodOnNode("app", "default", "worker")
			pod.UID = "pod-uid"
			pod.Spec.TerminationGracePeriodSeconds = ptrInt64(75)
			cs := newNodeClientSet(testNode("worker"), pod)
			var eviction *policyv1.Eviction
			cs.KubeClient.(*fake.Clientset).PrependReactor("create", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
				require.Equal(t, "eviction", action.GetSubresource())
				eviction = action.(k8stesting.CreateAction).GetObject().(*policyv1.Eviction)
				require.NoError(t, cs.KubeClient.(*fake.Clientset).Tracker().Delete(corev1.SchemeGroupVersion.WithResource("pods"), pod.Namespace, pod.Name))
				return true, eviction, nil
			})
			request := workloadActionRequest("drain", "worker", "", nil)
			request.Reference.Address.Type = "k8s:/nodes"
			uid := "node-uid"
			request.Reference.Incarnation = &uid
			// This is the actual jsonToValue drawer payload, including tagged -1.
			require.NoError(t, json.Unmarshal([]byte(`{"kind":"map","value":{"gracePeriodSeconds":{"kind":"int64","value":"-1"},"ignoreDaemonSets":{"kind":"bool","value":true},"deleteEmptyDirData":{"kind":"bool","value":true},"force":{"kind":"bool","value":false}}}`), &request.Input))
			if tc.value == nil {
				delete(request.Input.Map, "gracePeriodSeconds")
			} else {
				request.Input.Map["gracePeriodSeconds"] = *tc.value
			}

			stream := make(chan resource.ActionEvent, 32)
			err := newTestNodeResourcer().StreamAction(context.Background(), cs, request, stream)
			require.NoError(t, err)
			require.NotNil(t, eviction)
			require.NotNil(t, eviction.DeleteOptions)
			assert.Equal(t, tc.want, eviction.DeleteOptions.GracePeriodSeconds)
			require.NotNil(t, eviction.DeleteOptions.Preconditions)
			assert.Equal(t, pod.UID, *eviction.DeleteOptions.Preconditions.UID)
			patch := cs.KubeClient.(*fake.Clientset).Actions()[0].(k8stesting.PatchAction)
			assert.JSONEq(t, `{"metadata":{"uid":"node-uid"},"spec":{"unschedulable":true}}`, string(patch.GetPatch()))
		})
	}
}

func TestNodeResourcer_Drain_InvalidGraceNeverAcquiresNativeClient(t *testing.T) {
	for _, value := range []resource.Value{
		{Kind: "int64", Int: "-2"},
		{Kind: "int64", Int: "-9223372036854775808"},
		{Kind: "uint64", Uint: "9223372036854775808"},
		{Kind: "double", Double: -1.5},
	} {
		request := workloadActionRequest("drain", "worker", "", nil)
		request.Input = resource.Value{Kind: "map", Map: map[string]resource.Value{"gracePeriodSeconds": value}}
		stream := make(chan resource.ActionEvent, 16)
		err := newTestNodeResourcer().StreamAction(context.Background(), nil, request, stream)
		require.ErrorContains(t, err, "gracePeriodSeconds")
		require.Empty(t, stream)
	}
}

func ptrInt64(value int64) *int64 { return &value }

func TestNodeResourcer_Drain_WaitsForTermination(t *testing.T) {
	pod := testPodOnNode("app", "default", "worker")
	pod.UID = "selected"
	cs := newNodeClientSet(testNode("worker"), pod)
	cs.KubeClient.(*fake.Clientset).PrependReactor("create", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, action.(k8stesting.CreateAction).GetObject(), nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream := make(chan resource.ActionEvent)
	done := make(chan error, 1)
	go func() {
		done <- newTestNodeResourcer().StreamAction(ctx, cs, workloadActionRequest("drain", "worker", "", nil), stream)
	}()
	for {
		event := <-stream
		if event.Type == "ready" {
			continue
		}
		require.NotEqual(t, "complete", event.Type)
		if event.Data.Map["stage"].String == "waiting" {
			require.Equal(t, "0", event.Data.Map["drained"].Int)
			require.Equal(t, "0", event.Activity.Progress.Current)
			break
		}
	}
	require.NoError(t, cs.KubeClient.(*fake.Clientset).Tracker().Delete(corev1.SchemeGroupVersion.WithResource("pods"), pod.Namespace, pod.Name))
	for _, event := range streamUntilDone(t, stream, done) {
		if event.Type == "complete" {
			require.Equal(t, "1", event.Data.Map["drained"].Int)
			return
		}
	}
	t.Fatal("missing completion")
}

func TestNodeResourcer_Drain_DoesNotRepeatUnchangedProgress(t *testing.T) {
	pod := testPodOnNode("app", "default", "worker")
	pod.UID = "selected"
	cs := newNodeClientSet(testNode("worker"), pod)
	client := cs.KubeClient.(*fake.Clientset)
	client.PrependReactor("create", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, action.(k8stesting.CreateAction).GetObject(), nil
	})
	observations := 0
	client.PrependReactor("get", "pods", func(k8stesting.Action) (bool, runtime.Object, error) {
		observations++
		if observations == 3 {
			return true, nil, apierrors.NewNotFound(schema.GroupResource{Resource: "pods"}, pod.Name)
		}
		return true, pod, nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stream := make(chan resource.ActionEvent, 32)
	require.NoError(t, newTestNodeResourcer().StreamAction(ctx, cs, workloadActionRequest("drain", "worker", "", nil), stream))
	close(stream)
	waiting := 0
	for event := range stream {
		if event.Type == "ready" {
			continue
		}
		require.NotNil(t, event.Activity)
		require.NoError(t, resource.ValidateActivityPresentation(*event.Activity))
		if event.Data.Map["stage"].String == "waiting" {
			waiting++
		}
	}
	require.Equal(t, 3, observations)
	require.Equal(t, 2, waiting, "initial waiting and changed removal count only")
}

func streamUntilDone(t *testing.T, stream <-chan resource.ActionEvent, done <-chan error) []resource.ActionEvent {
	t.Helper()
	var events []resource.ActionEvent
	for {
		select {
		case event := <-stream:
			events = append(events, event)
		case err := <-done:
			require.NoError(t, err)
			return events
		case <-time.After(5 * time.Second):
			t.Fatal("drain did not finish")
		}
	}
}

func TestNodeResourcer_Drain_SkipsUnselectedPods(t *testing.T) {
	for _, pod := range []*corev1.Pod{
		testPodOnNode("daemon", "default", "worker", withDaemonSetOwner),
		testPodOnNode("mirror", "default", "worker", withMirrorAnnotation),
		testPodOnNode("completed", "default", "worker", func(p *corev1.Pod) { p.Status.Phase = corev1.PodSucceeded }),
		testPodOnNode("failed", "default", "worker", func(p *corev1.Pod) { p.Status.Phase = corev1.PodFailed }),
	} {
		t.Run(pod.Name, func(t *testing.T) {
			cs := newNodeClientSet(testNode("worker"), pod)
			stream := make(chan resource.ActionEvent, 32)
			require.NoError(t, newTestNodeResourcer().StreamAction(context.Background(), cs, workloadActionRequest("drain", "worker", "", nil), stream))
			close(stream)
			for event := range stream {
				if event.Type == "ready" {
					continue
				}
				require.NotNil(t, event.Activity)
				require.NoError(t, resource.ValidateActivityPresentation(*event.Activity))
				if event.Type == "complete" {
					assert.Equal(t, "0", event.Data.Map["drained"].Int)
					assert.Equal(t, "1", event.Data.Map["skipped"].Int)
				}
			}
			for _, action := range cs.KubeClient.(*fake.Clientset).Actions() {
				require.NotEqual(t, "eviction", action.GetSubresource())
			}
		})
	}
}

func TestNodeResourcer_Drain_ErrorsNeverComplete(t *testing.T) {
	for _, stage := range []string{"eviction", "observation", "replacement", "cancellation"} {
		t.Run(stage, func(t *testing.T) {
			pod := testPodOnNode("app", "default", "worker")
			pod.UID = "original"
			cs := newNodeClientSet(testNode("worker"), pod)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			client := cs.KubeClient.(*fake.Clientset)
			client.PrependReactor("create", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
				if stage == "eviction" {
					return true, nil, apierrors.NewTooManyRequests("PDB blocks eviction", 0)
				}
				if stage == "cancellation" {
					cancel()
				}
				return true, action.(k8stesting.CreateAction).GetObject(), nil
			})
			if stage == "observation" {
				client.PrependReactor("get", "pods", func(k8stesting.Action) (bool, runtime.Object, error) {
					return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "app", errors.New("denied"))
				})
			}
			if stage == "replacement" {
				client.PrependReactor("get", "nodes", func(k8stesting.Action) (bool, runtime.Object, error) {
					node := testNode("worker")
					node.UID = "replacement"
					return true, node, nil
				})
			}
			stream := make(chan resource.ActionEvent, 32)
			require.Error(t, newTestNodeResourcer().StreamAction(ctx, cs, workloadActionRequest("drain", "worker", "", nil), stream))
			close(stream)
			for event := range stream {
				require.NotEqual(t, "complete", event.Type)
			}
		})
	}
}

func TestNodeResourcer_Drain_RejectsUnsafeEmptyDirAndInvalidInput(t *testing.T) {
	pod := testPodOnNode("app", "default", "worker")
	pod.Spec.Volumes = []corev1.Volume{{Name: "data", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}}}
	cs := newNodeClientSet(testNode("worker"), pod)
	err := newTestNodeResourcer().StreamAction(context.Background(), cs, workloadActionRequest("drain", "worker", "", map[string]interface{}{"deleteEmptyDirData": false}), make(chan resource.ActionEvent, 32))
	require.ErrorContains(t, err, "emptyDir")
	for _, action := range cs.KubeClient.(*fake.Clientset).Actions() {
		require.NotEqual(t, "eviction", action.GetSubresource())
	}
	for _, key := range []string{"force", "ignoreDaemonSets", "deleteEmptyDirData", "unknown"} {
		err := newTestNodeResourcer().StreamAction(context.Background(), nil, workloadActionRequest("drain", "worker", "", map[string]interface{}{key: "invalid"}), make(chan resource.ActionEvent, 32))
		require.Error(t, err)
	}
}

func TestNodeResourcer_Drain_ObservesOriginalPodAndGuardsForceDelete(t *testing.T) {
	for _, force := range []bool{false, true} {
		t.Run(map[bool]string{false: "replacement after admission", true: "force delete UID guard"}[force], func(t *testing.T) {
			pod := testPodOnNode("app", "default", "worker")
			pod.UID = "original"
			cs := newNodeClientSet(testNode("worker"), pod)
			client := cs.KubeClient.(*fake.Clientset)
			client.PrependReactor("create", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
				eviction := action.(k8stesting.CreateAction).GetObject().(*policyv1.Eviction)
				require.Equal(t, pod.UID, *eviction.DeleteOptions.Preconditions.UID)
				if force {
					return true, nil, apierrors.NewTooManyRequests("PDB blocks eviction", 0)
				}
				replacement := pod.DeepCopy()
				replacement.UID = "replacement"
				require.NoError(t, client.Tracker().Update(corev1.SchemeGroupVersion.WithResource("pods"), replacement, pod.Namespace))
				return true, eviction, nil
			})
			deleted := false
			client.PrependReactor("delete", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
				deleted = true
				options := action.(k8stesting.DeleteAction).GetDeleteOptions()
				require.Equal(t, pod.UID, *options.Preconditions.UID)
				require.Equal(t, int64(0), *options.GracePeriodSeconds)
				return true, nil, apierrors.NewConflict(schema.GroupResource{Resource: "pods"}, pod.Name, errors.New("UID changed"))
			})
			stream := make(chan resource.ActionEvent, 32)
			err := newTestNodeResourcer().StreamAction(context.Background(), cs, workloadActionRequest("drain", "worker", "", map[string]interface{}{"force": force}), stream)
			if force {
				require.ErrorContains(t, err, "force-delete")
				require.True(t, deleted)
			} else {
				require.NoError(t, err)
				require.False(t, deleted)
			}
			close(stream)
			completed := false
			for event := range stream {
				if event.Type == "complete" {
					completed = true
					require.Equal(t, "1", event.Data.Map["drained"].Int)
				}
			}
			require.Equal(t, !force, completed)
		})
	}
}

// ===================== Add Taint =====================

func TestNodeResourcer_AddTaint(t *testing.T) {
	node := testNode("taint-node")
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("add-taint", "taint-node", "", map[string]interface{}{
		"key":    "dedicated",
		"value":  "gpu",
		"effect": "NoSchedule",
	}))

	require.NoError(t, err)
	require.Equal(t, "map", result.Kind)
	assert.True(t, result.Map["success"].Bool)
	assert.Contains(t, result.Map["message"].String, "added")

	// Verify taint was applied.
	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "taint-node", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, updated.Spec.Taints, 1)
	assert.Equal(t, "dedicated", updated.Spec.Taints[0].Key)
	assert.Equal(t, "gpu", updated.Spec.Taints[0].Value)
	assert.Equal(t, corev1.TaintEffectNoSchedule, updated.Spec.Taints[0].Effect)
}

func TestNodeResourcer_AddTaint_Duplicate(t *testing.T) {
	existing := corev1.Taint{Key: "dedicated", Value: "gpu", Effect: corev1.TaintEffectNoSchedule}
	node := testNode("taint-node", withTaints(existing))
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("add-taint", "taint-node", "", map[string]interface{}{
		"key":    "dedicated",
		"value":  "gpu",
		"effect": "NoSchedule",
	}))

	require.NoError(t, err)
	require.Equal(t, "map", result.Kind)
	assert.True(t, result.Map["success"].Bool)
	assert.Contains(t, result.Map["message"].String, "already exists")

	// Taint count unchanged.
	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "taint-node", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Len(t, updated.Spec.Taints, 1)
}

func TestNodeResourcer_AddTaint_MissingKey(t *testing.T) {
	node := testNode("taint-node")
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("add-taint", "taint-node", "", map[string]interface{}{
		"effect": "NoSchedule",
	}))

	require.Error(t, err)
	assert.Equal(t, resource.Value{}, result)
	assert.Contains(t, err.Error(), "taint key is required")
}

func TestNodeResourcer_AddTaint_MissingEffect(t *testing.T) {
	node := testNode("taint-node")
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("add-taint", "taint-node", "", map[string]interface{}{
		"key": "dedicated",
	}))

	require.Error(t, err)
	assert.Equal(t, resource.Value{}, result)
	assert.Contains(t, err.Error(), "taint effect is required")
}

func TestNodeResourcer_AddTaint_NodeNotFound(t *testing.T) {
	cs := newNodeClientSet()
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("add-taint", "nonexistent", "", map[string]interface{}{
		"key":    "foo",
		"effect": "NoSchedule",
	}))

	require.Error(t, err)
	assert.Equal(t, resource.Value{}, result)
	assert.Contains(t, err.Error(), "failed to get node")
}

// ===================== Remove Taint =====================

func TestNodeResourcer_RemoveTaint(t *testing.T) {
	existing := corev1.Taint{Key: "dedicated", Value: "gpu", Effect: corev1.TaintEffectNoSchedule}
	keep := corev1.Taint{Key: "other", Value: "val", Effect: corev1.TaintEffectNoExecute}
	node := testNode("taint-node", withTaints(existing, keep))
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("remove-taint", "taint-node", "", map[string]interface{}{
		"key":    "dedicated",
		"effect": "NoSchedule",
	}))

	require.NoError(t, err)
	require.Equal(t, "map", result.Kind)
	assert.True(t, result.Map["success"].Bool)
	assert.Contains(t, result.Map["message"].String, "removed")

	// Verify only the matching taint was removed.
	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "taint-node", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, updated.Spec.Taints, 1)
	assert.Equal(t, "other", updated.Spec.Taints[0].Key)
}

func TestNodeResourcer_RemoveTaint_ByKeyOnly(t *testing.T) {
	t1 := corev1.Taint{Key: "foo", Value: "bar", Effect: corev1.TaintEffectNoSchedule}
	t2 := corev1.Taint{Key: "foo", Value: "baz", Effect: corev1.TaintEffectNoExecute}
	node := testNode("taint-node", withTaints(t1, t2))
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("remove-taint", "taint-node", "", map[string]interface{}{
		"key": "foo",
		// no effect — removes all taints with this key
	}))

	require.NoError(t, err)
	require.Equal(t, "map", result.Kind)
	assert.True(t, result.Map["success"].Bool)

	updated, err := cs.KubeClient.CoreV1().Nodes().Get(context.Background(), "taint-node", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Empty(t, updated.Spec.Taints)
}

func TestNodeResourcer_RemoveTaint_NotFound(t *testing.T) {
	node := testNode("taint-node")
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("remove-taint", "taint-node", "", map[string]interface{}{
		"key":    "nonexistent",
		"effect": "NoSchedule",
	}))

	require.NoError(t, err)
	require.Equal(t, "map", result.Kind)
	assert.True(t, result.Map["success"].Bool)
	assert.Contains(t, result.Map["message"].String, "not found")
}

func TestNodeResourcer_RemoveTaint_MissingKey(t *testing.T) {
	node := testNode("taint-node")
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("remove-taint", "taint-node", "", map[string]interface{}{}))

	require.Error(t, err)
	assert.Equal(t, resource.Value{}, result)
	assert.Contains(t, err.Error(), "taint key is required")
}

// ===================== Get Conditions =====================

func TestNodeResourcer_GetConditions(t *testing.T) {
	node := testNode("cond-node")
	node.Status.Conditions = []corev1.NodeCondition{
		{Type: corev1.NodeReady, Status: corev1.ConditionTrue, Reason: "KubeletReady", Message: "kubelet is posting ready status"},
		{Type: corev1.NodeMemoryPressure, Status: corev1.ConditionFalse, Reason: "KubeletHasSufficientMemory"},
		{Type: corev1.NodeDiskPressure, Status: corev1.ConditionFalse, Reason: "KubeletHasNoDiskPressure"},
	}
	cs := newNodeClientSet(node)
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("get-conditions", "cond-node", "", nil))

	require.NoError(t, err)
	require.Equal(t, "map", result.Kind)
	assert.True(t, result.Map["success"].Bool)

	require.Equal(t, "list", result.Map["data"].Map["conditions"].Kind)
	conditions := result.Map["data"].Map["conditions"].List
	assert.Len(t, conditions, 3)

	first := conditions[0].Map
	assert.Equal(t, "Ready", first["type"].String)
	assert.Equal(t, "True", first["status"].String)
	assert.Equal(t, "KubeletReady", first["reason"].String)
}

func TestNodeResourcer_GetConditions_NodeNotFound(t *testing.T) {
	cs := newNodeClientSet()
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("get-conditions", "ghost", "", nil))

	require.Error(t, err)
	assert.Equal(t, resource.Value{}, result)
	assert.Contains(t, err.Error(), "failed to get node")
}

// ===================== Unknown Action =====================

func TestNodeResourcer_UnknownAction(t *testing.T) {
	cs := newNodeClientSet()
	r := newTestNodeResourcer()

	result, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("invalid", "", "", nil))

	require.Error(t, err)
	assert.Equal(t, resource.Value{}, result)
	assert.Contains(t, err.Error(), "unknown action")
}

// ===================== StreamAction =====================

func TestNodeResourcer_StreamAction_NotSupported(t *testing.T) {
	r := newTestNodeResourcer()

	err := r.StreamAction(context.Background(), nil, workloadActionRequest("cordon", "", "", nil), nil)

	require.Error(t, err)
	var operationError *resource.ResourceOperationError
	require.ErrorAs(t, err, &operationError)
	assert.Equal(t, "UNSUPPORTED", operationError.Code)
}

// ===================== isDaemonSetPod =====================

func TestIsDaemonSetPod_True(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "DaemonSet", Name: "node-exporter"},
			},
		},
	}
	assert.True(t, isDaemonSetPod(pod))
}

func TestIsDaemonSetPod_False_NoOwners(t *testing.T) {
	pod := &corev1.Pod{}
	assert.False(t, isDaemonSetPod(pod))
}

func TestIsDaemonSetPod_False_ReplicaSetOwner(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			OwnerReferences: []metav1.OwnerReference{
				{Kind: "ReplicaSet", Name: "my-deploy-abc123"},
			},
		},
	}
	assert.False(t, isDaemonSetPod(pod))
}

// ===================== WaitForPodRunning =====================

func TestWaitForPodRunning_AlreadyRunning(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "running-pod", Namespace: "default"},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	cs := fake.NewSimpleClientset(pod)

	err := WaitForPodRunning(context.Background(), cs, "default", "running-pod", 5*time.Second)
	require.NoError(t, err)
}

func TestWaitForPodRunning_PodNotFound_TimesOut(t *testing.T) {
	cs := fake.NewSimpleClientset()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	err := WaitForPodRunning(ctx, cs, "default", "missing-pod", 2*time.Second)
	require.Error(t, err)
}
func workloadGetRequest(id, namespace string) resource.GetRequest {
	scope := []resource.ScopeEntry{}
	if namespace != "" {
		scope = append(scope, resource.ScopeEntry{Dimension: "namespace", Value: namespace})
	}
	return resource.GetRequest{Route: resource.AccessRoute{Connection: "test-connection"}, Reference: resource.ResourceReference{Address: resource.ResourceAddress{Provider: "kubernetes", Authority: "test-cluster", Type: "native-workload", Scope: scope, ID: id}}, Representation: "native"}
}

func workloadActionRequest(action, id, namespace string, params map[string]interface{}) resource.ActionRequest {
	input, err := resource.ValueFromNative(params)
	if err != nil {
		panic(err)
	}
	request := workloadGetRequest(id, namespace)
	return resource.ActionRequest{Route: request.Route, Reference: request.Reference, Action: action, Input: input}
}

func TestNativeActionIntegerExactRange(t *testing.T) {
	for _, value := range []resource.Value{{Kind: "int64", Int: "9223372036854775807"}, {Kind: "uint64", Uint: "9223372036854775807"}} {
		native, err := resource.NativeFromValue(value)
		require.NoError(t, err)
		actual, err := nativeActionInteger(native, 0, 9223372036854775807)
		require.NoError(t, err)
		assert.Equal(t, int64(9223372036854775807), actual)
	}
	for _, value := range []any{uint64(9223372036854775808), float64(9223372036854775808), -int64(1), 1.5} {
		_, err := nativeActionInteger(value, 0, 9223372036854775807)
		require.Error(t, err)
	}
}

func TestNativeActionIncarnationGuards(t *testing.T) {
	request := workloadActionRequest("cordon", "worker", "", nil)
	uid := "original-uid"
	request.Reference.Incarnation = &uid
	assert.JSONEq(t, `{"metadata":{"uid":"original-uid"},"spec":{"unschedulable":true}}`,
		string(nativeActionPatch(request, `{"spec":{"unschedulable":true}}`)))
	node := testNode("worker")
	node.UID = "replacement-uid"
	require.Error(t, nativeActionObjectMatches(request, node))
	node.UID = "original-uid"
	require.NoError(t, nativeActionObjectMatches(request, node))
	request.Reference.Incarnation = nil
	require.NoError(t, nativeActionObjectMatches(request, node))
	pod := testPodOnNode("pod", "default", "worker")
	pod.UID = "pod-uid"
	preconditions := nativePodUIDPreconditions(pod)
	require.NotNil(t, preconditions)
	require.NotNil(t, preconditions.UID)
	assert.Equal(t, pod.UID, *preconditions.UID)
}

func TestNativeActionEventValue(t *testing.T) {
	value, err := nativeActionEventValue(map[string]any{"ready": int32(3)})
	require.NoError(t, err)
	require.NotNil(t, value)
	assert.Equal(t, "3", value.Map["ready"].Int)
	value, err = nativeActionEventValue(make(chan int))
	require.Error(t, err)
	assert.Nil(t, value)
}
