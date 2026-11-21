package resource

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourcepb "github.com/omniviewdev/plugin-sdk/proto/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	clienttesting "k8s.io/client-go/testing"
)

// A Secret's values are sent by no read: not a list, not a page's name-narrowed read, not a Get, not the result of a mutation, and not the live source that follows a list or one object. What a read sends
// of a Secret is its metadata, its type, whether it is immutable, and for each key its name and its size in bytes. These tests drive the registration the plugin hands the host for the type, so every
// operation the host can ask of it is asked; each plants values that name themselves in the objects the API server serves, and looks for every one of them (in the clear, as base64, and as base64 at
// each of its three alignments) in the bytes the plugin would put on the wire: the JSON and the protobuf of each page, record and frame.

const (
	secretsToken    = "k8s:/secrets"
	configMapsToken = "k8s:/configmaps"
	lastApplied     = "kubectl.kubernetes.io/last-applied-configuration"
	rawSecretRep    = "kubernetes.object.v1/v1"
	modelSecretRep  = "kubernetes.model.v1/v1"
)

var (
	secretsGVR    = schema.GroupVersionResource{Version: "v1", Resource: "secrets"}
	configMapsGVR = schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}
)

// heldSecret is a Secret as a cluster holds it: each key's bytes, and the annotations the tools that made it left.
type heldSecret struct {
	namespace, name, secretType string
	data                        map[string][]byte
	immutable                   bool
	annotations                 map[string]string
}

// applied is what `kubectl apply` of a manifest that wrote its values as stringData leaves in the annotation: the manifest, values in the clear.
func applied(namespace, name string, stringData map[string]string) string {
	encoded, err := json.Marshal(map[string]any{"apiVersion": "v1", "kind": "Secret", "metadata": map[string]any{"name": name, "namespace": namespace}, "stringData": stringData, "type": "Opaque"})
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

// binaryBlob holds bytes that are no text (0xff, 0x80 and 0x00 cannot begin or sit inside UTF-8), with a value that names itself in the middle.
var binaryBlob = slices.Concat([]byte{0xff, 0x00, 0xfe, 0x80}, []byte("sentinel-blob-d2c855"), []byte{0x00, 0xff, 0x81})

func secretFixtures() []heldSecret {
	return []heldSecret{
		{namespace: "shop", name: "credentials", secretType: "Opaque",
			data:        map[string][]byte{"username": []byte("sentinel-user-4b1d6e"), "password": []byte("sentinel-password-7f3a9c")},
			annotations: map[string]string{"owner": "payments", lastApplied: applied("shop", "credentials", map[string]string{"username": "sentinel-user-4b1d6e", "password": "sentinel-password-7f3a9c"})}},
		{namespace: "shop", name: "web-tls", secretType: "kubernetes.io/tls",
			data: map[string][]byte{"tls.crt": []byte("-----BEGIN CERTIFICATE-----\nsentinel-cert-0c6e2a\n-----END CERTIFICATE-----\n"), "tls.key": []byte("sentinel-key-91fd03")}},
		{namespace: "shop", name: "blob", secretType: "Opaque", data: map[string][]byte{"blob": binaryBlob, "blank": {}}},
		{namespace: "shop", name: "empty", secretType: "Opaque"},
		// made from a manifest whose values were stringData: the server stored them as data, and the annotation kept them as written
		{namespace: "shop", name: "from-string-data", secretType: "Opaque",
			data:        map[string][]byte{"token": []byte("sentinel-token-52d0b8")},
			annotations: map[string]string{lastApplied: applied("shop", "from-string-data", map[string]string{"token": "sentinel-token-52d0b8"})}},
		{namespace: "shop", name: "pinned", secretType: "Opaque", immutable: true, data: map[string][]byte{"api-key": []byte("sentinel-immutable-6a08e1")}},
		{namespace: "billing", name: "credentials", secretType: "Opaque", data: map[string][]byte{"password": []byte("sentinel-password-billing-2e90bb")}},
	}
}

func (s heldSecret) object() *unstructured.Unstructured {
	metadata := map[string]any{
		"name": s.name, "namespace": s.namespace, "uid": "uid-" + s.namespace + "-" + s.name, "resourceVersion": "7",
		"creationTimestamp": "2026-11-19T10:00:00Z", "labels": map[string]any{"app": "shop"},
		// the server's record of who wrote which keys: key names, never values
		"managedFields": []any{map[string]any{"manager": "kubectl-client-side-apply", "operation": "Update", "fieldsV1": map[string]any{"f:data": map[string]any{"f:password": map[string]any{}}}}},
	}
	if len(s.annotations) != 0 {
		annotations := map[string]any{}
		for key, value := range s.annotations {
			annotations[key] = value
		}
		metadata["annotations"] = annotations
	}
	object := map[string]any{"apiVersion": "v1", "kind": "Secret", "metadata": metadata, "type": s.secretType}
	if len(s.data) != 0 {
		data := map[string]any{}
		for key, value := range s.data {
			data[key] = base64.StdEncoding.EncodeToString(value)
		}
		object["data"] = data
	}
	if s.immutable {
		object["immutable"] = true
	}
	return &unstructured.Unstructured{Object: object}
}

// shopSettings is a ConfigMap: its values are plain configuration, and they are sent whole.
func shopSettings() *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1", "kind": "ConfigMap",
		"metadata": map[string]any{"name": "settings", "namespace": "shop", "uid": "uid-shop-settings", "resourceVersion": "3", "annotations": map[string]any{lastApplied: `{"data":{"app.properties":"configmap-value-51a7f0"}}`}},
		"data":     map[string]any{"app.properties": "configmap-value-51a7f0"},
	}}
}

