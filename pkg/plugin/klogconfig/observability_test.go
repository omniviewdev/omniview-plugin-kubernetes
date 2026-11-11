package klogconfig

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	"github.com/stretchr/testify/require"
)

func TestResolveLevelWarnsOnceWithoutErrorText(t *testing.T) {
	sink := &logtest.RecordingSink{}
	previous := logging.Default()
	logging.SetDefault(logging.New(logging.Config{
		Name:    "test",
		Level:   logging.NewLevelController(logging.LevelTrace),
		Backend: logging.NewSinkBackend(sink),
	}))
	resolveLevelWarnOnce = sync.Once{}
	t.Cleanup(func() {
		logging.SetDefault(previous)
		resolveLevelWarnOnce = sync.Once{}
	})

	provider := providerStub{err: errors.New("secret-provider-detail")}
	require.Equal(t, LevelNone, ResolveLevel(provider))
	require.Equal(t, LevelNone, ResolveLevel(provider))

	records := sink.Records()
	require.Len(t, records, 1)
	require.Equal(t, logging.LevelWarn, records[0].Level)
	require.False(t, strings.Contains(fmt.Sprint(records[0].Message, records[0].Fields), "secret-provider-detail"))
}
