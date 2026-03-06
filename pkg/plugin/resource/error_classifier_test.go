package resource

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

func TestErrorClassifier_DelegatesToClassify(t *testing.T) {
	ec := &kubeErrorClassifier{}

	// Use a K8s 403 error — classifyResourceError should produce a FORBIDDEN result.
	err := k8sStatusError(403, "pods is forbidden")

	result := ec.ClassifyError(err)
	require.NotNil(t, result)

	var opErr *sdkresource.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "FORBIDDEN", opErr.Code)
}

func TestErrorClassifier_NilError(t *testing.T) {
	ec := &kubeErrorClassifier{}

	// A plain unclassifiable error returns nil from classifyResourceError.
	result := ec.ClassifyError(errors.New("unknown"))
	assert.Nil(t, result)
}