// needles are every form in which a value could be found on the wire: itself, its base64, and (for a value that sits inside a longer one) the base64 of its inside at the two other alignments.
func needles(value []byte) []string {
	found := []string{string(value), base64.StdEncoding.EncodeToString(value)}
	for pad := 1; pad <= 2; pad++ {
		encoded := base64.StdEncoding.EncodeToString(append(bytes.Repeat([]byte{'x'}, pad), value...))
		if len(encoded) > 8+4+4 {
			found = append(found, encoded[4:len(encoded)-4])
		}
	}
	return found
}

// everyValueNeedle: the values of every Secret of the fixture, and the self-naming part of the binary one.
func everyValueNeedle() []string {
	var found []string
	for _, secret := range secretFixtures() {
		for _, value := range secret.data {
			if len(value) > 8 {
				found = append(found, needles(value)...)
			}
		}
	}
	return append(found, needles([]byte("sentinel-blob-d2c855"))...)
}

// onTheWire is the bytes a plugin response is made of when it reaches the host: the JSON of the value and its protobuf message.
func pageOnTheWire(t *testing.T, page resourcev2.SourcePage) [][]byte {
	t.Helper()
	encoded, err := json.Marshal(page)
	require.NoError(t, err)
	wire, err := resourcev2.ToProtoSourcePage(page)
	require.NoError(t, err)
	message, err := proto.Marshal(&resourcepb.Response{Version: resourcev2.WireVersion, Result: &resourcepb.Response_Page{Page: wire}})
	require.NoError(t, err)
	return [][]byte{encoded, message}
}

func recordOnTheWire(t *testing.T, record resourcev2.Record) [][]byte {
	t.Helper()
	encoded, err := json.Marshal(record)
	require.NoError(t, err)
	wire, err := resourcev2.ToProtoRecord(record)
	require.NoError(t, err)
	message, err := proto.Marshal(wire)
	require.NoError(t, err)
	return [][]byte{encoded, message}
}

func frameOnTheWire(t *testing.T, frame resourcev2.SourceFrame) [][]byte {
	t.Helper()
	encoded, err := json.Marshal(frame)
	require.NoError(t, err)
	wire, err := resourcev2.ToProtoSourceFrame(frame)
	require.NoError(t, err)
	message, err := proto.Marshal(wire)
	require.NoError(t, err)
	return [][]byte{encoded, message}
}

// requireNoValue fails for each needle found, naming the needle's head and never printing the frames.
func requireNoValue(t *testing.T, what string, frames [][]byte) {
	t.Helper()
	for _, needle := range everyValueNeedle() {
		for _, frame := range frames {
			if bytes.Contains(frame, []byte(needle)) {
				t.Errorf("%s: %q... is in the bytes the plugin sends (%d bytes)", what, needle[:min(len(needle), 12)], len(frame))
			}
		}
	}
}

