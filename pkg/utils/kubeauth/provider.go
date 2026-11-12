package kubeauth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"runtime"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/pluginid"
	"go.opentelemetry.io/otel/attribute"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/util/flowcontrol"
)

const (
	// ConnectionQPS and ConnectionBurst are the API request limits for one
	// connection's client bundle. Client-go builds a separate token bucket for
	// every client it constructs from a config, so the bundle shares one
	// limiter (rest.Config.RateLimiter, which overrides QPS/Burst) to make
	// these the total for the clientset, dynamic, discovery and streaming
	// clients together. A watch takes one token when it starts, so sharing
	// with the streaming clientset only throttles watch (re)starts against
	// other traffic, never an established stream.
	ConnectionQPS   float32 = 50
	ConnectionBurst         = 100
)

// newConnectionRateLimiter builds the limiter shared by one client bundle.
// It is a variable so tests can observe which requests consult it.
var newConnectionRateLimiter = func() flowcontrol.RateLimiter {
	return flowcontrol.NewTokenBucketRateLimiter(ConnectionQPS, ConnectionBurst)
}

// userAgent identifies this plugin's API traffic in server audit logs.
func userAgent() string {
	return fmt.Sprintf("omniview-%s/%s (%s/%s)", pluginid.ID, pluginid.Version, runtime.GOOS, runtime.GOARCH)
}

// userAgentTransport sets the plugin user agent on requests that carry none.
// Clients built from a pre-authenticated http.Client (EKS) ignore
// rest.Config.UserAgent, so the header is applied on the transport instead.
type userAgentTransport struct {
	base http.RoundTripper
}

func (t *userAgentTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	base := t.base
	if base == nil {
		base = http.DefaultTransport
	}
	if req.Header.Get("User-Agent") == "" {
		req = req.Clone(req.Context())
		req.Header.Set("User-Agent", userAgent())
	}
	return base.RoundTrip(req)
}

// setEKSUserAgent applies the plugin user agent to the pre-authenticated EKS
// http client, whose transport is fixed before client-go reads the config.
func setEKSUserAgent(client *http.Client) {
	client.Transport = &userAgentTransport{base: client.Transport}
}

type KubeClientBundle struct {
	Clientset  *kubernetes.Clientset
	Discovery  discovery.DiscoveryInterface
	Dynamic    dynamic.Interface
	RestConfig *rest.Config
	// HTTPClient is the auth-aware bounded client for resource-only bundles.
	// Use it with RestConfig when constructing additional finite resource clients.
	HTTPClient *http.Client
	// StreamingClientset shares this generation's authentication, without resource body budgets.
	StreamingClientset  *kubernetes.Clientset
	StreamingHTTPClient *http.Client
}

// LoadKubeClients loads the various clients necessary to interact with the api, given a kubeconfig path and
// and active kubeconfig context to use
func LoadKubeClients(ctx context.Context, kubeconfigPath string, kubeContext string) (*KubeClientBundle, error) {
	if ctx == nil {
		return nil, errors.New("native client construction requires a context")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	ctx, span := diag.Tracer().Start(ctx, "kubernetes.client.build")
	span.SetAttributes(attribute.String("connection", kubeContext))
	started := time.Now()
	logger := authLogger()
	strategyName := "unknown"
	operation := "detect"

	bundle, err := func() (*KubeClientBundle, error) {
		strategy, err := DetectAuthStrategy(kubeconfigPath, kubeContext)
		if err != nil {
			return nil, err
		}
		strategyName = authStrategyName(strategy)
		span.SetAttributes(attribute.String("auth.strategy", strategyName))
		span.AddEvent("strategy_detected")

		operation = "rest_config"
		restConfig, err := strategy.BuildRestConfig(ctx, kubeconfigPath, kubeContext)
		if err != nil {
			return nil, err
		}
		span.AddEvent("rest_config")

		// Raise rate limits from default (5 QPS / 10 burst) to avoid cascading
		// timeouts when starting many informers concurrently. One limiter is
		// shared by every client built from this config.
		restConfig.QPS = ConnectionQPS
		restConfig.Burst = ConnectionBurst
		restConfig.RateLimiter = newConnectionRateLimiter()
		restConfig.UserAgent = userAgent()
		restConfig.Wrap(diag.Transport)
		if eks, ok := strategy.(*EKSAuthStrategy); ok && !eks.useDefault {
			setEKSUserAgent(eks.httpClient)
		}

		operation = "clientset"
		clientset, err := strategy.NewForConfig(restConfig)
		if err != nil {
			return nil, err
		}
		span.AddEvent("clientset")

		operation = "dynamic"
		dyn, err := strategy.NewDynamicForConfig(restConfig)
		if err != nil {
			return nil, err
		}
		span.AddEvent("dynamic")

		operation = "discovery"
		disco, err := strategy.NewDiscoveryForConfig(restConfig)
		if err != nil {
			return nil, err
		}
		span.AddEvent("discovery")

		operation = "complete"
		return &KubeClientBundle{
			Clientset:  clientset,
			Discovery:  disco,
			Dynamic:    dyn,
			RestConfig: restConfig,
		}, nil
	}()

	span.SetAttributes(attribute.String("operation", operation))
	c := diag.EndSpan(span, err, false)
	diag.ClientBuild(operation, c.Outcome)
	fields := append([]any{"connection", kubeContext, "operation", operation, "auth_strategy", strategyName,
		"duration_ms", time.Since(started).Milliseconds()}, c.LogFields()...)
	if err != nil {
		logger.Warnw(ctx, "kubernetes client build failed", fields...)
		return nil, err
	}
	logger.Debugw(ctx, "kubernetes clients built", fields...)
	return bundle, nil
}
