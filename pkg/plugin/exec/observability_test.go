package exec

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
	utilexec "k8s.io/client-go/util/exec"
)

func captureExecDefaultLogs(t *testing.T) *logtest.RecordingSink {
	t.Helper()
	sink := &logtest.RecordingSink{}
	previous := logging.Default()
	logging.SetDefault(logging.New(logging.Config{
		Name:    "test",
		Level:   logging.NewLevelController(logging.LevelDebug),
		Backend: logging.NewSinkBackend(sink),
	}))
	t.Cleanup(func() { logging.SetDefault(previous) })
	return sink
}

func captureExecSpans(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	previous := otel.GetTracerProvider()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		require.NoError(t, provider.Shutdown(context.Background()))
	})
	return exporter
}

func execRecordText(sink *logtest.RecordingSink) string {
	var b strings.Builder
	for _, record := range sink.Records() {
		b.WriteString(record.Message)
		for _, field := range record.Fields {
			fmt.Fprintf(&b, " %s=%v", field.Key, field.Value)
		}
		b.WriteByte('\n')
	}
	return b.String()
}

func TestExecBuildFailedEmitsClassifiedSpanEventAndWarn(t *testing.T) {
	sink := captureExecDefaultLogs(t)
	exporter := captureExecSpans(t)
	ctx, span := otel.Tracer("test").Start(context.Background(), "exec.parent")
	execBuildFailed(ctx, "spdy", errors.New("secret-executor-error https://cluster.invalid/token"))
	span.End()

	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	require.Len(t, spans[0].Events, 1)
	event := spans[0].Events[0]
	assert.Equal(t, "executor_build_failed", event.Name)
	attrs := map[string]string{}
	for _, attr := range event.Attributes {
		attrs[string(attr.Key)] = attr.Value.Emit()
		assert.NotContains(t, attr.Value.Emit(), "secret-executor-error")
	}
	assert.Equal(t, "spdy", attrs["transport"])
	assert.Equal(t, "failure", attrs["outcome"])
	assert.Equal(t, "other", attrs["error.class"])

	records := sink.Records()
	require.Len(t, records, 1)
	assert.Equal(t, logging.LevelWarn, records[0].Level)
	assert.NotContains(t, execRecordText(sink), "secret-executor-error")
}

func TestWaitForDebugContainerRecordsWaitEventWithoutContainerMessage(t *testing.T) {
	sink := captureExecDefaultLogs(t)
	exporter := captureExecSpans(t)
	pod := attachPodFixture()
	client := fake.NewSimpleClientset(pod)
	client.PrependReactor("get", "pods", func(ktesting.Action) (bool, runtime.Object, error) {
		observed := pod.DeepCopy()
		observed.Status.EphemeralContainerStatuses[0].State = corev1.ContainerState{
			Terminated: &corev1.ContainerStateTerminated{Reason: "Error", ExitCode: 7, Message: "secret-terminated-message"},
		}
		return true, observed, nil
	})
	ctx, span := otel.Tracer("test").Start(context.Background(), "exec.parent")
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	err := waitForDebugContainer(ctx, client, pod.Namespace, pod.Name, string(pod.UID), "debugger-omniview-selected")
	require.Error(t, err)
	span.End()

	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	require.Len(t, spans[0].Events, 1)
	assert.Equal(t, "debug_container_wait", spans[0].Events[0].Name)
	attrs := map[string]string{}
	for _, attr := range spans[0].Events[0].Attributes {
		attrs[string(attr.Key)] = attr.Value.Emit()
		assert.NotContains(t, attr.Value.Emit(), "secret-terminated-message")
	}
	assert.Equal(t, "failure", attrs["outcome"])
	assert.Contains(t, attrs, "wait_ms")
	assert.NotContains(t, execRecordText(sink), "secret-terminated-message")
	assert.Contains(t, execRecordText(sink), "debug container wait finished")
}

func TestNativeKubeconfigRejectionLogsCauseWithoutPath(t *testing.T) {
	sink := captureExecDefaultLogs(t)
	connection := &types.Connection{ID: "cluster", Data: map[string]any{"kubeconfig": "/secret/home/user/kubeconfig"}}
	_, _, err := nativeKubeconfig(connection)
	require.Error(t, err)

	text := execRecordText(sink)
	assert.Contains(t, text, "native exec kubeconfig unsupported")
	assert.Contains(t, text, "cause=kubeconfig_not_regular_file")
	assert.NotContains(t, text, "/secret/home/user")
}

func TestClassifyExecErrorDropsRemoteTextButKeepsClassification(t *testing.T) {
	remote := errors.New(`OCI runtime exec failed: exec: "secret-binary": executable file not found in $PATH secret-node-detail`)
	result := classifyExecError(remote, []string{"sh"})
	var execErr *sdkexec.ExecError
	require.True(t, errors.As(result, &execErr))
	assert.Equal(t, "Shell not found", execErr.Title)
	assert.True(t, execErr.Retryable)
	for _, text := range []string{execErr.Error(), execErr.Message, execErr.Title, execErr.Suggestion} {
		assert.NotContains(t, text, "secret-binary")
		assert.NotContains(t, text, "secret-node-detail")
	}
	assert.NotErrorIs(t, execErr, remote)

	forbidden := apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "secret-pod", errors.New("secret-rbac-message"))
	result = classifyExecError(forbidden, []string{"sh"})
	require.True(t, errors.As(result, &execErr))
	assert.True(t, apierrors.IsForbidden(execErr), "API class stays matchable")
	assert.NotContains(t, execErr.Error(), "secret-")
	assert.NotContains(t, execErr.Message, "secret-")

	result = classifyExecError(utilexec.CodeExitError{Err: errors.New("command terminated with exit code 3 secret-output"), Code: 3}, []string{"sh"})
	require.True(t, errors.As(result, &execErr))
	assert.Equal(t, "Command exited with status 3.", execErr.Message)
	assert.NotContains(t, execErr.Error(), "secret-output")
}
