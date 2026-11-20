package resourcers

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// What a Secret's record holds: its identity and metadata, its type and whether it is immutable, and for each key its name and its size in bytes. The values it holds are never in it, and neither is the
// annotation that `kubectl apply` fills with the manifest, values and all. The tests give ProjectObject the objects an API server serves, and look at what it returns.

var secretsResource = schema.GroupVersionResource{Version: "v1", Resource: "secrets"}

func encode(value []byte) string { return base64.StdEncoding.EncodeToString(value) }

// secretOf is a Secret as the API server serves it: apiVersion, kind, metadata, type, immutable and data.
func secretOf(data map[string]any) map[string]any {
	object := map[string]any{
		"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
		"metadata": map[string]any{"name": "credentials", "namespace": "shop", "uid": "uid-1", "resourceVersion": "7", "creationTimestamp": "2026-11-19T10:00:00Z", "labels": map[string]any{"app": "shop"}},
	}
	if data != nil {
		object["data"] = data
	}
	return object
}

func sizesOf(t *testing.T, projected map[string]any, member string) map[string]int64 {
	t.Helper()
	held, present := projected[member]
	if !present {
		return nil
	}
	entries, ok := held.(map[string]any)
	require.True(t, ok, "%s is a map of entries", member)
	sizes := map[string]int64{}
	for name, entry := range entries {
		fields, ok := entry.(map[string]any)
		require.True(t, ok, "the entry %s is a map, not a value", name)
		require.Len(t, fields, 1, "the entry %s holds its size and nothing else", name)
		size, ok := fields["size"].(int64)
		require.True(t, ok, "the size of %s is an int64", name)
		sizes[name] = size
	}
	return sizes
}

func TestAKindThatIsNotTheCoreSecretIsLeftAlone(t *testing.T) {
	for _, gvr := range []schema.GroupVersionResource{
		{Version: "v1", Resource: "configmaps"},
		{Version: "v1", Resource: "pods"},
		{Group: "apps", Version: "v1", Resource: "deployments"},
		{Group: "vault.example", Version: "v1", Resource: "secrets"},
		{Group: "bitnami.com", Version: "v1alpha1", Resource: "sealedsecrets"},
	} {
		t.Run(gvr.String(), func(t *testing.T) {
			object := map[string]any{"kind": "Thing", "metadata": map[string]any{"name": "a", "annotations": map[string]any{"kubectl.kubernetes.io/last-applied-configuration": "{}"}}, "data": map[string]any{"key": "dmFsdWU="}, "stringData": map[string]any{"key": "value"}, "extra": "kept"}
			before, err := json.Marshal(object)
			require.NoError(t, err)
			projected := ProjectObject(gvr, object)
			after, err := json.Marshal(projected)
			require.NoError(t, err)
			assert.JSONEq(t, string(before), string(after), "the object is sent as the server holds it")
			paths, reason := ProjectionLimits(gvr)
			assert.Empty(t, paths)
			assert.Empty(t, reason)
		})
	}
}

func TestSecretVersionDoesNotMatter(t *testing.T) {
	for _, version := range []string{"v1", "v2beta1"} {
		projected := ProjectObject(schema.GroupVersionResource{Version: version, Resource: "secrets"}, secretOf(map[string]any{"password": encode([]byte("hunter2"))}))
		assert.Equal(t, map[string]int64{"password": 7}, sizesOf(t, projected, "data"), version)
	}
}

func TestASecretKeepsItsKeyNamesAndTheSizeOfEachValueInBytes(t *testing.T) {
	binary := []byte{0xff, 0x00, 0xfe, 0x80, 0x00, 0xff}
	for _, test := range []struct {
		name string
		data map[string]any
		want map[string]int64
	}{
		{"text", map[string]any{"password": encode([]byte("hunter2")), "username": encode([]byte("admin"))}, map[string]int64{"password": 7, "username": 5}},
		{"bytes that are no text", map[string]any{"blob": encode(binary)}, map[string]int64{"blob": 6}},
		{"a base64 text that ends in one padding character and in two", map[string]any{"one": encode([]byte("ab")), "two": encode([]byte("a")), "none": encode([]byte("abc"))}, map[string]int64{"one": 2, "two": 1, "none": 3}},
		{"an empty value", map[string]any{"empty": ""}, map[string]int64{"empty": 0}},
		{"a value the server sent as null", map[string]any{"missing": nil}, map[string]int64{"missing": 0}},
		{"a large value", map[string]any{"big": encode(make([]byte, 1<<20))}, map[string]int64{"big": 1 << 20}},
		{"a value that is not base64 is measured as the text it is", map[string]any{"odd": "not base64!"}, map[string]int64{"odd": 11}},
		{"a value that is not a string holds no size", map[string]any{"nested": map[string]any{"password": "hunter2"}, "number": int64(12)}, map[string]int64{"nested": 0, "number": 0}},
		{"no key at all", map[string]any{}, map[string]int64{}},
	} {
		t.Run(test.name, func(t *testing.T) {
			projected := ProjectObject(secretsResource, secretOf(test.data))
			assert.Equal(t, test.want, sizesOf(t, projected, "data"))
			encoded, err := json.Marshal(projected)
			require.NoError(t, err)
			for _, forbidden := range []string{"hunter2", "aHVudGVyMg", "nested\":{\"password"} {
				assert.NotContains(t, string(encoded), forbidden)
			}
		})
	}
}

