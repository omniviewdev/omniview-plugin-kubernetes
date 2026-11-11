package networker

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/utils"
	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"github.com/omniview/kubernetes/pkg/utils/remoteerr"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
)

func Register(plugin *sdk.Plugin) {
	wf := &WorkloadResourceForwarder{}
	portForwarders := map[string]networker.ResourceForwarder{
		"k8s:/pods":                   &PodResourceForwarder{},
		"k8s:/services":               wf,
		"k8s:/replicationcontrollers": wf,
		"k8s:apps/deployments":        wf,
		"k8s:apps/replicasets":        wf,
		"k8s:apps/statefulsets":       wf,
		"k8s:apps/daemonsets":         wf,
		"k8s:batch/jobs":              wf,
	}

	// Register the capabilities
	if err := networker.RegisterPlugin(plugin, networker.PluginOpts{
		ResourceForwarders: portForwarders,
	}); err != nil {
		panic(err)
	}
}

// PodResourceForwarder implements networker.ResourceForwarder for Kubernetes pods.
type PodResourceForwarder struct{}

func (f *PodResourceForwarder) ForwardResource(
	ctx context.Context,
	pctx *types.PluginContext,
	opts networker.ResourcePortForwardHandlerOpts,
) (result *networker.ForwarderResult, resultErr error) {
	log := loggerFromCtx(pctx)
	span := startForwardSetupSpan(ctx, pctx, "pod", opts.Resource.ResourceKey)
	defer func() {
		class := diag.EndSpan(span, resultErr, false)
		if resultErr != nil {
			log.Warnw(ctx, "pod port-forward: setup failed", class.LogFields()...)
		}
		resultErr = remoteerr.Sanitize("pod port-forward setup", resultErr)
	}()

	log.Info(ctx, "pod port-forward: starting",
		logging.String("resource_key", opts.Resource.ResourceKey),
		logging.String("resource_id", opts.Resource.ResourceID),
		logging.Int("local_port", int(opts.Options.LocalPort)),
		logging.Int("remote_port", int(opts.Options.RemotePort)),
	)

	clients, err := utils.KubeClientsFromContext(pctx)
	if err != nil {
		log.Errorw(ctx, "pod port-forward: failed to get kube clients", diag.ClassifyError(err, false).LogFields()...)
		return nil, err
	}

	if opts.Resource.ResourceKey != "k8s:/pods" {
		return nil, resourcev2.NewError("INVALID_REQUEST", "pod port-forward requires k8s:/pods")
	}
	name, namespace, err := nativeForwardTarget(pctx, opts.Resource, "k8s:/pods")
	if err != nil {
		return nil, err
	}
	span.SetAttributes(attribute.String("resource.id", name), attribute.String("resource.namespace", namespace))

	log.Info(ctx, "pod port-forward: resolved target",
		logging.String("pod", name),
		logging.String("namespace", namespace),
	)

	path := fmt.Sprintf("/api/v1/namespaces/%s/pods/%s/portforward", namespace, name)
	regexURLScheme := regexp.MustCompile(`(?i)^https?://`)
	hostIP := regexURLScheme.ReplaceAllString(clients.RestConfig.Host, "")

	log.Debug(ctx, "pod port-forward: dialing API server",
		logging.String("host", hostIP),
		logging.String("path", path),
	)

	transport, upgrader, err := spdy.RoundTripperFor(clients.RestConfig)
	if err != nil {
		log.Errorw(ctx, "pod port-forward: failed to create SPDY round-tripper", diag.ClassifyError(err, false).LogFields()...)
		return nil, err
	}

	stopCh := make(chan struct{}, 1)
	readyCh := make(chan struct{}, 1)
	errCh := make(chan error, 1)
	out, errOut := new(bytes.Buffer), new(bytes.Buffer)

	dialer := spdy.NewDialer(
		upgrader,
		&http.Client{Transport: transport},
		http.MethodPost,
		&url.URL{Scheme: "https", Path: path, Host: hostIP},
	)

	fw, err := portforward.New(
		dialer,
		[]string{fmt.Sprintf("%d:%d", opts.Options.LocalPort, opts.Options.RemotePort)},
		stopCh,
		readyCh,
		out,
		errOut,
	)
	if err != nil {
		log.Errorw(ctx, "pod port-forward: failed to create portforward", diag.ClassifyError(err, false).LogFields()...)
		return nil, err
	}

	// start the forwarder
	go func() {
		started := time.Now()
		log.Info(ctx, "pod port-forward: ForwardPorts starting")
		diag.PortForward("started")
		err := fw.ForwardPorts()
		class := diag.ClassifyError(err, false)
		fields := append([]any{
			"resource_id", name,
			"resource_namespace", namespace,
			"duration_ms", time.Since(started).Milliseconds(),
			"stdout_lines", forwardLineCount(out),
			"stderr_lines", forwardLineCount(errOut),
		}, class.LogFields()...)
		if err != nil {
			diag.PortForward("failed")
			log.Errorw(ctx, "pod port-forward: ForwardPorts returned error", fields...)
			errCh <- remoteerr.Sanitize("port-forward tunnel", err)
		} else {
			diag.PortForward("ended")
			log.Infow(ctx, "pod port-forward: ForwardPorts exited cleanly", fields...)
		}
		close(errCh)
	}()

	// stop when the parent context is cancelled
	go func() {
		select {
		case <-ctx.Done():
			log.Info(ctx, "pod port-forward: stopping tunnel",
				logging.String("reason", forwardStopReason(ctx)),
			)
			close(stopCh)
		case <-stopCh:
			log.Debug(ctx, "pod port-forward: stopCh closed externally")
		}
	}()

	return &networker.ForwarderResult{
		Ready: readyCh,
		ErrCh: errCh,
	}, nil
}

