package kubeauth

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"go.opentelemetry.io/otel/attribute"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

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
		// timeouts when starting many informers concurrently.
		restConfig.QPS = 50
		restConfig.Burst = 100
		restConfig.Wrap(diag.Transport)

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
