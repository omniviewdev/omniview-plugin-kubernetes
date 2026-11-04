package resource

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/tools/clientcmd"
)

const p08Group = "discovery.fixture.omniview.dev"

var p08Namespace string

// TestNativeDiscoveryAcceptance is intentionally opt-in. The owning script checks
// both containers and private kubeconfigs before allowing this destructive test.
// No fake discovery, dynamic client, schema, or CRUD handler enters this path.
func TestNativeDiscoveryAcceptance(t *testing.T) {
	root := os.Getenv("P08_NATIVE_ROOT")
	if root == "" {
		t.Skip("use node hack/discovery-native.mjs exercise with two owned sandboxes")
	}
	p08Namespace = "p08-native-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()
	provider, err := newKubernetesProvider(zap.NewNop().Sugar(), func(string) {})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, provider.Close()) })
	var connections []types.Connection
	backends := make([]dynamic.Interface, 2)
	discoveries := make([]*discovery.DiscoveryClient, 2)
	for i, child := range []string{"a", "b"} {
		configPath := filepath.Join(root, child, "kubeconfig")
		config, err := clientcmd.LoadFromFile(configPath)
		require.NoError(t, err)
		require.Len(t, config.Contexts, 1)
		require.Len(t, config.Clusters, 1)
		require.Len(t, config.AuthInfos, 1)
		for _, cluster := range config.Clusters {
			require.True(t, strings.HasPrefix(cluster.Server, "https://127.0.0.1:"))
			require.False(t, cluster.InsecureSkipTLSVerify)
		}
		for _, auth := range config.AuthInfos {
			require.Nil(t, auth.Exec)
			require.Nil(t, auth.AuthProvider)
		}
		restConfig, err := clientcmd.NewNonInteractiveClientConfig(*config, config.CurrentContext, &clientcmd.ConfigOverrides{}, nil).ClientConfig()
		require.NoError(t, err)
		restConfig.Timeout = 20 * time.Second
		backends[i], err = dynamic.NewForConfig(restConfig)
		require.NoError(t, err)
		discoveries[i], err = discovery.NewDiscoveryClientForConfig(restConfig)
		require.NoError(t, err)
		loaded, err := connectionsFromKubeconfig(configPath)
		require.NoError(t, err)
		require.Len(t, loaded, 1)
		connections = append(connections, loaded[0])
		p08Create(t, ctx, backends[i], schema.GroupVersionResource{Version: "v1", Resource: "namespaces"}, map[string]any{
			"apiVersion": "v1", "kind": "Namespace", "metadata": map[string]any{"name": p08Namespace},
		})
		p08CRD(t, ctx, backends[i], "Mouse", "mice", i == 0, []string{"alphaOnly", "betaOnly"}[i], []string{"string", "integer"}[i])
	}
	p08CRD(t, ctx, backends[0], "Ox", "oxen", false, "alphaOnly", "string")
	// Established CRDs need not already be published by the OpenAPI controller.
	// Establish fixture readiness through the production schema acquisition path;
	// the later independently acquired gRPC catalog must still preserve schemas.
	for i, discoveryClient := range discoveries {
		expected := []string{"k8s:" + p08Group + "/mice"}
		if i == 0 {
			expected = append(expected, "k8s:"+p08Group+"/oxen")
		}
		require.Eventually(t, func() bool {
			all, _, err := discoverNativeTypes(ctx, discoveryClient)
			if err != nil {
				return false
			}
			selected := make(map[string]nativeType)
			for _, token := range expected {
				binding, ok := all[token]
				if !ok {
					return false
				}
				selected[token] = binding
			}
			documents, _, lease := fetchNativeSchemas(ctx, discoveryClient.RESTClient(), nativeSchemaBindings(selected), &nativeSchemaBudget{})
			defer lease.Release()
			for _, token := range expected {
				if _, ok := documents[token]; !ok {
					return false
				}
			}
			return true
		}, time.Minute, time.Second, "owned CRD OpenAPI publication")
	}
	require.NotEqual(t, connections[0].ID, connections[1].ID)
	require.NoError(t, provider.ApplyConnections(ctx, connections))
	for _, connection := range connections {
		_, err = provider.StartConnection(ctx, connection.ID)
		require.NoError(t, err)
	}
	server := grpc.NewServer(resourceplugin.ServerOptions()...)
	resourceplugin.RegisterServer(server, provider)
	listener := bufconn.Listen(1 << 20)
	go server.Serve(listener)
	t.Cleanup(func() { server.Stop(); listener.Close() })
	transport, err := grpc.DialContext(ctx, "passthrough:///p08-native", grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) {
		return listener.Dial()
	}), grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithBlock())
	require.NoError(t, err)
	t.Cleanup(func() { transport.Close() })
	client := resourceplugin.NewClient(transport)
	routes := []resourcev2.AccessRoute{{Connection: connections[0].ID}, {Connection: connections[1].ID}}
	catalogs := make([]resourcev2.Catalog, 2)
	contexts := make([]context.Context, 2)
	for i, route := range routes {
		catalogs[i], err = client.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
		require.NoError(t, err)
		contexts[i] = resourcev2.WithCatalogRevisionForRoute(ctx, "kubernetes", route, catalogs[i].Revision)
	}
	mice := "k8s:" + p08Group + "/mice"
	var survivors [2]resourcev2.GetRequest
	for i, route := range routes {
		descriptor := p08Type(t, catalogs[i], mice)
		require.Len(t, descriptor.IdentityDimensions, 1-i)
		if i == 0 {
			require.Equal(t, "namespace", descriptor.IdentityDimensions[0].Name)
		}
		resources, err := discoveries[i].ServerResourcesForGroupVersion(p08Group + "/v1")
		require.NoError(t, err)
		for _, api := range resources.APIResources {
			if api.Name == "mice" {
				require.Equal(t, "Mouse", api.Kind)
				require.Equal(t, i == 0, api.Namespaced)
				p08Capabilities(t, descriptor, api.Verbs)
			}
		}
		p08Schema(t, contexts[i], client, route, descriptor, []string{"alphaOnly", "betaOnly"}[i], []string{"string", "integer"}[i])
		survivors[i] = p08CRUD(t, contexts[i], client, route, descriptor, "Mouse", i == 0, []string{"alphaOnly", "betaOnly"}[i], i == 1)
	}
	oxen := p08Type(t, catalogs[0], "k8s:"+p08Group+"/oxen")
	require.Empty(t, oxen.IdentityDimensions)
	p08CRUD(t, contexts[0], client, routes[0], oxen, "Ox", false, "alphaOnly", false)

	// A real create-only Kubernetes API proves verbs are not inferred from CRUD.
	review := p08Type(t, catalogs[0], "k8s:authorization.k8s.io/selfsubjectaccessreviews")
	reviews, err := discoveries[0].ServerResourcesForGroupVersion("authorization.k8s.io/v1")
	require.NoError(t, err)
	for _, api := range reviews.APIResources {
		if api.Name == "selfsubjectaccessreviews" {
			require.Equal(t, metav1.Verbs{"create"}, api.Verbs)
			p08Capabilities(t, review, api.Verbs)
		}
	}
	unsupported := resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "p08-owned", Type: review.Type, ID: "unsupported", Scope: []resourcev2.ScopeEntry{}}}
	before := p08Audit(t, root, "a")
	_, err = client.Get(contexts[0], resourcev2.GetRequest{Route: routes[0], Reference: unsupported, Representation: review.DefaultRepresentation})
	require.Equal(t, "UNSUPPORTED", resourcev2.ErrorCode(err))
	_, err = client.Enumerate(contexts[0], resourcev2.EnumerateRequest{Target: resourcev2.ReadTarget{Route: routes[0], Provider: "kubernetes", Authority: "p08-owned", Type: review.Type, Scope: resourcev2.QueryScope{}, Representation: review.DefaultRepresentation}, PageSize: 10})
	require.Equal(t, "UNSUPPORTED", resourcev2.ErrorCode(err))
	for _, operation := range []string{"update", "delete"} {
		_, err = client.Mutate(contexts[0], resourcev2.MutationRequest{Route: routes[0], Reference: unsupported, Operation: operation, Input: resourcev2.Value{Kind: "null"}})
		require.Equal(t, "UNSUPPORTED", resourcev2.ErrorCode(err))
	}
	require.Equal(t, p08EndpointCount(before, "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews"), p08EndpointCount(p08Audit(t, root, "a"), "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews"))

	// Observe real wall-clock eligibility; never force nextRefresh or alter clocks.
	provider.mu.RLock()
	eligible := provider.catalogs[routes[0].Connection].nextRefresh
	provider.mu.RUnlock()
	crds := backends[0].Resource(schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"})
	require.NoError(t, crds.Delete(ctx, "mice."+p08Group, metav1.DeleteOptions{}))
	require.Eventually(t, func() bool {
		list, err := discoveries[0].ServerResourcesForGroupVersion(p08Group + "/v1")
		if err != nil {
			return false
		}
		for _, api := range list.APIResources {
			if api.Name == "mice" {
				return false
			}
		}
		return true
	}, 30*time.Second, 250*time.Millisecond)
	if wait := time.Until(eligible); wait > 0 {
		select {
		case <-time.After(wait + 100*time.Millisecond):
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	_, err = provider.registration(ctx, routes[0], mice)
	require.NoError(t, err, "registration lookup alone must not refresh discovery")
	before = p08Audit(t, root, "a")
	refreshed, err := client.Catalog(ctx, resourcev2.CatalogRequest{Route: routes[0]})
	require.NoError(t, err)
	require.NotEqual(t, catalogs[0].Revision, refreshed.Revision)
	for _, descriptor := range refreshed.Types {
		require.NotEqual(t, mice, descriptor.Type)
	}
	_, err = provider.registration(ctx, routes[0], mice)
	require.Equal(t, "NOT_FOUND", resourcev2.ErrorCode(err))
	_, err = client.Get(contexts[0], survivors[0])
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	freshContext := resourcev2.WithCatalogRevisionForRoute(ctx, "kubernetes", routes[0], refreshed.Revision)
	_, err = client.Get(freshContext, survivors[0])
	require.Equal(t, "UNSUPPORTED", resourcev2.ErrorCode(err))
	require.Equal(t, p08EndpointCount(before, "/apis/"+p08Group+"/v1/namespaces/"+p08Namespace+"/mice"), p08EndpointCount(p08Audit(t, root, "a"), "/apis/"+p08Group+"/v1/namespaces/"+p08Namespace+"/mice"))
	// B retains its independent scope, schema, and route after A removes that GVK.
	bCatalog, err := client.Catalog(ctx, resourcev2.CatalogRequest{Route: routes[1]})
	require.NoError(t, err)
	bContext := resourcev2.WithCatalogRevisionForRoute(ctx, "kubernetes", routes[1], bCatalog.Revision)
	_, err = client.Get(bContext, survivors[1])
	require.NoError(t, err)
	p08Schema(t, bContext, client, routes[1], p08Type(t, bCatalog, mice), "betaOnly", "integer")
	for i, route := range routes {
		_, err = provider.StopConnection(ctx, route.Connection)
		require.NoError(t, err)
		_, err = provider.StartConnection(ctx, route.Connection)
		require.NoError(t, err)
		current, err := client.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
		require.NoError(t, err)
		_, err = client.Get(contexts[i], survivors[i])
		require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
		currentContext := resourcev2.WithCatalogRevisionForRoute(ctx, "kubernetes", route, current.Revision)
		_, err = client.Get(currentContext, survivors[i])
		if i == 0 {
			require.Equal(t, "UNSUPPORTED", resourcev2.ErrorCode(err))
		} else {
			require.NoError(t, err)
		}
	}
	p08AssertPaths(t, p08Audit(t, root, "a"), "/apis/"+p08Group+"/v1/namespaces/"+p08Namespace+"/mice")
	p08AssertPaths(t, p08Audit(t, root, "a"), "/apis/"+p08Group+"/v1/oxen")
	p08AssertPaths(t, p08Audit(t, root, "b"), "/apis/"+p08Group+"/v1/mice")
	t.Log("PASS: two real APIs; same GVK/different scope+schema; irregular plurals; SDK gRPC CRUD+enumeration; create-only admission; eligible catalog refresh; removed-route rejection; B continuity; reconnect")
}

func p08Create(t *testing.T, ctx context.Context, backend dynamic.Interface, gvr schema.GroupVersionResource, object map[string]any) {
	t.Helper()
	_, err := backend.Resource(gvr).Create(ctx, &unstructured.Unstructured{Object: object}, metav1.CreateOptions{})
	require.NoError(t, err)
}
func p08CRD(t *testing.T, ctx context.Context, backend dynamic.Interface, kind, plural string, namespaced bool, field, fieldType string) {
	t.Helper()
	scope := "Cluster"
	if namespaced {
		scope = "Namespaced"
	}
	p08Create(t, ctx, backend, schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"}, map[string]any{
		"apiVersion": "apiextensions.k8s.io/v1", "kind": "CustomResourceDefinition", "metadata": map[string]any{"name": plural + "." + p08Group},
		"spec": map[string]any{"group": p08Group, "scope": scope, "names": map[string]any{"kind": kind, "plural": plural, "singular": strings.ToLower(kind)}, "versions": []any{map[string]any{
			"name": "v1", "served": true, "storage": true, "schema": map[string]any{"openAPIV3Schema": map[string]any{"type": "object", "properties": map[string]any{"spec": map[string]any{"type": "object", "properties": map[string]any{field: map[string]any{"type": fieldType}}}}}},
		}}},
	})
	require.Eventually(t, func() bool {
		crd, err := backend.Resource(schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"}).Get(ctx, plural+"."+p08Group, metav1.GetOptions{})
		if err != nil {
			return false
		}
		conditions, _, _ := unstructured.NestedSlice(crd.Object, "status", "conditions")
		for _, raw := range conditions {
			condition := raw.(map[string]any)
			if condition["type"] == "Established" && condition["status"] == "True" {
				return true
			}
		}
		return false
	}, 30*time.Second, 250*time.Millisecond)
}

func p08Type(t *testing.T, catalog resourcev2.Catalog, token string) resourcev2.ResourceType {
	t.Helper()
	for _, descriptor := range catalog.Types {
		if descriptor.Type == token {
			return descriptor
		}
	}
	t.Fatalf("missing native type %s", token)
	return resourcev2.ResourceType{}
}

func p08Capabilities(t *testing.T, descriptor resourcev2.ResourceType, verbs []string) {
	t.Helper()
	for verb, operation := range map[string]resourcev2.Operation{"get": resourcev2.OperationGet, "list": resourcev2.OperationEnumerate, "create": resourcev2.OperationCreate, "update": resourcev2.OperationMutationUpdate, "delete": resourcev2.OperationDelete} {
		want, got := false, false
		for _, supported := range verbs {
			want = want || supported == verb
		}
		for _, capability := range descriptor.Capabilities {
			got = got || capability.Operation == operation
		}
		require.Equal(t, want, got, "native verb %s", verb)
	}
}

func p08Schema(t *testing.T, ctx context.Context, client *resourceplugin.Client, route resourcev2.AccessRoute, descriptor resourcev2.ResourceType, field, fieldType string) {
	t.Helper()
	var binding resourcev2.SchemaBinding
	for _, representation := range descriptor.Representations {
		if representation.ID == descriptor.DefaultRepresentation {
			binding = representation.Schema
		}
	}
	require.Equal(t, "available", binding.State)
	document := binding.Document
	if binding.DocumentRef != nil {
		shared, err := client.GetSchemaDocument(ctx, route, *binding.DocumentRef)
		require.NoError(t, err)
		document = shared.Document
	}
	var raw any
	require.NoError(t, json.Unmarshal(document, &raw))
	for _, segment := range strings.Split(strings.TrimPrefix(binding.Root, "#/"), "/") {
		if segment != "" {
			raw = raw.(map[string]any)[strings.ReplaceAll(strings.ReplaceAll(segment, "~1", "/"), "~0", "~")]
		}
	}
	properties := raw.(map[string]any)["properties"].(map[string]any)["spec"].(map[string]any)["properties"].(map[string]any)
	require.Equal(t, fieldType, properties[field].(map[string]any)["type"])
	other := "alphaOnly"
	if field == other {
		other = "betaOnly"
	}
	require.NotContains(t, properties, other)
}

func p08CRUD(t *testing.T, ctx context.Context, client *resourceplugin.Client, route resourcev2.AccessRoute, descriptor resourcev2.ResourceType, kind string, namespaced bool, field string, integer bool) resourcev2.GetRequest {
	t.Helper()
	scope := []resourcev2.ScopeEntry{}
	queryScope := resourcev2.QueryScope{}
	metadata := map[string]any{"name": "sdk-routing"}
	if namespaced {
		metadata["namespace"] = p08Namespace
		scope = append(scope, resourcev2.ScopeEntry{Dimension: "namespace", Value: p08Namespace})
		values := []string{p08Namespace}
		queryScope = append(queryScope, resourcev2.ScopeConstraint{Dimension: "namespace", Match: resourcev2.ScopeOneOf, Values: &values})
	}
	reference := resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "p08-owned", Type: descriptor.Type, ID: "sdk-routing", Scope: scope}}
	var value any = "first"
	if integer {
		value = int64(17)
	}
	input, err := resourcev2.ValueFromNative(map[string]any{"apiVersion": p08Group + "/v1", "kind": kind, "metadata": metadata, "spec": map[string]any{field: value}})
	require.NoError(t, err)
	created, err := client.Mutate(ctx, resourcev2.MutationRequest{Route: route, Reference: reference, Operation: "create", Input: input})
	require.NoError(t, err)
	require.NotNil(t, created.Reference.Incarnation)
	request := resourcev2.GetRequest{Route: route, Reference: created.Reference, Representation: descriptor.DefaultRepresentation}
	got, err := client.Get(ctx, request)
	require.NoError(t, err)
	require.Equal(t, created.Reference, got.Reference)
	page, err := client.Enumerate(ctx, resourcev2.EnumerateRequest{Target: resourcev2.ReadTarget{Route: route, Provider: "kubernetes", Authority: "p08-owned", Type: descriptor.Type, Scope: queryScope, Representation: descriptor.DefaultRepresentation}, PageSize: 10})
	require.NoError(t, err)
	require.Len(t, page.Records, 1)
	require.Equal(t, got.Reference, page.Records[0].Reference)
	if integer {
		got.Body.Map["spec"].Map[field] = resourcev2.Value{Kind: "int64", Int: "29"}
	} else {
		got.Body.Map["spec"].Map[field] = resourcev2.Value{Kind: "string", String: "updated"}
	}
	updated, err := client.Mutate(ctx, resourcev2.MutationRequest{Route: route, Reference: got.Reference, Operation: "update", ExpectedRevision: got.SourceRevision, Input: got.Body})
	require.NoError(t, err)
	require.Equal(t, got.Body.Map["spec"].Map[field], updated.Body.Map["spec"].Map[field])
	_, err = client.Mutate(ctx, resourcev2.MutationRequest{Route: route, Reference: updated.Reference, Operation: "delete", ExpectedRevision: updated.SourceRevision, Input: resourcev2.Value{Kind: "null"}})
	require.NoError(t, err)
	_, err = client.Get(ctx, request)
	require.Equal(t, "NOT_FOUND", resourcev2.ErrorCode(err))
	created, err = client.Mutate(ctx, resourcev2.MutationRequest{Route: route, Reference: reference, Operation: "create", Input: input})
	require.NoError(t, err)
	require.NotEqual(t, request.Reference.Incarnation, created.Reference.Incarnation)
	request.Reference = created.Reference
	return request
}

