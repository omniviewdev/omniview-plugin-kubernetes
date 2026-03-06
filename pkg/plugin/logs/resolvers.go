package logs

import (
	"context"
	"fmt"

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
		go watchPodsAsSourceEvents(ctx, clients, namespace, selector, opts.Target, initialKnown, eventCh)
	}

	return result, nil
}

// watchPodsAsSourceEvents watches for pod changes and emits source events.
func watchPodsAsSourceEvents(
	ctx *types.PluginContext,
	clients *kubeauth.KubeClientBundle,
	namespace string,
	selector labels.Selector,
	target string,
	initialKnown map[string]map[string]struct{},
	eventCh chan<- logs.SourceEvent,
) {
	defer close(eventCh)

	watcher, err := clients.Clientset.CoreV1().Pods(namespace).Watch(
		ctx.Context,
		metav1.ListOptions{LabelSelector: selector.String()},
	)
	if err != nil {
		return
	}
	defer watcher.Stop()

	processPodWatchEvents(ctx.Context, watcher, target, initialKnown, eventCh)
}

// processPodWatchEvents reads from a K8s watch and emits SourceAdded/SourceRemoved
// events. It tracks known sources per pod and diffs on MODIFIED to detect new
// or removed containers (e.g. ephemeral debug containers).
func processPodWatchEvents(
	ctx context.Context,
	watcher watch.Interface,
	target string,
	initialKnown map[string]map[string]struct{},
	eventCh chan<- logs.SourceEvent,
) {
	// Track known sources per pod for diffing on MODIFIED.
	// Seed from the initial list so we don't re-emit already-known sources.
	knownSources := initialKnown
	if knownSources == nil {
		knownSources = make(map[string]map[string]struct{})
	}

	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-watcher.ResultChan():
			if !ok {
				return
			}

			pod, ok := event.Object.(*corev1.Pod)
			if !ok {
				continue
			}

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
						return
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
							return
						}
					}
				}
				// Emit removed for sources that disappeared
				for id := range prev {
					if _, exists := currentIDs[id]; !exists {
						select {
						case eventCh <- logs.SourceEvent{Type: logs.SourceRemoved, Source: logs.LogSource{ID: id}}:
						case <-ctx.Done():
							return
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
						return
					}
				}
				// Also emit for any sources in the current payload not in prev
				// (rare but defensive).
				for _, src := range sources {
					if _, ok := prev[src.ID]; !ok {
						select {
						case eventCh <- logs.SourceEvent{Type: logs.SourceRemoved, Source: src}:
						case <-ctx.Done():
							return
						}
					}
				}
			}
		}
	}
}
