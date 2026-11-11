package resourcers

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/validation"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

func testCronJob(name string) *batchv1.CronJob {
	return &batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "default", UID: k8stypes.UID("cj-uid")},
		Spec: batchv1.CronJobSpec{
			Schedule: "0 0 1 1 *",
			JobTemplate: batchv1.JobTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "smoke"}, Annotations: map[string]string{"team": "ops"}},
				Spec: batchv1.JobSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
					RestartPolicy: corev1.RestartPolicyNever,
					Containers:    []corev1.Container{{Name: "main", Image: "busybox:1.37.0", Command: []string{"true"}}},
				}}},
			},
		},
	}
}

func TestCronJobResourcer_GetActions(t *testing.T) {
	actions, err := NewCronJobResourcer(zap.NewNop().Sugar()).GetActions(context.Background(), nil)
	require.NoError(t, err)
	require.Len(t, actions, 3)
	for i, id := range []string{"trigger", "suspend", "resume"} {
		assert.Equal(t, id, actions[i].ID)
		assert.NotNil(t, actions[i].ParamsSchema)
		assert.False(t, actions[i].Streaming)
	}
}

func TestCronJobResourcer_Trigger(t *testing.T) {
	name := strings.Repeat("a", 70)
	fakeClient := fake.NewClientset(testCronJob(name))
	r := NewCronJobResourcer(zap.NewNop().Sugar())

	result, err := r.ExecuteAction(context.Background(), &clients.ClientSet{KubeClient: fakeClient}, workloadActionRequest("trigger", name, "default", nil))
	require.NoError(t, err)
	jobName := result.Map["job"].String
	require.NotEmpty(t, jobName)
	assert.Equal(t, "default", result.Map["namespace"].String)

	job, err := fakeClient.BatchV1().Jobs("default").Get(context.Background(), jobName, metav1.GetOptions{})
	require.NoError(t, err)
	assert.LessOrEqual(t, len(job.Name), 63)
	assert.True(t, strings.HasPrefix(job.Name, strings.Repeat("a", 50)+"-manual-"))
	assert.Equal(t, "manual", job.Annotations["cronjob.kubernetes.io/instantiate"])
	assert.Equal(t, "ops", job.Annotations["team"])
	assert.Equal(t, "smoke", job.Labels["app"])
	require.Len(t, job.OwnerReferences, 1)
	owner := job.OwnerReferences[0]
	assert.Equal(t, "CronJob", owner.Kind)
	assert.Equal(t, "batch/v1", owner.APIVersion)
	assert.Equal(t, name, owner.Name)
	assert.Equal(t, k8stypes.UID("cj-uid"), owner.UID)
	require.NotNil(t, owner.Controller)
	assert.True(t, *owner.Controller)
	assert.Equal(t, "busybox:1.37.0", job.Spec.Template.Spec.Containers[0].Image)
}

func TestCronJobActionTelemetry(t *testing.T) {
	for _, tc := range []struct {
		action, verb, resource, stage, operation string
		cancel, success                          bool
	}{
		{action: "trigger", verb: "get", resource: "cronjobs", stage: "fetching", operation: "get_cronjob"},
		{action: "trigger", verb: "create", resource: "jobs", stage: "creating", operation: "create_job"},
		{action: "suspend", verb: "patch", resource: "cronjobs", stage: "patching", operation: "patch_cronjob"},
		{action: "resume", verb: "patch", resource: "cronjobs", stage: "patching", operation: "patch_cronjob"},
		{action: "trigger", verb: "get", resource: "cronjobs", stage: "fetching", operation: "get_cronjob", cancel: true},
		{action: "trigger", stage: "creating", operation: "create_job", success: true},
		{action: "suspend", stage: "patching", operation: "patch_cronjob", success: true},
		{action: "resume", stage: "patching", operation: "patch_cronjob", success: true},
	} {
		t.Run(tc.action+"/"+tc.stage+tc.verb, func(t *testing.T) {
			core, logs := observer.New(zap.InfoLevel)
			r := NewCronJobResourcer(zap.New(core).Sugar())
			client := fake.NewClientset(testCronJob("nightly"))
			if tc.verb != "" {
				client.PrependReactor(tc.verb, tc.resource, func(k8stesting.Action) (bool, runtime.Object, error) {
					if tc.cancel {
						return true, nil, context.DeadlineExceeded
					}
					return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: tc.resource}, "secret-cronjob", errors.New("secret-error"))
				})
			}
			request := workloadActionRequest(tc.action, "nightly", "default", nil)
			request.Route.Connection = "cluster"
			_, err := r.ExecuteAction(context.Background(), &clients.ClientSet{KubeClient: client}, request)
			require.Equal(t, !tc.success, err != nil)
			require.Equal(t, 1, logs.Len())
			fields := logs.All()[0].ContextMap()
			assert.Equal(t, tc.action, fields["action"])
			assert.Equal(t, "nightly", fields["resource_id"])
			assert.Equal(t, "default", fields["namespace"])
			assert.Equal(t, "cluster", fields["connection"])
			assert.Equal(t, "k8s:batch/cronjobs", fields["resource_type"])
			assert.Equal(t, tc.stage, fields["stage"])
			assert.Equal(t, tc.operation, fields["operation"])
			if tc.success {
				assert.Equal(t, "success", fields["outcome"])
			} else if tc.cancel {
				assert.Equal(t, "canceled", fields["outcome"])
				assert.Equal(t, "deadline_exceeded", fields["error_class"])
			} else {
				assert.Equal(t, "failure", fields["outcome"])
				assert.Equal(t, "kubernetes", fields["error_class"])
				assert.Equal(t, "Forbidden", fields["k8s_reason"])
				assert.EqualValues(t, 403, fields["k8s_status_code"])
			}
			encoded, err := json.Marshal(fields)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "secret-")
		})
	}
}

