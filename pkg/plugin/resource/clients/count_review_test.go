package clients

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Reads that are being made are not answers: they count for nothing against the answers a connection keeps, and they never push one out.
func TestReadsInFlightDoNotPushKeptAnswersOut(t *testing.T) {
	reads, clock := testCountReads()
	var a asker
	for i := range countKept {
		clock.advance(time.Millisecond)
		_, err := reads.Read(context.Background(), "kept-"+strconv.Itoa(i), a.read)
		require.NoError(t, err)
	}
	reads.mu.Lock()
	for i := range 300 {
		reads.reads["in-flight-"+strconv.Itoa(i)] = &countRead{done: make(chan struct{})}
	}
	reads.mu.Unlock()

	clock.advance(time.Millisecond)
	_, err := reads.Read(context.Background(), "one more", a.read)
	require.NoError(t, err)

	reads.mu.Lock()
	defer reads.mu.Unlock()
	answers, inFlight := 0, 0
	for _, current := range reads.reads {
		if settled(current) {
			answers++
		} else {
			inFlight++
		}
	}
	assert.Equal(t, countKept, answers, "the answers kept are as many as may be kept, whatever is in flight")
	assert.Equal(t, 300, inFlight, "and no read in flight was dropped")
	_, oldest := reads.reads["kept-0"]
	assert.False(t, oldest, "the oldest answer is the one that went")
	_, newest := reads.reads["one more"]
	assert.True(t, newest)
}

func TestForgetDropsTheAnswerKeptForAKey(t *testing.T) {
	reads, _ := testCountReads()
	var a asker
	_, err := reads.Read(context.Background(), "pods", a.read)
	require.NoError(t, err)
	_, err = reads.Read(context.Background(), "pods", a.read)
	require.NoError(t, err)
	require.EqualValues(t, 1, a.calls.Load())

	reads.Forget("pods")
	reads.Forget("nothing kept under this key")
	_, err = reads.Read(context.Background(), "pods", a.read)
	require.NoError(t, err)
	assert.EqualValues(t, 2, a.calls.Load(), "a forgotten answer is asked for again")
}

// RefreshClient shuts the sources down, replaces the clients, then lets them start again. A count read that began in between used the old clients, and the coordinator it made must not survive.
func TestACoordinatorMadeWhileTheClientsAreBeingReplacedDoesNotOutliveThem(t *testing.T) {
	client := &ClientSet{}
	client.ShutdownInformers()
	during := client.CountReads()
	client.ResetInformerLifecycle()
	assert.NotSame(t, during, client.CountReads())
}
