package resourcers

import (
	"context"
	"errors"
	"testing"

	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func TestPodDebugRejectsNullAndUnsafeMountFields(t *testing.T) {
	cases := map[string]func(*resource.ActionInput){
		"null env value": func(i *resource.ActionInput) { i.Params["env"] = map[string]interface{}{"TOKEN": nil} },
		"null argv":      func(i *resource.ActionInput) { i.Params["command"] = []interface{}{"sh", nil} },
		"mount propagation": func(i *resource.ActionInput) {
			i.Params["volumeMounts"] = []interface{}{map[string]interface{}{"name": "data", "mountPath": "/inspect", "readOnly": true, "mountPropagation": "Bidirectional"}}
		},
		"relative mount": func(i *resource.ActionInput) {
			i.Params["volumeMounts"] = []interface{}{map[string]interface{}{"name": "data", "mountPath": "inspect", "readOnly": true}}
		},
		"duplicate mount paths": func(i *resource.ActionInput) {
			i.Params["volumeMounts"] = []interface{}{map[string]interface{}{"name": "data", "mountPath": "/inspect", "readOnly": true}, map[string]interface{}{"name": "data", "mountPath": "/inspect", "readOnly": true}}
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			client := fake.NewSimpleClientset(debugPodFixture())
			input := debugInput()
			change(&input)
			_, err := callDebug(t, client, input)
			require.Error(t, err)
			assert.Zero(t, debugMutationCount(t, client))
		})
	}
}

func TestPodDebugReconcilesAcceptedLostResponse(t *testing.T) {
	client := fake.NewSimpleClientset(debugPodFixture())
	submissions := 0
	client.PrependReactor("update", "pods", func(action ktesting.Action) (bool, runtime.Object, error) {
		if action.GetSubresource() != "ephemeralcontainers" {
			return false, nil, nil
		}
		submissions++
		pod := action.(ktesting.UpdateAction).GetObject().(*corev1.Pod).DeepCopy()
		require.NoError(t, client.Tracker().Update(corev1.SchemeGroupVersion.WithResource("pods"), pod, pod.Namespace))
		return true, nil, errors.New("response lost after acceptance")
	})
	result, err := callDebug(t, client, debugInput())
	require.NoError(t, err)
	debugResult(t, result, true)
	assert.Equal(t, 1, submissions)
	pod, err := client.CoreV1().Pods("debug-test").Get(context.Background(), "app", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Len(t, pod.Spec.EphemeralContainers, 2)
}

func TestPodDebugDoesNotAdoptReplacementAfterLostResponse(t *testing.T) {
	client := fake.NewSimpleClientset(debugPodFixture())
	client.PrependReactor("update", "pods", func(action ktesting.Action) (bool, runtime.Object, error) {
		if action.GetSubresource() != "ephemeralcontainers" {
			return false, nil, nil
		}
		pod := action.(ktesting.UpdateAction).GetObject().(*corev1.Pod).DeepCopy()
		pod.UID = "replacement-uid"
		require.NoError(t, client.Tracker().Update(corev1.SchemeGroupVersion.WithResource("pods"), pod, pod.Namespace))
		return true, nil, errors.New("response lost")
	})
	_, err := callDebug(t, client, debugInput())
	require.ErrorContains(t, err, "DEBUG_CREATION_UNKNOWN")
	assert.Equal(t, 1, debugMutationCount(t, client))
}

func TestPodDebugReplaySurvivesStoppedTarget(t *testing.T) {
	client := fake.NewSimpleClientset(debugPodFixture())
	result, err := callDebug(t, client, debugInput())
	require.NoError(t, err)
	debugResult(t, result, true)
	pod, err := client.CoreV1().Pods("debug-test").Get(context.Background(), "app", metav1.GetOptions{})
	require.NoError(t, err)
	pod.Status.ContainerStatuses[0].State = corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{ExitCode: 1}}
	require.NoError(t, client.Tracker().Update(corev1.SchemeGroupVersion.WithResource("pods"), pod, pod.Namespace))
	result, err = callDebug(t, client, debugInput())
	require.NoError(t, err)
	debugResult(t, result, false)
	assert.Equal(t, 1, debugMutationCount(t, client), "replay must not create another container")
}

func TestPodDebugPreflightRejectionIsAuthoritative(t *testing.T) {
	for _, name := range []string{"invalid image", "stopped target", "changed UID"} {
		t.Run(name, func(t *testing.T) {
			pod := debugPodFixture()
			input := debugInput()
			switch name {
			case "invalid image":
				input.Params["image"] = ""
			case "stopped target":
				pod.Status.ContainerStatuses[0].State = corev1.ContainerState{}
			case "changed UID":
				pod.UID = "replacement"
			}
			client := fake.NewSimpleClientset(pod)
			_, err := callDebug(t, client, input)
			var operationError *resource.ResourceOperationError
			require.ErrorAs(t, err, &operationError)
			assert.Equal(t, "INVALID_REQUEST", operationError.Code)
			assert.Zero(t, debugMutationCount(t, client))
		})
	}
}

func TestPodDebugResultSurvivesGRPCTransport(t *testing.T) {
	client := fake.NewSimpleClientset(debugPodFixture())
	result, err := callDebug(t, client, debugInput())
	require.NoError(t, err)
	wire, err := structpb.NewStruct(result.Data)
	require.NoError(t, err)
	pod := wire.GetFields()["pod"].GetStructValue()
	require.NotNil(t, pod)
	assert.Equal(t, "original-uid", pod.GetFields()["metadata"].GetStructValue().GetFields()["uid"].GetStringValue())
	containers := pod.GetFields()["spec"].GetStructValue().GetFields()["ephemeralContainers"].GetListValue().GetValues()
	require.Len(t, containers, 2)
	assert.Equal(t, "debugger-omniview-test", containers[1].GetStructValue().GetFields()["name"].GetStringValue())
	assert.Equal(t, "app", containers[1].GetStructValue().GetFields()["targetContainerName"].GetStringValue())
}