// secretsRegistration is what the plugin registers for the Secrets (and the ConfigMaps) of a connection, built as the plugin builds it from discovery.
func secretsRegistrations(t *testing.T) (map[string]resourcev2.Registration[clients.ClientSet], map[string]resourcev2.ResourceType) {
	t.Helper()
	verbs := metav1.Verbs{"create", "delete", "get", "list", "update", "watch"}
	discovery := &fake.FakeDiscovery{Fake: &clienttesting.Fake{Resources: []*metav1.APIResourceList{{
		GroupVersion: "v1",
		APIResources: []metav1.APIResource{
			{Name: "secrets", Kind: "Secret", Namespaced: true, Verbs: verbs},
			{Name: "configmaps", Kind: "ConfigMap", Namespaced: true, Verbs: verbs},
		},
	}}}}
	bindings, _, err := discoverNativeTypes(context.Background(), discovery)
	require.NoError(t, err)
	provider := &kubernetesProvider{logger: zap.NewNop().Sugar()}
	snapshot, err := provider.assembleNativeCatalog(context.Background(), "route", &clients.ClientSet{}, bindings, nil, nativeTestAny())
	require.NoError(t, err)
	types := map[string]resourcev2.ResourceType{}
	for _, descriptor := range snapshot.catalog.Types {
		types[descriptor.Type] = descriptor
	}
	return snapshot.registrations, types
}

// secretsClient is an API server that holds the fixture's Secrets and a ConfigMap. It answers a field selector on metadata.name the way kube-apiserver does: the stock fake would ignore it.
func secretsClient(t *testing.T) *clients.ClientSet {
	t.Helper()
	objects := []runtime.Object{shopSettings()}
	for _, secret := range secretFixtures() {
		objects = append(objects, secret.object())
	}
	native := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{secretsGVR: "SecretList", configMapsGVR: "ConfigMapList"}, objects...)
	for _, served := range []struct {
		gvr  schema.GroupVersionResource
		kind string
	}{{secretsGVR, "Secret"}, {configMapsGVR, "ConfigMap"}} {
		native.PrependReactor("list", served.gvr.Resource, func(action clienttesting.Action) (bool, runtime.Object, error) {
			selector := action.(clienttesting.ListAction).GetListRestrictions().Fields
			everything, err := native.Tracker().List(served.gvr, schema.GroupVersionKind{Version: served.gvr.Version, Kind: served.kind}, action.GetNamespace())
			if err != nil {
				return true, nil, err
			}
			list := everything.(*unstructured.UnstructuredList)
			kept := list.Items[:0]
			for i := range list.Items {
				if selector.Matches(fields.Set{"metadata.name": list.Items[i].GetName(), "metadata.namespace": list.Items[i].GetNamespace()}) {
					kept = append(kept, list.Items[i])
				}
			}
			list.Items = kept
			return true, list, nil
		})
	}
	return &clients.ClientSet{DynamicClient: native}
}

func secretsTarget(token, representation string, scope resourcev2.QueryScope) resourcev2.ReadTarget {
	return resourcev2.ReadTarget{Route: resourcev2.AccessRoute{Connection: "route"}, Provider: "kubernetes", Authority: "authority", Type: token, Scope: scope, Representation: representation}
}

func secretsReference(token, namespace, name string) resourcev2.ResourceReference {
	return resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "authority", Type: token, ID: name, Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: namespace}}}}
}

func anyNamespaceAnyName() resourcev2.QueryScope {
	return resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeAny}, {Dimension: "name", Match: resourcev2.ScopeAny}}
}

// recordKey is namespace/name.
func recordKey(record resourcev2.Record) string {
	return record.Reference.Address.Scope[0].Value + "/" + record.Reference.Address.ID
}

// keysOf reads what a record's body says of the keys of `member` ("data"): name and size, and fails on a key that holds anything else.
func keysOf(t *testing.T, record resourcev2.Record, member string) map[string]int64 {
	t.Helper()
	held, present := record.Body.Map[member]
	if !present {
		return map[string]int64{}
	}
	require.Equal(t, "map", held.Kind, "%s of %s", member, recordKey(record))
	keys := map[string]int64{}
	for name, entry := range held.Map {
		require.Equal(t, "map", entry.Kind, "the entry %s of %s: a size, never a value", name, recordKey(record))
		require.Len(t, entry.Map, 1, "the entry %s of %s holds its size and nothing else", name, recordKey(record))
		size, ok := entry.Map["size"]
		require.True(t, ok, "the entry %s of %s", name, recordKey(record))
		require.Equal(t, "int64", size.Kind)
		var n int64
		_, err := fmt.Sscan(size.Int, &n)
		require.NoError(t, err)
		keys[name] = n
	}
	return keys
}

