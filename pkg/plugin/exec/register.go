package exec

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/util/httpstream"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	restclient "k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

func Register(plugin *sdk.Plugin) {
	// Register the capabilities
	if err := exec.RegisterPlugin(plugin, exec.PluginOpts{
		Handlers: []exec.Handler{
			podExecHandler(),
			{
				Plugin:         "kubernetes",
				Resource:       "core::v1::Node",
				TTYHandler:     NodeHandler,
				DefaultCommand: []string{"/bin/bash"},
			},
		},
	}); err != nil {
		panic(err)
	}
}

func podExecHandler() exec.Handler {
	return exec.Handler{
		Plugin:         "kubernetes",
		Resource:       "core::v1::Pod",
		TTYHandler:     PodHandler,
		HandlesResize:  true,
		DefaultCommand: []string{"/bin/bash"},
		TargetBuilder: exec.ActionTargetBuilder{
			Paths: []string{"$.spec.containers[*]"},
			Selectors: map[string]string{
				"container": "$.name",
			},
			LabelSelector: "container",
		},
	}
}

func PodHandler(
	ctx *types.PluginContext,
	opts exec.SessionOptions,
	tty *os.File,
	stopCh chan error,
	resize <-chan exec.SessionResizeInput,
) error {
	return podHandlerWithProvider(defaultClientProvider, ctx, opts, tty, stopCh, resize)
}

func podHandlerWithProvider(
	provider ClientProvider,
	ctx *types.PluginContext,
	opts exec.SessionOptions,
	tty *os.File,
	stopCh chan error,
	resize <-chan exec.SessionResizeInput,
) error {
	clients, err := provider(ctx)
	if err != nil {
		return err
	}

	// get the namespace and pod off the data obj
	metadata, ok := opts.ResourceData["metadata"].(map[string]interface{})
	if !ok {
		return errors.New("metadata is required")
	}
	pod, ok := metadata["name"].(string)
	if !ok {
		return errors.New("pod is required")
	}
	namespace, ok := metadata["namespace"].(string)
	if !ok {
		return errors.New("namespace is required")
	}
	container, ok := opts.Params["container"]
	if !ok {
		container = ""
	}

	switch opts.Params["mode"] {
	case "attach":
		if err := waitForDebugContainer(ctx.Context, clients.Clientset, namespace, pod, opts.Params["pod_uid"], container); err != nil {
			return err
		}
		return streamPod(ctx.Context, clients.Clientset, clients.RestConfig, namespace, pod, container, nil, true, tty, stopCh, resize)
	case "", "exec":
	default:
		return fmt.Errorf("unsupported session mode %q", opts.Params["mode"])
	}

	return ExecCmd(
		ctx.Context,
		clients.Clientset,
		clients.RestConfig,
		namespace,
		pod,
		container,
		opts.Command,
		tty,
		stopCh,
		resize,
	)
}

// ExecCmd exec command on specific pod and wait the command's output.
func ExecCmd(
	ctx context.Context,
	client kubernetes.Interface,
	config *restclient.Config,
	namespace string,
	pod string,
	container string,
	command []string,
	tty *os.File,
	stopChan chan error,
	resize <-chan exec.SessionResizeInput,
) error {
	return streamPod(ctx, client, config, namespace, pod, container, command, false, tty, stopChan, resize)
}

func streamPod(
	ctx context.Context,
	client kubernetes.Interface,
	config *restclient.Config,
	namespace, pod, container string,
	command []string,
	attach bool,
	tty *os.File,
	stopChan chan error,
	resize <-chan exec.SessionResizeInput,
) error {
	subresource := "exec"
	if attach {
		subresource = "attach"
	}
	req := client.CoreV1().RESTClient().Post().Resource("pods").Name(pod).Namespace(namespace).SubResource(subresource)
	if attach {
		req.VersionedParams(&v1.PodAttachOptions{Container: container, Stdin: true, Stdout: true, Stderr: true, TTY: true}, scheme.ParameterCodec)
	} else {
		req.VersionedParams(&v1.PodExecOptions{Command: command, Container: container, Stdin: true, Stdout: true, Stderr: true, TTY: true}, scheme.ParameterCodec)
	}
	spdy, err := remotecommand.NewSPDYExecutor(config, "POST", req.URL())
	if err != nil {
		return err
	}
	ws, err := remotecommand.NewWebSocketExecutor(config, "GET", req.URL().String())
	if err != nil {
		return err
	}
	executor, err := remotecommand.NewFallbackExecutor(ws, spdy, httpstream.IsUpgradeFailure)
	if err != nil {
		return err
	}
	go func() {
		streamCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		queue := &terminalSizeQueue{ctx: streamCtx, resize: resize}
		streamErr := executor.StreamWithContext(streamCtx, remotecommand.StreamOptions{
			Stdin: tty, Stdout: tty, Stderr: tty, Tty: true, TerminalSizeQueue: queue,
		})
		if streamErr != nil && !attach {
			streamErr = classifyExecError(streamErr, command)
		}
		select {
		case stopChan <- streamErr:
		case <-ctx.Done():
		}
	}()
	return nil
}

// classifyExecError inspects a Kubernetes exec error and returns a structured
// ExecError with user-facing title, suggestion, and retry information.
func classifyExecError(err error, command []string) error {
	msg := err.Error()
	lower := strings.ToLower(msg)

	type classification struct {
		pattern       string
		title         string
		suggestion    string
		retryable     bool
		retryCommands []string
	}

	classifications := []classification{
		{
			pattern:       "no such file or directory",
			title:         "Shell not found",
			suggestion:    fmt.Sprintf("The shell %q was not found in this container. It may be a distroless or minimal image.", strings.Join(command, " ")),
			retryable:     true,
			retryCommands: []string{"sh", "/bin/sh", "ash"},
		},
		{
			pattern:       "executable file not found",
			title:         "Shell not found",
			suggestion:    fmt.Sprintf("The executable %q is not available in this container's PATH.", strings.Join(command, " ")),
			retryable:     true,
			retryCommands: []string{"sh", "/bin/sh", "ash"},
		},
		{
			pattern:       "oci runtime exec failed",
			title:         "Container runtime error",
			suggestion:    "The container runtime could not execute the command. The container may be a distroless image.",
			retryable:     true,
			retryCommands: []string{"sh", "/bin/sh"},
		},
		{
			pattern:    "permission denied",
			title:      "Permission denied",
			suggestion: "You may not have permission to exec into this container. Check your RBAC rules.",
			retryable:  false,
		},
		{
			pattern:    "container not running",
			title:      "Container not running",
			suggestion: "The target container is not in a running state. It may have crashed or completed its task.",
			retryable:  false,
		},
		{
			pattern:    "cannot exec in a stopped",
			title:      "Container stopped",
			suggestion: "The container has stopped. It may have crashed or completed its task.",
			retryable:  false,
		},
		{
			pattern:    "container name must be specified",
			title:      "Container not specified",
			suggestion: "This pod has multiple containers and the container name was not provided in the exec request.",
			retryable:  false,
		},
	}

	for _, c := range classifications {
		if strings.Contains(lower, c.pattern) {
			return &exec.ExecError{
				Err:           err,
				Title:         c.title,
				Message:       msg,
				Suggestion:    c.suggestion,
				Retryable:     c.retryable,
				RetryCommands: c.retryCommands,
			}
		}
	}

	// Default: generic retryable error
	return &exec.ExecError{
		Err:           err,
		Title:         "Exec failed",
		Message:       msg,
		Suggestion:    "The exec session failed unexpectedly.",
		Retryable:     true,
		RetryCommands: []string{"sh", "/bin/sh"},
	}
}
