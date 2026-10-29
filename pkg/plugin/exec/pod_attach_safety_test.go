package exec

import (
	"context"
	"testing"
	"time"

	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func TestAttachReadinessObservesExactContainerTransition(t *testing.T) {
	pod := attachPodFixture()
	client := fake.NewSimpleClientset(pod)
	reads := 0
	client.PrependReactor("get", "pods", func(ktesting.Action) (bool, runtime.Object, error) {
		reads++
		observed := pod.DeepCopy()
		if reads >= 2 {
			observed.Status.EphemeralContainerStatuses[0].State = corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}
		}
		return true, observed, nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, waitForDebugContainer(ctx, client, pod.Namespace, pod.Name, string(pod.UID), "debugger-omniview-selected"))
	assert.GreaterOrEqual(t, reads, 2)
}

func TestAttachReadinessRejectsReplacementDuringWait(t *testing.T) {
	pod := attachPodFixture()
	client := fake.NewSimpleClientset(pod)
	reads := 0
	client.PrependReactor("get", "pods", func(ktesting.Action) (bool, runtime.Object, error) {
		reads++
		observed := pod.DeepCopy()
		if reads >= 2 {
			observed.UID = "replacement"
			observed.Status.EphemeralContainerStatuses[0].State = corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}
		}
		return true, observed, nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.ErrorContains(t, waitForDebugContainer(ctx, client, pod.Namespace, pod.Name, string(pod.UID), "debugger-omniview-selected"), "UID")
}

func TestTerminalResizeQueueDimensionsAndCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	resize := make(chan sdkexec.SessionResizeInput, 2)
	resize <- sdkexec.SessionResizeInput{Cols: -1, Rows: 24}
	resize <- sdkexec.SessionResizeInput{Cols: 120, Rows: 40}
	queue := &terminalSizeQueue{ctx: ctx, resize: resize}
	size := queue.Next()
	require.NotNil(t, size)
	assert.EqualValues(t, 120, size.Width)
	assert.EqualValues(t, 40, size.Height)
	cancel()
	assert.Nil(t, queue.Next(), "cancellation must release resize reader even when channel stays open")
}

func TestAttachReadinessRejectsDeletingPod(t *testing.T) {
	pod := attachPodFixture()
	now := metav1.Now()
	pod.DeletionTimestamp = &now
	pod.Status.EphemeralContainerStatuses[0].State = corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}
	client := fake.NewSimpleClientset(pod)
	require.ErrorContains(t, waitForDebugContainer(context.Background(), client, pod.Namespace, pod.Name, string(pod.UID), "debugger-omniview-selected"), "deleting")
}
