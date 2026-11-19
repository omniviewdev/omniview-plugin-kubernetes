package resource

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	authenticationv1 "k8s.io/api/authentication/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

// The name is a query dimension of every native kind, so every read that takes a scope takes it: the finite reads (Enumerate, the label query) as
// well as the live source. A name selects within the namespaces; the API server does the selecting (a metadata.name field selector), the plugin
// never reads a namespace to keep one object.

func nativeTestSelection(namespaces, names *[]string) resourcev2.QueryScope {
	scope := resourcev2.QueryScope{}
	for _, entry := range []struct {
		dimension string
		values    *[]string
	}{{"namespace", namespaces}, {"name", names}} {
		if entry.values == nil {
			scope = append(scope, resourcev2.ScopeConstraint{Dimension: entry.dimension, Match: resourcev2.ScopeAny})
		} else {
			scope = append(scope, resourcev2.ScopeConstraint{Dimension: entry.dimension, Match: resourcev2.ScopeOneOf, Values: entry.values})
		}
	}
	return scope
}

func values(v ...string) *[]string {
	if v == nil {
		v = []string{}
	}
	return &v
}

// two namespaces of ten widgets: widget-0000 ... widget-0009, every third labelled app=api
func nativeNameFixture(t *testing.T) *nativeChunkAPI {
	t.Helper()
	return newNativeChunkAPI(t, nativeChunkObjects(nativeChunkPopulation{"team-a", 10}, nativeChunkPopulation{"team-b", 10})...)
}

func nativeNameEnumerate(scope resourcev2.QueryScope, pageSize uint32) resourcev2.EnumerateRequest {
	request := nativeTestEnumerate(scope)
	request.PageSize = pageSize
	return request
}

func TestNativeEnumerateNarrowedToAnObjectAsksTheServerForOnlyThatObject(t *testing.T) {
	api := nativeNameFixture(t)
	client := nativeChunkClient(t, api, nil)

	page, err := NativeEnumerate(context.Background(), client, nativeTestGVR, true, nativeNameEnumerate(nativeTestSelection(values("team-a"), values("widget-0004")), 10), nativeTestRepresentation())
	require.NoError(t, err)
	require.Equal(t, []string{"team-a/widget-0004"}, nativeChunkRecordKeys(page.Records))
	require.Nil(t, page.NextCursor)
	require.Equal(t, []nativeChunkRequest{{Path: "/apis/sample.example/v1/namespaces/team-a/widgets", Limit: 10, Returned: 1, FieldSelector: "metadata.name=widget-0004"}}, api.served(),
		"one List, narrowed by the server: the namespace's other nine widgets were never listed")
}

func TestNativeEnumerateNarrowedByNameAloneReadsEveryNamespaceThatHoldsIt(t *testing.T) {
	api := nativeNameFixture(t)
	client := nativeChunkClient(t, api, nil)

	page, err := NativeEnumerate(context.Background(), client, nativeTestGVR, true, nativeNameEnumerate(nativeTestSelection(nil, values("widget-0004")), 10), nativeTestRepresentation())
	require.NoError(t, err)
	require.Equal(t, []string{"team-a/widget-0004", "team-b/widget-0004"}, nativeChunkRecordKeys(page.Records))
	require.Equal(t, []nativeChunkRequest{{Path: "/apis/sample.example/v1/widgets", Limit: 10, Returned: 2, FieldSelector: "metadata.name=widget-0004"}}, api.served())
}

func TestNativeEnumerateNarrowedToAClusterScopedObject(t *testing.T) {
	api := newNativeChunkAPI(t, nativeChunkObjects(nativeChunkPopulation{"", 10})...)
	client := nativeChunkClient(t, api, nil)

	scope := resourcev2.QueryScope{{Dimension: "name", Match: resourcev2.ScopeOneOf, Values: values("widget-0003")}}
	page, err := NativeEnumerate(context.Background(), client, nativeTestGVR, false, nativeNameEnumerate(scope, 10), nativeTestRepresentation())
	require.NoError(t, err)
	require.Equal(t, []string{"/widget-0003"}, nativeChunkRecordKeys(page.Records))
	require.Equal(t, []nativeChunkRequest{{Path: "/apis/sample.example/v1/widgets", Limit: 10, Returned: 1, FieldSelector: "metadata.name=widget-0003"}}, api.served())

	// any name is the whole kind, as the list reads it
	page, err = NativeEnumerate(context.Background(), client, nativeTestGVR, false, nativeNameEnumerate(resourcev2.QueryScope{{Dimension: "name", Match: resourcev2.ScopeAny}}, 256), nativeTestRepresentation())
	require.NoError(t, err)
	require.Len(t, page.Records, 10)
}

func TestNativeEnumerateWithAnyNameIsTheNamespaceRead(t *testing.T) {
	api := nativeNameFixture(t)
	client := nativeChunkClient(t, api, nil)

	page, err := NativeEnumerate(context.Background(), client, nativeTestGVR, true, nativeNameEnumerate(nativeTestSelection(values("team-a"), nil), 256), nativeTestRepresentation())
	require.NoError(t, err)
	require.Len(t, page.Records, 10)
	require.Equal(t, []nativeChunkRequest{{Path: "/apis/sample.example/v1/namespaces/team-a/widgets", Limit: 256, Returned: 10}}, api.served(), "an omitted name selects every object: no field selector")
}

