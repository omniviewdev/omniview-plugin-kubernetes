package logs

import (
	"context"
	"fmt"
	"log"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/watch"

	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	"github.com/omniviewdev/plugin-sdk/pkg/types"

	"github.com/omniview/kubernetes/pkg/utils"
	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
)

// DeploymentSourceResolver resolves a Deployment to its pod containers.
func DeploymentSourceResolver(
	ctx *types.PluginContext,
	resourceData map[string]interface{},
	opts logs.SourceResolverOptions,
) (*logs.SourceResolverResult, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}
	name, namespace := extractNameAndNamespace(resourceData)

	deployment, err := clients.Clientset.AppsV1().Deployments(namespace).Get(
		ctx.Context, name, metav1.GetOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get deployment %s/%s: %w", namespace, name, err)
	}

	selector, err := metav1.LabelSelectorAsSelector(deployment.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("failed to parse selector: %w", err)
	}

	return resolvePodsToSources(ctx, clients, namespace, selector, opts)
}

// StatefulSetSourceResolver resolves a StatefulSet to its pod containers.
func StatefulSetSourceResolver(
	ctx *types.PluginContext,
	resourceData map[string]interface{},
	opts logs.SourceResolverOptions,
) (*logs.SourceResolverResult, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}
	name, namespace := extractNameAndNamespace(resourceData)

	sts, err := clients.Clientset.AppsV1().StatefulSets(namespace).Get(
		ctx.Context, name, metav1.GetOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get statefulset %s/%s: %w", namespace, name, err)
	}

	selector, err := metav1.LabelSelectorAsSelector(sts.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("failed to parse selector: %w", err)
	}

	return resolvePodsToSources(ctx, clients, namespace, selector, opts)
}

// DaemonSetSourceResolver resolves a DaemonSet to its pod containers.
func DaemonSetSourceResolver(
	ctx *types.PluginContext,
	resourceData map[string]interface{},
	opts logs.SourceResolverOptions,
) (*logs.SourceResolverResult, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}
	name, namespace := extractNameAndNamespace(resourceData)

	ds, err := clients.Clientset.AppsV1().DaemonSets(namespace).Get(
		ctx.Context, name, metav1.GetOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get daemonset %s/%s: %w", namespace, name, err)
	}

	selector, err := metav1.LabelSelectorAsSelector(ds.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("failed to parse selector: %w", err)
	}

	return resolvePodsToSources(ctx, clients, namespace, selector, opts)
}

// ReplicaSetSourceResolver resolves a ReplicaSet to its pod containers.
func ReplicaSetSourceResolver(
	ctx *types.PluginContext,
	resourceData map[string]interface{},
	opts logs.SourceResolverOptions,
) (*logs.SourceResolverResult, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}
	name, namespace := extractNameAndNamespace(resourceData)

	rs, err := clients.Clientset.AppsV1().ReplicaSets(namespace).Get(
		ctx.Context, name, metav1.GetOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get replicaset %s/%s: %w", namespace, name, err)
	}

	selector, err := metav1.LabelSelectorAsSelector(rs.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("failed to parse selector: %w", err)
	}

	return resolvePodsToSources(ctx, clients, namespace, selector, opts)
}

// JobSourceResolver resolves a Job to its pod containers.
func JobSourceResolver(
	ctx *types.PluginContext,
	resourceData map[string]interface{},
	opts logs.SourceResolverOptions,
) (*logs.SourceResolverResult, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}
	name, namespace := extractNameAndNamespace(resourceData)

	job, err := clients.Clientset.BatchV1().Jobs(namespace).Get(
		ctx.Context, name, metav1.GetOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get job %s/%s: %w", namespace, name, err)
	}

	selector, err := metav1.LabelSelectorAsSelector(job.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("failed to parse selector: %w", err)
	}

	return resolvePodsToSources(ctx, clients, namespace, selector, opts)
}

// CronJobSourceResolver resolves a CronJob to its active job pods.
func CronJobSourceResolver(
	ctx *types.PluginContext,
	resourceData map[string]interface{},
	opts logs.SourceResolverOptions,
) (*logs.SourceResolverResult, error) {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return nil, err
	}
	name, namespace := extractNameAndNamespace(resourceData)

	cronjob, err := clients.Clientset.BatchV1().CronJobs(namespace).Get(
		ctx.Context, name, metav1.GetOptions{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get cronjob %s/%s: %w", namespace, name, err)
	}

	var allSources []logs.LogSource
	for _, ref := range cronjob.Status.Active {
		job, err := clients.Clientset.BatchV1().Jobs(namespace).Get(
			ctx.Context, ref.Name, metav1.GetOptions{},
		)
		if err != nil {
			continue
		}

		selector, err := metav1.LabelSelectorAsSelector(job.Spec.Selector)
		if err != nil {
			continue
		}

		result, err := resolvePodsToSources(ctx, clients, namespace, selector, opts)
		if err != nil {
			continue
		}
		allSources = append(allSources, result.Sources...)
	}

	return &logs.SourceResolverResult{Sources: allSources}, nil
}

