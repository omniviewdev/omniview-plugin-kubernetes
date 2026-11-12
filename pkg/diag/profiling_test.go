package diag

import (
	"context"
	"runtime"
	"runtime/pprof"
	"strings"
	"testing"
)

type profileRates struct {
	mutex, block int
	calls        int
}

func (r *profileRates) setMutex(v int) int { r.mutex, r.calls = v, r.calls+1; return 0 }
func (r *profileRates) setBlock(v int)     { r.block, r.calls = v, r.calls+1 }

func env(value string, set bool) func(string) string {
	return func(key string) string {
		if set && key == PprofEnv {
			return value
		}
		return ""
	}
}

func TestEnableProfilingSetsRatesOnlyWhenOptedIn(t *testing.T) {
	t.Cleanup(func() { SetProfileLabels(false) })
	for _, tc := range []struct {
		name    string
		getenv  func(string) string
		enabled bool
	}{
		{"unset", env("", false), false},
		{"empty", env("", true), false},
		{"false", env("false", true), false},
		{"numeric", env("1", true), false},
		{"upper", env("TRUE", true), false},
		{"true", env("true", true), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			SetProfileLabels(false)
			var rates profileRates
			if got := enableProfiling(tc.getenv, rates.setMutex, rates.setBlock); got != tc.enabled {
				t.Fatalf("enabled = %v, want %v", got, tc.enabled)
			}
			if tc.enabled {
				if rates.mutex != MutexProfileFraction || rates.block != BlockProfileRate || !labelsEnabled.Load() {
					t.Fatalf("rates = %+v labels = %v", rates, labelsEnabled.Load())
				}
				return
			}
			if rates.calls != 0 || labelsEnabled.Load() {
				t.Fatalf("disabled profiling touched runtime state: %+v labels = %v", rates, labelsEnabled.Load())
			}
		})
	}
}

func TestDoLabelsOnlyWhenEnabled(t *testing.T) {
	t.Cleanup(func() { SetProfileLabels(false) })
	read := func(connection string) (phase, conn string, hasConn bool) {
		Do(context.Background(), PhaseSource, connection, func(ctx context.Context) {
			phase, _ = pprof.Label(ctx, "phase")
			conn, hasConn = pprof.Label(ctx, "connection")
		})
		return
	}
	SetProfileLabels(false)
	if phase, _, hasConn := read("c1"); phase != "" || hasConn {
		t.Fatalf("labels applied while disabled: phase=%q connection=%v", phase, hasConn)
	}
	SetProfileLabels(true)
	if phase, conn, _ := read("c1"); phase != PhaseSource || conn != "c1" {
		t.Fatalf("phase=%q connection=%q", phase, conn)
	}
	if phase, _, hasConn := read(""); phase != PhaseSource || hasConn {
		t.Fatalf("empty connection must be omitted: phase=%q connection=%v", phase, hasConn)
	}
}

// goroutineLabels returns the label sets of live goroutines as printed by the
// debug=1 goroutine profile.
func goroutineLabels(t *testing.T) string {
	t.Helper()
	var out strings.Builder
	if err := pprof.Lookup("goroutine").WriteTo(&out, 1); err != nil {
		t.Fatal(err)
	}
	return out.String()
}

func TestLabelFuncLabelsEachCallAndNestedPhaseWins(t *testing.T) {
	t.Cleanup(func() { SetProfileLabels(false) })
	probe := func(arg int) (string, error) {
		return goroutineLabels(t), nil
	}
	ctx := context.Background()
	SetProfileLabels(false)
	if got, _ := LabelFunc(ctx, PhaseConvert, "c1", probe)(1); strings.Contains(got, `"phase"`) {
		t.Fatal("labels applied while disabled")
	}
	SetProfileLabels(true)
	got, err := LabelFunc(ctx, PhaseConvert, "c1", probe)(1)
	if err != nil || !strings.Contains(got, `{"connection":"c1", "phase":"convert"}`) {
		t.Fatalf("convert call not labeled (err=%v):\n%s", err, got)
	}
	Do(ctx, PhaseSource, "c1", func(ctx context.Context) {
		got, _ = LabelFunc(ctx, PhaseConvert, "c1", probe)(1)
	})
	if strings.Contains(got, `"phase":"source"`) || !strings.Contains(got, `"phase":"convert"`) {
		t.Fatalf("nested convert phase must replace source:\n%s", got)
	}
	if after := goroutineLabels(t); strings.Contains(after, `"phase":"convert"`) {
		t.Fatal("labels leaked past the wrapped call")
	}
}

func TestEnableProfilingAppliesMutexFractionToRuntime(t *testing.T) {
	previous := runtime.SetMutexProfileFraction(-1)
	t.Cleanup(func() {
		runtime.SetMutexProfileFraction(previous)
		runtime.SetBlockProfileRate(0)
		SetProfileLabels(false)
	})
	runtime.SetMutexProfileFraction(0)
	if EnableProfiling(env("false", true)) || runtime.SetMutexProfileFraction(-1) != 0 {
		t.Fatal("runtime mutex sampling changed without opt-in")
	}
	if !EnableProfiling(env("true", true)) || runtime.SetMutexProfileFraction(-1) != MutexProfileFraction {
		t.Fatal("runtime mutex sampling not enabled by opt-in")
	}
}
