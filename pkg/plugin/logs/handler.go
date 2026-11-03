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
			return nil, resourcev2.NewError("INVALID_REQUEST", "unsupported native log resource type")
		}
		name, targetNamespace, err := utils.NativeResourceTarget(ctx, req.ResourceData, req.Reference, req.Route, resourceType, true)
		if err != nil {
			return nil, err
		}
		if observed := namespace; observed != "" && observed != targetNamespace {
			return nil, resourcev2.NewError("INVALID_REQUEST", "log source namespace does not match the resource")
		}
		namespace = targetNamespace
		if resourceType == "k8s:/pods" {
			if observed := req.Labels["pod"]; observed != "" && observed != name {
				return nil, resourcev2.NewError("INVALID_REQUEST", "log source pod does not match the resource")
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
		return nil, fmt.Errorf("pod name is required but not found in labels or resource data")
	}
	if namespace == "" {
		return nil, fmt.Errorf("namespace is required but not found in labels or resource data")
	}

	// Container comes from labels first (resolved sources), then target selection
	container := req.Labels["container"]
	if container == "" {
		container = req.Target
	}

	logOpts := &corev1.PodLogOptions{
		Container:    container,
		Follow:       req.Follow,
		Previous:     req.IncludePrevious,
		Timestamps:   true, // always request timestamps for merge ordering
		TailLines:    ptrIfPositive(req.TailLines),
		SinceSeconds: ptrIfPositive(req.SinceSeconds),
	}
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

	if req.SinceTime != nil {
		t := metav1.NewTime(*req.SinceTime)
		logOpts.SinceTime = &t
		// Kubernetes rejects requests containing both time filters.
		logOpts.SinceSeconds = nil
	}

	if req.LimitBytes > 0 {
		logOpts.LimitBytes = &req.LimitBytes
	}
	if !req.Follow && (logOpts.LimitBytes == nil || *logOpts.LimitBytes > 1<<20) {
		limit := int64(1 << 20)
		logOpts.LimitBytes = &limit
	}

	return clients.Clientset.CoreV1().Pods(namespace).GetLogs(pod, logOpts).Stream(ctx.Context)
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