// resolvePodsToSources lists pods matching a selector and extracts container sources.
func resolvePodsToSources(
	ctx *types.PluginContext,
	clients *kubeauth.KubeClientBundle,
	namespace string,
	selector labels.Selector,
	opts logs.SourceResolverOptions,
) (*logs.SourceResolverResult, error) {
	pods, err := clients.Clientset.CoreV1().Pods(namespace).List(
		ctx.Context,
		metav1.ListOptions{LabelSelector: selector.String()},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}

	var sources []logs.LogSource
	for _, pod := range pods.Items {
		sources = append(sources, podToSources(pod, opts.Target)...)
	}

	result := &logs.SourceResolverResult{Sources: sources}

	if opts.Watch {
		// Seed known sources from the initial list so the watcher doesn't
		// re-emit SourceAdded for pods already included in the snapshot.
		initialKnown := make(map[string]map[string]struct{}, len(pods.Items))
		for _, pod := range pods.Items {
			ids := make(map[string]struct{})
			for _, s := range podToSources(pod, opts.Target) {
				ids[s.ID] = struct{}{}
			}
			initialKnown[pod.Name] = ids
		}
		eventCh := make(chan logs.SourceEvent, 16)
		result.Events = eventCh
		go watchPodsAsSourceEvents(ctx, clients, namespace, selector, opts.Target, pods.ResourceVersion, initialKnown, eventCh)
	}

	return result, nil
}

// watchPodsAsSourceEvents watches for pod changes and emits source events.
// It wraps the watch in a relist/re-watch loop so that transient failures
// (closed connections, expired resourceVersions) are retried with backoff.
func watchPodsAsSourceEvents(
	ctx *types.PluginContext,
	clients *kubeauth.KubeClientBundle,
	namespace string,
	selector labels.Selector,
	target string,
	resourceVersion string,
	initialKnown map[string]map[string]struct{},
	eventCh chan<- logs.SourceEvent,
) {
	defer close(eventCh)

	knownSources := initialKnown
	if knownSources == nil {
		knownSources = make(map[string]map[string]struct{})
	}
	rv := resourceVersion

	const (
		minBackoff = 500 * time.Millisecond
		maxBackoff = 30 * time.Second
	)
	backoff := minBackoff

	for {
		if ctx.Context.Err() != nil {
			return
		}

		watcher, err := clients.Clientset.CoreV1().Pods(namespace).Watch(
			ctx.Context,
			metav1.ListOptions{
				LabelSelector:   selector.String(),
				ResourceVersion: rv,
			},
		)
		if err != nil {
			log.Printf("[logs-watch] watch creation failed: %v, retrying in %s", err, backoff)
			select {
			case <-ctx.Context.Done():
				return
			case <-time.After(backoff):
			}
			// Relist to get a fresh resourceVersion.
			rv, knownSources = relistPods(ctx.Context, clients, namespace, selector, target, knownSources, eventCh)
			backoff = min(backoff*2, maxBackoff)
			continue
		}

		// Successful watch creation resets backoff.
		backoff = minBackoff
		newRV := processPodWatchEvents(ctx.Context, watcher, target, knownSources, eventCh)
		watcher.Stop()

		if ctx.Context.Err() != nil {
			return
		}

		// Update RV if processPodWatchEvents returned one from the stream.
		if newRV != "" {
			rv = newRV
		} else {
			// Watch closed without yielding events — relist.
			rv, knownSources = relistPods(ctx.Context, clients, namespace, selector, target, knownSources, eventCh)
		}
	}
}

