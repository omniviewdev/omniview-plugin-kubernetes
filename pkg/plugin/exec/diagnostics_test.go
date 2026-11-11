package exec

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type diagnosticTestLogger struct {
	logging.Logger
	fields map[string]interface{}
}

func (l *diagnosticTestLogger) Infow(_ context.Context, _ string, fields ...any) {
	l.fields = make(map[string]interface{}, len(fields)/2)
	for i := 0; i < len(fields); i += 2 {
		l.fields[fields[i].(string)] = fields[i+1]
	}
}

func TestExecDiagnosticClassification(t *testing.T) {
	for _, tc := range []struct {
		name, stage, class, outcome string
		err                         error
	}{
		{"success", "execution", "", "success", nil},
		{"validation", "admission", "validation", "failure", errors.New("secret-input")},
		{"canceled", "execution", "canceled", "canceled", context.Canceled},
		{"deadline", "execution", "deadline_exceeded", "canceled", context.DeadlineExceeded},
		{"kubernetes", "execution", "kubernetes", "failure", apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "pod", errors.New("secret-api-message"))},
		{"other", "lifecycle", "other", "failure", errors.New("secret-command")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logger := &diagnosticTestLogger{Logger: logging.NewNop()}
			ctx := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "cluster"}, Logger: logger}
			_, diagnostic := startExecDiagnostic(ctx, "test")
			diagnostic.stage, diagnostic.operation = tc.stage, "exec"
			diagnostic.pod, diagnostic.namespace = "pod", "namespace"
			diagnostic.finish(tc.err)
			assert.Equal(t, tc.outcome, logger.fields["outcome"])
			assert.Equal(t, "cluster", logger.fields["connection"])
			assert.Equal(t, "pod", logger.fields["resource_id"])
			if tc.err != nil {
				assert.Equal(t, tc.class, logger.fields["error_class"])
			} else {
				assert.NotContains(t, logger.fields, "error_class")
			}
			if tc.class == "kubernetes" {
				assert.Equal(t, "Forbidden", logger.fields["k8s_reason"])
				assert.Equal(t, 403, logger.fields["k8s_status_code"])
			}
			encoded, err := json.Marshal(logger.fields)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "secret-")
		})
	}
}

func TestPodHandlerDiagnosticDoesNotLogProviderError(t *testing.T) {
	logger := &diagnosticTestLogger{Logger: logging.NewNop()}
	ctx := &types.PluginContext{Context: context.Background(), Connection: &types.Connection{ID: "cluster"}, Logger: logger}
	err := podHandlerWithProvider(fakeProvider(errors.New("secret-provider-error")), ctx, sdkexec.SessionOptions{}, nil, nil, nil)
	require.Error(t, err)
	assert.NotContains(t, err.Error(), "secret-provider-error", "returned error must not carry provider text")
	assert.Equal(t, "client", logger.fields["operation"])
	assert.Equal(t, "other", logger.fields["error_class"])
	encoded, err := json.Marshal(logger.fields)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "secret-provider-error")
}
