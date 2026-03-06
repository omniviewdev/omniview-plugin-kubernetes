package resource

import (
	"context"
	"encoding/json"
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
	"github.com/omniview/kubernetes/pkg/utils"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/dynamic/dynamicinformer"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkutils "github.com/omniviewdev/plugin-sdk/pkg/utils"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// Compile-time interface checks.
var (
	_ resource.ConnectionProvider[clients.ClientSet] = (*kubeConnectionProvider)(nil)
	_ resource.ConnectionWatcher                     = (*kubeConnectionProvider)(nil)
	_ resource.ClientRefresher[clients.ClientSet]    = (*kubeConnectionProvider)(nil)
	_ resource.SchemaProvider[clients.ClientSet]      = (*kubeConnectionProvider)(nil)
	_ resource.ScopeProvider[clients.ClientSet]       = (*kubeConnectionProvider)(nil)
)

type kubeConnectionProvider struct {
	logger *zap.SugaredLogger
}

// CreateClient creates a new ClientSet from the connection in context.
func (p *kubeConnectionProvider) CreateClient(ctx context.Context) (*clients.ClientSet, error) {
	session := resource.SessionFromContext(ctx)
	if session == nil || session.Connection == nil {
		return nil, fmt.Errorf("no session/connection in context")
	}

	bundle, err := utils.KubeClientsFromConnection(session.Connection)
	if err != nil {
		return nil, err
	}

	return &clients.ClientSet{
		Clientset:              bundle.Clientset,
		KubeClient:             bundle.Clientset,
		DiscoveryClient:        bundle.Discovery,
		DynamicClient:          bundle.Dynamic,
		DynamicInformerFactory: bundle.InformerFactory,
		RESTConfig:             bundle.RestConfig,
	}, nil
}

// DestroyClient shuts down all informer factories (main + per-namespace).
func (p *kubeConnectionProvider) DestroyClient(_ context.Context, client *clients.ClientSet) error {
	if client == nil {
		return nil
	}
	// Shut down per-namespace factories first.
	client.ShutdownNamespaceFactories()
	// Signal the main factory to stop, then shut it down.
	client.StopFactory()
	if client.DynamicInformerFactory != nil {
		client.DynamicInformerFactory.Shutdown()
	}
	return nil
}

// LoadConnections loads all available kubeconfig connections.
func (p *kubeConnectionProvider) LoadConnections(ctx context.Context) ([]types.Connection, error) {
	session := resource.SessionFromContext(ctx)
	if session == nil || session.PluginConfig == nil {
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
func (p *kubeConnectionProvider) CheckConnection(_ context.Context, conn *types.Connection, client *clients.ClientSet) (types.ConnectionStatus, error) {
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

	result := types.ConnectionStatus{
		Connection: conn,
		Status:     types.ConnectionStatusUnknown,
	}

	groups, err := client.DiscoveryClient.ServerGroups()
	if err != nil {
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

	enrichConnectionData(conn, client, groups)

	result.Status = types.ConnectionStatusConnected
	result.Details = "Connection is valid"
	return result, nil
}

// GetNamespaces returns the available namespaces for the connection.
func (p *kubeConnectionProvider) GetNamespaces(_ context.Context, client *clients.ClientSet) ([]string, error) {
	lister := client.DynamicInformerFactory.
		ForResource(corev1.SchemeGroupVersion.WithResource("namespaces")).
		Lister()

	resources, err := lister.List(labels.Everything())
	if err != nil {
		return nil, err
	}

	namespaces := make([]string, 0, len(resources))
	for _, r := range resources {
		obj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(r)
		if err != nil {
			return nil, err
		}
		res := unstructured.Unstructured{Object: obj}
		namespaces = append(namespaces, res.GetName())
	}

	return namespaces, nil
}

// WatchConnections watches kubeconfig files for changes.
func (p *kubeConnectionProvider) WatchConnections(ctx context.Context) (<-chan []types.Connection, error) {
	session := resource.SessionFromContext(ctx)
	if session == nil || session.PluginConfig == nil {
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
				ws.files[path] = struct{}{}
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
					if filepath.Dir(p) == filepath.Dir(ev.Name) || p == ev.Name {
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
	session := resource.SessionFromContext(ctx)
	if session == nil || session.Connection == nil {
		return fmt.Errorf("no session/connection in context")
	}

	fresh, err := utils.KubeClientsFromConnection(session.Connection)
	if err != nil {
		return fmt.Errorf("failed to refresh client: %w", err)
	}

	// Shut down old namespace factories before replacing the dynamic client.
	client.ShutdownNamespaceFactories()

	client.Clientset = fresh.Clientset
	client.KubeClient = fresh.Clientset
	client.DiscoveryClient = fresh.Discovery
	client.DynamicClient = fresh.Dynamic
	client.RESTConfig = fresh.RestConfig
	client.DynamicInformerFactory = dynamicinformer.NewDynamicSharedInformerFactory(
		fresh.Dynamic,
		clients.DefaultResyncPeriod,
	)
	return nil
}

// ResolveScope implements resource.ScopeProvider[clients.ClientSet].
// Reads scope configuration from the Connection.Data map:
//   - watchScopeMode: "all" (default), "explicit", or "auto"
//   - watchPartitions: list of namespace names (for "explicit" mode)
//
// For "auto" mode, discovers accessible namespaces via the K8s API.
func (p *kubeConnectionProvider) ResolveScope(ctx context.Context, client *clients.ClientSet) (resource.ScopeMode, []string, error) {
	session := resource.SessionFromContext(ctx)
	if session == nil || session.Connection == nil {
		return resource.ScopeModeAll, nil, nil
	}

	data := session.Connection.Data
	if data == nil {
		return resource.ScopeModeAll, nil, nil
	}

	modeStr, _ := data["watchScopeMode"].(string)
	switch strings.ToLower(modeStr) {
	case "explicit":
		partitions := extractStringSlice(data, "watchPartitions")
		if len(partitions) == 0 {
			log.Printf("[k8s-scope] explicit mode but no watchPartitions, falling back to all")
			return resource.ScopeModeAll, nil, nil
		}
		log.Printf("[k8s-scope] explicit mode: %d namespaces", len(partitions))
		return resource.ScopeModeExplicit, partitions, nil

	case "auto":
		namespaces, err := p.discoverAccessibleNamespaces(ctx, client)
		if err != nil {
			log.Printf("[k8s-scope] auto-discover failed, falling back to all: %v", err)
			return resource.ScopeModeAll, nil, nil
		}
		if len(namespaces) == 0 {
			log.Printf("[k8s-scope] auto-discover found 0 namespaces, falling back to all")
			return resource.ScopeModeAll, nil, nil
		}
		log.Printf("[k8s-scope] auto-discover: %d namespaces", len(namespaces))
		return resource.ScopeModeAutoDiscover, namespaces, nil

	default:
		return resource.ScopeModeAll, nil, nil
	}
}

// discoverAccessibleNamespaces lists namespaces the current user can access.
func (p *kubeConnectionProvider) discoverAccessibleNamespaces(ctx context.Context, client *clients.ClientSet) ([]string, error) {
	nsList, err := client.KubeClient.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list namespaces: %w", err)
	}

	namespaces := make([]string, 0, len(nsList.Items))
	for _, ns := range nsList.Items {
		namespaces = append(namespaces, ns.Name)
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

// GetEditorSchemas returns OpenAPI schemas from the cluster for editor validation.
func (p *kubeConnectionProvider) GetEditorSchemas(ctx context.Context, client *clients.ClientSet) ([]resource.EditorSchema, error) {
	session := resource.SessionFromContext(ctx)
	if session == nil || session.Connection == nil {
		return nil, fmt.Errorf("no connection in context")
	}

	registeredKeys := make([]string, 0, len(resourceMap))
	for key := range resourceMap {
		registeredKeys = append(registeredKeys, key)
	}

	return fetchOpenAPISchemasV1(session.Connection.ID, client, registeredKeys)
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

// fetchOpenAPISchemasV1 fetches schemas using v1 SDK types.
func fetchOpenAPISchemasV1(connectionID string, client *clients.ClientSet, registeredKeys []string) ([]resource.EditorSchema, error) {
	log.Printf("[FetchOpenAPISchemas] fetching schemas for %d keys, connection=%s",
		len(registeredKeys), connectionID)

	openapiv3Client := client.Clientset.Discovery().OpenAPIV3()
	paths, err := openapiv3Client.Paths()
	if err != nil {
		return nil, fmt.Errorf("failed to get OpenAPI v3 paths: %w", err)
	}

	type gvKey struct {
		group   string
		version string
	}
	gvToKeys := make(map[gvKey][]string)
	for _, key := range registeredKeys {
		meta := resource.ResourceMetaFromString(key)
		if meta.Group == "" || meta.Version == "" || meta.Kind == "" {
			continue
		}
		gv := gvKey{group: meta.Group, version: meta.Version}
		gvToKeys[gv] = append(gvToKeys[gv], key)
	}

	var schemas []resource.EditorSchema

	for gv, keys := range gvToKeys {
		var openAPIPath string
		if gv.group == "core" {
			openAPIPath = fmt.Sprintf("api/%s", gv.version)
		} else {
			found := false
			for pathKey := range paths {
				if matchesGroupVersion(pathKey, gv.group, gv.version) {
					openAPIPath = pathKey
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}

		pathItem, ok := paths[openAPIPath]
		if !ok {
			continue
		}

		schemaBytes, err := pathItem.Schema("application/json")
		if err != nil {
			continue
		}

		var schemaDoc map[string]interface{}
		if err := json.Unmarshal(schemaBytes, &schemaDoc); err != nil {
			continue
		}

		components, _ := schemaDoc["components"].(map[string]interface{})
		if components == nil {
			continue
		}
		defs, _ := components["schemas"].(map[string]interface{})
		if defs == nil {
			continue
		}

		for _, key := range keys {
			meta := resource.ResourceMetaFromString(key)
			defKey := findDefinitionKeyV1(defs, meta)
			if defKey == "" {
				continue
			}

			def, ok := defs[defKey]
			if !ok {
				continue
			}

			defBytes, err := json.Marshal(def)
			if err != nil {
				continue
			}

			schemas = append(schemas, resource.EditorSchema{
				ResourceKey: key,
				FileMatch:   fmt.Sprintf("**/%s/*.yaml", key),
				URI:         fmt.Sprintf("k8s://%s/%s/%s/%s", connectionID, meta.Group, meta.Version, meta.Kind),
				Content:     defBytes,
				Language:    "yaml",
			})
		}
	}

	return schemas, nil
}

func findDefinitionKeyV1(defs map[string]interface{}, meta resource.ResourceMeta) string {
	group := meta.Group
	if group == "core" {
		group = "core"
	}
	primary := fmt.Sprintf("io.k8s.api.%s.%s.%s", group, meta.Version, meta.Kind)
	if _, ok := defs[primary]; ok {
		return primary
	}

	suffix := "." + meta.Kind
	for key := range defs {
		if strings.HasSuffix(key, suffix) && strings.Contains(key, meta.Version) {
			return key
		}
	}
	return ""
}

// The following functions are reused from connections.go (kept as-is for backward compat):
// - connectionsFromKubeconfig
// - enrichConnectionLabels
// - enrichConnectionData
// - enrichEKSLabels, enrichGKELabels, enrichAKSLabels