// relistPods re-lists pods to rebuild knownSources and obtain a fresh resourceVersion.
// It emits SourceAdded for any new pods and SourceRemoved for pods that disappeared.
func relistPods(
	ctx context.Context,
	clients *kubeauth.KubeClientBundle,
	namespace string,
	selector labels.Selector,
	target string,
	prevKnown map[string]map[string]struct{},
	eventCh chan<- logs.SourceEvent,
) (string, map[string]map[string]struct{}) {
	podList, err := clients.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: selector.String(),
	})
	if err != nil {
		log.Printf("[logs-watch] relist failed: %v", err)
		return "", prevKnown
	}

	newKnown := make(map[string]map[string]struct{})
	for i := range podList.Items {
		pod := &podList.Items[i]
		sources := podToSources(*pod, target)
		ids := make(map[string]struct{}, len(sources))
		for _, s := range sources {
			ids[s.ID] = struct{}{}
			// Emit add for sources not previously known.
			prev := prevKnown[pod.Name]
			if _, ok := prev[s.ID]; !ok {
				select {
				case eventCh <- logs.SourceEvent{Type: logs.SourceAdded, Source: s}:
				case <-ctx.Done():
					return podList.ResourceVersion, newKnown
				}
			}
		}
		newKnown[pod.Name] = ids
	}

	// Emit removals for pods/containers that disappeared.
	for podName, prevIDs := range prevKnown {
		currentIDs := newKnown[podName]
		for id := range prevIDs {
			if currentIDs == nil {
				select {
				case eventCh <- logs.SourceEvent{Type: logs.SourceRemoved, Source: logs.LogSource{ID: id}}:
				case <-ctx.Done():
					return podList.ResourceVersion, newKnown
				}
			} else if _, ok := currentIDs[id]; !ok {
				select {
				case eventCh <- logs.SourceEvent{Type: logs.SourceRemoved, Source: logs.LogSource{ID: id}}:
				case <-ctx.Done():
					return podList.ResourceVersion, newKnown
				}
			}
		}
	}

	return podList.ResourceVersion, newKnown
}

// processPodWatchEvents reads from a K8s watch and emits SourceAdded/SourceRemoved
// events. It tracks known sources per pod and diffs on MODIFIED to detect new
// or removed containers (e.g. ephemeral debug containers).
// Returns the last seen resourceVersion from the stream (empty if none seen).
func processPodWatchEvents(
	ctx context.Context,
	watcher watch.Interface,
	target string,
	knownSources map[string]map[string]struct{},
	eventCh chan<- logs.SourceEvent,
) string {
	var lastRV string

	for {
		select {
		case <-ctx.Done():
			return lastRV
		case event, ok := <-watcher.ResultChan():
			if !ok {
				return lastRV
			}

			// Handle watch errors (e.g. expired resourceVersion, server-side close).
			if event.Type == watch.Error {
				log.Printf("[logs-watch] watch error event received: %v", event.Object)
				return lastRV
			}

			pod, ok := event.Object.(*corev1.Pod)
			if !ok {
				continue
			}
			lastRV = pod.ResourceVersion

			sources := podToSources(*pod, target)
			currentIDs := make(map[string]struct{}, len(sources))
			for _, s := range sources {
				currentIDs[s.ID] = struct{}{}
			}

			switch event.Type {
			case watch.Added:
				knownSources[pod.Name] = currentIDs
				for _, src := range sources {
					select {
					case eventCh <- logs.SourceEvent{Type: logs.SourceAdded, Source: src}:
					case <-ctx.Done():
						return lastRV
					}
				}

			case watch.Modified:
				prev := knownSources[pod.Name]
				knownSources[pod.Name] = currentIDs
				// Emit added for new sources
				for _, src := range sources {
					if _, existed := prev[src.ID]; !existed {
						select {
						case eventCh <- logs.SourceEvent{Type: logs.SourceAdded, Source: src}:
						case <-ctx.Done():
							return lastRV
						}
					}
				}
				// Emit removed for sources that disappeared
				for id := range prev {
					if _, exists := currentIDs[id]; !exists {
						select {
						case eventCh <- logs.SourceEvent{Type: logs.SourceRemoved, Source: logs.LogSource{ID: id}}:
						case <-ctx.Done():
							return lastRV
						}
					}
				}

			case watch.Deleted:
				prev := knownSources[pod.Name]
				delete(knownSources, pod.Name)
				// Emit removals for all previously tracked sources, preferring
				// full Source data from the current payload when available.
				for id := range prev {
					src := logs.LogSource{ID: id}
					if _, ok := currentIDs[id]; ok {
						for _, s := range sources {
							if s.ID == id {
								src = s
								break
							}
						}
					}
					select {
					case eventCh <- logs.SourceEvent{Type: logs.SourceRemoved, Source: src}:
					case <-ctx.Done():
						return lastRV
					}
				}
			}
		}
	}
}
