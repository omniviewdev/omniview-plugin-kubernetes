package logs

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// What the plugin-sdk v0.22.0 changed for a plugin that serves logs, held with the plugin's own
// handlers under the SDK's real manager. The plugin calls neither UpdateSessionOptions nor Close
// itself (the host's source sync and the SDK's shutdown do), so it has no code to change: these
// tests say what the plugin's sessions do now.

func ended(items []sinkItem) bool {
	for _, item := range items {
		if item.event != nil && item.event.Type == sdklogs.StreamEventStreamEnded && item.event.SourceID == "" {
			return true
		}
	}
	return false
}

func TestUpdatingAnEndedLogSessionThatWouldStartASourceIsAConflict(t *testing.T) {
	r := newSessionRig(t)
	r.kubelet.writeNumbered(r.kubelet.container("ns", "pod", "app"), "app", 1, 5)
	data := podResource("ns", "pod", nil, []string{"app"}, nil)
	session := r.create(data, sdklogs.LogSessionOptions{Follow: false, TailLines: 3})
	items := r.sink.waitFor(t, "the end of the session", ended)
	linesAtEnd := len(linesOf(items))
	require.Equal(t, 3, linesAtEnd)

	updated, err := r.manager.UpdateSessionOptions(nil, session.ID, sdklogs.LogSessionOptions{TailLines: 9, Params: map[string]string{"enabled_sources": ""}})

	require.Error(t, err)
	assert.Nil(t, updated)
	assert.Equal(t, "CONFLICT", resourcev2.ErrorCode(err), "the session is over: the host opens a new one if the user still wants the sources")
	time.Sleep(100 * time.Millisecond)
	assert.Equal(t, linesAtEnd, len(linesOf(r.sink.snapshot())), "no source streams again after STREAM_ENDED")
	assert.Len(t, r.kubelet.Reads("app"), 1, "and the cluster was not read again")

	applied, err := r.manager.UpdateSessionOptions(nil, session.ID, sdklogs.LogSessionOptions{TailLines: 9})
	require.NoError(t, err, "an update that starts no source is applied to an ended session, as it always was")
	assert.EqualValues(t, 9, applied.Options.TailLines)
}

func TestALogSessionStartedAfterTheManagerClosedIsAConnectionError(t *testing.T) {
	r := newSessionRig(t)
	r.kubelet.writeNumbered(r.kubelet.container("ns", "pod", "app"), "app", 1, 5)
	r.manager.Close()
	r.manager.Close() // idempotent: every call returns once the sessions are gone

	ctx := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}
	session, err := r.manager.CreateResourceSession(ctx, sdklogs.CreateSessionOptions{
		ResourceKey: "k8s:/pods", ResourceID: "pod",
		ResourceData: podResource("ns", "pod", nil, []string{"app"}, nil),
		Options:      sdklogs.LogSessionOptions{Follow: true},
	})

	require.Error(t, err)
	assert.Nil(t, session)
	assert.Equal(t, "CONNECTION_ERROR", resourcev2.ErrorCode(err), "the manager is going away: a retry into it cannot succeed, so it is surfaced once")
	assert.Empty(t, r.kubelet.Requests(), "refused before any native work")
}
