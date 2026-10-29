package resourcers

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

// Assert the public action boundary at runtime so absent action support is a
// behavioral failure, rather than a compile failure for a future method.
type podDebugActionExecutor interface {
	ExecuteAction(context.Context, *clients.ClientSet, resource.ResourceMeta, string, resource.ActionInput) (*resource.ActionResult, error)
}

func debugPodFixture() *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "app", Namespace: "debug-test", UID: "original-uid", ResourceVersion: "17", Labels: map[string]string{"app": "keep"}},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app", Image: "distroless", Env: []corev1.EnvVar{{Name: "SECRET", Value: "do-not-copy"}}}}, Volumes: []corev1.Volume{{Name: "data", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}}}, EphemeralContainers: []corev1.EphemeralContainer{{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "previous", Image: "keep:1"}, TargetContainerName: "app"}}},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning, ContainerStatuses: []corev1.ContainerStatus{{Name: "app", State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}}}},
	}
}

func debugInput() resource.ActionInput {
	return resource.ActionInput{ID: "app", Namespace: "debug-test", Params: map[string]interface{}{
		"podUID": "original-uid", "name": "debugger-omniview-test", "targetContainerName": "app", "image": "busybox:1.37.0", "command": []interface{}{"sh", "-c", "printf '%s' 'two words'"}, "profile": "restricted", "imagePullPolicy": "IfNotPresent",
	}}
}

func callDebug(t *testing.T, client *fake.Clientset, input resource.ActionInput) (*resource.ActionResult, error) {
	t.Helper()
	executor, ok := interface{}(NewPodResourcer(zap.NewNop().Sugar())).(podDebugActionExecutor)
	require.True(t, ok, "Pod must expose dedicated debug-create resource action")
	return executor.ExecuteAction(context.Background(), &clients.ClientSet{KubeClient: client}, resource.ResourceMeta{}, "debug-create", input)
}

func debugMutationCount(t *testing.T, client *fake.Clientset) int {
	t.Helper()
	count := 0
	for _, action := range client.Actions() {
		switch action.GetVerb() {
		case "create", "update", "patch", "delete", "delete-collection":
			count++
			assert.Equal(t, "pods", action.GetResource().Resource)
			assert.Equal(t, "ephemeralcontainers", action.GetSubresource(), "only ephemeralcontainers may mutate")
		}
	}
	return count
}

func debugResult(t *testing.T, result *resource.ActionResult, created bool) {
	t.Helper()
	require.NotNil(t, result)
	assert.True(t, result.Success)
	encoded, err := json.Marshal(result.Data)
	require.NoError(t, err)
	var data struct {
		Pod           corev1.Pod `json:"pod"`
		PodUID        string     `json:"podUID"`
		ContainerName string     `json:"containerName"`
		Created       bool       `json:"created"`
	}
	require.NoError(t, json.Unmarshal(encoded, &data))
	assert.Equal(t, "original-uid", data.PodUID)
	assert.Equal(t, "debugger-omniview-test", data.ContainerName)
	assert.Equal(t, created, data.Created)
	assert.Equal(t, "original-uid", string(data.Pod.UID))
}

