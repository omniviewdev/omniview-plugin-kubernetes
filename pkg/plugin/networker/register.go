package networker

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"time"

	"github.com/omniview/kubernetes/pkg/utils"
	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"

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
	clients, err := utils.KubeClientsFromContext(pctx)
	if err != nil {
		return nil, err
	}

	// extract name and namespace
	metadata, ok := opts.Resource.ResourceData["metadata"].(map[string]any)
	if !ok {
		return nil, errors.New("metadata is required")
	}
	name, ok := metadata["name"].(string)
	if !ok {
		return nil, errors.New("pod is required")
	}
	namespace, ok := metadata["namespace"].(string)
	if !ok {
		return nil, errors.New("namespace is required")
	}

	path := fmt.Sprintf("/api/v1/namespaces/%s/pods/%s/portforward", namespace, name)
	regexURLScheme := regexp.MustCompile(`(?i)^https?://`)
	hostIP := regexURLScheme.ReplaceAllString(clients.RestConfig.Host, "")

	transport, upgrader, err := spdy.RoundTripperFor(clients.RestConfig)
	if err != nil {
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
		return nil, err
	}

	// start the forwarder
	go func() {
		if err := fw.ForwardPorts(); err != nil {
			errCh <- err
		}
		close(errCh)
	}()

	// stop when the parent context is cancelled
	go func() {
		select {
		case <-ctx.Done():
			close(stopCh)
		case <-stopCh:
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
	clients, err := utils.KubeClientsFromContext(pctx)
	if err != nil {
		return nil, err
	}

	metadata, ok := opts.Resource.ResourceData["metadata"].(map[string]any)
	if !ok {
		return nil, errors.New("metadata is required")
	}
	namespace, ok := metadata["namespace"].(string)
	if !ok {
		return nil, errors.New("namespace is required")
	}

	resourceKey := opts.Resource.ResourceKey
	selector, err := extractPodSelector(resourceKey, opts.Resource.ResourceData)
	if err != nil {
		return nil, err
	}

	// For Services, resolve the target port through spec.ports[].targetPort.
	remotePort := opts.Options.RemotePort
	if resourceKey == "core::v1::Service" {
		if spec, ok := opts.Resource.ResourceData["spec"].(map[string]any); ok {
			if ports, ok := spec["ports"].([]any); ok {
				remotePort = resolveServiceTargetPort(ports, remotePort)
			}
		}
	}

	// Resolve the initial backing pod.
	podName, err := resolveBackingPod(ctx, clients.Clientset, namespace, selector)
	if err != nil {
		return nil, err
	}

	readyCh := make(chan struct{}, 1)
	errCh := make(chan error, 1)

	go func() {
		defer close(errCh)

		localPort := opts.Options.LocalPort
		firstAttempt := true

		for attempt := range maxReconnectAttempts {
			if err := ctx.Err(); err != nil {
				return
			}

			// On reconnect, re-resolve the backing pod.
			if !firstAttempt {
				backoff := min(time.Duration(1<<attempt)*time.Second, 30*time.Second)
				log.Printf("networker: reconnecting %s (attempt %d, backoff %s)", resourceKey, attempt+1, backoff)

				select {
				case <-ctx.Done():
					return
				case <-time.After(backoff):
				}

				podName, err = resolveBackingPod(ctx, clients.Clientset, namespace, selector)
				if err != nil {
					log.Printf("networker: failed to resolve backing pod: %v", err)
					continue
				}
			}
			firstAttempt = false

			fwErr := f.forwardToPod(ctx, clients, namespace, podName, localPort, remotePort, readyCh)
			if fwErr == nil {
				return // clean shutdown
			}
			if errors.Is(fwErr, portforward.ErrLostConnectionToPod) {
				log.Printf("networker: lost connection to pod %s/%s, will reconnect", namespace, podName)
				continue
			}
			// Unrecoverable error.
			errCh <- fwErr
			return
		}

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
	clients *kubeauth.KubeClientBundle,
	namespace, podName string,
	localPort, remotePort int32,
	readyCh chan struct{},
) error {
	path := fmt.Sprintf("/api/v1/namespaces/%s/pods/%s/portforward", namespace, podName)
	regexURLScheme := regexp.MustCompile(`(?i)^https?://`)
	hostIP := regexURLScheme.ReplaceAllString(clients.RestConfig.Host, "")

	transport, upgrader, err := spdy.RoundTripperFor(clients.RestConfig)
	if err != nil {
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
		return err
	}

	// Stop when the parent context is cancelled.
	go func() {
		select {
		case <-ctx.Done():
			close(stopCh)
		case <-stopCh:
		}
	}()

	return fw.ForwardPorts()
}
