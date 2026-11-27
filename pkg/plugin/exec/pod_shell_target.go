package exec

import (
	"context"
	"strconv"
	"time"

	"github.com/omniview/kubernetes/pkg/utils/remoteerr"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// pods/exec accepts names, not an atomic UID precondition. Recheck the exact
// incarnation and regular container immediately before opening that subresource.
// The host must independently fence the established session and its menu origin.
func verifyPodShellTarget(ctx context.Context, client kubernetes.Interface, namespace, name, uid, container, containerID, restart string) error {
	if namespace == "" || name == "" || uid == "" || container == "" || containerID == "" || restart == "" {
		return resourcev2.NewError("INVALID_REQUEST", "An exact Pod and container incarnation are required for this shell")
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	pod, err := client.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return remoteerr.Sanitize("verify Pod shell target", err)
	}
	if pod == nil || pod.Namespace != namespace || pod.Name != name || string(pod.UID) != uid || pod.DeletionTimestamp != nil {
		return resourcev2.NewError("RESET_REQUIRED", "The Pod for this shell is no longer current")
	}
	declared := false
	for i := range pod.Spec.Containers {
		if pod.Spec.Containers[i].Name == container {
			declared = true
			break
		}
	}
	if pod.Status.Phase != corev1.PodRunning || !declared {
		return resourcev2.NewError("UNAVAILABLE", "The selected regular container is not running")
	}
	for i := range pod.Status.ContainerStatuses {
		status := &pod.Status.ContainerStatuses[i]
		if status.Name == container && status.State.Running != nil && status.ContainerID == containerID && strconv.FormatInt(int64(status.RestartCount), 10) == restart {
			return ctx.Err()
		}
	}
	return resourcev2.NewError("RESET_REQUIRED", "The selected container is no longer current")
}
