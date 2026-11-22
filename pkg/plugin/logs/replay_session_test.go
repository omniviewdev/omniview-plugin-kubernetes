package logs

import (
	"context"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// These tests run the plugin's own handlers (what Register installs) under the SDK's real log
// manager, over the fake kubelet: what a reader that asks for replay markers is told, and that a
// reader that does not ask gets the stream it always got.

func asking() map[string]string {
	return map[string]string{sdklogs.ParamReplayMarkers: sdklogs.ReplayMarkersOn}
}

func caughtUp(items []sinkItem) int {
	n := 0
	for _, item := range items {
		if item.event != nil && item.event.Type == sdklogs.StreamEventSourceCaughtUp {
			n++
		}
	}
	return n
}

func flagged(items []sinkItem) int {
	n := 0
	for _, item := range items {
		if item.line != nil && item.line.Replay {
			n++
		}
	}
	return n
}

func TestASessionThatAsksIsToldWhereEachContainersReplayEnds(t *testing.T) {
	r := newSessionRig(t)
	// A Pod's sources are its containers: init, regular and ephemeral ones, each with its own log.
	logs := map[string]int{"setup": 3, "app": 300, "side": 5, "debug": 0}
	for name, n := range logs {
		r.kubelet.writeNumbered(r.kubelet.container("ns", "pod", name), name, 1, n)
	}
	data := podResource("ns", "pod", []string{"setup"}, []string{"app", "side"}, []string{"debug"})

	session := r.create(data, sdklogs.LogSessionOptions{Follow: true, TailLines: 100, Params: asking()})

	require.True(t, session.ReplayMarkers, "the create reply says a caught-up event will come: the Pod's handler declares its count")
	items := r.sink.waitFor(t, "a caught-up event for each container", func(items []sinkItem) bool { return caughtUp(items) == len(logs) })
	want := map[string]int{"pod/setup": 3, "pod/app": 100, "pod/side": 5, "pod/debug": 0}
	sources := bySource(items)
	require.Len(t, sources, len(want))
	for source, replay := range want {
		mine := sources[source]
		assert.Equal(t, replay, flagged(mine), "%s: the lines flagged replay are the tail its stream delivers", source)
		assert.Equal(t, 1, caughtUp(mine), "%s: one caught-up event", source)
		seenEvent := false
		for _, item := range mine {
			switch {
			case item.event != nil && item.event.Type == sdklogs.StreamEventSourceCaughtUp:
				seenEvent = true
			case item.line != nil:
				assert.Equal(t, !seenEvent, item.line.Replay, "%s: a line is replay exactly when it comes before the event", source)
			}
		}
	}

	// What is written after the replay is live: unflagged, and after the event.
	r.kubelet.write(r.kubelet.container("ns", "pod", "app"), "app live 1", "app live 2")
	r.kubelet.write(r.kubelet.container("ns", "pod", "side"), "side live 1")
	items = r.sink.waitFor(t, "the live lines", func(items []sinkItem) bool {
		live := 0
		for _, item := range items {
			if item.line != nil && !item.line.Replay {
				live++
			}
		}
		return live == 3
	})
	assert.Equal(t, 3+100+5, flagged(items), "the flagged lines are the replay and no live line is flagged")
	assert.Equal(t, len(logs), caughtUp(items), "and the live lines add no event")

	for name := range logs {
		reads := r.kubelet.Reads(name)
		require.Len(t, reads, 2, "%s: one read to count and one to stream", name)
		assert.Empty(t, reads[0].Query.Get("follow"))
		assert.Equal(t, "true", reads[1].Query.Get("follow"))
		assert.Equal(t, queryWithoutFollow(reads[1].Query), queryWithoutFollow(reads[0].Query))
	}
}

func TestASessionThatDoesNotAskGetsTheStreamItAlwaysGot(t *testing.T) {
	run := func(params map[string]string) (*sdklogs.LogSession, []sinkItem, *fakeKubelet) {
		r := newSessionRig(t)
		r.kubelet.writeNumbered(r.kubelet.container("ns", "pod", "app"), "app", 1, 40)
		r.kubelet.writeNumbered(r.kubelet.container("ns", "pod", "side"), "side", 1, 10)
		data := podResource("ns", "pod", nil, []string{"app", "side"}, nil)
		session := r.create(data, sdklogs.LogSessionOptions{Follow: true, TailLines: 25, Params: params})
		items := r.sink.waitFor(t, "the replay", func(items []sinkItem) bool { return len(linesOf(items)) == 25+10 })
		return session, items, r.kubelet
	}

	plain, plainItems, plainKubelet := run(nil)
	asked, askedItems, askedKubelet := run(asking())

	assert.False(t, plain.ReplayMarkers, "a reader that did not ask is told no marker will come")
	assert.Zero(t, flagged(plainItems), "no line is flagged")
	assert.Zero(t, caughtUp(plainItems), "no caught-up event is sent")
	assert.True(t, asked.ReplayMarkers)

	// The stream is the same lines in the same per-source order, whether or not the reader asked.
	for source, mine := range bySource(askedItems) {
		assert.Equal(t, linesOf(bySource(plainItems)[source]), linesOf(mine), "%s", source)
	}
	for _, name := range []string{"app", "side"} {
		plainReads, askedReads := plainKubelet.Reads(name), askedKubelet.Reads(name)
		require.Len(t, plainReads, 1, "%s: a reader that did not ask costs the one read it always cost", name)
		require.Len(t, askedReads, 2)
		assert.Equal(t, plainReads[0].Query, askedReads[1].Query, "%s: the stream asks for what it always asked for", name)
		assert.Equal(t, "true", plainReads[0].Query.Get("follow"))
	}
}

func TestACountedLogThatRotatesBeforeTheOpenLosesNoLine(t *testing.T) {
	// The count is made, then the kubelet rotates the log, then the stream opens on the new file:
	// the SDK documents what the markers say then (fewer lines than counted: the next lines are
	// flagged until the count is reached, and a quiet source stays unknown). What the plugin owes
	// is that asking changes nothing about the lines: it only counts.
	run := func(params map[string]string) ([]sinkItem, []fakeRequest) {
		r := newSessionRig(t)
		app := r.kubelet.container("ns", "pod", "app")
		r.kubelet.writeNumbered(app, "old", 1, 50)
		var once sync.Once
		r.kubelet.setOnRequest(func(_ int, q url.Values) {
			if q.Get("follow") != "true" {
				return
			}
			once.Do(func() {
				r.kubelet.rotate(app)
				r.kubelet.write(app, "new 1", "new 2")
			})
		})
		data := podResource("ns", "pod", nil, []string{"app"}, nil)
		r.create(data, sdklogs.LogSessionOptions{Follow: true, TailLines: 1000, Params: params})
		r.sink.waitFor(t, "the lines of the new file", func(items []sinkItem) bool { return len(linesOf(items)) == 2 })
		time.Sleep(50 * time.Millisecond)
		return r.sink.snapshot(), r.kubelet.Reads("app")
	}

	plain, plainReads := run(nil)
	asked, askedReads := run(asking())

	assert.Equal(t, linesOf(plain), linesOf(asked), "the lines are the same with and without the count: none is lost, none is added")
	require.Len(t, linesOf(asked), 2)
	for _, item := range asked {
		if item.line != nil {
			assert.Contains(t, item.line.Content, "new", "the stream reads the file that is current when it opens")
		}
	}
	require.Len(t, plainReads, 1)
	require.Len(t, askedReads, 2)
	assert.Equal(t, plainReads[0].Query, askedReads[1].Query, "the stream's request is the one that is made without a count")
	assert.Zero(t, caughtUp(plain))
	assert.Zero(t, caughtUp(asked), "50 lines were counted and 2 came: the event waits for the counted lines, as the SDK documents")
	assert.Equal(t, 2, flagged(asked))
}

func TestAReplayCountThatFailsFailsTheAttemptAsAFailedOpenDoes(t *testing.T) {
	// A container that has not started: the count is refused as the stream would be. The SDK retries the
	// attempt with its backoff; the first retry waits a second, so the session is shown refused by the
	// reads the kubelet received, not by waiting for its end.
	r := newSessionRig(t)
	app := r.kubelet.container("ns", "pod", "app")
	app.waiting = "PodInitializing"
	data := podResource("ns", "pod", nil, []string{"app"}, nil)

	r.create(data, sdklogs.LogSessionOptions{Follow: true, Params: asking()})

	require.Eventually(t, func() bool { return len(r.kubelet.Reads("app")) >= 1 }, 10*time.Second, 5*time.Millisecond)
	time.Sleep(150 * time.Millisecond) // well inside the SDK's first backoff of a second: only the count was tried
	reads := r.kubelet.Reads("app")
	require.NotEmpty(t, reads)
	for _, read := range reads {
		assert.Empty(t, read.Query.Get("follow"), "the attempt fails at the count: a count that came back as 0 would have opened the stream")
	}
	assert.Zero(t, caughtUp(r.sink.snapshot()))
	assert.Zero(t, flagged(r.sink.snapshot()))
}

func TestAWorkloadSessionCountsEachSourceItsResolverGives(t *testing.T) {
	// A workload's sources are the containers of its Pods, resolved by the plugin's resolvers (which
	// this PR does not touch); the SDK streams them through the Pod handler, so that handler's count
	// decides whether the session gets markers and what each source's replay is. A Pod that appears
	// later is a source that opens later and is counted when it does.
	late := make(chan sdklogs.SourceEvent, 1)
	source := func(pod, container string) sdklogs.LogSource {
		return sdklogs.LogSource{
			ID:     pod + "/" + container,
			Labels: map[string]string{"pod": pod, "container": container, "namespace": "ns"},
		}
	}
	r := newSessionRigResolving(t, map[string]sdklogs.SourceResolver{
		"k8s:apps/deployments": func(*types.PluginContext, *resourcev2.Value, sdklogs.SourceResolverOptions) (*sdklogs.SourceResolverResult, error) {
			return &sdklogs.SourceResolverResult{
				Sources: []sdklogs.LogSource{source("web-a", "app"), source("web-a", "side"), source("web-b", "app")},
				Events:  late,
			}, nil
		},
	})
	logs := map[string]int{"web-a/app": 250, "web-a/side": 7, "web-b/app": 0, "web-c/app": 30}
	for id, n := range logs {
		pod, container, _ := strings.Cut(id, "/")
		r.kubelet.writeNumbered(r.kubelet.container("ns", pod, container), id, 1, n)
	}
	ctx := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "selected"}}

	session, err := r.manager.CreateResourceSession(ctx, sdklogs.CreateSessionOptions{
		ResourceKey: "k8s:apps/deployments", ResourceID: "web",
		ResourceData: taggedFixture(map[string]any{"metadata": map[string]any{"name": "web", "namespace": "ns"}}),
		Options:      sdklogs.LogSessionOptions{Follow: true, TailLines: 100, Params: asking()},
	})

	require.NoError(t, err)
	require.True(t, session.ReplayMarkers, "a group resource streams through the Pod handler, whose count decides")
	r.sink.waitFor(t, "the first three sources caught up", func(items []sinkItem) bool { return caughtUp(items) == 3 })
	late <- sdklogs.SourceEvent{Type: sdklogs.SourceAdded, Source: source("web-c", "app")}
	items := r.sink.waitFor(t, "the late source caught up", func(items []sinkItem) bool { return caughtUp(items) == 4 })

	want := map[string]int{"web-a/app": 100, "web-a/side": 7, "web-b/app": 0, "web-c/app": 30}
	sources := bySource(items)
	for id, replay := range want {
		assert.Equal(t, replay, flagged(sources[id]), "%s: the lines flagged replay are the tail its own stream delivers", id)
		assert.Equal(t, 1, caughtUp(sources[id]), "%s: one caught-up event", id)
	}
}

