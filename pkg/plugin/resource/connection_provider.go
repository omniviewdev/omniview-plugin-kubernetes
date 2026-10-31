package resource

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"go.uber.org/zap"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkutils "github.com/omniviewdev/plugin-sdk/pkg/utils"
)

type kubeConnectionProvider struct {
	logger *zap.SugaredLogger
}

// CreateClient creates a new ClientSet from the connection in context.
func (p *kubeConnectionProvider) CreateClient(ctx context.Context) (*clients.ClientSet, error) {
	session, ok := resource.SessionFromContext(ctx)
	if !ok || session.Connection == nil {
		return nil, fmt.Errorf("no session/connection in context")
	}

	bundle, err := LoadBoundedResourceClients(ctx, session.Connection)
	if err != nil {
		return nil, err
	}

	return &clients.ClientSet{
		Clientset:       bundle.Clientset,
		KubeClient:      bundle.Clientset,
		DiscoveryClient: bundle.Discovery,
		DynamicClient:   bundle.Dynamic,
		RESTConfig:      bundle.RestConfig,
		HTTPClient:      bundle.HTTPClient,
	}, nil
}

// DestroyClient stops and evicts every leased native informer source.
func (p *kubeConnectionProvider) DestroyClient(_ context.Context, client *clients.ClientSet) error {
	if client == nil {
		return nil
	}
	client.ShutdownInformers()
	return nil
}

// LoadConnections loads all available kubeconfig connections.
func (p *kubeConnectionProvider) LoadConnections(ctx context.Context) ([]types.Connection, error) {
	session, ok := resource.SessionFromContext(ctx)
	if !ok || session.PluginConfig == nil {
		return nil, fmt.Errorf("no session in context")
	}

	kubeconfigs, err := session.PluginConfig.GetStringSlice("kubeconfigs")
	if err != nil {
		return nil, fmt.Errorf("failed to get kubeconfigs from settings: %w", err)
	}

	connections := make([]types.Connection, 0, len(kubeconfigs)*EstimatedContexts)
	for _, kubeconfigPath := range kubeconfigs {
		kubeconfigConnections, err := connectionsFromKubeconfig(kubeconfigPath)
		if err != nil {
			continue
		}
		connections = append(connections, kubeconfigConnections...)
	}

	sort.Slice(connections, func(i, j int) bool {
		return connections[i].Name < connections[j].Name
	})

	return connections, nil
}

// CheckConnection validates connectivity to the cluster.
func (p *kubeConnectionProvider) CheckConnection(ctx context.Context, conn *types.Connection, client *clients.ClientSet) (types.ConnectionStatus, error) {
	if conn == nil {
		return types.ConnectionStatus{
			Connection: conn,
			Status:     types.ConnectionStatusError,
			Details:    "No connection was provided to check",
			Error:      "connection is required",
		}, nil
	}
	if client == nil {
		return types.ConnectionStatus{
			Connection: conn,
			Status:     types.ConnectionStatusError,
			Details:    "No client was provided to check the connection",
			Error:      "client is required",
		}, nil
	}

	if client.DiscoveryClient == nil {
		return types.ConnectionStatus{
			Connection: conn,
			Status:     types.ConnectionStatusError,
			Details:    "DiscoveryClient is not initialized",
			Error:      "DiscoveryClient is nil",
		}, nil
	}
	if client.DynamicClient == nil {
		return types.ConnectionStatus{
			Connection: conn,
			Status:     types.ConnectionStatusError,
			Details:    "DynamicClient is not initialized",
			Error:      "DynamicClient is nil",
		}, nil
	}

	result := types.ConnectionStatus{
		Connection: conn,
		Status:     types.ConnectionStatusUnknown,
	}

	groups := &metav1.APIGroupList{}
	err := client.DiscoveryClient.RESTClient().Get().AbsPath("/apis").Do(ctx).Into(groups)
	if err != nil {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		switch {
		case k8serrors.IsUnauthorized(err):
			result.Status = types.ConnectionStatusUnauthorized
			result.Error = "Unauthorized"
			result.Details = "You are not currently authorized to access this connection. Please check your credentials and try again."
		case k8serrors.IsForbidden(err):
			result.Status = types.ConnectionStatusForbidden
			result.Error = "Forbidden"
			result.Details = "You are forbidden from accessing this connection. Please check your permissions and try again."
		case strings.Contains(err.Error(), "getting credentials: exec: executable aws failed with exit code 255"):
			result.Status = types.ConnectionStatusUnauthorized
			result.Error = "Unauthorized"
			result.Details = "You are not currently authorized to access this connection. Please check your AWS credentials and try again."
		case strings.Contains(err.Error(), "executable aws-iam-authenticator failed with exit code 1"):
			result.Status = types.ConnectionStatusUnauthorized
			result.Error = "Unauthorized"
			result.Details = "You are not currently authorized to access this connection. Please check your AWS credentials and try again."
		case strings.Contains(err.Error(), "no such host"):
			result.Status = types.ConnectionStatusNotFound
			result.Error = "Not Found"
			result.Details = "The host was not found. Please check the host and try again."
		case strings.Contains(err.Error(), "connection refused"):
			result.Status = types.ConnectionStatusError
			result.Error = "Connection Refused"
			result.Details = "The connection was refused. Please check the host and try again."
		case strings.Contains(err.Error(), "certificate signed by unknown authority"):
			result.Status = types.ConnectionStatusError
			result.Error = "Unknown Authority"
			result.Details = "The certificate for this connection was signed by an unknown authority. Please check the certificate and try again."
		case strings.Contains(err.Error(), "certificate has expired"):
			result.Status = types.ConnectionStatusUnauthorized
			result.Error = "Certificate Expired"
			result.Details = "The certificate for this connection has expired. Please check/refresh the certificate and try again."
		default:
			result.Status = types.ConnectionStatusError
			result.Error = "Error"
			result.Details = fmt.Sprintf("Error checking connection: %v", err)
		}
		return result, nil
	}

	if err := ctx.Err(); err != nil {
		return result, err
	}

	result.Status = types.ConnectionStatusConnected
	result.Details = "Connection is valid"
	return result, nil
}

