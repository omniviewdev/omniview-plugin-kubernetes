package zapbridge

import (
	"errors"
	"testing"
	"time"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// installSDKLogger mirrors what sdk.NewPlugin does: a logger with an Info
// threshold and a fixed plugin_id field, published as the process default.
func installSDKLogger(t *testing.T) (*logtest.RecordingSink, *logging.LevelController) {
	t.Helper()
	sink := &logtest.RecordingSink{}
	level := logging.NewLevelController(logging.LevelInfo)
	logging.SetDefault(logging.New(logging.Config{
		Name:    "plugin",
		Level:   level,
		Backend: logging.NewSinkBackend(sink),
		Fields:  []logging.Field{logging.String("plugin_id", "kubernetes")},
	}))
	t.Cleanup(func() { logging.SetDefault(nil) })
	restore := Install()
	t.Cleanup(restore)
	return sink, level
}

func fieldMap(r logging.Record) map[string]any {
	out := make(map[string]any, len(r.Fields))
	for _, f := range r.Fields {
		out[f.Key] = f.Value
	}
	return out
}

func TestInstall_WarnReachesSDKSink(t *testing.T) {
	sink, _ := installSDKLogger(t)

	zap.S().Named("catalog").Warnw("native discovery partial",
		"failed_groups", 3, "error_class", "timeout", "budget", 1500*time.Millisecond, "retried", true)

	recs := sink.Records()
	require.Len(t, recs, 1)
	r := recs[0]
	require.Equal(t, logging.LevelWarn, r.Level)
	require.Equal(t, "native discovery partial", r.Message)
	require.Equal(t, "plugin.catalog", r.Logger)
	f := fieldMap(r)
	require.Equal(t, "kubernetes", f["plugin_id"])
	require.EqualValues(t, 3, f["failed_groups"])
	require.Equal(t, "timeout", f["error_class"])
	require.Equal(t, 1500*time.Millisecond, f["budget"])
	require.Equal(t, true, f["retried"])
}

func TestInstall_DebugFilteredAtDefaultLevel(t *testing.T) {
	sink, level := installSDKLogger(t)

	zap.S().Named("source").Debugw("source event queue full", "reason", "queue_overflow")
	zap.S().Named("source").Debugf("formatted %d", 1)
	require.Empty(t, sink.Records(), "Debug must be filtered at the SDK default Info level")

	// A runtime change on the SDK level controller applies to existing loggers.
	log := zap.S().Named("source")
	level.Set(logging.LevelDebug)
	log.Debugw("source event queue full", "reason", "queue_overflow")
	recs := sink.Records()
	require.Len(t, recs, 1)
	require.Equal(t, logging.LevelDebug, recs[0].Level)
	require.Equal(t, "queue_overflow", fieldMap(recs[0])["reason"])
}

func TestInstall_LevelsMapped(t *testing.T) {
	sink, _ := installSDKLogger(t)

	zap.S().Infow("i")
	zap.S().Warnw("w")
	zap.S().Errorw("e")

	recs := sink.Records()
	require.Len(t, recs, 3)
	require.Equal(t, []logging.Level{logging.LevelInfo, logging.LevelWarn, logging.LevelError},
		[]logging.Level{recs[0].Level, recs[1].Level, recs[2].Level})
}

func TestInstall_WithFieldsAndErrorValuePreserved(t *testing.T) {
	sink, _ := installSDKLogger(t)

	boom := errors.New("boom")
	zap.S().Named("informers").With("gvr", "pods").Warnw("informer handler removal failed", "error", boom)
	zap.L().With(zap.String("connection", "kind")).Warn("typed", zap.Error(boom), zap.Int("n", 2))

	recs := sink.Records()
	require.Len(t, recs, 2)

	f := fieldMap(recs[0])
	require.Equal(t, "plugin.informers", recs[0].Logger)
	require.Equal(t, "pods", f["gvr"])
	require.Same(t, boom, f["error"])

	f = fieldMap(recs[1])
	require.Equal(t, "typed", recs[1].Message)
	require.Equal(t, "kind", f["connection"])
	require.Same(t, boom, f["error"])
	require.EqualValues(t, 2, f["n"])
}

func TestInstall_RestoreRevertsToNop(t *testing.T) {
	sink := &logtest.RecordingSink{}
	logging.SetDefault(logging.New(logging.Config{Backend: logging.NewSinkBackend(sink)}))
	t.Cleanup(func() { logging.SetDefault(nil) })

	restore := Install()
	restore()
	zap.S().Warnw("dropped")
	require.Empty(t, sink.Records())
}