// The interim for a count that is not had in time (README of the status file, section 3): the stream opens at
// once, no caught-up event comes for that opening, and no number is guessed, so every line of the opening is
// flagged replay, a live one too. A consumer must treat a source that is not yet marked as unknown and must
// not read the flag of an unmarked source as a fact. When the SDK has a first-class answer for it this test
// changes on purpose.
func TestACountThatIsNotHadInTimeLeavesTheSourceUnmarkedAndTheStreamOpen(t *testing.T) {
	r := newSessionRigBound(t, nil, 80*time.Millisecond)
	app := r.kubelet.container("ns", "pod", "app")
	r.kubelet.writeNumbered(app, "app", 1, 20)
	r.kubelet.setOnRequest(func(_ int, q url.Values) {
		if q.Get("follow") != "true" {
			time.Sleep(600 * time.Millisecond) // the kubelet answers the count too late and the stream at once
		}
	})
	session := r.create(podResource("ns", "pod", nil, []string{"app"}, nil), sdklogs.LogSessionOptions{Follow: true, TailLines: 100, Params: asking()})

	require.True(t, session.ReplayMarkers)
	r.sink.waitFor(t, "the lines of the opened stream", func(items []sinkItem) bool { return len(linesOf(items)) == 20 })
	r.kubelet.write(app, "written after the open")
	r.sink.waitFor(t, "the live line", func(items []sinkItem) bool { return len(linesOf(items)) == 21 })
	time.Sleep(100 * time.Millisecond)

	items := r.sink.snapshot()
	assert.Zero(t, caughtUp(items), "this opening is never marked caught up")
	assert.Equal(t, 21, flagged(items), "no number is guessed: every line of the opening is flagged replay, the live one too, and that flag is not a fact")
	reads := r.kubelet.Reads("app")
	require.Len(t, reads, 2, "the count was tried once and the stream was opened")
	assert.Empty(t, reads[0].Query.Get("follow"))
	assert.Equal(t, "true", reads[1].Query.Get("follow"))
}
