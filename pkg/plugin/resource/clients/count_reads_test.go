package clients

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeClock is the time of a test: it moves when the test says.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func testCountReads() (*CountReads, *fakeClock) {
	clock := &fakeClock{now: time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)}
	return newCountReads(clock.Now), clock
}

// countedPage is a page of one object, and a count of the objects of its kind.
func countedPage(name string, count int) resourcev2.SourcePage {
	value := strconv.Itoa(count)
	revision := "42"
	return resourcev2.SourcePage{
		Records: []resourcev2.Record{{
			Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
				Provider: "kubernetes", Authority: "authority", Type: "k8s:/pods", ID: name, Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "shop"}},
			}},
			Body:           resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"kind": {Kind: "string", String: "Pod"}, "labels": {Kind: "list", List: []resourcev2.Value{{Kind: "string", String: "a"}}}}},
			Representation: resourcev2.Representation{ID: "kubernetes.object.v1/v1", Revision: "kubernetes.object.v1/v1"},
			Coverage:       resourcev2.Coverage{Kind: "complete", Paths: []string{}},
		}},
		Count:          resourcev2.Count{Kind: "estimate", Value: &value},
		Coverage:       resourcev2.Coverage{Kind: "complete", Paths: []string{}},
		Consistency:    resourcev2.ConsistencyBestEffort,
		SourceRevision: &revision,
	}
}

// asker counts the reads it is asked to make and answers each with a page.
type asker struct {
	calls         atomic.Int32
	running, peak atomic.Int32
	hold          chan struct{}
}

func (a *asker) read(ctx context.Context) (resourcev2.SourcePage, error) {
	calls := a.calls.Add(1)
	running := a.running.Add(1)
	defer a.running.Add(-1)
	for {
		peak := a.peak.Load()
		if running <= peak || a.peak.CompareAndSwap(peak, running) {
			break
		}
	}
	if a.hold != nil {
		select {
		case <-a.hold:
		case <-ctx.Done():
			return resourcev2.SourcePage{}, ctx.Err()
		}
	}
	return countedPage("pod-"+strconv.Itoa(int(calls)), int(calls)), nil
}

func TestTheAnswerOfACountReadIsKeptForTheStalenessAndNoLonger(t *testing.T) {
	assert.Equal(t, 30*time.Second, CountStaleness)
	reads, clock := testCountReads()
	var a asker
	first, err := reads.Read(context.Background(), "pods", a.read)
	require.NoError(t, err)

	clock.advance(CountStaleness - time.Nanosecond)
	again, err := reads.Read(context.Background(), "pods", a.read)
	require.NoError(t, err)
	assert.Equal(t, first, again)
	assert.EqualValues(t, 1, a.calls.Load(), "an answer a nanosecond short of the staleness is repeated")

	clock.advance(time.Nanosecond)
	fresh, err := reads.Read(context.Background(), "pods", a.read)
	require.NoError(t, err)
	assert.EqualValues(t, 2, a.calls.Load(), "an answer as old as the staleness is not")
	assert.NotEqual(t, first, fresh)

	// another question is another answer
	_, err = reads.Read(context.Background(), "services", a.read)
	require.NoError(t, err)
	assert.EqualValues(t, 3, a.calls.Load())
	// and the age of an answer is the age since it was made, not since it was asked for
	clock.advance(CountStaleness / 2)
	_, err = reads.Read(context.Background(), "pods", a.read)
	require.NoError(t, err)
	clock.advance(CountStaleness/2 + time.Second)
	_, err = reads.Read(context.Background(), "pods", a.read)
	require.NoError(t, err)
	assert.EqualValues(t, 4, a.calls.Load())
}

