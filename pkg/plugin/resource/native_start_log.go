package resource

import (
	"context"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// startNativeConnectionObserved runs startNativeConnection and records why it
// failed. The SDK reports a failed start with its error code alone, so without
// this line the cause of a connection that could not start cannot be recovered.
func (p *kubernetesProvider) startNativeConnectionObserved(ctx context.Context, connection types.Connection, client *clients.ClientSet) error {
	started := time.Now()
	err := p.startNativeConnection(ctx, connection, client)
	if err != nil {
		logNativeStartFailure(ctx, connection.ID, time.Since(started), err)
	}
	return err
}

// logNativeStartFailure logs the closed class and the Go type of a failed start,
// never the error text, which can carry endpoints and server messages. A start
// that was canceled, or retired by a newer start, is expected; a deadline is not.
func logNativeStartFailure(ctx context.Context, connectionID string, elapsed time.Duration, err error) {
	class := diag.ClassifyError(err, false)
	fields := append([]any{"connection", connectionID, "duration_ms", elapsed.Milliseconds()}, class.LogFields()...)
	if class.Class == "canceled" || resourcev2.ErrorCode(err) == "RESET_REQUIRED" {
		connectionLogger().Debugw(ctx, "native connection start interrupted", fields...)
		return
	}
	connectionLogger().Warnw(ctx, "native connection start failed", fields...)
}
