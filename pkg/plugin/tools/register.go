// Package tools exposes a small set of cluster tools to AI assistants through
// the host MCP relay. Every tool is connection-scoped: the host resolves the
// cluster connection and the tool acts on that cluster only.
package tools

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdktools "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

const (
	defaultListLimit = 100
	maxListLimit     = 500
	defaultTailLines = 200
	maxTailLines     = 5000
	maxLogBytes      = 1 << 20
)

// Register adds the kubernetes tools capability to the plugin.
func Register(plugin *sdk.Plugin) {
	if err := sdktools.RegisterPlugin(plugin, sdktools.PluginOpts{Tools: Tools(defaultClientProvider)}); err != nil {
		panic(err)
	}
}

// Tools builds the tool set with the given client provider.
func Tools(clients ClientProvider) []sdktools.Tool {
	return []sdktools.Tool{
		{
			Descriptor: sdktools.Descriptor{
				Name:        "list_namespaces",
				Title:       "List namespaces",
				Description: "List the namespaces of the selected Kubernetes cluster.",
				InputSchema: sdktools.ObjectSchema(nil),
				Scope:       sdktools.ScopeConnection,
				Annotations: sdktools.Annotations{ReadOnly: true, Idempotent: true},
			},
			Handler: withClients(clients, listNamespaces),
		},
		{
			Descriptor: sdktools.Descriptor{
				Name:        "list_resources",
				Title:       "List resources",
				Description: "List resources of one kind, optionally filtered by namespace and label selector. Returns names and metadata only.",
				InputSchema: sdktools.ObjectSchema(map[string]any{
					"apiVersion":    map[string]any{"type": "string", "description": "API version, for example v1 or apps/v1"},
					"kind":          map[string]any{"type": "string", "description": "Kind, for example Pod or Deployment"},
					"namespace":     map[string]any{"type": "string", "description": "Namespace; empty lists every namespace"},
					"labelSelector": map[string]any{"type": "string", "description": "Label selector, for example app=web"},
					"limit":         map[string]any{"type": "integer", "description": "Maximum items (default 100, max 500)", "minimum": 1, "maximum": maxListLimit},
				}, "apiVersion", "kind"),
				Scope:       sdktools.ScopeConnection,
				Annotations: sdktools.Annotations{ReadOnly: true, Idempotent: true},
			},
			Handler: withClients(clients, listResources),
		},
		{
			Descriptor: sdktools.Descriptor{
				Name:        "get_resource",
				Title:       "Get resource",
				Description: "Get one resource as JSON (managedFields removed).",
				InputSchema: sdktools.ObjectSchema(map[string]any{
					"apiVersion": map[string]any{"type": "string"},
					"kind":       map[string]any{"type": "string"},
					"namespace":  map[string]any{"type": "string", "description": "Required for namespaced kinds"},
					"name":       map[string]any{"type": "string"},
				}, "apiVersion", "kind", "name"),
				Scope:       sdktools.ScopeConnection,
				Annotations: sdktools.Annotations{ReadOnly: true, Idempotent: true},
			},
			Handler: withClients(clients, getResource),
		},
		{
			Descriptor: sdktools.Descriptor{
				Name:        "get_pod_logs",
				Title:       "Get pod logs",
				Description: "Read the last lines of a container log. Output is cut at 1 MiB.",
				InputSchema: sdktools.ObjectSchema(map[string]any{
					"namespace": map[string]any{"type": "string"},
					"name":      map[string]any{"type": "string", "description": "Pod name"},
					"container": map[string]any{"type": "string", "description": "Container name; defaults to the first container"},
					"tailLines": map[string]any{"type": "integer", "description": "Lines from the end (default 200, max 5000)", "minimum": 1, "maximum": maxTailLines},
					"previous":  map[string]any{"type": "boolean", "description": "Read the previous (crashed) container instance"},
				}, "namespace", "name"),
				Scope:       sdktools.ScopeConnection,
				Annotations: sdktools.Annotations{ReadOnly: true},
			},
			Handler: withClients(clients, getPodLogs),
		},
		{
			Descriptor: sdktools.Descriptor{
				Name:        "delete_resource",
				Title:       "Delete resource",
				Description: "Delete one resource. This cannot be undone.",
				InputSchema: sdktools.ObjectSchema(map[string]any{
					"apiVersion": map[string]any{"type": "string"},
					"kind":       map[string]any{"type": "string"},
					"namespace":  map[string]any{"type": "string", "description": "Required for namespaced kinds"},
					"name":       map[string]any{"type": "string"},
				}, "apiVersion", "kind", "name"),
				Scope:       sdktools.ScopeConnection,
				Annotations: sdktools.Annotations{Destructive: true},
			},
			Handler: withClients(clients, deleteResource),
		},
	}
}

