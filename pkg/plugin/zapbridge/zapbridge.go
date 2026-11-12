// Package zapbridge routes zap's process-wide logger through the plugin SDK's
// logging package, so call sites written against zap.S() reach the same sink
// (and the same configured level) as the SDK loggers.
//
// Without it zap's global logger is a no-op core and every zap.S() line in the
// plugin is silently dropped.
package zapbridge

import (
	"context"
	"sort"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Install replaces zap's global logger with one that writes through the SDK
// default logger (logging.Default). It must run after the SDK has installed its
// logger (sdk.NewPlugin) and before any code captures zap.S() or zap.L().
// The returned function restores the previous global logger.
func Install() func() {
	return zap.ReplaceGlobals(zap.New(NewCore(logging.Default)))
}

// NewCore returns a zapcore.Core that writes to the logger returned by resolve.
// resolve is called for every enabled check and write, so a later
// logging.SetDefault, or a runtime level change on the SDK level controller,
// applies to loggers that were already built from this core.
func NewCore(resolve func() logging.Logger) zapcore.Core {
	return &core{resolve: resolve}
}

type core struct {
	resolve func() logging.Logger
	fields  []logging.Field
}

func (c *core) Enabled(level zapcore.Level) bool {
	return c.resolve().Enabled(context.Background(), toLevel(level))
}

func (c *core) With(fields []zapcore.Field) zapcore.Core {
	if len(fields) == 0 {
		return c
	}
	next := make([]logging.Field, 0, len(c.fields)+len(fields))
	next = append(next, c.fields...)
	next = appendFields(next, fields)
	return &core{resolve: c.resolve, fields: next}
}

func (c *core) Check(entry zapcore.Entry, checked *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	if c.Enabled(entry.Level) {
		return checked.AddCore(entry, c)
	}
	return checked
}

func (c *core) Write(entry zapcore.Entry, fields []zapcore.Field) error {
	all := make([]logging.Field, 0, len(c.fields)+len(fields))
	all = append(all, c.fields...)
	all = appendFields(all, fields)
	c.resolve().Named(entry.LoggerName).Log(context.Background(), toLevel(entry.Level), entry.Message, all...)
	return nil
}

func (c *core) Sync() error {
	return c.resolve().Sync(context.Background())
}

func toLevel(level zapcore.Level) logging.Level {
	switch {
	case level <= zapcore.DebugLevel:
		return logging.LevelDebug
	case level == zapcore.InfoLevel:
		return logging.LevelInfo
	case level == zapcore.WarnLevel:
		return logging.LevelWarn
	case level == zapcore.FatalLevel:
		return logging.LevelFatal
	default:
		return logging.LevelError
	}
}

// appendFields converts zap fields to SDK fields in order. Errors keep their
// error value; every other type is rendered by zap's own map encoder, so
// durations, ints, bools, stringers and marshalers keep zap's semantics.
func appendFields(dst []logging.Field, fields []zapcore.Field) []logging.Field {
	for _, f := range fields {
		if f.Type == zapcore.ErrorType {
			if err, ok := f.Interface.(error); ok {
				dst = append(dst, logging.Field{Key: f.Key, Value: err})
				continue
			}
		}
		enc := zapcore.NewMapObjectEncoder()
		f.AddTo(enc)
		keys := make([]string, 0, len(enc.Fields))
		for k := range enc.Fields {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			dst = append(dst, logging.Field{Key: k, Value: enc.Fields[k]})
		}
	}
	return dst
}
