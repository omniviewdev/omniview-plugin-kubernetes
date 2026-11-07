package resourcers

import (
	"fmt"
	"strconv"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// rolloutActivity keeps notification presentation separate from action business data.
func rolloutActivity(kind, name string, updated, ready, current, desired, readyPods int32, unit string, complete bool) *resource.ActivityPresentation {
	old := current - updated
	if old < 0 {
		old = 0
	}
	count := func(value int32) string { return strconv.FormatInt(int64(value), 10) }
	message := ""
	progress := &resource.ActivityProgress{Kind: "indeterminate"}
	// Only pods from this restart count; old Ready pods cannot advance progress.
	if desired > 0 {
		if readyPods > desired {
			readyPods = desired
		}
		progress = &resource.ActivityProgress{Kind: "units", Current: count(readyPods), Total: count(desired), Unit: "pods"}
	}
	if complete {
		message = fmt.Sprintf("%s %s successfully restarted", kind, name)
	}
	return &resource.ActivityPresentation{
		Title:    fmt.Sprintf("Restart %s %s", kind, name),
		Message:  message,
		Progress: progress,
		Metrics: []resource.ActivityMetric{
			{ID: "updated", Label: "Updated", Value: count(updated), Unit: unit},
			{ID: "ready", Label: "Total ready", Value: count(ready), Unit: unit},
			{ID: "old", Label: "Old", Value: count(old), Unit: unit},
		},
	}
}
