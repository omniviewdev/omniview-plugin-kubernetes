package exec

import (
	"context"
	"fmt"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/utils/remoteerr"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/remotecommand"
)

// terminalSizeQueue needs no forwarding goroutine. Cancellation also releases
// the remotecommand resize reader when the SDK leaves its resize channel open.
type terminalSizeQueue struct {
	ctx    context.Context
	resize <-chan sdkexec.SessionResizeInput
}

func (q *terminalSizeQueue) Next() *remotecommand.TerminalSize {
	for {
		select {
		case <-q.ctx.Done():
			return nil
		case size, ok := <-q.resize:
			if !ok {
				return nil
			}
			if size.Cols <= 0 || size.Rows <= 0 || size.Cols > 65535 || size.Rows > 65535 {
				continue
			}
			return &remotecommand.TerminalSize{Width: uint16(size.Cols), Height: uint16(size.Rows)}
		}
	}
}

func waitForDebugContainer(ctx context.Context, client kubernetes.Interface, namespace, name, uid, container string) (resultErr error) {
	started := time.Now()
	defer func() {
		class := diag.ClassifyError(resultErr, false)
		waitMs := time.Since(started).Milliseconds()
		trace.SpanFromContext(ctx).AddEvent("debug_container_wait", trace.WithAttributes(
			append([]attribute.KeyValue{attribute.Int64("wait_ms", waitMs)}, class.SpanAttrs()...)...))
		execLoggerFromContext(ctx).Debugw(ctx, "debug container wait finished",
			append([]any{"resource_namespace", namespace, "resource_id", name, "wait_ms", waitMs}, class.LogFields()...)...)
	}()
	if uid == "" {
		return fmt.Errorf("original Pod UID is required for attach")
	}
	if container == "" {
		return fmt.Errorf("exact ephemeral container name is required for attach")
	}
	waitCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	last := "status not yet reported"
	for {
		pod, err := client.CoreV1().Pods(namespace).Get(waitCtx, name, metav1.GetOptions{})
		if err != nil {
			return remoteerr.Sanitize("check debug container "+container, err)
		}
		if string(pod.UID) != uid {
			return fmt.Errorf("Pod UID changed; cannot attach to original Pod UID %s", uid)
		}
		if pod.DeletionTimestamp != nil || pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
			return fmt.Errorf("Pod is deleting or terminal")
		}
		found := false
		for _, entry := range pod.Spec.EphemeralContainers {
			if entry.Name == container {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("ephemeral container %s does not exist", container)
		}
		for _, status := range pod.Status.EphemeralContainerStatuses {
			if status.Name != container {
				continue
			}
			if terminated := status.State.Terminated; terminated != nil {
				// The kubelet message is remote text; only the reason and exit code are reported.
				return fmt.Errorf("debug container %s terminated: %s (exit %d)", container, safeContainerReason(terminated.Reason), terminated.ExitCode)
			}
			if waiting := status.State.Waiting; waiting != nil {
				last = safeContainerReason(waiting.Reason)
				switch waiting.Reason {
				case "", "ContainerCreating", "PodInitializing":
				default:
					return fmt.Errorf("debug container %s is waiting: %s", container, last)
				}
			}
			if status.State.Running != nil {
				return nil
			}
		}
		select {
		case <-waitCtx.Done():
			return fmt.Errorf("waiting for debug container %s (%s): %w", container, last, waitCtx.Err())
		case <-ticker.C:
		}
	}
}
