package resourcers

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// The live source of Secrets: the snapshot, a change, an addition and the source narrowed to one object by its name (the detail page's) hold no value. The tests look at the frames as the host
// receives them, in JSON and as protobuf, for the values and for the manifest annotation that holds them.

func newSecretsResourcer() *KubernetesResourcerBase[MetaAccessor] {
	return NewKubernetesResourcerBase[MetaAccessor](zap.NewNop().Sugar(), secretsResource)
}

func secretObject(name, namespace, uid, revision string, data map[string]any, applied string) *unstructured.Unstructured {
	object := secretOf(data)
	metadata := object["metadata"].(map[string]any)
	metadata["name"], metadata["namespace"], metadata["uid"], metadata["resourceVersion"] = name, namespace, uid, revision
	if applied != "" {
		metadata["annotations"] = map[string]any{"kubectl.kubernetes.io/last-applied-configuration": applied, "owner": "payments"}
	}
	return &unstructured.Unstructured{Object: object}
}

func secretsServer(t *testing.T, objects ...*unstructured.Unstructured) (*clients.ClientSet, *nativeTraffic) {
	t.Helper()
	held := make([]runtime.Object, 0, len(objects))
	for _, object := range objects {
		held = append(held, object)
	}
	cs := newFakeClientSet(map[schema.GroupVersionResource]string{secretsResource: "SecretList"}, held...)
	return cs, serveFieldSelectors(t, cs, secretsResource, "Secret")
}

const (
	passwordValue = "sentinel-password-7f3a9c"
	tokenValue    = "sentinel-token-52d0b8"
)