func TestPodDebugCreatePreservesPodAndUsesRestrictedProfile(t *testing.T) {
	before := debugPodFixture()
	client := fake.NewSimpleClientset(before.DeepCopy())
	result, err := callDebug(t, client, debugInput())
	require.NoError(t, err)
	debugResult(t, result, true)
	after, err := client.CoreV1().Pods(before.Namespace).Get(context.Background(), before.Name, metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, after.Spec.EphemeralContainers, 2)
	assert.Equal(t, before.Spec.EphemeralContainers[0], after.Spec.EphemeralContainers[0])
	entry := after.Spec.EphemeralContainers[1]
	assert.Equal(t, "debugger-omniview-test", entry.Name)
	assert.Equal(t, "app", entry.TargetContainerName)
	assert.Equal(t, "busybox:1.37.0", entry.Image)
	assert.Equal(t, []string{"sh", "-c", "printf '%s' 'two words'"}, entry.Command)
	assert.True(t, entry.Stdin)
	assert.True(t, entry.TTY)
	assert.Empty(t, entry.Env, "source credentials must not be copied")
	require.NotNil(t, entry.SecurityContext)
	sc := entry.SecurityContext
	require.NotNil(t, sc.RunAsUser)
	assert.EqualValues(t, 1000, *sc.RunAsUser)
	require.NotNil(t, sc.RunAsNonRoot)
	assert.True(t, *sc.RunAsNonRoot)
	require.NotNil(t, sc.AllowPrivilegeEscalation)
	assert.False(t, *sc.AllowPrivilegeEscalation)
	require.NotNil(t, sc.Capabilities)
	assert.Equal(t, []corev1.Capability{"ALL"}, sc.Capabilities.Drop)
	assert.Empty(t, sc.Capabilities.Add)
	require.NotNil(t, sc.SeccompProfile)
	assert.Equal(t, corev1.SeccompProfileTypeRuntimeDefault, sc.SeccompProfile.Type)
	after.Spec.EphemeralContainers = before.Spec.EphemeralContainers
	assert.Equal(t, before.Spec, after.Spec)
	assert.Equal(t, before.Labels, after.Labels)
	assert.Equal(t, before.Status, after.Status)
	assert.Equal(t, 1, debugMutationCount(t, client))
}

func TestPodDebugCreateRejectsUnsafeRequestsWithoutMutation(t *testing.T) {
	tests := []struct {
		name   string
		change func(*corev1.Pod, *resource.ActionInput)
	}{
		{"stale UID", func(p *corev1.Pod, i *resource.ActionInput) { i.Params["podUID"] = "old" }},
		{"missing UID", func(p *corev1.Pod, i *resource.ActionInput) { delete(i.Params, "podUID") }},
		{"mirror Pod", func(p *corev1.Pod, i *resource.ActionInput) {
			p.Annotations = map[string]string{"kubernetes.io/config.mirror": "hash"}
		}},
		{"deleting Pod", func(p *corev1.Pod, i *resource.ActionInput) { now := metav1.Now(); p.DeletionTimestamp = &now }},
		{"succeeded Pod", func(p *corev1.Pod, i *resource.ActionInput) { p.Status.Phase = corev1.PodSucceeded }},
		{"failed Pod", func(p *corev1.Pod, i *resource.ActionInput) { p.Status.Phase = corev1.PodFailed }},
		{"missing target", func(p *corev1.Pod, i *resource.ActionInput) { i.Params["targetContainerName"] = "missing" }},
		{"stopped target", func(p *corev1.Pod, i *resource.ActionInput) {
			p.Status.ContainerStatuses[0].State = corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{ExitCode: 0}}
		}},
		{"no observed running target", func(p *corev1.Pod, i *resource.ActionInput) { p.Status.ContainerStatuses = nil }},
		{"blank image", func(p *corev1.Pod, i *resource.ActionInput) { i.Params["image"] = "  " }},
		{"empty argv", func(p *corev1.Pod, i *resource.ActionInput) { i.Params["command"] = []interface{}{} }},
		{"string command", func(p *corev1.Pod, i *resource.ActionInput) { i.Params["command"] = "sh -c evil" }},
		{"nonstring argv", func(p *corev1.Pod, i *resource.ActionInput) { i.Params["command"] = []interface{}{"sh", 42} }},
		{"nonstring env", func(p *corev1.Pod, i *resource.ActionInput) { i.Params["env"] = map[string]interface{}{"PORT": 80} }},
		{"unsupported profile", func(p *corev1.Pod, i *resource.ActionInput) { i.Params["profile"] = "root" }},
		{"netadmin needs consent", func(p *corev1.Pod, i *resource.ActionInput) { i.Params["profile"] = "netadmin" }},
		{"sysadmin needs consent", func(p *corev1.Pod, i *resource.ActionInput) { i.Params["profile"] = "sysadmin" }},
		{"string consent is not consent", func(p *corev1.Pod, i *resource.ActionInput) {
			i.Params["profile"] = "sysadmin"
			i.Params["elevatedAcknowledged"] = "true"
		}},
		{"unsupported pull policy", func(p *corev1.Pod, i *resource.ActionInput) { i.Params["imagePullPolicy"] = "Never" }},
		{"arbitrary privilege", func(p *corev1.Pod, i *resource.ActionInput) {
			i.Params["securityContext"] = map[string]interface{}{"privileged": true}
		}},
		{"unknown volume", func(p *corev1.Pod, i *resource.ActionInput) {
			i.Params["volumeMounts"] = []interface{}{map[string]interface{}{"name": "secret", "mountPath": "/data", "readOnly": true}}
		}},
		{"writable volume", func(p *corev1.Pod, i *resource.ActionInput) {
			i.Params["volumeMounts"] = []interface{}{map[string]interface{}{"name": "data", "mountPath": "/data", "readOnly": false}}
		}},
		{"application name collision", func(p *corev1.Pod, i *resource.ActionInput) { i.Params["name"] = "app" }},
		{"invalid reserved name", func(p *corev1.Pod, i *resource.ActionInput) { i.Params["name"] = "NOT A DNS LABEL" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pod, input := debugPodFixture(), debugInput()
			tt.change(pod, &input)
			client := fake.NewSimpleClientset(pod.DeepCopy())
			result, err := callDebug(t, client, input)
			require.Error(t, err)
			if result != nil {
				assert.False(t, result.Success)
			}
			assert.Equal(t, 0, debugMutationCount(t, client))
			after, getErr := client.CoreV1().Pods(pod.Namespace).Get(context.Background(), pod.Name, metav1.GetOptions{})
			require.NoError(t, getErr)
			assert.Equal(t, pod, after)
		})
	}
}

