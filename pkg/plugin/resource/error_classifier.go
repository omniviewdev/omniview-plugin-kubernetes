package resource

import sdkresource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"

// kubeErrorClassifier adapts the classifyResourceError function to satisfy the
// v1 SDK's ErrorClassifier interface. It can be set on ResourcePluginConfig so
// the gRPC server converts raw Kubernetes API errors into structured
// ResourceOperationError values before returning them to the host.
type kubeErrorClassifier struct{}

// Compile-time interface check.
var _ sdkresource.ErrorClassifier = (*kubeErrorClassifier)(nil)

// ClassifyError delegates to classifyResourceError in errors.go.
func (k *kubeErrorClassifier) ClassifyError(err error) error {
	return classifyResourceError(err)
}
