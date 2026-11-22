package logs

import (
	"time"

	"github.com/omniview/kubernetes/pkg/pluginid"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// Register registers the log capability with the Kubernetes plugin.
func Register(plugin *sdk.Plugin, borrow ClientBorrower) {
	logs.RegisterPlugin(plugin, logs.PluginOpts{
		Handlers:        handlers(borrow),
		SourceResolvers: resolvers(borrow),
	})
}

// handlers are the log handlers of the plugin. A Pod's handler also serves the Pods that the
// group resources below resolve to (the SDK streams a group's sources through it).
func handlers(borrow ClientBorrower) map[string]logs.Handler {
	return handlersWithin(borrow, replayCountBound, nil)
}

// handlersWithin are the log handlers with their count bounded by bound and the clock the count resolves a
// relative window by (nil: the time). The count and the stream of an opening share what they must through
// one openings.
func handlersWithin(borrow ClientBorrower, bound time.Duration, now func() time.Time) map[string]logs.Handler {
	shared := newOpenings(now)
	return map[string]logs.Handler{
		"k8s:/pods": {
			Plugin:   pluginid.ID,
			Resource: "k8s:/pods",
			Handler:  nativeHandlerWith(borrow, shared),
			// ReplayCount lets a reader that asks for replay markers know where each source's
			// replay ends. Handler is the stream as it always was.
			ReplayCount:   nativeReplayCountWith(borrow, bound, shared),
			SourceBuilder: PodSourceBuilder,
			TargetBuilder: logs.ActionTargetBuilder{
				Paths: []string{
					"$.spec.containers[*]",
					"$.spec.initContainers[*]",
					"$.spec.ephemeralContainers[*]",
				},
				Selectors:     map[string]string{"container": "$.name"},
				LabelSelector: "container",
			},
		},
	}
}

func resolvers(borrow ClientBorrower) map[string]logs.SourceResolver {
	return map[string]logs.SourceResolver{
		"k8s:apps/deployments":  nativeResolver(borrow, DeploymentSourceResolver),
		"k8s:apps/statefulsets": nativeResolver(borrow, StatefulSetSourceResolver),
		"k8s:apps/daemonsets":   nativeResolver(borrow, DaemonSetSourceResolver),
		"k8s:apps/replicasets":  nativeResolver(borrow, ReplicaSetSourceResolver),
		"k8s:batch/jobs":        nativeResolver(borrow, JobSourceResolver),
		"k8s:batch/cronjobs":    nativeResolver(borrow, CronJobSourceResolver),
	}
}