func TestPodDebugCreateReplayAndCollision(t *testing.T) {
	client := fake.NewSimpleClientset(debugPodFixture())
	first, err := callDebug(t, client, debugInput())
	require.NoError(t, err)
	debugResult(t, first, true)
	mutations := debugMutationCount(t, client)
	replay, err := callDebug(t, client, debugInput())
	require.NoError(t, err)
	debugResult(t, replay, false)
	assert.Equal(t, mutations, debugMutationCount(t, client))
	input := debugInput()
	input.Params["image"] = "different:1"
	_, err = callDebug(t, client, input)
	require.Error(t, err)
	assert.Equal(t, mutations, debugMutationCount(t, client))
	pod, err := client.CoreV1().Pods("debug-test").Get(context.Background(), "app", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, pod.Spec.EphemeralContainers, 2)
	assert.Equal(t, "busybox:1.37.0", pod.Spec.EphemeralContainers[1].Image)
}

func TestPodDebugCreatePreservesAuthorizationRejection(t *testing.T) {
	client := fake.NewSimpleClientset(debugPodFixture())
	denied := apierrors.NewForbidden(schema.GroupResource{Resource: "pods/ephemeralcontainers"}, "app", errors.New("admission denied debug image"))
	client.PrependReactor("*", "pods", func(action ktesting.Action) (bool, runtime.Object, error) {
		if action.GetSubresource() == "ephemeralcontainers" {
			return true, nil, denied
		}
		return false, nil, nil
	})
	_, err := callDebug(t, client, debugInput())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "admission denied debug image")
	assert.NotContains(t, err.Error(), "DEBUG_CREATION_UNKNOWN")
	pod, err := client.CoreV1().Pods("debug-test").Get(context.Background(), "app", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Len(t, pod.Spec.EphemeralContainers, 1)
}