func manifestOf(namespace, name, key, value string) string {
	encoded, err := json.Marshal(map[string]any{"apiVersion": "v1", "kind": "Secret", "metadata": map[string]any{"name": name, "namespace": namespace}, "stringData": map[string]any{key: value}})
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

// requireNothingOfTheValues fails if a value, in the clear or as base64, is in the JSON or the protobuf of the frames.
func requireNothingOfTheValues(t *testing.T, label string, observations []resource.SourceObservation, changes []resource.SourceChange) {
	t.Helper()
	var frames []resource.SourceFrame
	if len(observations) != 0 {
		frames = append(frames, resource.SourceFrame{SessionID: "session", Generation: "generation", Sequence: 1, Snapshot: &resource.SourceSnapshot{Observations: observations}})
	}
	if len(changes) != 0 {
		frames = append(frames, resource.SourceFrame{SessionID: "session", Generation: "generation", Sequence: 2, Changes: &resource.SourceChanges{Changes: changes}})
	}
	require.NotEmpty(t, frames, label)
	for _, frame := range frames {
		encoded, err := json.Marshal(frame)
		require.NoError(t, err)
		wire, err := resource.ToProtoSourceFrame(frame)
		require.NoError(t, err)
		message, err := proto.Marshal(wire)
		require.NoError(t, err)
		for _, value := range []string{passwordValue, tokenValue} {
			for _, form := range []string{value, encode([]byte(value))} {
				assert.False(t, bytes.Contains(encoded, []byte(form)), "%s: %q... is in the JSON of a frame", label, form[:12])
				assert.False(t, bytes.Contains(message, []byte(form)), "%s: %q... is in the protobuf of a frame", label, form[:12])
			}
		}
	}
}

func TestTheSnapshotAndTheChangesOfASecretSourceHoldNoValue(t *testing.T) {
	cs, _ := secretsServer(t,
		secretObject("credentials", "checkout", "credentials-uid", "1", map[string]any{"password": encode([]byte(passwordValue))}, manifestOf("checkout", "credentials", "password", passwordValue)),
		secretObject("api", "checkout", "api-uid", "1", map[string]any{"token": encode([]byte(tokenValue))}, manifestOf("checkout", "api", "token", tokenValue)),
	)
	opened := openSource(t, newSecretsResourcer(), cs, selection(oneOf("checkout"), nil))
	require.ElementsMatch(t, []string{"checkout/credentials", "checkout/api"}, opened.names())
	requireNothingOfTheValues(t, "snapshot", opened.snapshot, nil)
	for _, observation := range opened.snapshot {
		record := observation.Record
		assert.Equal(t, "partial", record.Coverage.Kind, "the record says what it leaves out")
		assert.Contains(t, record.Coverage.Paths, "/data")
		assert.NotEmpty(t, record.Coverage.Reason)
		assert.Equal(t, "Opaque", record.Body.Map["type"].String)
		annotations := record.Body.Map["metadata"].Map["annotations"].Map
		assert.NotContains(t, annotations, "kubectl.kubernetes.io/last-applied-configuration")
		assert.Equal(t, "payments", annotations["owner"].String)
		require.Contains(t, record.Body.Map, "data")
		for name, entry := range record.Body.Map["data"].Map {
			assert.Equal(t, "map", entry.Kind, "the entry %s is its size, never its value", name)
		}
	}

	// modify
	changed := secretObject("credentials", "checkout", "credentials-uid", "2", map[string]any{"password": encode([]byte(passwordValue)), "token": encode([]byte(tokenValue))}, manifestOf("checkout", "credentials", "password", passwordValue))
	_, err := cs.DynamicClient.Resource(secretsResource).Namespace("checkout").Update(context.Background(), changed, metav1.UpdateOptions{})
	require.NoError(t, err)
	event := nextSourceTestEvent(t, opened.emitter)
	require.Len(t, event.changes, 1)
	require.Equal(t, resource.SourceChangeUpsert, event.changes[0].Kind)
	requireNothingOfTheValues(t, "modify", nil, event.changes)
	data := event.changes[0].Observation.Record.Body.Map["data"].Map
	require.Len(t, data, 2, "the key that was added is in the record, by its name")
	assert.Equal(t, resource.Value{Kind: "int64", Int: "24"}, data["password"].Map["size"])
	assert.Equal(t, resource.Value{Kind: "int64", Int: "21"}, data["token"].Map["size"])

	// add
	_, err = cs.DynamicClient.Resource(secretsResource).Namespace("checkout").Create(context.Background(), secretObject("late", "checkout", "late-uid", "1", map[string]any{"password": encode([]byte(passwordValue))}, manifestOf("checkout", "late", "password", passwordValue)), metav1.CreateOptions{})
	require.NoError(t, err)
	event = nextSourceTestEvent(t, opened.emitter)
	require.Len(t, event.changes, 1)
	requireNothingOfTheValues(t, "add", nil, event.changes)
	assert.Equal(t, "late", event.changes[0].Observation.Record.Reference.Address.ID)

	// delete: nothing of the Secret travels with its removal
	require.NoError(t, cs.DynamicClient.Resource(secretsResource).Namespace("checkout").Delete(context.Background(), "late", metav1.DeleteOptions{}))
	event = nextSourceTestEvent(t, opened.emitter)
	require.Len(t, event.changes, 1)
	require.Equal(t, resource.SourceChangeRemove, event.changes[0].Kind)
	requireNothingOfTheValues(t, "remove", nil, event.changes)
}

func TestTheSourceNarrowedToOneSecretHoldsNoValueEither(t *testing.T) {
	cs, traffic := secretsServer(t,
		secretObject("credentials", "checkout", "credentials-uid", "1", map[string]any{"password": encode([]byte(passwordValue))}, manifestOf("checkout", "credentials", "password", passwordValue)),
		secretObject("credentials", "staging", "staging-uid", "1", map[string]any{"password": encode([]byte(tokenValue))}, manifestOf("staging", "credentials", "password", tokenValue)),
		secretObject("api", "checkout", "api-uid", "1", map[string]any{"token": encode([]byte(tokenValue))}, ""),
	)
	opened := openSource(t, newSecretsResourcer(), cs, selection(oneOf("checkout"), oneOf("credentials")))
	require.Equal(t, []string{"checkout/credentials"}, opened.names(), "the detail page reads one object")
	requireNothingOfTheValues(t, "snapshot", opened.snapshot, nil)
	lists, watches := traffic.asked()
	for _, selector := range append(lists, watches...) {
		assert.Equal(t, "metadata.name=credentials", selector, "the server narrows the read; the projection is not what narrows it")
	}

	changed := secretObject("credentials", "checkout", "credentials-uid", "2", map[string]any{"password": encode([]byte(passwordValue))}, manifestOf("checkout", "credentials", "password", passwordValue))
	_, err := cs.DynamicClient.Resource(secretsResource).Namespace("checkout").Update(context.Background(), changed, metav1.UpdateOptions{})
	require.NoError(t, err)
	event := nextSourceTestEvent(t, opened.emitter)
	require.Len(t, event.changes, 1)
	requireNothingOfTheValues(t, "modify", nil, event.changes)
	assert.Equal(t, "2", *event.changes[0].Observation.Record.SourceRevision)
}

// The objects of a source are the informer's, shared with every session that reads them: reading a Secret for a source must not change what the next session finds.
func TestTwoSourcesOfOneSecretBothHoldNoValue(t *testing.T) {
	cs, _ := secretsServer(t, secretObject("credentials", "checkout", "credentials-uid", "1", map[string]any{"password": encode([]byte(passwordValue))}, manifestOf("checkout", "credentials", "password", passwordValue)))
	first := openSource(t, newSecretsResourcer(), cs, selection(oneOf("checkout"), oneOf("credentials")))
	second := openSource(t, newSecretsResourcer(), cs, selection(oneOf("checkout"), oneOf("credentials")))
	for _, opened := range []openedSource{first, second} {
		require.Equal(t, []string{"checkout/credentials"}, opened.names())
		requireNothingOfTheValues(t, "snapshot", opened.snapshot, nil)
		assert.Equal(t, resource.Value{Kind: "int64", Int: "24"}, opened.snapshot[0].Record.Body.Map["data"].Map["password"].Map["size"])
	}
}