func TestNativeEnumerateWalksEveryNamespaceAndNameInPages(t *testing.T) {
	scope := nativeTestSelection(values("team-b", "team-a"), values("widget-0002", "widget-0001"))
	expected := []string{"team-a/widget-0001", "team-a/widget-0002", "team-b/widget-0001", "team-b/widget-0002"}
	for _, pageSize := range []uint32{1, 2, 3, 256} {
		t.Run(fmt.Sprintf("page size %d", pageSize), func(t *testing.T) {
			api := nativeNameFixture(t)
			client := nativeChunkClient(t, api, nil)
			run := nativeChunkFollow(t, api, func(cursor *string) (resourcev2.SourcePage, error) {
				request := nativeNameEnumerate(scope, pageSize)
				request.Cursor = cursor
				return NativeEnumerate(context.Background(), client, nativeTestGVR, true, request, nativeTestRepresentation())
			})
			require.Equal(t, expected, run.flatten(), "each namespace and name once, in order, however the pages cut them")
			for _, list := range api.served() {
				require.Regexp(t, `^metadata\.name=widget-000[12]$`, list.FieldSelector)
			}
		})
	}
}

func TestNativeEnumerateCursorBindsTheNameSelection(t *testing.T) {
	api := nativeNameFixture(t)
	client := nativeChunkClient(t, api, nil)
	original := nativeNameEnumerate(nativeTestSelection(values("team-a"), values("widget-0001", "widget-0002")), 1)
	first, err := NativeEnumerate(context.Background(), client, nativeTestGVR, true, original, nativeTestRepresentation())
	require.NoError(t, err)
	require.NotNil(t, first.NextCursor)

	for name, scope := range map[string]resourcev2.QueryScope{
		"another name":     nativeTestSelection(values("team-a"), values("widget-0001", "widget-0003")),
		"fewer names":      nativeTestSelection(values("team-a"), values("widget-0001")),
		"any name":         nativeTestSelection(values("team-a"), nil),
		"another namepace": nativeTestSelection(values("team-b"), values("widget-0001", "widget-0002")),
	} {
		t.Run(name, func(t *testing.T) {
			request := nativeNameEnumerate(scope, 1)
			request.Cursor = first.NextCursor
			before := len(api.served())
			_, err := NativeEnumerate(context.Background(), client, nativeTestGVR, true, request, nativeTestRepresentation())
			require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
			require.Len(t, api.served(), before)
		})
	}

	same := original
	same.Cursor = first.NextCursor
	same.Target.Scope = nativeTestSelection(values("team-a"), values("widget-0002", "widget-0001"))
	second, err := NativeEnumerate(context.Background(), client, nativeTestGVR, true, same, nativeTestRepresentation())
	require.NoError(t, err, "the same names in another order are the same selection")
	require.Equal(t, []string{"team-a/widget-0002"}, nativeChunkRecordKeys(second.Records))
}

func TestNativeEnumerateRefusesANameScopeItCannotNarrowByWithoutAskingTheServer(t *testing.T) {
	empty, anyWithValues := []string{""}, []string{"widget-0001"}
	for _, tc := range []struct {
		name  string
		scope resourcev2.QueryScope
	}{
		{"empty name", nativeTestSelection(values("team-a"), values(""))},
		{"names without values", resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeAny}, {Dimension: "name", Match: resourcev2.ScopeOneOf}}},
		{"any name with values", resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeAny}, {Dimension: "name", Match: resourcev2.ScopeAny, Values: &anyWithValues}}},
		{"unknown match", resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeAny}, {Dimension: "name", Match: "prefix", Values: &empty}}},
		{"a path", nativeTestSelection(values("team-a"), values("widget-0001/status"))},
		{"a dot", nativeTestSelection(values("team-a"), values("."))},
		{"two dots", nativeTestSelection(values("team-a"), values(".."))},
		{"a percent", nativeTestSelection(values("team-a"), values("widget%2F0001"))},
		{"name twice", append(nativeTestSelection(values("team-a"), values("widget-0001")), resourcev2.ScopeConstraint{Dimension: "name", Match: resourcev2.ScopeAny})},
		{"unknown dimension", append(nativeTestSelection(values("team-a"), nil), resourcev2.ScopeConstraint{Dimension: "region", Match: resourcev2.ScopeAny})},
	} {
		t.Run(tc.name, func(t *testing.T) {
			api := nativeNameFixture(t)
			client := nativeChunkClient(t, api, nil)
			_, err := NativeEnumerate(context.Background(), client, nativeTestGVR, true, nativeNameEnumerate(tc.scope, 10), nativeTestRepresentation())
			require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err), "%v", err)
			require.Empty(t, api.served())
		})
	}
	t.Run("a namespace constraint on a cluster-scoped kind", func(t *testing.T) {
		api := nativeNameFixture(t)
		client := nativeChunkClient(t, api, nil)
		_, err := NativeEnumerate(context.Background(), client, nativeTestGVR, false, nativeNameEnumerate(nativeTestSelection(nil, nil), 10), nativeTestRepresentation())
		require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
		require.Empty(t, api.served())
	})
}