// requireSecretRecord checks one Secret's record against the Secret the server holds: the identity, the type, immutability, labels and the annotations a tool left (but the last-applied one), the key names and the
// sizes, and nothing a key holds.
func requireSecretRecord(t *testing.T, record resourcev2.Record, secret heldSecret) {
	t.Helper()
	requireSecretRecordAt(t, record, secret, "7")
}

// requireSecretRecordAt is requireSecretRecord for the Secret at the resource version a change gave it.
func requireSecretRecordAt(t *testing.T, record resourcev2.Record, secret heldSecret, revision string) {
	t.Helper()
	label := secret.namespace + "/" + secret.name
	requireNoValue(t, "the record of "+label, recordOnTheWire(t, record))
	assert.Equal(t, label, recordKey(record))
	require.NotNil(t, record.Reference.Incarnation, label)
	assert.Equal(t, "uid-"+secret.namespace+"-"+secret.name, *record.Reference.Incarnation, label)
	require.NotNil(t, record.SourceRevision, label)
	assert.Equal(t, revision, *record.SourceRevision, label)

	body := record.Body.Map
	assert.Equal(t, "Secret", body["kind"].String, label)
	assert.Equal(t, "v1", body["apiVersion"].String, label)
	assert.Equal(t, secret.secretType, body["type"].String, label)
	metadata := body["metadata"].Map
	assert.Equal(t, secret.name, metadata["name"].String, label)
	assert.Equal(t, secret.namespace, metadata["namespace"].String, label)
	assert.Equal(t, "shop", metadata["labels"].Map["app"].String, label)
	assert.Equal(t, "2026-11-19T10:00:00Z", metadata["creationTimestamp"].String, label)

	if secret.immutable {
		assert.Equal(t, resourcev2.Value{Kind: "bool", Bool: true}, body["immutable"], label)
	} else {
		assert.NotContains(t, body, "immutable", label)
	}

	// the annotation that holds the manifest, values and all, is left out; every other one is kept
	kept := map[string]string{}
	for key, value := range metadata["annotations"].Map {
		kept[key] = value.String
	}
	for key, value := range secret.annotations {
		if key == lastApplied {
			assert.NotContains(t, kept, key, label)
		} else {
			assert.Equal(t, value, kept[key], label)
		}
	}

	expected := map[string]int64{}
	for key, value := range secret.data {
		expected[key] = int64(len(value))
	}
	assert.Equal(t, expected, keysOf(t, record, "data"), "%s: each key's name and its size in bytes, as the bytes are (binary and empty values too)", label)
	assert.NotContains(t, body, "stringData", label)

	assert.Equal(t, "partial", record.Coverage.Kind, label)
	assert.Contains(t, record.Coverage.Paths, "/data", label)
	assert.Contains(t, record.Coverage.Paths, "/metadata/annotations/kubectl.kubernetes.io~1last-applied-configuration", label)
	assert.NotEmpty(t, record.Coverage.Reason, label)
}

func fixtureByKey() map[string]heldSecret {
	byKey := map[string]heldSecret{}
	for _, secret := range secretFixtures() {
		byKey[secret.namespace+"/"+secret.name] = secret
	}
	return byKey
}

func requireSecretPage(t *testing.T, page resourcev2.SourcePage, wanted ...string) {
	t.Helper()
	requireNoValue(t, "the page", pageOnTheWire(t, page))
	byKey := fixtureByKey()
	var got []string
	for _, record := range page.Records {
		got = append(got, recordKey(record))
		requireSecretRecord(t, record, byKey[recordKey(record)])
	}
	assert.ElementsMatch(t, wanted, got)
	assert.Equal(t, "partial", page.Coverage.Kind, "the page says what its records leave out")
	assert.Contains(t, page.Coverage.Paths, "/data")
}

func allSecrets() []string {
	var all []string
	for _, secret := range secretFixtures() {
		all = append(all, secret.namespace+"/"+secret.name)
	}
	return all
}

func TestSecretsAreListedByNameTypeAndSizeNeverByValue(t *testing.T) {
	registrations, types := secretsRegistrations(t)
	registration := registrations[secretsToken]
	for _, representation := range []string{rawSecretRep, modelSecretRep} {
		t.Run(representation, func(t *testing.T) {
			client := secretsClient(t)
			page, err := registration.Enumerate(context.Background(), client, resourcev2.EnumerateRequest{Target: secretsTarget(secretsToken, representation, anyNamespaceAnyName()), PageSize: 256})
			require.NoError(t, err)
			requireSecretPage(t, page, allSecrets()...)
			assert.Contains(t, types[secretsToken].Representations, resourcev2.Representation{ID: representation, Revision: representation}, "the representation the host asks for is one the catalog declares")
		})
	}
}