type handler[Args any] func(ctx *types.PluginContext, clients *Clients, args Args) (*sdktools.Result, error)

// withClients decodes the arguments and resolves the cluster clients before
// the tool runs. Argument and API errors become tool error results so the
// model can read them.
func withClients[Args any](provider ClientProvider, run handler[Args]) sdktools.Handler {
	return func(ctx *types.PluginContext, raw json.RawMessage) (*sdktools.Result, error) {
		var args Args
		if len(raw) > 0 {
			decoder := json.NewDecoder(strings.NewReader(string(raw)))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&args); err != nil {
				return sdktools.ErrorResult("invalid arguments: %v", err), nil
			}
		}
		clients, err := provider(ctx)
		if err != nil {
			return sdktools.ErrorResult("cannot connect to the cluster: %v", err), nil
		}
		return run(ctx, clients, args)
	}
}

func listNamespaces(ctx *types.PluginContext, clients *Clients, _ struct{}) (*sdktools.Result, error) {
	list, err := clients.Core.Namespaces().List(ctx.Context, metav1.ListOptions{})
	if err != nil {
		return sdktools.ErrorResult("%v", err), nil
	}
	names := make([]string, 0, len(list.Items))
	for _, item := range list.Items {
		names = append(names, item.Name)
	}
	return sdktools.JSONResult(map[string]any{"namespaces": names})
}

type resourceArgs struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Namespace  string `json:"namespace"`
	Name       string `json:"name"`
}

func (a resourceArgs) validate(needName bool) error {
	if a.APIVersion == "" || a.Kind == "" {
		return errors.New("apiVersion and kind are required")
	}
	if needName && a.Name == "" {
		return errors.New("name is required")
	}
	return nil
}

type listResourcesArgs struct {
	resourceArgs
	LabelSelector string `json:"labelSelector"`
	Limit         int64  `json:"limit"`
}

type resourceSummary struct {
	Namespace         string            `json:"namespace,omitempty"`
	Name              string            `json:"name"`
	CreationTimestamp string            `json:"creationTimestamp"`
	Labels            map[string]string `json:"labels,omitempty"`
}

func listResources(ctx *types.PluginContext, clients *Clients, args listResourcesArgs) (*sdktools.Result, error) {
	if err := args.validate(false); err != nil {
		return sdktools.ErrorResult("%v", err), nil
	}
	limit := args.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}
	gvr, namespaced, err := clients.resourceMapping(args.APIVersion, args.Kind)
	if err != nil {
		return sdktools.ErrorResult("%v", err), nil
	}
	client := clients.Dynamic.Resource(gvr)
	var list *unstructured.UnstructuredList
	options := metav1.ListOptions{LabelSelector: args.LabelSelector, Limit: limit}
	if namespaced {
		list, err = client.Namespace(args.Namespace).List(ctx.Context, options)
	} else {
		list, err = client.List(ctx.Context, options)
	}
	if err != nil {
		return sdktools.ErrorResult("%v", err), nil
	}
	items := make([]resourceSummary, 0, len(list.Items))
	truncated := list.GetContinue() != ""
	for _, item := range list.Items {
		if int64(len(items)) >= limit {
			truncated = true
			break
		}
		items = append(items, resourceSummary{
			Namespace:         item.GetNamespace(),
			Name:              item.GetName(),
			CreationTimestamp: item.GetCreationTimestamp().UTC().Format("2006-01-02T15:04:05Z"),
			Labels:            item.GetLabels(),
		})
	}
	return sdktools.JSONResult(map[string]any{"items": items, "truncated": truncated})
}

