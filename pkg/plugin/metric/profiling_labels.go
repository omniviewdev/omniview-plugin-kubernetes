package metric

import (
	"context"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// labelMetricsScan tags CPU profile samples of a native metrics query with the
// metrics_scan phase and the connection ID.
func labelMetricsScan(next func(*types.PluginContext, sdkmetric.ResourceMetricsQuery) (*sdkmetric.ResourceMetricsResponse, error)) func(*types.PluginContext, sdkmetric.ResourceMetricsQuery) (*sdkmetric.ResourceMetricsResponse, error) {
	return func(pc *types.PluginContext, query sdkmetric.ResourceMetricsQuery) (response *sdkmetric.ResourceMetricsResponse, err error) {
		if pc == nil || pc.Context == nil {
			return next(pc, query)
		}
		connection := ""
		if pc.Connection != nil {
			connection = pc.Connection.ID
		}
		diag.Do(pc.Context, diag.PhaseMetricsScan, connection, func(context.Context) { response, err = next(pc, query) })
		return response, err
	}
}
