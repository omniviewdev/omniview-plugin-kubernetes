package execv2

import (
	"context"
	"errors"
	"io"
	"net"
	"net/url"
	"time"

	"github.com/gorilla/websocket"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes/scheme"
	restclient "k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
	utilexec "k8s.io/client-go/util/exec"
	"k8s.io/streaming/pkg/httpstream"

	"github.com/omniview/kubernetes/pkg/utils"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// execRequest builds the pods/exec or the pods/attach request of the session's Pod with the client of its connection, and
// returns its URL and the config the transports are made from.
func execRequest(p *exec.Proc) (*restclient.Config, *url.URL, error) {
	namespace, name, err := podAddress(p.Request.Ref)
	if err != nil {
		return nil, nil, err
	}
	clients, err := utils.KubeClientsFromContext(p.Context)
	if err != nil {
		return nil, nil, err
	}
	container, err := containerOf(p)
	if err != nil {
		return nil, nil, err
	}
	tty := p.Request.TTY
	req := clients.Clientset.CoreV1().RESTClient().Post().Resource("pods").Name(name).Namespace(namespace)
	if p.Request.Selection["mode"] == modeAttach {
		req = req.SubResource("attach").VersionedParams(
			&corev1.PodAttachOptions{Container: container, Stdin: true, Stdout: true, Stderr: !tty, TTY: tty}, scheme.ParameterCodec)
	} else {
		req = req.SubResource("exec").VersionedParams(
			&corev1.PodExecOptions{Command: p.Request.Argv, Container: container, Stdin: true, Stdout: true, Stderr: !tty, TTY: tty}, scheme.ParameterCodec)
	}
	return clients.RestConfig, req.URL(), nil
}

// newExecutors returns the two transports of the session's request: WebSocket v5 and SPDY. It is a variable so that a test
// can script the stream.
var newExecutors = func(p *exec.Proc) (ws, spdy remotecommand.Executor, err error) {
	config, u, err := execRequest(p)
	if err != nil {
		return nil, nil, err
	}
	if spdy, err = remotecommand.NewSPDYExecutor(config, "POST", u); err != nil {
		return nil, nil, err
	}
	ws, err = remotecommand.NewWebSocketExecutor(config, "GET", u.String())
	return ws, spdy, err
}

// containerOf is the container a session runs in: the one its selection names, else the default choice of Options. The SDK
// holds a selection to the choices of Options but does not put the default of an option the request omits into
// Proc.Request.Selection (it uses it only to narrow the capabilities), so the Pod is read again for it.
func containerOf(p *exec.Proc) (string, error) {
	if container := p.Request.Selection["container"]; container != "" {
		return container, nil
	}
	namespace, name, err := podAddress(p.Request.Ref)
	if err != nil {
		return "", err
	}
	pod, err := getPod(p.Context, namespace, name)
	if err != nil {
		return "", err
	}
	for _, choice := range containerChoices(pod) {
		if choice.IsDefault {
			return choice.Value, nil
		}
	}
	return "", nil
}

// checkIncarnation refuses a session whose reference names a Pod that has been replaced since the host read it. The exec API
// takes no precondition, so the Pod is read first, and the race between that read and the exec stays open.
func checkIncarnation(p *exec.Proc) error {
	want := p.Request.Ref.Incarnation
	if want == nil {
		return nil
	}
	namespace, name, err := podAddress(p.Request.Ref)
	if err != nil {
		return err
	}
	pod, err := getPod(p.Context, namespace, name)
	if err != nil {
		return err
	}
	if string(pod.UID) != *want {
		return exec.NewError(exec.ErrorClassConflict, exec.ErrorReasonTargetReplaced, nil)
	}
	return nil
}

// podExec runs the session's command in its container, or attaches to the container's own process, and returns how it ended.
func podExec(ctx context.Context, p *exec.Proc) (exec.Exit, error) {
	if err := checkIncarnation(p); err != nil {
		return exec.Exit{}, err
	}
	ws, spdy, err := newExecutors(p)
	if err != nil {
		return exec.Exit{}, err
	}
	opts := remotecommand.StreamOptions{Stdin: p.Stdin, Stdout: p.Stdout, Stderr: p.Stderr, Tty: p.Request.TTY}
	if p.Request.TTY {
		opts.TerminalSizeQueue = sizeQueue{p.Resize} // a terminal has no Stderr: it is nil, which client-go reads as none
	}
	began := time.Now()
	protocol, streamErr := stream(ctx, ws, spdy, opts)
	exit, err := exitOf(streamErr, p.Request.Selection["mode"] == modeAttach)
	if err != nil {
		if classified, ok := classify(err); ok {
			err = withFacts(p.Request, classified)
		}
	}
	traceEnd(p, protocol, began, streamErr, exit, err)
	return exit, err
}

// stream runs the command over WebSocket v5 and, when the server refuses the upgrade, over SPDY: client-go's own fallback
// executor, spelt out so that the protocol that carried the session is known.
func stream(ctx context.Context, ws, spdy remotecommand.Executor, opts remotecommand.StreamOptions) (string, error) {
	err := ws.StreamWithContext(ctx, opts)
	if httpstream.IsUpgradeFailure(err) {
		return "k8s-spdy", spdy.StreamWithContext(ctx, opts)
	}
	return "k8s-ws-v5", err
}

// exitOf says how the command ended from how client-go's stream ended. A status the API relayed is the command's own;
// a stream that broke says nothing of the command; anything else is an error for Classify.
func exitOf(err error, attach bool) (exec.Exit, error) {
	var status utilexec.ExitError
	switch {
	case errors.As(err, &status) && status.Exited():
		return exec.ExitCode(status.ExitStatus()), nil
	case errors.Is(err, errSuccess) && !attach: // a Success status read off the error channel (the own executor only)
		return exec.ExitCode(0), nil
	case errors.Is(err, errSuccess):
		return nilExit(attach), nil // an attach's Success says the attach ended, not how the process did
	case err == nil:
		return nilExit(attach), nil
	}
	if cause, ok := lostCause(err); ok {
		return exec.ExitLost(cause), nil
	}
	return exec.Exit{}, err
}

// lostCause says whether err is the stream to the target breaking while it was read (as opposed to failing to open), and
// how: client-go's heartbeat read deadline gave up, or the connection closed or reset.
func lostCause(err error) (exec.LostCause, bool) {
	var (
		closed *websocket.CloseError
		op     *net.OpError
	)
	switch {
	case errors.As(err, &op) && op.Op == "read" && op.Timeout():
		return exec.LostLinkDead, true
	case errors.As(err, &closed), errors.As(err, &op) && op.Op == "read", errors.Is(err, io.ErrUnexpectedEOF):
		return exec.LostNoStatus, true
	}
	return exec.LostUnspecified, false
}

// sizeQueue hands Proc.Resize to client-go: Next waits for the next size and returns nil when the command has ended.
type sizeQueue struct{ resize <-chan exec.Size }

func (q sizeQueue) Next() *remotecommand.TerminalSize {
	size, ok := <-q.resize
	if !ok {
		return nil
	}
	return &remotecommand.TerminalSize{Width: size.Cols, Height: size.Rows}
}