func TestEachReaderOfACountReadIsGivenAPageOfItsOwn(t *testing.T) {
	reads, _ := testCountReads()
	var a asker
	first, err := reads.Read(context.Background(), "pods", a.read)
	require.NoError(t, err)
	second, err := reads.Read(context.Background(), "pods", a.read)
	require.NoError(t, err)
	third, err := reads.Read(context.Background(), "pods", a.read)
	require.NoError(t, err)

	for _, page := range []resourcev2.SourcePage{first, second} {
		page.Records[0].Body.Map["kind"] = resourcev2.Value{Kind: "string", String: "Tampered"}
		page.Records[0].Body.Map["labels"].List[0].String = "tampered"
		page.Records[0].Reference.Address.Scope[0].Value = "tampered"
		page.Records[0].Coverage.Paths = append(page.Records[0].Coverage.Paths, "/tampered")
		*page.Count.Value = "0"
		*page.SourceRevision = "tampered"
	}
	again, err := reads.Read(context.Background(), "pods", a.read)
	require.NoError(t, err)
	assert.Equal(t, third, again)
	assert.Equal(t, "Pod", again.Records[0].Body.Map["kind"].String)
	assert.Equal(t, "a", again.Records[0].Body.Map["labels"].List[0].String)
	assert.EqualValues(t, 1, a.calls.Load())
}

func TestCountReadsRunAtMostFourAtATime(t *testing.T) {
	require.Equal(t, 4, CountConcurrency)
	reads, _ := testCountReads()
	a := asker{hold: make(chan struct{})}
	var wg sync.WaitGroup
	for i := range 13 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := reads.Read(context.Background(), "kind-"+strconv.Itoa(i), a.read)
			assert.NoError(t, err)
		}()
	}
	require.Eventually(t, func() bool { return a.running.Load() == CountConcurrency }, 5*time.Second, time.Millisecond)
	time.Sleep(100 * time.Millisecond)
	assert.EqualValues(t, CountConcurrency, a.running.Load(), "the rest wait for a turn")
	assert.EqualValues(t, CountConcurrency, a.calls.Load())
	close(a.hold)
	wg.Wait()
	assert.EqualValues(t, 13, a.calls.Load())
	assert.EqualValues(t, CountConcurrency, a.peak.Load())
}

func TestACountReadThatWaitsForATurnStopsWaitingWhenItsCallerGoes(t *testing.T) {
	reads, _ := testCountReads()
	a := asker{hold: make(chan struct{})}
	var wg sync.WaitGroup
	for i := range CountConcurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := reads.Read(context.Background(), "held-"+strconv.Itoa(i), a.read)
			assert.NoError(t, err)
		}()
	}
	require.Eventually(t, func() bool { return a.running.Load() == CountConcurrency }, 5*time.Second, time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	results := make(chan error, 5)
	for i := range 5 {
		go func() {
			_, err := reads.Read(ctx, "waiting-"+strconv.Itoa(i), a.read)
			results <- err
		}()
	}
	time.Sleep(50 * time.Millisecond)
	cancel()
	for range 5 {
		select {
		case err := <-results:
			assert.ErrorIs(t, err, context.Canceled)
		case <-time.After(5 * time.Second):
			t.Fatal("a read kept waiting after its caller went")
		}
	}
	assert.EqualValues(t, CountConcurrency, a.calls.Load(), "none of them ever asked")
	// a caller that is gone before it begins does not begin
	_, err := reads.Read(ctx, "late", a.read)
	assert.ErrorIs(t, err, context.Canceled)
	assert.EqualValues(t, CountConcurrency, a.calls.Load())
	close(a.hold)
	wg.Wait()
	// the turns that were waited for were given back
	_, err = reads.Read(context.Background(), "after", a.read)
	require.NoError(t, err)
}

func TestIdenticalCountReadsAtTheSameTimeAreOne(t *testing.T) {
	reads, _ := testCountReads()
	a := asker{hold: make(chan struct{})}
	pages := make([]resourcev2.SourcePage, 8)
	var wg sync.WaitGroup
	for i := range pages {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var err error
			pages[i], err = reads.Read(context.Background(), "pods", a.read)
			assert.NoError(t, err)
		}()
	}
	require.Eventually(t, func() bool { return a.calls.Load() == 1 }, 5*time.Second, time.Millisecond)
	time.Sleep(50 * time.Millisecond)
	close(a.hold)
	wg.Wait()
	assert.EqualValues(t, 1, a.calls.Load())
	for _, page := range pages {
		assert.Equal(t, pages[0], page)
	}
}

