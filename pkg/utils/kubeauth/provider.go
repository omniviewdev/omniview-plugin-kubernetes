package kubeauth

import (
	"context"
	"errors"
	"github.com/omniview/kubernetes/pkg/diag"
	"log"
	"net/http"

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
	// log.Printf("loading kube clients at path %s for context %s", kubeconfigPath, kubeContext)

	strategy, err := DetectAuthStrategy(kubeconfigPath, kubeContext)
	if err != nil {
		return nil, err
	}

	restConfig, err := strategy.BuildRestConfig(ctx, kubeconfigPath, kubeContext)
	if err != nil {
		log.Printf("failed to build rest config: %s", err.Error())
		return nil, err
	}

	// Raise rate limits from default (5 QPS / 10 burst) to avoid cascading
	// timeouts when starting many informers concurrently.
	restConfig.QPS = 50
	restConfig.Burst = 100
	restConfig.Wrap(diag.Transport)

	clientset, err := strategy.NewForConfig(restConfig)
	if err != nil {
		log.Printf("failed to build clientset config: %s", err.Error())
		return nil, err
	}

	dyn, err := strategy.NewDynamicForConfig(restConfig)
	if err != nil {
		log.Printf("failed to build dynamic config: %s", err.Error())
		return nil, err
	}

	disco, err := strategy.NewDiscoveryForConfig(restConfig)
	if err != nil {
		log.Printf("failed to build discovery config: %s", err.Error())
		return nil, err
	}

	return &KubeClientBundle{
		Clientset:  clientset,
		Discovery:  disco,
		Dynamic:    dyn,
		RestConfig: restConfig,
	}, nil
}
