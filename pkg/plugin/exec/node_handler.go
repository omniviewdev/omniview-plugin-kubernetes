package exec

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/plugin/resource/resourcers"
	"github.com/omniview/kubernetes/pkg/utils/remoteerr"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

const (
	debugPodNamespace = "kube-system"
	debugPodTimeout   = 60 * time.Second
	debugPodImage     = "busybox:latest"
)

// NodeHandler creates a privileged debug pod on the target node using
// nsenter to access the host namespaces, then execs into it. On
// disconnect the debug pod is cleaned up.
func NodeHandler(
	ctx *types.PluginContext,
	opts exec.SessionOptions,
	tty *os.File,
	stopCh chan error,
	resize <-chan exec.SessionResizeInput,
) error {
	return nodeHandlerWithProvider(defaultClientProvider, ctx, opts, tty, stopCh, resize)
}

func nodeHandlerWithProvider(
	provider ClientProvider,
	ctx *types.PluginContext,
	opts exec.SessionOptions,
	tty *os.File,
	stopCh chan error,
	resize <-chan exec.SessionResizeInput,
) error {
	clients, err := provider(ctx)
	if err != nil {
		return remoteerr.Sanitize("load kubernetes client", err)
	}

	nodeName, _, err := nativeExecTarget(ctx, opts, "k8s:/nodes", false)
	if err != nil {
		return err
	}

	// Create a unique debug pod name.
	debugPodName := fmt.Sprintf("omniview-node-debug-%s-%d", nodeName, time.Now().Unix())

	// Resolve configurable image and nsenter command from params.
	podImage := debugPodImage
	if img, ok := opts.Params["node_shell_image"]; ok && img != "" {
		podImage = img
	}

	nsenterCommand := []string{"nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "/bin/bash"}
	if cmd, ok := opts.Params["node_shell_command"]; ok && cmd != "" {
		nsenterCommand = strings.Fields(cmd)
	}

	// Define the privileged debug pod.
	privileged := true
	hostPID := true
	zero := int64(0)
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      debugPodName,
			Namespace: debugPodNamespace,
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": "omniview",
				"omniview/debug-target":        nodeName,
			},
		},
		Spec: corev1.PodSpec{
			NodeName:      nodeName,
			HostPID:       hostPID,
			HostNetwork:   true,
			RestartPolicy: corev1.RestartPolicyNever,
			Containers: []corev1.Container{
				{
					Name:    "debug",
					Image:   podImage,
					Command: nsenterCommand,
					Stdin:   true,
					TTY:     true,
					SecurityContext: &corev1.SecurityContext{
						Privileged: &privileged,
					},
				},
			},
			TerminationGracePeriodSeconds: &zero,
			Tolerations: []corev1.Toleration{
				{Operator: corev1.TolerationOpExists},
			},
		},
	}

	// Create the debug pod.
	log := execLogger(ctx)
	baseCtx := execBaseContext(ctx)
	span := trace.SpanFromContext(baseCtx)
	createStarted := time.Now()
	_, err = clients.Clientset.CoreV1().Pods(debugPodNamespace).Create(ctx.Context, pod, metav1.CreateOptions{})
	if err != nil {
		class := diag.ClassifyError(err, false)
		span.AddEvent("debug_pod_create_failed", trace.WithAttributes(class.SpanAttrs()...))
		log.Warnw(baseCtx, "node debug pod create failed",
			append([]any{"resource_id", nodeName, "resource_namespace", debugPodNamespace}, class.LogFields()...)...)
		return remoteerr.Sanitize("create debug pod", err)
	}
	span.AddEvent("debug_pod_created", trace.WithAttributes(
		attribute.String("resource.id", debugPodName),
		attribute.String("resource.namespace", debugPodNamespace),
		attribute.String("node", nodeName),
		attribute.Int64("create_ms", time.Since(createStarted).Milliseconds()),
	))
	log.Info(baseCtx, "node debug pod created",
		logging.String("pod", debugPodName), logging.String("node", nodeName))

	// Ensure cleanup on exit. Use a detached context so the delete succeeds
	// even when the session context has already been cancelled.
	cleanup := func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		delErr := clients.Clientset.CoreV1().Pods(debugPodNamespace).Delete(
			cleanupCtx, debugPodName, metav1.DeleteOptions{GracePeriodSeconds: &zero},
		)
		class := diag.ClassifyError(delErr, false)
		attrs := append([]attribute.KeyValue{attribute.String("resource.id", debugPodName)}, class.SpanAttrs()...)
		span.AddEvent("debug_pod_cleanup", trace.WithAttributes(attrs...))
		switch {
		case delErr == nil:
			log.Debugw(baseCtx, "node debug pod deleted", "resource_id", debugPodName)
		case apierrors.IsNotFound(delErr):
			// Already gone: nothing left to clean up.
			log.Debugw(baseCtx, "node debug pod already deleted", "resource_id", debugPodName)
		default:
			log.Warnw(baseCtx, "node debug pod cleanup failed; pod may remain",
				append([]any{"resource_id", debugPodName, "resource_namespace", debugPodNamespace}, class.LogFields()...)...)
		}
	}

	// Wait for pod to be running.
	waitStarted := time.Now()
	if err := resourcers.WaitForPodRunning(ctx.Context, clients.Clientset, debugPodNamespace, debugPodName, debugPodTimeout); err != nil {
		class := diag.ClassifyError(err, false)
		span.AddEvent("debug_pod_not_running", trace.WithAttributes(
			append([]attribute.KeyValue{attribute.Int64("wait_ms", time.Since(waitStarted).Milliseconds())}, class.SpanAttrs()...)...))
		log.Warnw(baseCtx, "node debug pod did not reach Running",
			append([]any{"resource_id", debugPodName, "wait_ms", time.Since(waitStarted).Milliseconds()}, class.LogFields()...)...)
		cleanup()
		return remoteerr.Sanitize("wait for debug pod to reach Running", err)
	}
	span.AddEvent("debug_pod_running", trace.WithAttributes(attribute.Int64("wait_ms", time.Since(waitStarted).Milliseconds())))

	// Exec into the debug pod.
	command := opts.Command
	if len(command) == 0 {
		command = []string{"/bin/bash"}
	}

	// Use a wrapper stop channel so we can intercept completion and clean up.
	innerStopCh := make(chan error, 1)
	err = ExecCmd(
		ctx.Context,
		clients.Clientset,
		clients.RestConfig,
		debugPodNamespace,
		debugPodName,
		"debug",
		command,
		tty,
		innerStopCh,
		resize,
	)
	if err != nil {
		log.Warnw(baseCtx, "node debug exec setup failed", diag.ClassifyError(err, false).LogFields()...)
		cleanup()
		return err
	}

	// Forward the inner stop signal and clean up.
	// Listen for both the exec finishing and context cancellation to ensure
	// the debug pod is always deleted.
	go func() {
		var completion error
		select {
		case completion = <-innerStopCh:
		case <-ctx.Context.Done():
			completion = ctx.Context.Err()
		}
		cleanup()
		select {
		case stopCh <- completion:
		case <-ctx.Context.Done():
		}
	}()

	return nil
}
