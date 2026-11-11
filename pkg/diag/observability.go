package diag

import (
	"time"

	sdkdiag "github.com/omniviewdev/plugin-sdk/pkg/diagnostics"
)

var (
	tokenRefreshes, _    = sdkdiag.Default().Counter("omniview.plugin.self.auth.token_refreshes", "1")
	clientBuilds, _      = sdkdiag.Default().Counter("omniview.plugin.self.client.builds", "1")
	informerSources, _   = sdkdiag.Default().Gauge("omniview.plugin.self.informer.sources", "1")
	sourceSync, _        = sdkdiag.Default().Histogram("omniview.plugin.self.source.sync.duration", "s", []float64{0.1, 0.5, 1, 5, 10, 30, 60})
	catalogRefreshes, _  = sdkdiag.Default().Counter("omniview.plugin.self.catalog.refreshes", "1")
	logsWatchRestarts, _ = sdkdiag.Default().Counter("omniview.plugin.self.logs.watch.restarts", "1")
)

func safeAttr(key sdkdiag.Key, value string) sdkdiag.Attr {
	if !sdkdiag.ValidValue(value) {
		value = "other"
	}
	return attr(key, value)
}
func TokenRefresh(outcome string) { tokenRefreshes.Add(1, safeAttr(sdkdiag.KeyOutcome, outcome)) }
func ClientBuild(operation, outcome string) {
	clientBuilds.Add(1, safeAttr(sdkdiag.KeyOperation, operation), safeAttr(sdkdiag.KeyOutcome, outcome))
}
func InformerSources(n int) { informerSources.Set(float64(n)) }
func SourceSync(d time.Duration, outcome string) {
	sourceSync.Observe(d.Seconds(), safeAttr(sdkdiag.KeyOutcome, outcome))
}
func CatalogRefresh(outcome string)  { catalogRefreshes.Add(1, safeAttr(sdkdiag.KeyOutcome, outcome)) }
func LogsWatchRestart(reason string) { logsWatchRestarts.Add(1, safeAttr(sdkdiag.KeyReason, reason)) }
