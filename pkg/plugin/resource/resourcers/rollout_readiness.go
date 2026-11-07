package resourcers

import (
	"context"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
)

// rolloutReadyPods counts the intersection of this restart's pods and Ready pods.
// Workload status counters cannot distinguish old ready pods from updated ready pods.
func rolloutReadyPods(ctx context.Context, client kubernetes.Interface, kind string, workload metav1.Object, restartedAt string) (int32, error) {
	if workload.GetUID() == "" || restartedAt == "" {
		return 0, nil
	}
	options := metav1.ListOptions{}
	var selector *metav1.LabelSelector
	switch object := workload.(type) {
	case *appsv1.Deployment:
		selector = object.Spec.Selector
	case *appsv1.StatefulSet:
		selector = object.Spec.Selector
	case *appsv1.DaemonSet:
		selector = object.Spec.Selector
	}
	if selector != nil {
		labels, err := metav1.LabelSelectorAsSelector(selector)
		if err != nil {
			return 0, err
		}
		options.LabelSelector = labels.String()
	}
	owners := map[types.UID]bool{workload.GetUID(): true}
	if kind == "Deployment" {
		owners = make(map[types.UID]bool)
		replicas, err := client.AppsV1().ReplicaSets(workload.GetNamespace()).List(ctx, options)
		if err != nil {
			return 0, err
		}
		for i := range replicas.Items {
			replica := &replicas.Items[i]
			owner := metav1.GetControllerOf(replica)
			if owner != nil && owner.UID == workload.GetUID() && owner.Kind == "Deployment" {
				owners[replica.UID] = true
			}
		}
	}
	pods, err := client.CoreV1().Pods(workload.GetNamespace()).List(ctx, options)
	if err != nil {
		return 0, err
	}
	var ready int32
	for i := range pods.Items {
		pod := &pods.Items[i]
		owner := metav1.GetControllerOf(pod)
		ownerKind := kind
		if kind == "Deployment" {
			ownerKind = "ReplicaSet"
		}
		if owner == nil || owner.Kind != ownerKind || !owners[owner.UID] || pod.DeletionTimestamp != nil || pod.Annotations["kubectl.kubernetes.io/restartedAt"] != restartedAt {
			continue
		}
		for _, condition := range pod.Status.Conditions {
			if condition.Type == corev1.PodReady && condition.Status == corev1.ConditionTrue {
				ready++
				break
			}
		}
	}
	return ready, nil
}

type rolloutObservation struct {
	event watch.Event
	err   error
}

// rolloutObservations refreshes readiness even when pod transitions leave the
// workload's aggregate status unchanged, so its workload watch emits no update.
func rolloutObservations[T runtime.Object](ctx context.Context, watcher watch.Interface, interval time.Duration, refresh func(context.Context) (T, error)) (<-chan rolloutObservation, context.CancelFunc) {
	ctx, cancel := context.WithCancel(ctx)
	observations := make(chan rolloutObservation)
	go func() {
		defer close(observations)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			var observation rolloutObservation
			select {
			case <-ctx.Done():
				return
			case event, ok := <-watcher.ResultChan():
				if !ok {
					return
				}
				observation.event = event
			case <-ticker.C:
				object, err := refresh(ctx)
				observation = rolloutObservation{event: watch.Event{Type: watch.Modified, Object: object}, err: err}
			}
			select {
			case observations <- observation:
			case <-ctx.Done():
				return
			}
			if observation.err != nil {
				return
			}
		}
	}()
	return observations, cancel
}