// GetNamespaces returns the available namespaces for the connection.
func (p *kubeConnectionProvider) GetNamespaces(ctx context.Context, client *clients.ClientSet) ([]string, error) {
	if client == nil || client.KubeClient == nil {
		return nil, fmt.Errorf("client is required")
	}

	namespaces := []string{}
	continuation, bytes := "", 2
	for {
		page, err := client.KubeClient.CoreV1().Namespaces().List(ctx, metav1.ListOptions{Limit: resource.MaxPageRecords, Continue: continuation})
		if err != nil {
			return nil, fmt.Errorf("failed to list namespaces: %w", err)
		}
		for _, namespace := range page.Items {
			bytes += len(namespace.Name) + 3
			if len(namespaces) >= resource.MaxValueNodes || bytes > resource.MaxDocumentBytes {
				return nil, resource.NewError("RESOURCE_LIMIT", "Namespace discovery exceeds the finite output policy")
			}
			namespaces = append(namespaces, namespace.Name)
		}
		continuation = page.Continue
		if continuation == "" {
			return namespaces, ctx.Err()
		}
	}
}

// WatchConnections watches kubeconfig files for changes.
func (p *kubeConnectionProvider) WatchConnections(ctx context.Context) (<-chan []types.Connection, error) {
	session, ok := resource.SessionFromContext(ctx)
	if !ok || session.PluginConfig == nil {
		return nil, fmt.Errorf("no session in context")
	}

	kubeconfigs, err := session.PluginConfig.GetStringSlice("kubeconfigs")
	if err != nil {
		return nil, fmt.Errorf("failed to get kubeconfigs from settings: %w", err)
	}

	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("failed to create fsnotify watcher: %w", err)
	}

	out := make(chan []types.Connection, 1)

	type watchSet struct {
		mu    sync.Mutex
		files map[string]struct{}
		dirs  map[string]struct{}
	}
	ws := &watchSet{
		files: make(map[string]struct{}),
		dirs:  make(map[string]struct{}),
	}

	addWatch := func(path string) {
		ws.mu.Lock()
		defer ws.mu.Unlock()

		expandedPath, _ := sdkutils.ExpandTilde(path)

		dir := filepath.Dir(expandedPath)
		if _, ok := ws.dirs[dir]; !ok {
			if err := w.Add(dir); err != nil {
				log.Printf("watch add (dir) %q failed: %v", dir, err)
			} else {
				ws.dirs[dir] = struct{}{}
			}
		}

		if _, ok := ws.files[expandedPath]; !ok {
			if err := w.Add(expandedPath); err != nil {
				log.Printf("watch add (file) %q failed: %v (will rely on dir watch)", expandedPath, err)
			} else {
				ws.files[expandedPath] = struct{}{}
			}
		}
	}

	for _, p := range kubeconfigs {
		addWatch(p)
	}

	pushRefresh := func() {
		conns, err := p.loadConnectionsFromPaths(kubeconfigs)
		if err != nil {
			log.Printf("LoadConnections failed during refresh: %v", err)
			return
		}
		select {
		case out <- conns:
		default:
			select {
			case <-out:
			default:
			}
			select {
			case out <- conns:
			default:
			}
		}
	}

	pushRefresh()

	const debounce = 250 * time.Millisecond
	timer := time.NewTimer(time.Hour)
	if !timer.Stop() {
		<-timer.C
	}

	go func() {
		defer func() {
			_ = w.Close()
			close(out)
		}()

		trigger := func() {
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(debounce)
		}

		for {
			select {
			case <-ctx.Done():
				return

			case ev := <-w.Events:
				for _, p := range kubeconfigs {
					ep, _ := sdkutils.ExpandTilde(p)
					if filepath.Dir(ep) == filepath.Dir(ev.Name) || ep == ev.Name {
						addWatch(p)
					}
				}
				if ev.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Remove|fsnotify.Rename|fsnotify.Chmod) != 0 {
					trigger()
				}

			case err := <-w.Errors:
				log.Printf("fsnotify error: %v", err)

			case <-timer.C:
				pushRefresh()
			}
		}
	}()

	return out, nil
}

