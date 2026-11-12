package diag

import (
	"context"
	"runtime"
	"runtime/pprof"
	"sync/atomic"
)

// PprofEnv is the variable the host sets when developer profiling is enabled.
// The SDK starts its loopback profiling server under the same condition.
const PprofEnv = "OMNIVIEW_PLUGIN_PPROF_ENABLED"

const (
	// MutexProfileFraction samples one in this many contended mutex events.
	MutexProfileFraction = 10
	// BlockProfileRate samples one blocking event per this many nanoseconds blocked.
	BlockProfileRate = 100_000
)

// Closed set of CPU profile phase label values. Label values must stay bounded:
// never a resource name, namespace, or error text.
const (
	PhaseClientBuild   = "client_build"
	PhaseConnect       = "connect"
	PhaseSource        = "source"
	PhaseConvert       = "convert"
	PhaseMetricsScan   = "metrics_scan"
	phaseLabelKey      = "phase"
	connectionLabelKey = "connection"
)

var labelsEnabled atomic.Bool

// ProfilingEnabled reports whether the environment opts this process into profiling.
func ProfilingEnabled(getenv func(string) string) bool {
	return getenv(PprofEnv) == "true"
}

// EnableProfiling turns on block and mutex sampling and CPU profile phase labels
// when the environment opts into profiling, and does nothing otherwise, so a
// process that never enables profiling pays no sampling or labeling cost.
func EnableProfiling(getenv func(string) string) bool {
	return enableProfiling(getenv, runtime.SetMutexProfileFraction, runtime.SetBlockProfileRate)
}

func enableProfiling(getenv func(string) string, setMutex func(int) int, setBlock func(int)) bool {
	if !ProfilingEnabled(getenv) {
		return false
	}
	setMutex(MutexProfileFraction)
	setBlock(BlockProfileRate)
	labelsEnabled.Store(true)
	return true
}

// SetProfileLabels toggles CPU profile phase labels without touching the
// block and mutex rates. Benchmarks use it to make labeled phases visible.
func SetProfileLabels(enabled bool) { labelsEnabled.Store(enabled) }

// Do runs f with the phase and connection profiler labels applied when labels
// are enabled, and calls f directly otherwise. An empty connection is omitted.
func Do(ctx context.Context, phase, connection string, f func(context.Context)) {
	if !labelsEnabled.Load() {
		f(ctx)
		return
	}
	labels := pprof.Labels(phaseLabelKey, phase)
	if connection != "" {
		labels = pprof.Labels(phaseLabelKey, phase, connectionLabelKey, connection)
	}
	pprof.Do(ctx, labels, f)
}

// LabelFunc wraps f so each call runs under Do.
func LabelFunc[A, R any](ctx context.Context, phase, connection string, f func(A) (R, error)) func(A) (R, error) {
	return func(arg A) (result R, err error) {
		Do(ctx, phase, connection, func(context.Context) { result, err = f(arg) })
		return result, err
	}
}
