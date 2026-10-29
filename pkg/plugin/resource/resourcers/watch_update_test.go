package resourcers

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource/resourcetest"
)

// updateMarshalProbe makes serialization observable without replacing the production callback.
type updateMarshalProbe struct {
	calls int
}

func (p *updateMarshalProbe) MarshalJSON() ([]byte, error) {
	p.calls++
	return []byte(`"encoded"`), nil
}

func TestMakeEventHandler_Update(t *testing.T) {
	tests := []struct {
		name    string
		prepare func(old, next *unstructured.Unstructured) (interface{}, interface{})
		forward bool
	}{
		{name: "unchanged replay"},
		{
			name: "same pointer replay",
			prepare: func(old, _ *unstructured.Unstructured) (interface{}, interface{}) {
				return old, old
			},
		},
		{
			name: "changed version",
			prepare: func(old, next *unstructured.Unstructured) (interface{}, interface{}) {
				next.SetResourceVersion("43")
				return old, next
			},
			forward: true,
		},
		{
			name: "both versions empty",
			prepare: func(old, next *unstructured.Unstructured) (interface{}, interface{}) {
				old.SetResourceVersion("")
				next.SetResourceVersion("")
				return old, next
			},
			forward: true,
		},
		{
			name: "old version empty",
			prepare: func(old, next *unstructured.Unstructured) (interface{}, interface{}) {
				old.SetResourceVersion("")
				return old, next
			},
			forward: true,
		},
		{
			name: "new version empty",
			prepare: func(old, next *unstructured.Unstructured) (interface{}, interface{}) {
				next.SetResourceVersion("")
				return old, next
			},
			forward: true,
		},
		{
			name: "replacement UID",
			prepare: func(old, next *unstructured.Unstructured) (interface{}, interface{}) {
				next.SetUID("replacement-uid")
				return old, next
			},
			forward: true,
		},
		{
			name: "removed UID",
			prepare: func(old, next *unstructured.Unstructured) (interface{}, interface{}) {
				next.SetUID("")
				return old, next
			},
			forward: true,
		},
		{
			name: "different name",
			prepare: func(old, next *unstructured.Unstructured) (interface{}, interface{}) {
				next.SetName("replacement-name")
				return old, next
			},
			forward: true,
		},
		{
			name: "different namespace",
			prepare: func(old, next *unstructured.Unstructured) (interface{}, interface{}) {
				next.SetNamespace("other")
				return old, next
			},
			forward: true,
		},
		{
			name: "different kind",
			prepare: func(old, next *unstructured.Unstructured) (interface{}, interface{}) {
				next.SetKind("Node")
				return old, next
			},
			forward: true,
		},
		{
			name: "different API version",
			prepare: func(old, next *unstructured.Unstructured) (interface{}, interface{}) {
				next.SetAPIVersion("example.io/v1")
				return old, next
			},
			forward: true,
		},
		{
			name: "nil old object",
			prepare: func(_, next *unstructured.Unstructured) (interface{}, interface{}) {
				return nil, next
			},
			forward: true,
		},
		{
			name: "typed nil old object",
			prepare: func(_, next *unstructured.Unstructured) (interface{}, interface{}) {
				return (*unstructured.Unstructured)(nil), next
			},
			forward: true,
		},
		{
			name: "unexpected old type",
			prepare: func(_, next *unstructured.Unstructured) (interface{}, interface{}) {
				return "not an object", next
			},
			forward: true,
		},
		{
			name: "nil new object",
			prepare: func(old, _ *unstructured.Unstructured) (interface{}, interface{}) {
				return old, nil
			},
		},
		{
			name: "typed nil new object",
			prepare: func(old, _ *unstructured.Unstructured) (interface{}, interface{}) {
				return old, (*unstructured.Unstructured)(nil)
			},
		},
		{
			name: "unexpected new type",
			prepare: func(old, _ *unstructured.Unstructured) (interface{}, interface{}) {
				return old, "not an object"
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			old := newTestPod("web", "default")
			old.SetUID("pod-uid")
			old.SetResourceVersion("42")
			next := old.DeepCopy()
			next.SetLabels(map[string]string{"app": "web"})
			var oldObj, newObj interface{} = old, next
			if tt.prepare != nil {
				oldObj, newObj = tt.prepare(old, next)
			}
			probe := &updateMarshalProbe{}
			if obj, ok := newObj.(*unstructured.Unstructured); ok && obj != nil {
				obj.Object["encodeProbe"] = probe
			}

			sink := resourcetest.NewRecordingSink()
			meta := resource.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}
			makeEventHandler(meta, sink).UpdateFunc(oldObj, newObj)

			if !tt.forward {
				assert.Zero(t, probe.calls, "replays must skip serialization, not only sink delivery")
				assert.Zero(t, sink.UpdateCount())
				return
			}
			require.Equal(t, 1, probe.calls)
			require.Equal(t, 1, sink.UpdateCount())
			payload := sink.Updates[0]
			obj := newObj.(*unstructured.Unstructured)
			assert.Equal(t, meta.Key(), payload.Key)
			assert.Equal(t, obj.GetName(), payload.ID)
			assert.Equal(t, obj.GetNamespace(), payload.Namespace)
			assert.Equal(t, string(obj.GetUID()), payload.Metadata.UID)
			assert.Equal(t, obj.GetLabels(), payload.Metadata.Labels)
			var data unstructured.Unstructured
			require.NoError(t, json.Unmarshal(payload.Data, &data))
			assert.Equal(t, obj.GetResourceVersion(), data.GetResourceVersion())
		})
	}
}

func TestMakeEventHandler_AddReplayPreserved(t *testing.T) {
	pod := newTestPod("web", "default")
	pod.SetUID("pod-uid")
	pod.SetResourceVersion("42")
	probe := &updateMarshalProbe{}
	pod.Object["encodeProbe"] = probe
	sink := resourcetest.NewRecordingSink()
	handler := makeEventHandler(resource.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}, sink)
	handler.AddFunc(pod)
	handler.AddFunc(pod)
	assert.Equal(t, 2, probe.calls)
	assert.Equal(t, 2, sink.AddCount(), "initial ADD replay must not use update deduplication")
}

func TestWatch_ChangedAndEmptyVersionUpdates(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	pod := newTestPod("web", "default")
	pod.SetUID("pod-uid")
	pod.SetResourceVersion("42")
	cs := newWatchableClientSet(testGVR, defaultGVRListKinds(), pod)
	sink := resourcetest.NewRecordingSink()
	meta := resource.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}
	done := make(chan error, 1)
	go func() {
		done <- newBaseResourcer().Watch(ctx, cs, meta, sink)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			assert.NoError(t, err)
		case <-time.After(5 * time.Second):
			t.Error("Watch did not return after context cancellation")
		}
		cs.StopFactory()
		cs.DynamicInformerFactory.Shutdown()
	})
	sink.WaitForState(t, meta.Key(), resource.WatchStateSynced, 5*time.Second)
	sink.WaitForAdds(t, 1, 5*time.Second)

	for i, version := range []string{"43", ""} {
		next := pod.DeepCopy()
		next.SetResourceVersion(version)
		next.SetLabels(map[string]string{"version": version})
		_, err := cs.DynamicClient.Resource(testGVR).Namespace("default").Update(ctx, next, metav1.UpdateOptions{})
		require.NoError(t, err)
		sink.WaitForUpdates(t, i+1, 5*time.Second)
	}
	assert.Equal(t, 2, sink.UpdateCount())
}