func TestSecretsOfOneNamespaceAndTheLabelQueryAreProjectedToo(t *testing.T) {
	registrations, _ := secretsRegistrations(t)
	registration := registrations[secretsToken]
	client := secretsClient(t)

	scope := resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeOneOf, Values: &[]string{"billing"}}, {Dimension: "name", Match: resourcev2.ScopeAny}}
	page, err := registration.Enumerate(context.Background(), client, resourcev2.EnumerateRequest{Target: secretsTarget(secretsToken, rawSecretRep, scope), PageSize: 256})
	require.NoError(t, err)
	requireSecretPage(t, page, "billing/credentials")

	query := resourcev2.NativeQueryRequest{
		Target: secretsTarget(secretsToken, rawSecretRep, anyNamespaceAnyName()), Language: nativeLabelSelectorLanguage, PageSize: 256,
		Query: resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"labelSelector": {Kind: "string", String: "app=shop"}}},
	}
	page, err = registration.NativeQuery(context.Background(), client, query)
	require.NoError(t, err)
	requireSecretPage(t, page, allSecrets()...)
}

// The detail page of one object reads it by name: a read narrowed to the namespace and the name of one Secret.
func TestTheNameNarrowedReadOfOneSecretIsProjected(t *testing.T) {
	registrations, _ := secretsRegistrations(t)
	registration := registrations[secretsToken]
	client := secretsClient(t)

	scope := resourcev2.QueryScope{
		{Dimension: "namespace", Match: resourcev2.ScopeOneOf, Values: &[]string{"shop"}},
		{Dimension: "name", Match: resourcev2.ScopeOneOf, Values: &[]string{"credentials"}},
	}
	page, err := registration.Enumerate(context.Background(), client, resourcev2.EnumerateRequest{Target: secretsTarget(secretsToken, rawSecretRep, scope), PageSize: 256})
	require.NoError(t, err)
	requireSecretPage(t, page, "shop/credentials")
}

func TestGettingOneSecretSendsNoValue(t *testing.T) {
	registrations, _ := secretsRegistrations(t)
	registration := registrations[secretsToken]
	for _, representation := range []string{rawSecretRep, modelSecretRep} {
		for _, secret := range secretFixtures() {
			t.Run(representation+" "+secret.namespace+"/"+secret.name, func(t *testing.T) {
				record, err := registration.Get(context.Background(), secretsClient(t), resourcev2.GetRequest{Route: resourcev2.AccessRoute{Connection: "route"}, Reference: secretsReference(secretsToken, secret.namespace, secret.name), Representation: representation})
				require.NoError(t, err)
				requireSecretRecord(t, record, secret)
			})
		}
	}
}

func TestMutatingASecretReturnsNoValue(t *testing.T) {
	registrations, _ := secretsRegistrations(t)
	registration := registrations[secretsToken]
	mutation := func(operation, namespace, name string, input resourcev2.Value) resourcev2.MutationRequest {
		return resourcev2.MutationRequest{Route: resourcev2.AccessRoute{Connection: "route"}, Reference: secretsReference(secretsToken, namespace, name), Operation: operation, Input: input}
	}
	byKey := fixtureByKey()

	// create: the server may echo the manifest it was given, stringData and all
	client := secretsClient(t)
	manifest, err := resourcev2.ValueFromNative(map[string]any{
		"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
		"metadata":   map[string]any{"name": "fresh", "namespace": "shop", "uid": "uid-shop-fresh", "resourceVersion": "7", "labels": map[string]any{"app": "shop"}, "creationTimestamp": "2026-11-19T10:00:00Z"},
		"stringData": map[string]any{"password": "sentinel-password-7f3a9c"},
	})
	require.NoError(t, err)
	created, err := registration.Mutate(context.Background(), client, mutation("create", "shop", "fresh", manifest))
	require.NoError(t, err)
	requireNoValue(t, "the result of create", recordOnTheWire(t, created))
	assert.Equal(t, map[string]int64{"password": int64(len("sentinel-password-7f3a9c"))}, keysOf(t, created, "stringData"), "stringData keeps its keys and their sizes in bytes")

	// update: the object as the user edited it, values and all, comes back from the server whole
	changed := byKey["shop/credentials"].object()
	changed.Object["metadata"].(map[string]any)["resourceVersion"] = "8"
	input, err := resourcev2.ValueFromNative(changed.Object)
	require.NoError(t, err)
	updated, err := registration.Mutate(context.Background(), client, mutation("update", "shop", "credentials", input))
	require.NoError(t, err)
	requireNoValue(t, "the result of update", recordOnTheWire(t, updated))
	assert.Equal(t, map[string]int64{"username": 20, "password": 24}, keysOf(t, updated, "data"))

	// delete: the record of the object that was deleted
	deleted, err := registration.Mutate(context.Background(), client, mutation("delete", "shop", "from-string-data", resourcev2.Value{Kind: "null"}))
	require.NoError(t, err)
	requireSecretRecord(t, deleted, byKey["shop/from-string-data"])
}

