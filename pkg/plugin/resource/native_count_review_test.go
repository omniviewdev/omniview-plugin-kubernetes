package resource

import (
	"context"
	"math"
	"strconv"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// An aggregated API may report more objects than a count can hold. Added to the page it would wrap round to a negative number: the count is then unknown, and a number that fits is still the sum.
func TestAServerThatReportsMoreThanACountCanHoldSaysNothingToAddToThePage(t *testing.T) {
	api, enumerate := widgetsAPI(t, nativeChunkPopulation{"shop", 25})
	api.remainingReported = math.MaxInt64
	page, err := enumerate(widgetsEnumerate(nativeTestAny(), 1))
	require.NoError(t, err)
	require.Len(t, page.Records, 1)
	requireCount(t, page, "unknown", 0)

	api.remainingReported = math.MaxInt64 - 1
	page, err = enumerate(widgetsEnumerate(nativeTestAny(), 1))
	require.NoError(t, err)
	require.NotNil(t, page.Count.Value)
	assert.Equal(t, "estimate", page.Count.Kind)
	assert.Equal(t, strconv.FormatInt(math.MaxInt64, 10), *page.Count.Value, "one object and all the rest that a count can hold")

	api.remainingReported = 100
	page, err = enumerate(widgetsEnumerate(nativeTestAny(), 1))
	require.NoError(t, err)
	requireCount(t, page, "estimate", 101)
}

// The cursor of a kept first page names a snapshot the API server may compact away before the answer is stale. When it does, the restart of the read is not given the same page and the same cursor.
func TestAContinuationThatExpiredDoesNotLeaveTheKeptFirstPageToBeGivenAgain(t *testing.T) {
	api := thirteenAPI(t)
	client, registrations := api.connection(theThirteenKinds...)
	pods := theThirteenKinds[2]

	first, err := countRead(context.Background(), registrations, client, pods)
	require.NoError(t, err)
	require.NotNil(t, first.NextCursor)
	require.Len(t, api.lists("pods"), 1)

	api.expireContinue = true
	_, err = registrations[pods.token].Enumerate(context.Background(), client, resourcev2.EnumerateRequest{Target: countTarget(pods), PageSize: 1, Cursor: first.NextCursor})
	require.Error(t, err)
	assert.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	api.expireContinue = false

	restarted, err := countRead(context.Background(), registrations, client, pods)
	require.NoError(t, err)
	assert.Len(t, api.lists("pods"), 2, "the restart asks the server for a first page, and is not given the kept one")
	require.NotNil(t, restarted.NextCursor)
	requireCount(t, restarted, "estimate", 8)
}