func getResource(ctx *types.PluginContext, clients *Clients, args resourceArgs) (*sdktools.Result, error) {
	if err := args.validate(true); err != nil {
		return sdktools.ErrorResult("%v", err), nil
	}
	gvr, namespaced, err := clients.resourceMapping(args.APIVersion, args.Kind)
	if err != nil {
		return sdktools.ErrorResult("%v", err), nil
	}
	if namespaced && args.Namespace == "" {
		return sdktools.ErrorResult("namespace is required for %s", args.Kind), nil
	}
	client := clients.Dynamic.Resource(gvr)
	var object *unstructured.Unstructured
	if namespaced {
		object, err = client.Namespace(args.Namespace).Get(ctx.Context, args.Name, metav1.GetOptions{})
	} else {
		object, err = client.Get(ctx.Context, args.Name, metav1.GetOptions{})
	}
	if err != nil {
		return sdktools.ErrorResult("%v", err), nil
	}
	unstructured.RemoveNestedField(object.Object, "metadata", "managedFields")
	return sdktools.JSONResult(object.Object)
}

type podLogsArgs struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Container string `json:"container"`
	TailLines int64  `json:"tailLines"`
	Previous  bool   `json:"previous"`
}

func getPodLogs(ctx *types.PluginContext, clients *Clients, args podLogsArgs) (*sdktools.Result, error) {
	if args.Namespace == "" || args.Name == "" {
		return sdktools.ErrorResult("namespace and name are required"), nil
	}
	tail := args.TailLines
	if tail <= 0 {
		tail = defaultTailLines
	}
	if tail > maxTailLines {
		tail = maxTailLines
	}
	options := &corev1.PodLogOptions{Container: args.Container, TailLines: &tail, Previous: args.Previous}
	stream, err := clients.Core.Pods(args.Namespace).GetLogs(args.Name, options).Stream(ctx.Context)
	if err != nil {
		return sdktools.ErrorResult("%v", err), nil
	}
	defer func() { _ = stream.Close() }()
	data, err := io.ReadAll(io.LimitReader(stream, maxLogBytes+1))
	if err != nil {
		return sdktools.ErrorResult("read logs: %v", err), nil
	}
	text := string(data)
	if len(data) > maxLogBytes {
		text = string(data[:maxLogBytes]) + "\n[truncated]"
	}
	return sdktools.TextResult(text), nil
}

func deleteResource(ctx *types.PluginContext, clients *Clients, args resourceArgs) (*sdktools.Result, error) {
	if err := args.validate(true); err != nil {
		return sdktools.ErrorResult("%v", err), nil
	}
	gvr, namespaced, err := clients.resourceMapping(args.APIVersion, args.Kind)
	if err != nil {
		return sdktools.ErrorResult("%v", err), nil
	}
	if namespaced && args.Namespace == "" {
		return sdktools.ErrorResult("namespace is required for %s", args.Kind), nil
	}
	client := clients.Dynamic.Resource(gvr)
	if namespaced {
		err = client.Namespace(args.Namespace).Delete(ctx.Context, args.Name, metav1.DeleteOptions{})
	} else {
		err = client.Delete(ctx.Context, args.Name, metav1.DeleteOptions{})
	}
	if err != nil {
		return sdktools.ErrorResult("%v", err), nil
	}
	if namespaced {
		return sdktools.TextResult(fmt.Sprintf("Deleted %s/%s in %s", args.Kind, args.Name, args.Namespace)), nil
	}
	return sdktools.TextResult(fmt.Sprintf("Deleted %s/%s", args.Kind, args.Name)), nil
}