// RefreshClient re-reads the kubeconfig and replaces all client components in-place.
func (p *kubeConnectionProvider) RefreshClient(ctx context.Context, client *clients.ClientSet) error {
	if client == nil {
		return fmt.Errorf("nil client passed to RefreshClient")
	}
	session, ok := resource.SessionFromContext(ctx)
	if !ok || session.Connection == nil {
		return fmt.Errorf("no session/connection in context")
	}

	fresh, err := LoadBoundedResourceClients(ctx, session.Connection)
	if err != nil {
		return fmt.Errorf("failed to refresh client: %w", err)
	}

	// Stop old native sources before replacing clients.
	client.ShutdownInformers()

	client.Clientset = fresh.Clientset
	client.KubeClient = fresh.Clientset
	client.DiscoveryClient = fresh.Discovery
	client.DynamicClient = fresh.Dynamic
	client.RESTConfig = fresh.RestConfig
	client.HTTPClient = fresh.HTTPClient
	client.ResetInformerLifecycle()
	return nil
}

// ResolveScope makes the configured namespace selection explicit. Failed
// discovery and an empty selection never widen acquisition to all namespaces.
func (p *kubeConnectionProvider) ResolveScope(ctx context.Context, client *clients.ClientSet) (resource.QueryScope, error) {
	session, ok := resource.SessionFromContext(ctx)
	if !ok || session.Connection == nil {
		return nil, resource.NewError("INVALID_REQUEST", "An explicit connection is required for namespace scope")
	}
	mode, _ := session.Connection.Data["watchScopeMode"].(string)
	switch mode {
	case "", "all":
		return resource.QueryScope{{Dimension: "namespace", Match: resource.ScopeAny}}, nil
	case "explicit":
		values := extractStringSlice(session.Connection.Data, "watchPartitions")
		if values == nil {
			values = []string{}
		}
		return resource.QueryScope{{Dimension: "namespace", Match: resource.ScopeOneOf, Values: &values}}, nil
	case "auto":
		values, err := p.discoverAccessibleNamespaces(ctx, client)
		if err != nil {
			return nil, err
		}
		if values == nil {
			values = []string{}
		}
		return resource.QueryScope{{Dimension: "namespace", Match: resource.ScopeOneOf, Values: &values}}, nil
	default:
		return nil, resource.NewError("INVALID_REQUEST", "Unknown Kubernetes namespace scope mode")
	}
}

// discoverAccessibleNamespaces lists namespaces the current user can access.
func (p *kubeConnectionProvider) discoverAccessibleNamespaces(ctx context.Context, client *clients.ClientSet) ([]string, error) {
	namespaces, err := p.GetNamespaces(ctx, client)
	if err != nil {
		return nil, err
	}
	sort.Strings(namespaces)
	return namespaces, nil
}

// extractStringSlice extracts a []string from a map[string]any value.
// Handles both []string and []any (JSON-decoded) representations.
func extractStringSlice(data map[string]any, key string) []string {
	val, ok := data[key]
	if !ok {
		return nil
	}

	switch v := val.(type) {
	case []string:
		return v
	case []any:
		result := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				result = append(result, s)
			}
		}
		return result
	default:
		return nil
	}
}

// loadConnectionsFromPaths loads connections from a set of kubeconfig paths (no session needed).
func (p *kubeConnectionProvider) loadConnectionsFromPaths(kubeconfigs []string) ([]types.Connection, error) {
	connections := make([]types.Connection, 0, len(kubeconfigs)*EstimatedContexts)
	for _, kubeconfigPath := range kubeconfigs {
		kubeconfigConnections, err := connectionsFromKubeconfig(kubeconfigPath)
		if err != nil {
			continue
		}
		connections = append(connections, kubeconfigConnections...)
	}

	sort.Slice(connections, func(i, j int) bool {
		return connections[i].Name < connections[j].Name
	})
	return connections, nil
}
