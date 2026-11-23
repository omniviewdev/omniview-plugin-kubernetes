package execv2

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/omniview/kubernetes/pkg/utils"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// getPod reads a Pod with the client of the connection ctx carries. It is a variable so that a test can serve a Pod.
var getPod = func(ctx *types.PluginContext, namespace, name string) (*corev1.Pod, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}
	return clients.Clientset.CoreV1().Pods(namespace).Get(ctx.Context, name, metav1.GetOptions{})
}

// podAddress is the namespace and the name a Pod reference carries.
func podAddress(ref resourcev2.ResourceReference) (namespace, name string, err error) {
	a := ref.Address
	if a.ID == "" || len(a.Scope) != 1 || a.Scope[0].Dimension != "namespace" || a.Scope[0].Value == "" {
		return "", "", exec.NewError(exec.ErrorClassInvalidRequest, exec.ErrorReasonUnspecified, nil)
	}
	return a.Scope[0].Value, a.ID, nil
}

// podOptions is the Options callback: the containers of the Pod with their states, and the two modes a session can run in.
func podOptions(ctx *types.PluginContext, ref resourcev2.ResourceReference) ([]exec.Option, error) {
	namespace, name, err := podAddress(ref)
	if err != nil {
		return nil, err
	}
	pod, err := getPod(ctx, namespace, name)
	if err != nil {
		return nil, err
	}
	execMode, attachMode := modeCapabilities()
	return []exec.Option{
		{Name: "container", Required: true, Choices: containerChoices(pod)},
		{Name: "mode", Choices: []exec.Choice{
			{Value: modeExec, State: exec.ChoiceStateReady, IsDefault: true, Capabilities: &execMode},
			{Value: modeAttach, State: exec.ChoiceStateReady, Capabilities: &attachMode},
		}},
	}, nil
}

// containerChoices lists the containers of a Pod: regular, init and ephemeral, each with the state its status reports. The
// default is the one kubectl runs in: the annotated container, else the first regular one.
func containerChoices(pod *corev1.Pod) []exec.Choice {
	preferred := pod.Annotations["kubectl.kubernetes.io/default-container"]
	if preferred == "" && len(pod.Spec.Containers) > 0 {
		preferred = pod.Spec.Containers[0].Name
	}
	var choices []exec.Choice
	add := func(kind, name string, statuses []corev1.ContainerStatus) {
		choice := exec.Choice{Value: name, Kind: kind, IsDefault: kind == "container" && name == preferred}
		choice.State, choice.Detail = choiceState(statusNamed(statuses, name))
		choices = append(choices, choice)
	}
	for _, c := range pod.Spec.Containers {
		add("container", c.Name, pod.Status.ContainerStatuses)
	}
	for _, c := range pod.Spec.InitContainers {
		add("init", c.Name, pod.Status.InitContainerStatuses)
	}
	for _, c := range pod.Spec.EphemeralContainers {
		add("ephemeral", c.Name, pod.Status.EphemeralContainerStatuses)
	}
	return choices
}

func statusNamed(statuses []corev1.ContainerStatus, name string) *corev1.ContainerStatus {
	for i := range statuses {
		if statuses[i].Name == name {
			return &statuses[i]
		}
	}
	return nil
}

// choiceState maps what a container status reports to what a picker shows: whether a command can run in it now, and a
// closed code for why not. Only a running container can run one.
func choiceState(s *corev1.ContainerStatus) (exec.ChoiceState, string) {
	switch {
	case s == nil:
		return exec.ChoiceStateStarting, "pending"
	case s.State.Running != nil:
		return exec.ChoiceStateReady, ""
	case s.State.Terminated != nil && s.State.Terminated.Reason == "Completed":
		return exec.ChoiceStateStopped, "completed"
	case s.State.Terminated != nil:
		return exec.ChoiceStateStopped, "terminated"
	case s.State.Waiting != nil:
		switch s.State.Waiting.Reason {
		case "", "ContainerCreating", "PodInitializing":
			return exec.ChoiceStateStarting, "creating"
		case "CrashLoopBackOff":
			return exec.ChoiceStateStopped, "crash-loop"
		case "ErrImagePull", "ImagePullBackOff", "InvalidImageName":
			return exec.ChoiceStateStopped, "image-pull"
		}
		return exec.ChoiceStateStopped, "waiting"
	}
	return exec.ChoiceStateUnspecified, ""
}