// WorkloadResourceForwarder implements networker.ResourceForwarder for
// non-Pod workload types (Service, Deployment, StatefulSet, etc.).
// It resolves the workload to a backing pod via label selectors and
// auto-reconnects when the connection to the pod is lost.
type WorkloadResourceForwarder struct{}

const maxReconnectAttempts = 10

func (f *WorkloadResourceForwarder) ForwardResource(
	ctx context.Context,
	pctx *types.PluginContext,
	opts networker.ResourcePortForwardHandlerOpts,
) (result *networker.ForwarderResult, resultErr error) {
	log := loggerFromCtx(pctx)
	span := startForwardSetupSpan(ctx, pctx, "workload", opts.Resource.ResourceKey)
	defer func() {
		class := diag.EndSpan(span, resultErr, false)
		if resultErr != nil {
			log.Warnw(ctx, "workload port-forward: setup failed", class.LogFields()...)
		}
		resultErr = remoteerr.Sanitize("workload port-forward setup", resultErr)
	}()

	log.Info(ctx, "workload port-forward: starting",
		logging.String("resource_key", opts.Resource.ResourceKey),
		logging.String("resource_id", opts.Resource.ResourceID),
		logging.Int("local_port", int(opts.Options.LocalPort)),
		logging.Int("remote_port", int(opts.Options.RemotePort)),
	)

	clients, err := utils.KubeClientsFromContext(pctx)
	if err != nil {
		log.Errorw(ctx, "workload port-forward: failed to get kube clients", diag.ClassifyError(err, false).LogFields()...)
		return nil, err
	}

	_, namespace, err := nativeForwardTarget(pctx, opts.Resource, opts.Resource.ResourceKey)
	if err != nil {
		return nil, err
	}
	span.SetAttributes(attribute.String("resource.namespace", namespace))

	resourceKey := opts.Resource.ResourceKey
	selector, err := extractPodSelector(resourceKey, opts.Resource.ResourceData)
	if err != nil {
		log.Errorw(ctx, "workload port-forward: failed to extract pod selector",
			append([]any{"resource_key", resourceKey}, diag.ClassifyError(err, false).LogFields()...)...)
		return nil, err
	}
	log.Info(ctx, "workload port-forward: extracted selector",
		logging.Any("selector", selector),
	)

	// For Services, resolve the target port through spec.ports[].targetPort.
	remotePort := opts.Options.RemotePort
	if resourceKey == "k8s:/services" {
		if spec, ok := utils.TaggedField(opts.Resource.ResourceData, "spec"); ok && spec.Kind == "map" {
			if ports, ok := spec.Map["ports"]; ok && ports.Kind == "list" {
				resolved := resolveServiceTargetPort(ports.List, remotePort)
				if resolved != remotePort {
					log.Info(ctx, "workload port-forward: resolved service targetPort",
						logging.Int("service_port", int(remotePort)),
						logging.Int("target_port", int(resolved)),
					)
				}
				remotePort = resolved
			}
		}
	}

	// Resolve the initial backing pod.
	podName, err := resolveBackingPod(ctx, clients.Clientset, namespace, selector)
	if err != nil {
		log.Errorw(ctx, "workload port-forward: failed to resolve backing pod",
			append([]any{"resource_namespace", namespace}, diag.ClassifyError(err, false).LogFields()...)...)
		return nil, err
	}
	span.SetAttributes(attribute.String("resource.id", podName))
	log.Info(ctx, "workload port-forward: resolved backing pod",
		logging.String("pod", podName),
		logging.String("namespace", namespace),
	)

	readyCh := make(chan struct{}, 1)
	errCh := make(chan error, 1)

	go func() {
		defer close(errCh)

		sessionStarted := time.Now()
		localPort := opts.Options.LocalPort
		firstAttempt := true

		for attempt := range maxReconnectAttempts {
			if err := ctx.Err(); err != nil {
				log.Infow(ctx, "workload port-forward: context cancelled, stopping",
					"duration_ms", time.Since(sessionStarted).Milliseconds(), "outcome", "canceled")
				return
			}

			// On reconnect, re-resolve the backing pod.
			if !firstAttempt {
				backoff := min(time.Duration(1<<attempt)*time.Second, 30*time.Second)
				log.Info(ctx, "workload port-forward: reconnecting",
					logging.String("resource_key", resourceKey),
					logging.Int("attempt", attempt+1),
					logging.Duration("backoff", backoff),
				)

				select {
				case <-ctx.Done():
					return
				case <-time.After(backoff):
				}

				podName, err = resolveBackingPod(ctx, clients.Clientset, namespace, selector)
				if err != nil {
					log.Warnw(ctx, "workload port-forward: failed to resolve backing pod on reconnect",
						append([]any{"attempt", attempt + 1}, diag.ClassifyError(err, false).LogFields()...)...)
					continue
				}
				log.Info(ctx, "workload port-forward: re-resolved backing pod",
					logging.String("pod", podName),
				)
			}
			firstAttempt = false

			fwErr := f.forwardToPod(ctx, log, clients, namespace, podName, localPort, remotePort, readyCh)
			if fwErr == nil {
				log.Infow(ctx, "workload port-forward: tunnel closed cleanly",
					"duration_ms", time.Since(sessionStarted).Milliseconds(), "outcome", "success")
				return // clean shutdown
			}
			if errors.Is(fwErr, portforward.ErrLostConnectionToPod) {
				log.Warn(ctx, "workload port-forward: lost connection to pod, will reconnect",
					logging.String("pod", podName),
					logging.String("namespace", namespace),
				)
				continue
			}
			// Unrecoverable error.
			log.Errorw(ctx, "workload port-forward: unrecoverable error",
				append([]any{"resource_id", podName, "duration_ms", time.Since(sessionStarted).Milliseconds()},
					diag.ClassifyError(fwErr, false).LogFields()...)...)
			errCh <- remoteerr.Sanitize("port-forward tunnel", fwErr)
			return
		}

		log.Error(ctx, "workload port-forward: exceeded max reconnect attempts",
			logging.Int("max_attempts", maxReconnectAttempts),
			logging.String("resource_key", resourceKey),
		)
		errCh <- fmt.Errorf("exceeded %d reconnect attempts for %s", maxReconnectAttempts, resourceKey)
	}()

	return &networker.ForwarderResult{
		Ready: readyCh,
		ErrCh: errCh,
	}, nil
}