type p08AuditEvent struct {
	Verb   string `json:"verb"`
	URI    string `json:"requestURI"`
	Stage  string `json:"stage"`
	Status struct {
		Code int `json:"code"`
	} `json:"responseStatus"`
}

func p08Audit(t *testing.T, root, child string) []p08AuditEvent {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, child, "audit", "audit.jsonl"))
	require.NoError(t, err)
	var events []p08AuditEvent
	for _, line := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var event p08AuditEvent
		require.NoError(t, json.Unmarshal([]byte(line), &event))
		if event.Stage == "ResponseComplete" {
			events = append(events, event)
		}
	}
	return events
}

func p08EndpointCount(events []p08AuditEvent, prefix string) int {
	count := 0
	for _, event := range events {
		if strings.HasPrefix(event.URI, prefix) {
			count++
		}
	}
	return count
}

func p08AssertPaths(t *testing.T, events []p08AuditEvent, collection string) {
	t.Helper()
	for verb, endpoint := range map[string]string{"create": collection, "list": collection, "get": collection + "/sdk-routing", "update": collection + "/sdk-routing", "delete": collection + "/sdk-routing"} {
		found := false
		for _, event := range events {
			if event.Verb == verb && strings.Split(event.URI, "?")[0] == endpoint && event.Status.Code >= 200 && event.Status.Code < 300 {
				found = true
			}
		}
		require.True(t, found, "missing successful audited %s %s", verb, endpoint)
		t.Logf("API audit: %s %s 2xx", verb, endpoint)
	}
	for _, event := range events {
		if strings.Contains(event.URI, "/"+p08Group+"/") {
			require.NotContains(t, event.URI, "/mouses")
			require.NotContains(t, event.URI, "/oxs")
		}
	}
}
