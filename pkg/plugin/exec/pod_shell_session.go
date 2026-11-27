package exec

import (
	"context"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniview/kubernetes/pkg/pluginid"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	"k8s.io/client-go/rest"
)

const podDefaultShell = "/bin/bash"

func podSessionHandler(borrow clients.Borrower) sdkexec.TTYHandlerFunc {
	return func(pc *types.PluginContext, opts sdkexec.SessionOptions, tty *os.File, stop chan error, resize <-chan sdkexec.SessionResizeInput) error {
		_, hasID := opts.Params["containerID"]
		_, hasRestart := opts.Params["containerRestart"]
		if !hasID && !hasRestart {
			// Ordinary exec and debug attach do not claim this attested origin.
			return PodHandler(pc, opts, tty, stop, resize)
		}
		if pc == nil || pc.Context == nil || tty == nil || opts.Reference == nil || opts.Reference.Incarnation == nil || opts.Route == nil || opts.ResourceData != nil ||
			opts.ResourcePlugin != pluginid.ResourceProvider || opts.ResourceKey != "k8s:/pods" ||
			!opts.TTY || len(opts.Command) != 1 || opts.Command[0] != podDefaultShell || len(opts.Params) != 3 || !hasID || !hasRestart || opts.Params["container"] == "" {
			return resourcev2.NewError("INVALID_REQUEST", "Invalid resource-bound Pod shell target")
		}
		pod, namespace, err := nativeExecTarget(pc, opts, "k8s:/pods", true)
		if err != nil {
			return err
		}
		if borrow == nil {
			return resourcev2.NewError("UNAVAILABLE", "The admitted Pod connection is unavailable")
		}
		target := podShellTarget{namespace: namespace, name: pod, uid: *opts.Reference.Incarnation, container: opts.Params["container"], id: opts.Params["containerID"], restart: opts.Params["containerRestart"]}
		ready := make(chan error, 1)
		route := *opts.Route
		go func() {
			accepted := false
			err := borrow(pc.Context, route, func(ctx context.Context, native *clients.ClientSet) error {
				return target.stream(ctx, native, tty, resize, func() {
					accepted = true
					ready <- nil
				})
			})
			if !accepted {
				if err == nil {
					err = resourcev2.NewError("UNAVAILABLE", "Pod shell was not established")
				}
				ready <- err
				return
			}
			select {
			case stop <- err:
			case <-pc.Context.Done():
			}
		}()
		select {
		case err := <-ready:
			return err
		case <-pc.Context.Done():
			return pc.Context.Err()
		}
	}
}

type podShellTarget struct{ namespace, name, uid, container, id, restart string }

// Kubernetes provides no pods/exec UID precondition. Bracket the actual HTTP
// upgrade with two authenticated observations of the exact Pod and container.
// Never register an interactive session from executor construction alone.
// This does not make starting the remote shell atomic with either GET.
func (t podShellTarget) stream(ctx context.Context, native *clients.ClientSet, tty *os.File, resize <-chan sdkexec.SessionResizeInput, accept func()) error {
	// A custom base dialer or RoundTripper cannot be reproduced by client-go's
	// upgrade transport. Do not silently bypass it for an attested session.
	if native == nil || native.Clientset == nil || native.StreamingClientset == nil || native.RESTConfig == nil ||
		native.RESTConfig.Transport != nil || native.RESTConfig.Dial != nil {
		return resourcev2.NewError("UNAVAILABLE", "The admitted Pod connection is unavailable")
	}
	setup, endSetup := context.WithTimeout(ctx, 5*time.Second)
	defer endSetup()
	verify := func() error {
		return verifyPodShellTarget(setup, native.Clientset, t.namespace, t.name, t.uid, t.container, t.id, t.restart)
	}
	if err := verify(); err != nil {
		return err
	}
	config := rest.CopyConfig(native.RESTConfig) // retain this generation's endpoint, TLS, identity and auth wrappers
	config.Wrap(func(rt http.RoundTripper) http.RoundTripper { return podUpgradeTransport{rt} })
	stream, cancel := context.WithCancel(ctx)
	defer cancel()
	gate := &podShellIO{ctx: stream, tty: tty, opened: make(chan struct{}), admitted: make(chan struct{})}
	run, err := preparePodStream(stream, native.StreamingClientset, config, t.namespace, t.name, t.container, []string{podDefaultShell}, false, gate, resize)
	if err != nil {
		return err
	}
	finished := make(chan struct{})
	var streamErr error
	go func() {
		streamErr = run()
		close(finished)
	}()
	abort := func(err error) error {
		cancel()
		<-finished // Finish the transport before releasing the native client lease.
		return err
	}
	select {
	case <-gate.opened:
	case <-finished:
		return podShellNotStarted(streamErr)
	case <-setup.Done():
		return abort(setup.Err())
	}
	if err := verify(); err != nil {
		return abort(err)
	}
	select {
	case <-finished:
		return podShellNotStarted(streamErr)
	case <-setup.Done():
		return abort(setup.Err())
	default:
	}
	endSetup()
	accept()
	close(gate.admitted)
	<-finished
	return streamErr
}

func podShellNotStarted(err error) error {
	if err == nil {
		return resourcev2.NewError("UNAVAILABLE", "The Pod shell ended before admission")
	}
	return err
}

// All client-go remotecommand protocols create their streams before starting
// to copy stdin/stdout. Wait for that demand, then hold both directions until
// the post-upgrade observation admits the exact incarnation. No user input or
// remote output can cross the PTY while the name-only upgrade is unverified.
type podShellIO struct {
	ctx      context.Context
	tty      *os.File
	once     sync.Once
	opened   chan struct{}
	admitted chan struct{}
}

func (g *podShellIO) wait() error {
	g.once.Do(func() { close(g.opened) })
	select {
	case <-g.admitted:
		return g.ctx.Err()
	case <-g.ctx.Done():
		return g.ctx.Err()
	}
}

func (g *podShellIO) Read(p []byte) (int, error) {
	if err := g.wait(); err != nil {
		return 0, err
	}
	return g.tty.Read(p)
}

func (g *podShellIO) Write(p []byte) (int, error) {
	if err := g.wait(); err != nil {
		return 0, err
	}
	return g.tty.Write(p)
}

type podUpgradeTransport struct{ next http.RoundTripper }

func (t podUpgradeTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	res, err := t.next.RoundTrip(req)
	if err == nil && res.StatusCode >= 300 && res.StatusCode < 400 {
		_ = res.Body.Close() // Return the redirect refusal, not a transport diagnostic.
		return nil, resourcev2.NewError("UNAVAILABLE", "The Pod exec upgrade was redirected")
	}
	return res, err
}