func TestACountReadThatFailedIsNotKept(t *testing.T) {
	reads, _ := testCountReads()
	var calls atomic.Int32
	failing := true
	read := func(context.Context) (resourcev2.SourcePage, error) {
		calls.Add(1)
		if failing {
			return resourcev2.SourcePage{}, errors.New("forbidden")
		}
		return countedPage("pod", 3), nil
	}
	for range 3 {
		_, err := reads.Read(context.Background(), "pods", read)
		require.Error(t, err)
	}
	assert.EqualValues(t, 3, calls.Load(), "each failure is asked again")
	failing = false
	page, err := reads.Read(context.Background(), "pods", read)
	require.NoError(t, err)
	assert.Equal(t, "3", *page.Count.Value)
}

// The read of a caller that gave up fails with its cancellation, and the readers that waited for it are not given that: one of them reads.
func TestAReaderIsNotGivenTheCancellationOfTheReadItWaitedFor(t *testing.T) {
	reads, _ := testCountReads()
	started := make(chan struct{})
	leaderCtx, cancelLeader := context.WithCancel(context.Background())
	t.Cleanup(cancelLeader)
	var first atomic.Bool
	read := func(ctx context.Context) (resourcev2.SourcePage, error) {
		if first.CompareAndSwap(false, true) {
			close(started)
			<-ctx.Done()
			return resourcev2.SourcePage{}, ctx.Err()
		}
		return countedPage("pod", 5), nil
	}
	leader := make(chan error, 1)
	go func() {
		_, err := reads.Read(leaderCtx, "pods", read)
		leader <- err
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("the read of the first reader never began")
	}
	follower := make(chan resourcev2.SourcePage, 1)
	go func() {
		page, err := reads.Read(context.Background(), "pods", read)
		assert.NoError(t, err)
		follower <- page
	}()
	time.Sleep(50 * time.Millisecond)
	cancelLeader()
	select {
	case err := <-leader:
		require.ErrorIs(t, err, context.Canceled)
	case <-time.After(5 * time.Second):
		t.Fatal("the read of the reader that went did not return when its caller went")
	}
	select {
	case page := <-follower:
		assert.Equal(t, "5", *page.Count.Value)
	case <-time.After(5 * time.Second):
		t.Fatal("the reader that waited never read")
	}
}

func TestACountReadKeepsAtMostACountOfAnswers(t *testing.T) {
	reads, clock := testCountReads()
	var a asker
	for i := range countKept + 40 {
		clock.advance(time.Millisecond)
		_, err := reads.Read(context.Background(), "kind-"+strconv.Itoa(i), a.read)
		require.NoError(t, err)
	}
	reads.mu.Lock()
	kept := len(reads.reads)
	_, oldest := reads.reads["kind-0"]
	_, newest := reads.reads["kind-"+strconv.Itoa(countKept+39)]
	reads.mu.Unlock()
	assert.LessOrEqual(t, kept, countKept)
	assert.False(t, oldest, "the oldest answer goes first")
	assert.True(t, newest)
	// the stale go before the rest
	clock.advance(CountStaleness)
	_, err := reads.Read(context.Background(), "one more", a.read)
	require.NoError(t, err)
	reads.mu.Lock()
	defer reads.mu.Unlock()
	assert.LessOrEqual(t, len(reads.reads), countKept)
}

func TestAnAnswerOfLargeObjectsIsAskedAgainNotKept(t *testing.T) {
	reads, _ := testCountReads()
	var calls atomic.Int32
	read := func(context.Context) (resourcev2.SourcePage, error) {
		calls.Add(1)
		page := countedPage("pod", 3)
		page.Records[0].Body.Map["blob"] = resourcev2.Value{Kind: "string", String: strings.Repeat("x", 2*countKeptBytes)}
		return page, nil
	}
	for range 3 {
		page, err := reads.Read(context.Background(), "pods", read)
		require.NoError(t, err)
		require.Len(t, page.Records, 1)
	}
	assert.EqualValues(t, 3, calls.Load())
	reads.mu.Lock()
	defer reads.mu.Unlock()
	assert.Empty(t, reads.reads, "nothing of it is kept")
}

func TestAConnectionsCountReadsEndWithItsSources(t *testing.T) {
	client := &ClientSet{}
	first := client.CountReads()
	assert.Same(t, first, client.CountReads(), "a connection has one")
	client.ShutdownInformers()
	assert.NotSame(t, first, client.CountReads(), "what the old clients were answered is not given to the new")
	client.ResetInformerLifecycle()
	assert.NotSame(t, first, client.CountReads())
}
