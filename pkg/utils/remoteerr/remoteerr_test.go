package remoteerr

import (
	"context"
	"errors"
	"fmt"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestSanitizeDropsRemoteTextAndKeepsClass(t *testing.T) {
	assert.NoError(t, Sanitize("op", nil))

	other := Sanitize("op", fmt.Errorf("wrap: %w", errors.New("secret-remote-text")))
	require.Error(t, other)
	assert.Equal(t, "op failed", other.Error())

	assert.Equal(t, context.Canceled, Sanitize("op", context.Canceled))
	wrappedDeadline := Sanitize("op", fmt.Errorf("secret-wrapper: %w", context.DeadlineExceeded))
	assert.ErrorIs(t, wrappedDeadline, context.DeadlineExceeded)
	assert.NotContains(t, wrappedDeadline.Error(), "secret-wrapper")

	forbidden := apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "secret-name", errors.New("secret-api-message"))
	got := Sanitize("op", fmt.Errorf("outer secret-outer: %w", forbidden))
	assert.True(t, apierrors.IsForbidden(got), "API class must stay matchable")
	assert.Contains(t, got.Error(), "Forbidden")
	assert.Contains(t, got.Error(), "403")
	for _, secret := range []string{"secret-name", "secret-api-message", "secret-outer"} {
		assert.NotContains(t, got.Error(), secret)
	}

	provider := &resource.ResourceOperationError{
		Err:         errors.New("secret-cause"),
		Code:        "FORBIDDEN",
		Title:       "secret-title",
		Message:     "secret-message",
		Suggestions: []string{"secret-suggestion"},
	}
	coded := Sanitize("op", fmt.Errorf("secret-wrapper: %w", provider))
	var detail *resource.ResourceOperationError
	require.True(t, errors.As(coded, &detail))
	assert.Equal(t, "FORBIDDEN", detail.Code)
	assert.Equal(t, "op failed (FORBIDDEN)", detail.Message)
	assert.Empty(t, detail.Title)
	assert.Empty(t, detail.Suggestions)
	assert.Nil(t, detail.Err)
	assert.NotContains(t, coded.Error(), "secret-")

	// A code outside the reviewed vocabulary is not trusted.
	unknown := Sanitize("op", &resource.ResourceOperationError{Code: "secret-code", Message: "secret-message"})
	assert.Equal(t, "op failed", unknown.Error())
}
