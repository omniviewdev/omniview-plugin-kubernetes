package networker

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"

	"github.com/omniview/kubernetes/pkg/utils"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"

	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
)

func Register(plugin *sdk.Plugin) {
	portForwarders := map[string]networker.ResourceForwarder{
		"core::v1::Pod": &PodResourceForwarder{},
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
