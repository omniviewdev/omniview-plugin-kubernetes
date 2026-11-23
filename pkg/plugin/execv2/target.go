// Package execv2 serves Pod exec on the SDK's exec v2 lane: Describe, Options and Exec over client-go's remotecommand.
// The legacy lane (pkg/plugin/exec) is untouched and keeps serving beside it.
package execv2

import (
	"github.com/omniview/kubernetes/pkg/pluginid"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// podType is the resource type a Pod reference carries.
const podType = "k8s:/pods"

// The two modes of a Pod: a new process (exec) or the container's own (attach).
const (
	modeExec   = "exec"
	modeAttach = "attach"
)

// capabilities is what a Pod can do at most: the upper bound of every session of the kind, which the two modes narrow in
// different fields (see modeCapabilities).
func capabilities() exec.Capabilities {
	return exec.Capabilities{
		TTY: true, SeparateStderr: true, Resize: true, InitialSize: true, StdinEOF: true,
		Kill: exec.KillClosesStreamOnly, ExitReport: exec.ExitReportCode, Stall: exec.StallLossy,
		HostRestart: exec.SurvivalTargetProcess, // attach reaches the container's own process again
	}
}

// modeCapabilities is the kind's upper bound narrowed to each mode: an exec'd process cannot be reached again after a
// host restart, and an attach relays no exit status.
func modeCapabilities() (execMode, attachMode exec.Capabilities) {
	execMode, attachMode = capabilities(), capabilities()
	execMode.HostRestart = exec.SurvivalNone
	attachMode.ExitReport = exec.ExitReportNone
	return execMode, attachMode
}

// Target is the Pod: one kind that serves two modes.
func Target() exec.Target {
	return exec.Target{
		Info: exec.TargetInfo{
			Provider: pluginid.ResourceProvider, Type: podType, DisplayName: "Pod", DefaultArgv: []string{"/bin/sh"},
			Capabilities: capabilities(), Session: exec.DefaultSessionLimits(),
		},
		Exec:     podExec,
		Options:  podOptions,
		Classify: classify,
	}
}
