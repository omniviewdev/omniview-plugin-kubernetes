package execv2

// Spike instrumentation for the K-proof. None of it is the provider: it is not counted in its size and would not be merged.

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// nilExit is the end of a stream that client-go reports with a nil error. client-go returns nil for a Success status and
// for an error channel that closed empty alike, so the provider cannot tell them apart: this is the tag-gate question of
// the no-status arm. The default is the guide's (Lost, never an exit); KPROOF_NIL=code0 or transport0 picks the other two
// arms the contract has, for a measurement.
func nilExit(bool) exec.Exit {
	switch os.Getenv("KPROOF_NIL") {
	case "code0":
		return exec.ExitCode(0)
	case "transport0":
		return exec.ExitTransport(0)
	}
	return exec.ExitLost(exec.LostNoStatus)
}

var traceMu sync.Mutex

// traceLine appends one JSON line to the file named by KPROOF_TRACE.
func traceLine(line map[string]any) {
	path := os.Getenv("KPROOF_TRACE")
	if path == "" {
		return
	}
	line["ts"] = time.Now().Format(time.RFC3339Nano)
	data, err := json.Marshal(line)
	if err != nil {
		return
	}
	traceMu.Lock()
	defer traceMu.Unlock()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer func() { _ = f.Close() }()
	_, _ = f.Write(append(data, '\n'))
}

// traceEnd records a stream that ended: what client-go returned (type chain and text), the protocol that carried it, and
// what the provider made of it.
func traceEnd(p *exec.Proc, protocol string, began time.Time, streamErr error, exit exec.Exit, returned error) {
	line := map[string]any{
		"event": "stream-end", "began": began.Format(time.RFC3339Nano), "elapsed_ms": time.Since(began).Milliseconds(),
		"protocol": protocol, "address": p.Request.Ref.Address.ID, "container": p.Request.Selection["container"],
		"mode": p.Request.Selection["mode"], "tty": p.Request.TTY, "argv": p.Request.Argv,
		"executor": os.Getenv("KPROOF_EXECUTOR"), "stream_err_chain": chain(streamErr), "exit": describe(exit),
	}
	if streamErr != nil {
		line["stream_err"] = streamErr.Error()
	}
	if returned != nil {
		line["returned_err"] = returned.Error()
		line["returned_err_chain"] = chain(returned)
	}
	traceLine(line)
}

func chain(err error) []string {
	var out []string
	for ; err != nil; err = errors.Unwrap(err) {
		out = append(out, fmt.Sprintf("%T", err))
	}
	return out
}

func describe(e exec.Exit) map[string]any {
	out := map[string]any{"source": e.Source.String()}
	if e.Code != nil {
		out["code"] = *e.Code
	}
	if e.Lost != exec.LostUnspecified {
		out["lost"] = fmt.Sprint(e.Lost)
	}
	return out
}
