package helm

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"

	"helm.sh/helm/v3/pkg/action"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// Each native Helm operation owns its configuration so Background-only Helm
// APIs still use the actual RPC cancellation without caching a request context.
func newActionConfig(ctx context.Context, config *rest.Config, client *http.Client, namespace string) (*action.Configuration, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if config == nil || client == nil || client.Transport == nil {
		return nil, fmt.Errorf("Helm requires the native auth-aware bounded HTTP client")
	}
	ownedClient := *client
	ownedClient.Transport = helmRequestTransport{base: client.Transport, operation: ctx}
	getter := newRESTClientGetter(config, &ownedClient, namespace)
	driver := os.Getenv("HELM_DRIVER")
	if driver == "" {
		driver = "secrets"
	}
	cfg := new(action.Configuration)
	if err := cfg.Init(getter, namespace, driver, helmDebugSink(ctx)); err != nil {
		return nil, fmt.Errorf("failed to initialize Helm action configuration: %w", err)
	}
	return cfg, nil
}

type helmRequestTransport struct {
	base      http.RoundTripper
	operation context.Context
}

func (t helmRequestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if err := t.operation.Err(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(request.Context())
	stop := context.AfterFunc(t.operation, cancel)
	release := func() { stop(); cancel() }
	response, err := t.base.RoundTrip(request.WithContext(ctx))
	if err != nil {
		release()
		return nil, err
	}
	if response.Body == nil {
		release()
		return response, nil
	}
	response.Body = helmRequestBody{ReadCloser: response.Body, release: release}
	return response, nil
}

type helmRequestBody struct {
	io.ReadCloser
	release func()
}

func (b helmRequestBody) Read(buffer []byte) (int, error) {
	count, err := b.ReadCloser.Read(buffer)
	if err != nil {
		b.release()
	}
	return count, err
}

func (b helmRequestBody) Close() error { b.release(); return b.ReadCloser.Close() }

// restClientGetter implements genericclioptions.RESTClientGetter
// using an existing rest.Config from the K8s plugin's ClientSet.
type restClientGetter struct {
	restConfig *rest.Config
	httpClient *http.Client
	namespace  string
}

func newRESTClientGetter(cfg *rest.Config, client *http.Client, namespace string) *restClientGetter {
	// This HTTP-only config carries the existing complete transport. Authentication
	// and TLS are already inside it; do not reconstruct exec/EKS or a default
	// transport. Clearing duplicate TLS options is required by client-go's custom
	// Transport validation, and never mutates the original native configuration.
	config := rest.AnonymousClientConfig(cfg)
	config.TLSClientConfig = rest.TLSClientConfig{}
	config.Transport = client.Transport
	config.WrapTransport = nil
	return &restClientGetter{restConfig: config, httpClient: client, namespace: namespace}
}

func (g *restClientGetter) ToRESTConfig() (*rest.Config, error) {
	return g.restConfig, nil
}

func (g *restClientGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	dc, err := discovery.NewDiscoveryClientForConfigAndClient(g.restConfig, g.httpClient)
	if err != nil {
		return nil, err
	}
	return memory.NewMemCacheClient(dc), nil
}

func (g *restClientGetter) ToRESTMapper() (meta.RESTMapper, error) {
	dc, err := g.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	return restmapper.NewDeferredDiscoveryRESTMapper(dc), nil
}

func (g *restClientGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	return &simpleClientConfig{namespace: g.namespace}
}

// simpleClientConfig satisfies clientcmd.ClientConfig with just a namespace.
type simpleClientConfig struct {
	namespace string
}

func (c *simpleClientConfig) RawConfig() (clientcmdapi.Config, error) {
	return clientcmdapi.Config{}, nil
}

func (c *simpleClientConfig) ClientConfig() (*rest.Config, error) {
	return nil, fmt.Errorf("not supported")
}

func (c *simpleClientConfig) Namespace() (string, bool, error) {
	return c.namespace, true, nil
}

func (c *simpleClientConfig) ConfigAccess() clientcmd.ConfigAccess {
	return nil
}