func TestPodDebugCreateConflictRefetchPreservesConcurrentEntry(t *testing.T) {
	client := fake.NewSimpleClientset(debugPodFixture())
	conflicted := false
	client.PrependReactor("*", "pods", func(action ktesting.Action) (bool, runtime.Object, error) {
		if action.GetSubresource() != "ephemeralcontainers" || conflicted {
			return false, nil, nil
		}
		conflicted = true
		object, err := client.Tracker().Get(corev1.SchemeGroupVersion.WithResource("pods"), "debug-test", "app")
		require.NoError(t, err)
		pod := object.(*corev1.Pod).DeepCopy()
		pod.ResourceVersion = "18"
		pod.Spec.EphemeralContainers = append(pod.Spec.EphemeralContainers, corev1.EphemeralContainer{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "concurrent", Image: "keep:2"}})
		require.NoError(t, client.Tracker().Update(corev1.SchemeGroupVersion.WithResource("pods"), pod, pod.Namespace))
		return true, nil, apierrors.NewConflict(schema.GroupResource{Resource: "pods"}, "app", errors.New("resource version changed"))
	})
	result, err := callDebug(t, client, debugInput())
	require.NoError(t, err)
	debugResult(t, result, true)
	pod, err := client.CoreV1().Pods("debug-test").Get(context.Background(), "app", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, pod.Spec.EphemeralContainers, 3)
	assert.Equal(t, "previous", pod.Spec.EphemeralContainers[0].Name)
	assert.Equal(t, "concurrent", pod.Spec.EphemeralContainers[1].Name)
	assert.Equal(t, "debugger-omniview-test", pod.Spec.EphemeralContainers[2].Name)
}

func TestPodDebugCreateAmbiguousFailureDoesNotBlindlyRetry(t *testing.T) {
	client := fake.NewSimpleClientset(debugPodFixture())
	submissions := 0
	client.PrependReactor("*", "pods", func(action ktesting.Action) (bool, runtime.Object, error) {
		if action.GetSubresource() != "ephemeralcontainers" {
			return false, nil, nil
		}
		submissions++
		return true, nil, errors.New("connection reset after sending request")
	})
	_, err := callDebug(t, client, debugInput())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DEBUG_CREATION_UNKNOWN")
	assert.Equal(t, 1, submissions, "an absent-name reconciliation GET does not prove the request was rejected")
}

func TestPodDebugCreateAcknowledgedProfilesAndExplicitInputs(t *testing.T) {
	for _, profile := range []string{"restricted", "netadmin", "sysadmin"} {
		t.Run(profile, func(t *testing.T) {
			client := fake.NewSimpleClientset(debugPodFixture())
			input := debugInput()
			input.Params["profile"] = profile
			input.Params["elevatedAcknowledged"] = true
			input.Params["env"] = map[string]interface{}{"EXPLICIT": "two words"}
			input.Params["volumeMounts"] = []interface{}{map[string]interface{}{"name": "data", "mountPath": "/inspect", "readOnly": true}}
			input.Params["imagePullPolicy"] = "Always"
			result, err := callDebug(t, client, input)
			require.NoError(t, err)
			debugResult(t, result, true)
			pod, err := client.CoreV1().Pods("debug-test").Get(context.Background(), "app", metav1.GetOptions{})
			require.NoError(t, err)
			require.Len(t, pod.Spec.EphemeralContainers, 2)
			entry := pod.Spec.EphemeralContainers[1]
			assert.Equal(t, []corev1.EnvVar{{Name: "EXPLICIT", Value: "two words"}}, entry.Env)
			assert.Equal(t, []corev1.VolumeMount{{Name: "data", MountPath: "/inspect", ReadOnly: true}}, entry.VolumeMounts)
			assert.Equal(t, corev1.PullAlways, entry.ImagePullPolicy)
			require.NotNil(t, entry.SecurityContext)
			if profile == "sysadmin" {
				require.NotNil(t, entry.SecurityContext.Privileged)
				assert.True(t, *entry.SecurityContext.Privileged)
			} else {
				if entry.SecurityContext.Privileged != nil {
					assert.False(t, *entry.SecurityContext.Privileged)
				}
				if profile == "netadmin" {
					require.NotNil(t, entry.SecurityContext.Capabilities)
					assert.Contains(t, entry.SecurityContext.Capabilities.Add, corev1.Capability("NET_ADMIN"))
					for _, capability := range entry.SecurityContext.Capabilities.Add {
						assert.Contains(t, []corev1.Capability{"NET_ADMIN", "NET_RAW"}, capability)
					}
				}
			}
		})
	}
}
