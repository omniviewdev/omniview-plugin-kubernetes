package logs

import (
	"fmt"
	"io"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs"

	"github.com/omniview/kubernetes/pkg/utils"
	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
)

// PodLogHandler opens a log stream for a single K8s pod container.
func PodLogHandler(clients *kubeauth.KubeClientBundle, ctx *types.PluginContext, req logs.LogStreamRequest) (io.ReadCloser, error) {
	target, err := resolvePodLogTarget(ctx, req)
	if err != nil {
		return nil, err
	}

	logOpts := podLogOptions(req, target.container)
	if !req.Follow {
		tail := req.TailLines
		if tail <= 0 {
			tail = 200
		}
		if tail > 5000 {
			tail = 5000
		}
		logOpts.TailLines = &tail
	}
	if !req.Follow && (logOpts.LimitBytes == nil || *logOpts.LimitBytes > 1<<20) {
		limit := int64(1 << 20)
		logOpts.LimitBytes = &limit
	}

	return clients.Clientset.CoreV1().Pods(target.namespace).GetLogs(target.pod, logOpts).Stream(ctx.Context)
}

// podLogTarget is the pod container a log request reads.
type podLogTarget struct {
	pod, namespace, container string
}

// resolvePodLogTarget names the pod container that req reads and checks it against the request's
// canonical reference and route. The stream and the replay count both resolve through it, so they
// can never read two different containers.
func resolvePodLogTarget(ctx *types.PluginContext, req logs.LogStreamRequest) (podLogTarget, error) {
	pod := req.Labels["pod"]
	namespace := req.Labels["namespace"]
	if req.Reference != nil || req.Route != nil {
		resourceType := "k8s:/pods"
		if req.Reference != nil {
			resourceType = req.Reference.Address.Type
		}
		switch resourceType {
		case "k8s:/pods", "k8s:apps/deployments", "k8s:apps/statefulsets", "k8s:apps/daemonsets", "k8s:apps/replicasets", "k8s:batch/jobs", "k8s:batch/cronjobs":
		default:
			return podLogTarget{}, resourcev2.NewError("INVALID_REQUEST", "unsupported native log resource type")
		}
		name, targetNamespace, err := utils.NativeResourceTarget(ctx, req.ResourceData, req.Reference, req.Route, resourceType, true)
		if err != nil {
			return podLogTarget{}, err
		}
		if observed := namespace; observed != "" && observed != targetNamespace {
			return podLogTarget{}, resourcev2.NewError("INVALID_REQUEST", "log source namespace does not match the resource")
		}
		namespace = targetNamespace
		if resourceType == "k8s:/pods" {
			if observed := req.Labels["pod"]; observed != "" && observed != name {
				return podLogTarget{}, resourcev2.NewError("INVALID_REQUEST", "log source pod does not match the resource")
			}
			pod = name
		}
	}

	// Prefer source labels (set by SourceResolvers for group resources like
	// Deployments, StatefulSets, etc.) over resource data, since resource data
	// may point to the parent resource rather than the actual pod.
	if pod == "" || namespace == "" {
		rpod, rns := extractPodIdentity(req.ResourceData)
		if pod == "" && (req.Reference == nil || req.Reference.Address.Type == "k8s:/pods") {
			pod = rpod
		}
		if namespace == "" {
			namespace = rns
		}
	}

	if pod == "" {
		return podLogTarget{}, fmt.Errorf("pod name is required but not found in labels or resource data")
	}
	if namespace == "" {
		return podLogTarget{}, fmt.Errorf("namespace is required but not found in labels or resource data")
	}

	// Container comes from labels first (resolved sources), then target selection
	container := req.Labels["container"]
	if container == "" {
		container = req.Target
	}
	return podLogTarget{pod: pod, namespace: namespace, container: container}, nil
}

// podLogOptions is the read a request asks of the pod's log, with no bound of the plugin's own
// on it. The follow stream opens it as it is; a finite read adds its clamps (PodLogHandler), and
// the replay count turns Follow off and nothing else (podReplayCount), so that it counts the
// lines of the very stream the request opens.
func podLogOptions(req logs.LogStreamRequest, container string) *corev1.PodLogOptions {
	logOpts := &corev1.PodLogOptions{
		Container:    container,
		Follow:       req.Follow,
		Previous:     req.IncludePrevious,
		Timestamps:   true, // always request timestamps for merge ordering
		TailLines:    ptrIfPositive(req.TailLines),
		SinceSeconds: ptrIfPositive(req.SinceSeconds),
	}

	if req.SinceTime != nil {
		t := metav1.NewTime(*req.SinceTime)
		logOpts.SinceTime = &t
		// Kubernetes rejects requests containing both time filters.
		logOpts.SinceSeconds = nil
	}

	if req.LimitBytes > 0 {
		limit := req.LimitBytes
		logOpts.LimitBytes = &limit
	}
	return logOpts
}

func ptrIfPositive(v int64) *int64 {
	if v > 0 {
		return &v
	}
	return nil
}

// extractPodIdentity reads the pod name and namespace from resource data (the full K8s object).
func extractPodIdentity(data *resourcev2.Value) (name, namespace string) {
	return extractNameAndNamespace(data)
}