func TestASecretWithNoDataHasNoData(t *testing.T) {
	projected := ProjectObject(secretsResource, secretOf(nil))
	assert.NotContains(t, projected, "data", "the API omits an empty map, and so does the record: no key, no entry")
	assert.Equal(t, "Opaque", projected["type"])
}

func TestStringDataIsKeptAsKeysAndSizesInBytesToo(t *testing.T) {
	object := secretOf(map[string]any{"token": encode([]byte("abc"))})
	object["stringData"] = map[string]any{"greeting": "héllo", "plain": "value"}
	projected := ProjectObject(secretsResource, object)
	assert.Equal(t, map[string]int64{"greeting": 6, "plain": 5}, sizesOf(t, projected, "stringData"), "the bytes of the UTF-8 text")
	assert.Equal(t, map[string]int64{"token": 3}, sizesOf(t, projected, "data"))
}

func TestTheLastAppliedAnnotationLeavesTheRecordAndNoOtherAnnotationDoes(t *testing.T) {
	const manifest = `{"apiVersion":"v1","kind":"Secret","stringData":{"password":"hunter2"}}`
	object := secretOf(map[string]any{"password": encode([]byte("hunter2"))})
	object["metadata"].(map[string]any)["annotations"] = map[string]any{"kubectl.kubernetes.io/last-applied-configuration": manifest, "owner": "payments"}
	projected := ProjectObject(secretsResource, object)
	assert.Equal(t, map[string]any{"owner": "payments"}, projected["metadata"].(map[string]any)["annotations"])

	// when it was the only one there is no annotation left to hold, as the API server sends none for an object that has none
	only := secretOf(nil)
	only["metadata"].(map[string]any)["annotations"] = map[string]any{"kubectl.kubernetes.io/last-applied-configuration": manifest}
	assert.NotContains(t, ProjectObject(secretsResource, only)["metadata"], "annotations")
}

func TestASecretKeepsItsIdentityItsMetadataItsTypeAndImmutability(t *testing.T) {
	object := secretOf(map[string]any{"password": encode([]byte("x"))})
	object["immutable"] = true
	object["metadata"].(map[string]any)["ownerReferences"] = []any{map[string]any{"kind": "Deployment", "name": "shop"}}
	object["metadata"].(map[string]any)["managedFields"] = []any{map[string]any{"manager": "kubectl", "fieldsV1": map[string]any{"f:data": map[string]any{"f:password": map[string]any{}}}}}
	projected := ProjectObject(secretsResource, object)
	for _, member := range []string{"apiVersion", "kind", "type", "immutable"} {
		assert.Equal(t, object[member], projected[member], member)
	}
	assert.Equal(t, object["metadata"], projected["metadata"], "with no manifest annotation, the metadata is the same")
}

func TestASecretIsSentWithTheMembersItIsKnownToHaveAndNoOther(t *testing.T) {
	object := secretOf(map[string]any{"password": encode([]byte("x"))})
	object["someFutureField"] = map[string]any{"password": "hunter2"}
	projected := ProjectObject(secretsResource, object)
	assert.NotContains(t, projected, "someFutureField", "what is not known to hold no value is not sent")
	members := make([]string, 0, len(projected))
	for member := range projected {
		members = append(members, member)
	}
	assert.ElementsMatch(t, []string{"apiVersion", "kind", "metadata", "type", "data"}, members)
}

func TestProjectingASecretLeavesItsObjectAsItWas(t *testing.T) {
	// the object of a source is shared with the informer's cache and with every other session: a projection that wrote to it would change them all
	object := secretOf(map[string]any{"password": encode([]byte("hunter2"))})
	object["stringData"] = map[string]any{"token": "abc"}
	object["metadata"].(map[string]any)["annotations"] = map[string]any{"kubectl.kubernetes.io/last-applied-configuration": "{}", "owner": "payments"}
	before, err := json.Marshal(object)
	require.NoError(t, err)

	projected := ProjectObject(secretsResource, object)
	projected["type"] = "changed"
	projected["metadata"].(map[string]any)["name"] = "changed"
	projected["data"].(map[string]any)["password"] = "changed"
	projected["stringData"].(map[string]any)["token"] = "changed"

	after, err := json.Marshal(object)
	require.NoError(t, err)
	assert.JSONEq(t, string(before), string(after))
}

func TestWhatASecretProjectionLimitsIsSaidInTheRecordsCoverage(t *testing.T) {
	paths, reason := ProjectionLimits(secretsResource)
	assert.Equal(t, []string{"/data", "/stringData", "/metadata/annotations/kubectl.kubernetes.io~1last-applied-configuration"}, paths)
	assert.NotEmpty(t, reason)
	assert.False(t, strings.Contains(reason, "\n"))
}