// forwardToPod establishes an SPDY port-forward tunnel to a specific pod and
// blocks until the tunnel closes. Returns nil on clean shutdown, or the error
// from ForwardPorts.
func (f *WorkloadResourceForwarder) forwardToPod(
	ctx context.Context,
	log logging.Logger,
	clients *kubeauth.KubeClientBundle,
	namespace, podName string,
	localPort, remotePort int32,
	readyCh chan struct{},
) error {
	path := fmt.Sprintf("/api/v1/namespaces/%s/pods/%s/portforward", namespace, podName)
	regexURLScheme := regexp.MustCompile(`(?i)^https?://`)
	hostIP := regexURLScheme.ReplaceAllString(clients.RestConfig.Host, "")

	log.Debug(ctx, "forwardToPod: dialing API server",
		logging.String("host", hostIP),
		logging.String("path", path),
		logging.String("pod", podName),
	)

	transport, upgrader, err := spdy.RoundTripperFor(clients.RestConfig)
	if err != nil {
		log.Errorw(ctx, "forwardToPod: failed to create SPDY round-tripper", diag.ClassifyError(err, false).LogFields()...)
		return err
	}

	stopCh := make(chan struct{}, 1)
	out, errOut := new(bytes.Buffer), new(bytes.Buffer)

	dialer := spdy.NewDialer(
		upgrader,
		&http.Client{Transport: transport},
		http.MethodPost,
		&url.URL{Scheme: "https", Path: path, Host: hostIP},
	)

	fw, err := portforward.New(
		dialer,
		[]string{fmt.Sprintf("%d:%d", localPort, remotePort)},
		stopCh,
		readyCh,
		out,
		errOut,
	)
	if err != nil {
		log.Errorw(ctx, "forwardToPod: failed to create portforward", diag.ClassifyError(err, false).LogFields()...)
		return err
	}

	// Stop when the parent context is cancelled.
	go func() {
		select {
		case <-ctx.Done():
			log.Info(ctx, "forwardToPod: stopping tunnel",
				logging.String("pod", podName),
				logging.String("reason", forwardStopReason(ctx)),
			)
			close(stopCh)
		case <-stopCh:
		}
	}()

	log.Info(ctx, "forwardToPod: ForwardPorts starting",
		logging.String("pod", podName),
		logging.Int("local_port", int(localPort)),
		logging.Int("remote_port", int(remotePort)),
	)

	started := time.Now()
	diag.PortForward("started")
	fwErr := fw.ForwardPorts()
	if fwErr != nil {
		diag.PortForward("failed")
	} else {
		diag.PortForward("ended")
	}

	// Tunnel output can carry remote data; only line counts are logged.
	stdoutLines, stderrLines := forwardLineCount(out), forwardLineCount(errOut)
	if stderrLines > 0 {
		log.Warnw(ctx, "forwardToPod: stderr", "resource_id", podName, "stdout_lines", stdoutLines, "stderr_lines", stderrLines)
	} else if stdoutLines > 0 {
		log.Debugw(ctx, "forwardToPod: stdout", "resource_id", podName, "stdout_lines", stdoutLines)
	}

	fields := append([]any{
		"resource_id", podName,
		"duration_ms", time.Since(started).Milliseconds(),
	}, diag.ClassifyError(fwErr, false).LogFields()...)
	if fwErr != nil {
		log.Errorw(ctx, "forwardToPod: ForwardPorts returned error", fields...)
	} else {
		log.Infow(ctx, "forwardToPod: ForwardPorts exited cleanly", fields...)
	}

	return fwErr
}

