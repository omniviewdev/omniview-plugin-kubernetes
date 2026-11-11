package helm

import (
	"context"
	sqldriver "database/sql/driver"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/lib/pq"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/kube"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// Each native Helm operation owns its configuration. Kubernetes Background-only
// APIs use the actual RPC cancellation; Helm's native SQL write APIs do not.
func newActionConfig(ctx context.Context, config *rest.Config, client *http.Client, namespace string) (*action.Configuration, error) {
	getter, err := newHelmOperationGetter(ctx, config, client, namespace)
	if err != nil {
		return nil, err
	}
	driver := os.Getenv("HELM_DRIVER")
	if driver == "" {
		driver = "secrets"
	}
	if driver == "sql" {
		getter.sqlConnector, err = newHelmSQLConnector()
		if err != nil {
			return nil, err
		}
	}
	cfg := new(action.Configuration)
	if err := cfg.Init(getter, namespace, driver, helmDebugSink(ctx)); err != nil {
		return nil, fmt.Errorf("failed to initialize Helm action configuration: %w", err)
	}
	return cfg, nil
}

// newNamedReleaseConfig avoids Helm's context-free SQL connection and migrations.
// SQL configurations are named-read-only: Releases is deliberately unset, so no
// native action can silently write through a different storage driver.
func newNamedReleaseConfig(ctx context.Context, config *rest.Config, client *http.Client, namespace string) (*action.Configuration, error) {
	if os.Getenv("HELM_DRIVER") != "sql" {
		return newActionConfig(ctx, config, client, namespace)
	}
	getter, err := newHelmOperationGetter(ctx, config, client, namespace)
	if err != nil {
		return nil, err
	}
	getter.sqlConnector, err = newHelmSQLConnector()
	if err != nil {
		return nil, err
	}
	log := helmDebugSink(ctx)
	kubeClient := kube.New(getter)
	kubeClient.Log = log
	return &action.Configuration{RESTClientGetter: getter, KubeClient: kubeClient, Log: log}, nil
}

func newHelmOperationGetter(ctx context.Context, config *rest.Config, client *http.Client, namespace string) (*restClientGetter, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if config == nil || client == nil || client.Transport == nil {
		return nil, fmt.Errorf("Helm requires the native auth-aware bounded HTTP client")
	}
	ownedClient := *client
	ownedClient.Transport = helmRequestTransport{base: client.Transport, operation: ctx}
	return newRESTClientGetter(config, &ownedClient, namespace), nil
}

type helmSQLConnector struct {
	config pq.Config
}

func newHelmSQLConnector() (*helmSQLConnector, error) {
	config, err := pq.NewConfig(os.Getenv("HELM_DRIVER_SQL_CONNECTION_STRING"))
	if err != nil {
		return nil, err
	}
	return &helmSQLConnector{config: config}, nil
}

func (connector *helmSQLConnector) Driver() sqldriver.Driver { return &pq.Driver{} }

func (connector *helmSQLConnector) Connect(ctx context.Context) (sqldriver.Conn, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	native, err := pq.NewConnectorConfig(connector.config.Clone())
	if err != nil {
		return nil, err
	}
	dialer := &helmSQLConnectDialer{operation: ctx}
	native.Dialer(dialer)
	connection, err := native.Connect(ctx)
	dialer.finish()
	if canceled := ctx.Err(); canceled != nil {
		if err == nil && connection != nil {
			_ = connection.Close()
		}
		return nil, canceled
	}
	return connection, err
}

// pq only uses Connect's context for dialing, not SSL/startup or session checks.
// Its supported dialer hook closes stalled startup sockets on cancellation.
type helmSQLConnectDialer struct {
	net.Dialer
	operation context.Context
	release   func()
}

func (dialer *helmSQLConnectDialer) DialTimeout(network, address string, timeout time.Duration) (net.Conn, error) {
	ctx := dialer.operation
	if ctx == nil {
		ctx = context.Background()
	}
	if timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}
	return dialer.DialContext(ctx, network, address)
}

func (dialer *helmSQLConnectDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	if dialer.release != nil {
		dialer.release()
		dialer.release = nil
	}
	connection, err := dialer.Dialer.DialContext(ctx, network, address)
	if err != nil || dialer.operation == nil {
		return connection, err
	}
	closed := make(chan struct{})
	stop := context.AfterFunc(dialer.operation, func() {
		_ = connection.Close()
		close(closed)
	})
	dialer.release = func() {
		if !stop() {
			<-closed
		}
	}
	return connection, nil
}

func (dialer *helmSQLConnectDialer) finish() {
	if dialer.release != nil {
		dialer.release()
		dialer.release = nil
	}
	// pq retains this dialer for later query-cancellation packets. Those must
	// use pq's independent cancellation context, not the completed Connect.
	dialer.operation = nil
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
	restConfig   *rest.Config
	httpClient   *http.Client
	namespace    string
	sqlConnector *helmSQLConnector
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