// secretFrames is a source session's emitter: it keeps what the plugin emits, as the frames the host receives them.
type secretFrames struct {
	mu     sync.Mutex
	frames []resourcev2.SourceFrame
	signal chan struct{}
}

func newSecretFrames() *secretFrames { return &secretFrames{signal: make(chan struct{}, 64)} }

func (f *secretFrames) add(frame resourcev2.SourceFrame) error {
	f.mu.Lock()
	frame.Sequence = uint64(len(f.frames)) + 1
	f.frames = append(f.frames, frame)
	f.mu.Unlock()
	select {
	case f.signal <- struct{}{}:
	default:
	}
	return nil
}
func (f *secretFrames) Snapshot(_ context.Context, observations []resourcev2.SourceObservation) error {
	return f.add(resourcev2.SourceFrame{SessionID: "session", Generation: "generation", Snapshot: &resourcev2.SourceSnapshot{Observations: slices.Clone(observations)}})
}
func (f *secretFrames) EndSnapshot(_ context.Context, coverage resourcev2.SourceCoverage, continuity string) error {
	return f.add(resourcev2.SourceFrame{SessionID: "session", Generation: "generation", SnapshotEnd: &resourcev2.SourceSnapshotEnd{Coverage: coverage, Continuity: continuity}})
}
func (f *secretFrames) Changes(_ context.Context, changes []resourcev2.SourceChange, coverage *resourcev2.SourceCoverage) error {
	return f.add(resourcev2.SourceFrame{SessionID: "session", Generation: "generation", Changes: &resourcev2.SourceChanges{Changes: slices.Clone(changes), Coverage: coverage}})
}
func (f *secretFrames) Reset(_ context.Context, reason, message string) error {
	return f.add(resourcev2.SourceFrame{SessionID: "session", Generation: "generation", Reset: &resourcev2.SourceReset{Reason: reason, Message: message}})
}

func (f *secretFrames) snapshot() []resourcev2.SourceFrame {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.frames)
}

// until waits for the frames to satisfy done.
func (f *secretFrames) until(t *testing.T, what string, done func([]resourcev2.SourceFrame) bool) []resourcev2.SourceFrame {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		if frames := f.snapshot(); done(frames) {
			return frames
		}
		select {
		case <-f.signal:
		case <-deadline:
			t.Fatalf("timed out waiting for %s", what)
		}
	}
}

func openSecretSource(t *testing.T, client *clients.ClientSet, scope resourcev2.QueryScope, representation string) *secretFrames {
	t.Helper()
	registrations, _ := secretsRegistrations(t)
	registration := registrations[secretsToken]
	frames := newSecretFrames()
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		_ = registration.Source(ctx, client, resourcev2.SourceRequest{
			Target:         secretsTarget(secretsToken, representation, scope),
			Representation: resourcev2.Representation{ID: representation, Revision: representation},
			Limits:         resourcev2.SourceLimits{MaxFrameBytes: resourcev2.MaxSourceFrameBytes, MaxBatchItems: resourcev2.MaxSourceBatchItems},
		}, frames)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-finished:
		case <-time.After(10 * time.Second):
			t.Error("the source did not stop")
		}
	})
	return frames
}

func hasBoundary(frames []resourcev2.SourceFrame) bool {
	return slices.ContainsFunc(frames, func(frame resourcev2.SourceFrame) bool { return frame.SnapshotEnd != nil })
}

func observationsOf(frames []resourcev2.SourceFrame) []resourcev2.SourceObservation {
	var all []resourcev2.SourceObservation
	for _, frame := range frames {
		if frame.Snapshot != nil {
			all = append(all, frame.Snapshot.Observations...)
		}
		if frame.Changes != nil {
			for _, change := range frame.Changes.Changes {
				if change.Observation != nil {
					all = append(all, *change.Observation)
				}
			}
		}
	}
	return all
}