func TestCronJobActionTelemetrySpan(t *testing.T) {
	previous := otel.GetTracerProvider()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		require.NoError(t, provider.Shutdown(context.Background()))
	})
	core, logs := observer.New(zap.InfoLevel)
	r := NewCronJobResourcer(zap.New(core).Sugar())
	client := fake.NewClientset()
	client.PrependReactor("get", "cronjobs", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "cronjobs"}, "secret-name", errors.New("secret-error"))
	})
	request := workloadActionRequest("trigger", "nightly", "default", nil)
	request.Route.Connection = "cluster"
	_, err := r.ExecuteAction(context.Background(), &clients.ClientSet{KubeClient: client}, request)
	require.Error(t, err)
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	assert.Equal(t, "kubernetes.cronjob.trigger", spans[0].Name)
	assert.Equal(t, codes.Error, spans[0].Status.Code)
	assert.Equal(t, "kubernetes", spans[0].Status.Description)
	assert.Equal(t, spans[0].SpanContext.TraceID().String(), logs.All()[0].ContextMap()["trace_id"])
	attributes := make(map[string]string)
	for _, attr := range spans[0].Attributes {
		attributes[string(attr.Key)] = attr.Value.Emit()
	}
	assert.Equal(t, "nightly", attributes["resource.id"])
	assert.Equal(t, "default", attributes["resource.namespace"])
	assert.Equal(t, "cluster", attributes["connection"])
	assert.Equal(t, "k8s:batch/cronjobs", attributes["resource.type"])
	for _, attr := range spans[0].Attributes {
		assert.NotContains(t, attr.Value.Emit(), "secret-")
	}
	nodeRequest := workloadActionRequest("cordon", "worker", "", nil)
	nodeRequest.Route.Connection = "cluster"
	_, err = NewNodeResourcer(zap.New(core).Sugar()).ExecuteAction(context.Background(), newNodeClientSet(testNode("worker")), nodeRequest)
	require.NoError(t, err)
	spans = exporter.GetSpans()
	require.Len(t, spans, 2)
	attributes = make(map[string]string)
	for _, attr := range spans[1].Attributes {
		attributes[string(attr.Key)] = attr.Value.Emit()
	}
	assert.Equal(t, "worker", attributes["resource.id"])
	assert.Equal(t, "", attributes["resource.namespace"])
	assert.Equal(t, "cluster", attributes["connection"])
	assert.Equal(t, "k8s:/nodes", attributes["resource.type"])
	for _, attr := range spans[1].Attributes {
		assert.NotContains(t, attr.Value.Emit(), "secret-")
	}
}

func TestCronJobManualJobNameStaysDNS1123(t *testing.T) {
	// A '.' at index 49 would end the 50-character prefix in a non-alphanumeric.
	name := strings.Repeat("a", 48) + "-." + strings.Repeat("b", 20)
	job := cronJobManualJob(testCronJob(name))
	assert.True(t, strings.HasPrefix(job.Name, strings.Repeat("a", 48)+"-manual-"), job.Name)
	assert.LessOrEqual(t, len(job.Name), 63)
	assert.Empty(t, validation.IsDNS1123Subdomain(job.Name))
	assert.Empty(t, validation.IsDNS1123Label(job.Name))
}

func TestCronJobResourcer_TriggerIncarnationMismatch(t *testing.T) {
	fakeClient := fake.NewClientset(testCronJob("smoke-cron"))
	request := workloadActionRequest("trigger", "smoke-cron", "default", nil)
	other := "other-uid"
	request.Reference.Incarnation = &other
	_, err := NewCronJobResourcer(zap.NewNop().Sugar()).ExecuteAction(context.Background(), &clients.ClientSet{KubeClient: fakeClient}, request)
	require.Error(t, err)
	jobs, err := fakeClient.BatchV1().Jobs("default").List(context.Background(), metav1.ListOptions{})
	require.NoError(t, err)
	assert.Empty(t, jobs.Items)
}

func TestCronJobResourcer_SuspendResume(t *testing.T) {
	fakeClient := fake.NewClientset(testCronJob("smoke-cron"))
	cs := &clients.ClientSet{KubeClient: fakeClient}
	r := NewCronJobResourcer(zap.NewNop().Sugar())

	_, err := r.ExecuteAction(context.Background(), cs, workloadActionRequest("suspend", "smoke-cron", "default", nil))
	require.NoError(t, err)
	var patch k8stesting.PatchAction
	for _, action := range fakeClient.Actions() {
		if p, ok := action.(k8stesting.PatchAction); ok {
			patch = p
		}
	}
	require.NotNil(t, patch)
	assert.Equal(t, k8stypes.StrategicMergePatchType, patch.GetPatchType())
	assert.JSONEq(t, `{"spec":{"suspend":true}}`, string(patch.GetPatch()))
	cj, err := fakeClient.BatchV1().CronJobs("default").Get(context.Background(), "smoke-cron", metav1.GetOptions{})
	require.NoError(t, err)
	require.NotNil(t, cj.Spec.Suspend)
	assert.True(t, *cj.Spec.Suspend)

	_, err = r.ExecuteAction(context.Background(), cs, workloadActionRequest("resume", "smoke-cron", "default", nil))
	require.NoError(t, err)
	cj, err = fakeClient.BatchV1().CronJobs("default").Get(context.Background(), "smoke-cron", metav1.GetOptions{})
	require.NoError(t, err)
	require.NotNil(t, cj.Spec.Suspend)
	assert.False(t, *cj.Spec.Suspend)
}
