package logs

import (
	"context"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// logsLogger returns the request-scoped logger, falling back to the process default.
func logsLogger(ctx *types.PluginContext) logging.Logger {
	if ctx != nil && ctx.Logger != nil {
		return ctx.Logger
	}
	return logging.Default()
}

// logsBaseContext returns the request context for log records.
func logsBaseContext(ctx *types.PluginContext) context.Context {
	if ctx != nil && ctx.Context != nil {
		return ctx.Context
	}
	return context.Background()
}