func recordOf(observation resourcev2.SourceObservation) resourcev2.Record {
	source := observation.Record
	return resourcev2.Record{Reference: source.Reference, Body: source.Body, Representation: source.Representation, Coverage: source.Coverage, SourceRevision: source.SourceRevision}
}

func requireNoValueInFrames(t *testing.T, frames []resourcev2.SourceFrame) {
	t.Helper()
	for i, frame := range frames {
		requireNoValue(t, fmt.Sprintf("frame %d", i+1), frameOnTheWire(t, frame))
	}
}

func TestTheLiveSourceOfSecretsSendsNoValueInASnapshotOrAChange(t *testing.T) {
	client := secretsClient(t)
	frames := openSecretSource(t, client, anyNamespaceAnyName(), rawSecretRep)
	opened := frames.until(t, "the snapshot", hasBoundary)
	requireNoValueInFrames(t, opened)
	byKey := fixtureByKey()
	var listed []string
	for _, observation := range observationsOf(opened) {
		record := recordOf(observation)
		listed = append(listed, recordKey(record))
		requireSecretRecord(t, record, byKey[recordKey(record)])
	}
	assert.ElementsMatch(t, allSecrets(), listed)

	secrets := client.DynamicClient.Resource(secretsGVR)

	// modify: a value changes, and so does the manifest annotation
	changed := byKey["shop/credentials"].object()
	changed.Object["metadata"].(map[string]any)["resourceVersion"] = "8"
	changed.Object["data"] = map[string]any{"username": base64.StdEncoding.EncodeToString([]byte("sentinel-user-4b1d6e")), "password": base64.StdEncoding.EncodeToString([]byte("sentinel-password-7f3a9c"))}
	_, err := secrets.Namespace("shop").Update(context.Background(), changed, metav1.UpdateOptions{})
	require.NoError(t, err)

	// add: a Secret made after the page opened, from a manifest with stringData
	added := heldSecret{namespace: "shop", name: "late", secretType: "Opaque", data: map[string][]byte{"password": []byte("sentinel-password-7f3a9c")},
		annotations: map[string]string{lastApplied: applied("shop", "late", map[string]string{"password": "sentinel-password-7f3a9c"})}}
	_, err = secrets.Namespace("shop").Create(context.Background(), added.object(), metav1.CreateOptions{})
	require.NoError(t, err)

	after := frames.until(t, "the modify and the add", func(all []resourcev2.SourceFrame) bool { return len(observationsOf(all[len(opened):])) >= 2 })
	requireNoValueInFrames(t, after)
	for _, observation := range observationsOf(after[len(opened):]) {
		record := recordOf(observation)
		switch recordKey(record) {
		case "shop/credentials":
			requireSecretRecordAt(t, record, byKey["shop/credentials"], "8")
		case "shop/late":
			requireSecretRecord(t, record, added)
		default:
			t.Errorf("unexpected change of %s", recordKey(record))
		}
	}

	// delete: the removal names the Secret and holds nothing of it
	require.NoError(t, secrets.Namespace("shop").Delete(context.Background(), "late", metav1.DeleteOptions{}))
	removed := frames.until(t, "the removal", func(all []resourcev2.SourceFrame) bool {
		return slices.ContainsFunc(all, func(frame resourcev2.SourceFrame) bool {
			return frame.Changes != nil && slices.ContainsFunc(frame.Changes.Changes, func(change resourcev2.SourceChange) bool { return change.Kind == resourcev2.SourceChangeRemove })
		})
	})
	requireNoValueInFrames(t, removed)
}