// startForwardSetupSpan starts the span covering port-forward setup only; the
// tunnel itself outlives it and is described by logs.
func startForwardSetupSpan(ctx context.Context, pctx *types.PluginContext, kind, resourceKey string) trace.Span {
	connection := ""
	if pctx != nil && pctx.Connection != nil {
		connection = pctx.Connection.ID
	}
	_, span := diag.Tracer().Start(ctx, "kubernetes.portforward.session.open", trace.WithAttributes(
		attribute.String("connection", connection),
		attribute.String("resource.type", resourceKey),
		attribute.String("forward.kind", kind),
	))
	return span
}

// forwardStopReason maps the context end into a closed vocabulary.
func forwardStopReason(ctx context.Context) string {
	cause := context.Cause(ctx)
	if cause == nil {
		return "context_canceled"
	}
	switch class := diag.ClassifyError(cause, false); class.Class {
	case "canceled", "deadline_exceeded":
		return class.Class
	default:
		return "cancel_cause"
	}
}

// forwardLineCount counts the lines in the tunnel output buffer.
func forwardLineCount(b *bytes.Buffer) int {
	data := b.Bytes()
	if len(data) == 0 {
		return 0
	}
	n := bytes.Count(data, []byte{'\n'})
	if data[len(data)-1] != '\n' {
		n++
	}
	return n
}

// loggerFromCtx returns the logger from the plugin context, or a nop logger.
func loggerFromCtx(pctx *types.PluginContext) logging.Logger {
	if pctx != nil && pctx.Logger != nil {
		return pctx.Logger.Named("networker.kubernetes")
	}
	return logging.NewNop()
}

func nativeForwardTarget(ctx *types.PluginContext, target networker.PortForwardResourceConnection, resourceType string) (string, string, error) {
	if target.PluginID != "" && target.PluginID != "kubernetes" {
		return "", "", resourcev2.NewError("INVALID_REQUEST", "port-forward resource belongs to another provider")
	}
	if target.ConnectionID != "" && (ctx == nil || ctx.Connection == nil || target.ConnectionID != ctx.Connection.ID) {
		return "", "", resourcev2.NewError("INVALID_REQUEST", "port-forward connection does not match the selected connection")
	}
	return utils.NativeResourceTarget(ctx, target.ResourceData, target.Reference, target.Route, resourceType, true)
}