func TestNativeEnumerateWithNoNameOneOfIsAnEmptyPage(t *testing.T) {
	api := nativeNameFixture(t)
	client := nativeChunkClient(t, api, nil)
	page, err := NativeEnumerate(context.Background(), client, nativeTestGVR, true, nativeNameEnumerate(nativeTestSelection(nil, values()), 10), nativeTestRepresentation())
	require.NoError(t, err, "a valid empty selection matches nothing: it is an empty page, never every object")
	require.Empty(t, page.Records)
	require.Empty(t, api.served())
}

func TestNativeEnumerateIsSafeAgainstANameThatLooksLikeAnotherSelectorTerm(t *testing.T) {
	api := nativeNameFixture(t)
	client := nativeChunkClient(t, api, nil)
	hostile := "widget-0001,metadata.namespace=team-b"
	page, err := NativeEnumerate(context.Background(), client, nativeTestGVR, true, nativeNameEnumerate(nativeTestSelection(values("team-a"), values(hostile)), 10), nativeTestRepresentation())
	require.NoError(t, err)
	require.Empty(t, page.Records)
	served := api.served()
	require.Len(t, served, 1)
	require.Equal(t, `metadata.name=widget-0001\,metadata.namespace\=team-b`, served[0].FieldSelector)
}

// A server that does not implement the field selector would answer with the namespace. The read refuses that answer: it never returns an object it was not asked for.
func TestNativeEnumerateRefusesObjectsOfAServerThatIgnoresTheNameSelector(t *testing.T) {
	api := nativeNameFixture(t)
	api.ignoreFieldSelector = true
	client := nativeChunkClient(t, api, nil)
	_, err := NativeEnumerate(context.Background(), client, nativeTestGVR, true, nativeNameEnumerate(nativeTestSelection(values("team-a"), values("widget-0004")), 10), nativeTestRepresentation())
	require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
}

func nativeNameQuery(selector string) resourcev2.Value {
	return resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"labelSelector": {Kind: "string", String: selector}}}
}

func TestNativeQueryNarrowedToAnObjectKeepsTheLabelSelector(t *testing.T) {
	api := nativeNameFixture(t)
	client := nativeChunkClient(t, api, nil)
	query := func(name string) (resourcev2.SourcePage, error) {
		return NativeQuery(context.Background(), client, nativeTestGVR, true, resourcev2.NativeQueryRequest{
			Target: nativeTestEnumerate(nativeTestSelection(values("team-a"), values(name))).Target, Language: nativeLabelSelectorLanguage, Query: nativeNameQuery("app=api"), PageSize: 10,
		}, nativeTestRepresentation())
	}
	page, err := query("widget-0003") // every third widget is app=api
	require.NoError(t, err)
	require.Equal(t, []string{"team-a/widget-0003"}, nativeChunkRecordKeys(page.Records))
	page, err = query("widget-0004") // there, but not app=api
	require.NoError(t, err)
	require.Empty(t, page.Records, "both selectors apply: the object must have the name and the labels")
	for _, list := range api.served() {
		require.True(t, strings.HasPrefix(list.FieldSelector, "metadata.name=widget-000"), list.FieldSelector)
	}
}

// A type-level action (an editor's review, the reference lookup) takes the type's scope: it selects no object, so a name cannot narrow it.
func TestTypeActionTakesTheNamespaceAndRefusesToBeNarrowedByName(t *testing.T) {
	review := func(scope resourcev2.QueryScope) error {
		client := fake.NewSimpleClientset()
		client.PrependReactor("create", "tokenreviews", func(action clienttesting.Action) (bool, runtime.Object, error) {
			return true, action.(clienttesting.CreateAction).GetObject().(*authenticationv1.TokenReview), nil
		})
		binding := editorTestBinding("authentication.k8s.io", "v1", "tokenreviews", "TokenReview", false)
		_, err := editorAction(context.Background(), &clients.ClientSet{KubeClient: client}, binding, resourcev2.ActionRequest{
			TypeTarget: &resourcev2.TypeActionTarget{Scope: scope}, Action: editorReview,
			Input: editorTestValue(t, map[string]any{"apiVersion": "authentication.k8s.io/v1", "kind": "TokenReview", "spec": map[string]any{"token": "private-bearer"}}),
		})
		return err
	}
	require.NoError(t, review(resourcev2.QueryScope{{Dimension: "name", Match: resourcev2.ScopeAny}}), "the shape every caller of a cluster-scoped kind now sends")
	require.NoError(t, review(resourcev2.QueryScope{}))
	require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(review(resourcev2.QueryScope{{Dimension: "name", Match: resourcev2.ScopeOneOf, Values: values("x")}})))
}