// The detail page of one object follows it through a source narrowed to its name.
func TestTheNameNarrowedLiveSourceOfOneSecretSendsNoValue(t *testing.T) {
	client := secretsClient(t)
	scope := resourcev2.QueryScope{
		{Dimension: "namespace", Match: resourcev2.ScopeOneOf, Values: &[]string{"shop"}},
		{Dimension: "name", Match: resourcev2.ScopeOneOf, Values: &[]string{"credentials"}},
	}
	frames := openSecretSource(t, client, scope, modelSecretRep)
	opened := frames.until(t, "the snapshot", hasBoundary)
	requireNoValueInFrames(t, opened)
	observations := observationsOf(opened)
	require.Len(t, observations, 1)
	byKey := fixtureByKey()
	requireSecretRecord(t, recordOf(observations[0]), byKey["shop/credentials"])

	changed := byKey["shop/credentials"].object()
	changed.Object["metadata"].(map[string]any)["resourceVersion"] = "8"
	_, err := client.DynamicClient.Resource(secretsGVR).Namespace("shop").Update(context.Background(), changed, metav1.UpdateOptions{})
	require.NoError(t, err)
	after := frames.until(t, "the change", func(all []resourcev2.SourceFrame) bool { return len(observationsOf(all[len(opened):])) >= 1 })
	requireNoValueInFrames(t, after)
	for _, observation := range observationsOf(after[len(opened):]) {
		requireSecretRecordAt(t, recordOf(observation), byKey["shop/credentials"], "8")
	}
}

// What is not a Secret is sent whole: a ConfigMap's values are configuration, and a read of it is the object as the server holds it.
func TestAConfigMapIsSentWholeBySecretProjectionsLeavingItAlone(t *testing.T) {
	registrations, _ := secretsRegistrations(t)
	registration := registrations[configMapsToken]
	client := secretsClient(t)
	want, err := resourcev2.ValueFromNative(shopSettings().Object)
	require.NoError(t, err)

	page, err := registration.Enumerate(context.Background(), client, resourcev2.EnumerateRequest{Target: secretsTarget(configMapsToken, rawSecretRep, anyNamespaceAnyName()), PageSize: 256})
	require.NoError(t, err)
	require.Len(t, page.Records, 1)
	assert.Equal(t, want, page.Records[0].Body, "the whole object, its annotations and its values")
	assert.Equal(t, resourcev2.Coverage{Kind: "complete", Paths: []string{}}, page.Records[0].Coverage)
	assert.Equal(t, resourcev2.Coverage{Kind: "complete", Paths: []string{}}, page.Coverage)

	record, err := registration.Get(context.Background(), client, resourcev2.GetRequest{Route: resourcev2.AccessRoute{Connection: "route"}, Reference: secretsReference(configMapsToken, "shop", "settings"), Representation: rawSecretRep})
	require.NoError(t, err)
	assert.Equal(t, want, record.Body)

	frames := openConfigMapSource(t, client)
	observations := observationsOf(frames.until(t, "the snapshot", hasBoundary))
	require.Len(t, observations, 1)
	assert.Equal(t, want, observations[0].Record.Body)
	assert.Equal(t, resourcev2.Coverage{Kind: "complete", Paths: []string{}}, observations[0].Record.Coverage)
}

func openConfigMapSource(t *testing.T, client *clients.ClientSet) *secretFrames {
	t.Helper()
	registrations, _ := secretsRegistrations(t)
	frames := newSecretFrames()
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		_ = registrations[configMapsToken].Source(ctx, client, resourcev2.SourceRequest{
			Target:         secretsTarget(configMapsToken, rawSecretRep, anyNamespaceAnyName()),
			Representation: resourcev2.Representation{ID: rawSecretRep, Revision: rawSecretRep},
			Limits:         resourcev2.SourceLimits{MaxFrameBytes: resourcev2.MaxSourceFrameBytes, MaxBatchItems: resourcev2.MaxSourceBatchItems},
		}, frames)
	}()
	t.Cleanup(func() {
		cancel()
		<-finished
	})
	return frames
}

// A kind of another API group that is called "secrets" is not the core Secret: it is sent whole.
func TestAKindOtherThanTheCoreSecretThatIsCalledSecretsIsSentWhole(t *testing.T) {
	custom := schema.GroupVersionResource{Group: "vault.example", Version: "v1", Resource: "secrets"}
	object := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "vault.example/v1", "kind": "Secret",
		"metadata": map[string]any{"name": "lease", "namespace": "shop", "uid": "uid-lease", "resourceVersion": "1"},
		"data":     map[string]any{"path": "secret/shop/lease"},
	}}
	client := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{custom: "SecretList"}, object)
	request := nativeTestGet("shop")
	request.Reference.Address.ID = "lease"
	request.Reference.Address.Type = "k8s:vault.example/secrets"
	record, err := NativeGet(context.Background(), client, custom, true, request, nativeTestRepresentation())
	require.NoError(t, err)
	want, err := resourcev2.ValueFromNative(object.Object)
	require.NoError(t, err)
	assert.Equal(t, want, record.Body)
	assert.Equal(t, "complete", record.Coverage.Kind)
}
