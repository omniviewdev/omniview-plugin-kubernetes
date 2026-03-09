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

	"github.com/omniview/kubernetes/pkg/utils"
	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
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
		"core::v1::Pod":                   &PodResourceForwarder{},
		"core::v1::Service":               wf,
		"core::v1::ReplicationController": wf,
		"apps::v1::Deployment":            wf,
		"apps::v1::ReplicaSet":            wf,
		"apps::v1::StatefulSet":           wf,
		"apps::v1::DaemonSet":             wf,
		"batch::v1::Job":                  wf,
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
) (*networker.ForwarderResult, error) {
	log := loggerFromCtx(pctx)

	log.Info(ctx, "pod port-forward: starting",
		logging.String("resource_key", opts.Resource.ResourceKey),
		logging.String("resource_id", opts.Resource.ResourceID),
		logging.Int("local_port", int(opts.Options.LocalPort)),
		logging.Int("remote_port", int(opts.Options.RemotePort)),
	)

	clients, err := utils.KubeClientsFromContext(pctx)
	if err != nil {
		log.Error(ctx, "pod port-forward: failed to get kube clients", logging.Error(err))
		return nil, err
	}

	// extract name and namespace
	metadata, ok := opts.Resource.ResourceData["metadata"].(map[string]any)
	if !ok {
		log.Error(ctx, "pod port-forward: metadata missing from resource data",
			logging.Any("resource_data_keys", mapKeys(opts.Resource.ResourceData)))
		return nil, errors.New("metadata is required")
	}
	name, ok := metadata["name"].(string)
	if !ok {
		log.Error(ctx, "pod port-forward: pod name missing from metadata")
		return nil, errors.New("pod is required")
	}
	namespace, ok := metadata["namespace"].(string)
	if !ok {
		log.Error(ctx, "pod port-forward: namespace missing from metadata")
		return nil, errors.New("namespace is required")
	}

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
		log.Error(ctx, "pod port-forward: failed to create SPDY round-tripper", logging.Error(err))
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
		log.Error(ctx, "pod port-forward: failed to create portforward", logging.Error(err))
		return nil, err
	}

	// start the forwarder
	go func() {
		log.Info(ctx, "pod port-forward: ForwardPorts starting")
		if err := fw.ForwardPorts(); err != nil {
			log.Error(ctx, "pod port-forward: ForwardPorts returned error",
				logging.Error(err),
				logging.String("stdout", out.String()),
				logging.String("stderr", errOut.String()),
			)
			errCh <- err
		} else {
			log.Info(ctx, "pod port-forward: ForwardPorts exited cleanly",
				logging.String("stdout", out.String()),
				logging.String("stderr", errOut.String()),
			)
		}
		close(errCh)
	}()

	// stop when the parent context is cancelled
	go func() {
		select {
		case <-ctx.Done():
			reason := "context cancelled"
			if cause := context.Cause(ctx); cause != nil {
				reason = cause.Error()
			}
			log.Info(ctx, "pod port-forward: stopping tunnel",
				logging.String("reason", reason),
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
) (*networker.ForwarderResult, error) {
	log := loggerFromCtx(pctx)

	log.Info(ctx, "workload port-forward: starting",
		logging.String("resource_key", opts.Resource.ResourceKey),
		logging.String("resource_id", opts.Resource.ResourceID),
		logging.Int("local_port", int(opts.Options.LocalPort)),
		logging.Int("remote_port", int(opts.Options.RemotePort)),
	)

	clients, err := utils.KubeClientsFromContext(pctx)
	if err != nil {
		log.Error(ctx, "workload port-forward: failed to get kube clients", logging.Error(err))
		return nil, err
	}

	metadata, ok := opts.Resource.ResourceData["metadata"].(map[string]any)
	if !ok {
		log.Error(ctx, "workload port-forward: metadata missing from resource data")
		return nil, errors.New("metadata is required")
	}
	namespace, ok := metadata["namespace"].(string)
	if !ok {
		log.Error(ctx, "workload port-forward: namespace missing from metadata")
		return nil, errors.New("namespace is required")
	}

	resourceKey := opts.Resource.ResourceKey
	selector, err := extractPodSelector(resourceKey, opts.Resource.ResourceData)
	if err != nil {
		log.Error(ctx, "workload port-forward: failed to extract pod selector",
			logging.Error(err),
			logging.String("resource_key", resourceKey),
		)
		return nil, err
	}
	log.Info(ctx, "workload port-forward: extracted selector",
		logging.Any("selector", selector),
	)

	// For Services, resolve the target port through spec.ports[].targetPort.
	remotePort := opts.Options.RemotePort
	if resourceKey == "core::v1::Service" {
		if spec, ok := opts.Resource.ResourceData["spec"].(map[string]any); ok {
			if ports, ok := spec["ports"].([]any); ok {
				resolved := resolveServiceTargetPort(ports, remotePort)
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
		log.Error(ctx, "workload port-forward: failed to resolve backing pod",
			logging.Error(err),
			logging.String("namespace", namespace),
		)
		return nil, err
	}
	log.Info(ctx, "workload port-forward: resolved backing pod",
		logging.String("pod", podName),
		logging.String("namespace", namespace),
	)

	readyCh := make(chan struct{}, 1)
	errCh := make(chan error, 1)

	go func() {
		defer close(errCh)

		localPort := opts.Options.LocalPort
		firstAttempt := true

		for attempt := range maxReconnectAttempts {
			if err := ctx.Err(); err != nil {
				log.Info(ctx, "workload port-forward: context cancelled, stopping")
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
					log.Warn(ctx, "workload port-forward: failed to resolve backing pod on reconnect",
						logging.Error(err),
						logging.Int("attempt", attempt+1),
					)
					continue
				}
				log.Info(ctx, "workload port-forward: re-resolved backing pod",
					logging.String("pod", podName),
				)
			}
			firstAttempt = false

			fwErr := f.forwardToPod(ctx, log, clients, namespace, podName, localPort, remotePort, readyCh)
			if fwErr == nil {
				log.Info(ctx, "workload port-forward: tunnel closed cleanly")
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
			log.Error(ctx, "workload port-forward: unrecoverable error",
				logging.Error(fwErr),
				logging.String("pod", podName),
			)
			errCh <- fwErr
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
		log.Error(ctx, "forwardToPod: failed to create SPDY round-tripper", logging.Error(err))
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
		log.Error(ctx, "forwardToPod: failed to create portforward", logging.Error(err))
		return err
	}

	// Stop when the parent context is cancelled.
	go func() {
		select {
		case <-ctx.Done():
			reason := "context cancelled"
			if cause := context.Cause(ctx); cause != nil {
				reason = cause.Error()
			}
			log.Info(ctx, "forwardToPod: stopping tunnel",
				logging.String("pod", podName),
				logging.String("reason", reason),
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

	fwErr := fw.ForwardPorts()

	// Always log the portforward output for diagnostics.
	if stdout := out.String(); stdout != "" {
		log.Info(ctx, "forwardToPod: stdout", logging.String("output", stdout))
	}
	if stderr := errOut.String(); stderr != "" {
		log.Warn(ctx, "forwardToPod: stderr", logging.String("output", stderr))
	}

	if fwErr != nil {
		log.Error(ctx, "forwardToPod: ForwardPorts returned error",
			logging.Error(fwErr),
			logging.String("pod", podName),
		)
	} else {
		log.Info(ctx, "forwardToPod: ForwardPorts exited cleanly",
			logging.String("pod", podName),
		)
	}

	return fwErr
}

// loggerFromCtx returns the logger from the plugin context, or a nop logger.
func loggerFromCtx(pctx *types.PluginContext) logging.Logger {
	if pctx != nil && pctx.Logger != nil {
		return pctx.Logger.Named("networker.kubernetes")
	}
	return logging.NewNop()
}

// mapKeys returns the keys of a map as a slice (for diagnostic logging).
func mapKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
