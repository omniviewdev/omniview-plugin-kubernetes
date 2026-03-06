package resourcers

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

func int32Ptr(i int32) *int32 { return &i }

// ====================== NODE HEALTH ====================== //

func TestNodeHealth_Ready(t *testing.T) {
	r := NewNodeResourcer(zap.NewNop().Sugar())
	node := corev1.Node{
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{Type: corev1.NodeReady, Status: corev1.ConditionTrue},
			},
		},
	}
	data, _ := json.Marshal(node)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthHealthy, health.Status)
	assert.Equal(t, "Ready", health.Reason)
}

func TestNodeHealth_NotReady(t *testing.T) {
	r := NewNodeResourcer(zap.NewNop().Sugar())
	node := corev1.Node{
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{Type: corev1.NodeReady, Status: corev1.ConditionFalse, Message: "kubelet stopped"},
			},
		},
	}
	data, _ := json.Marshal(node)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthUnhealthy, health.Status)
	assert.Equal(t, "NotReady", health.Reason)
	assert.Equal(t, "kubelet stopped", health.Message)
}

func TestNodeHealth_MemoryPressure(t *testing.T) {
	r := NewNodeResourcer(zap.NewNop().Sugar())
	node := corev1.Node{
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{Type: corev1.NodeReady, Status: corev1.ConditionTrue},
				{Type: corev1.NodeMemoryPressure, Status: corev1.ConditionTrue, Message: "low memory"},
			},
		},
	}
	data, _ := json.Marshal(node)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthDegraded, health.Status)
	assert.Equal(t, "MemoryPressure", health.Reason)
}

func TestNodeHealth_NoConditions(t *testing.T) {
	r := NewNodeResourcer(zap.NewNop().Sugar())
	node := corev1.Node{}
	data, _ := json.Marshal(node)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthUnknown, health.Status)
}

// ====================== DEPLOYMENT HEALTH ====================== //

func TestDeploymentHealth_AllAvailable(t *testing.T) {
	r := NewDeploymentResourcer(zap.NewNop().Sugar())
	dep := appsv1.Deployment{
		Spec:   appsv1.DeploymentSpec{Replicas: int32Ptr(3)},
		Status: appsv1.DeploymentStatus{AvailableReplicas: 3},
	}
	data, _ := json.Marshal(dep)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthHealthy, health.Status)
	assert.Equal(t, "Available", health.Reason)
	assert.Contains(t, health.Message, "3/3")
}

func TestDeploymentHealth_PartiallyAvailable(t *testing.T) {
	r := NewDeploymentResourcer(zap.NewNop().Sugar())
	dep := appsv1.Deployment{
		Spec:   appsv1.DeploymentSpec{Replicas: int32Ptr(3)},
		Status: appsv1.DeploymentStatus{AvailableReplicas: 1},
	}
	data, _ := json.Marshal(dep)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthDegraded, health.Status)
	assert.Equal(t, "PartiallyAvailable", health.Reason)
	assert.Contains(t, health.Message, "1/3")
}

func TestDeploymentHealth_Unavailable(t *testing.T) {
	r := NewDeploymentResourcer(zap.NewNop().Sugar())
	dep := appsv1.Deployment{
		Spec:   appsv1.DeploymentSpec{Replicas: int32Ptr(3)},
		Status: appsv1.DeploymentStatus{AvailableReplicas: 0},
	}
	data, _ := json.Marshal(dep)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthUnhealthy, health.Status)
	assert.Equal(t, "Unavailable", health.Reason)
	assert.Contains(t, health.Message, "0/3")
}

func TestDeploymentHealth_NilReplicas(t *testing.T) {
	r := NewDeploymentResourcer(zap.NewNop().Sugar())
	dep := appsv1.Deployment{
		Spec:   appsv1.DeploymentSpec{}, // nil Replicas → defaults to 1
		Status: appsv1.DeploymentStatus{AvailableReplicas: 1},
	}
	data, _ := json.Marshal(dep)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthHealthy, health.Status)
	assert.Contains(t, health.Message, "1/1")
}

func TestDeploymentHealth_Conditions(t *testing.T) {
	r := NewDeploymentResourcer(zap.NewNop().Sugar())
	dep := appsv1.Deployment{
		Spec: appsv1.DeploymentSpec{Replicas: int32Ptr(1)},
		Status: appsv1.DeploymentStatus{
			AvailableReplicas: 1,
			Conditions: []appsv1.DeploymentCondition{
				{Type: appsv1.DeploymentAvailable, Status: corev1.ConditionTrue, Reason: "MinimumReplicasAvailable"},
			},
		},
	}
	data, _ := json.Marshal(dep)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	require.Len(t, health.Conditions, 1)
	assert.Equal(t, "Available", health.Conditions[0].Type)
}

// ====================== STATEFULSET HEALTH ====================== //

func TestStatefulSetHealth_AllReady(t *testing.T) {
	r := NewStatefulSetResourcer(zap.NewNop().Sugar())
	sts := appsv1.StatefulSet{
		Spec:   appsv1.StatefulSetSpec{Replicas: int32Ptr(3)},
		Status: appsv1.StatefulSetStatus{ReadyReplicas: 3},
	}
	data, _ := json.Marshal(sts)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthHealthy, health.Status)
	assert.Equal(t, "Ready", health.Reason)
	assert.Contains(t, health.Message, "3/3")
}

func TestStatefulSetHealth_PartiallyReady(t *testing.T) {
	r := NewStatefulSetResourcer(zap.NewNop().Sugar())
	sts := appsv1.StatefulSet{
		Spec:   appsv1.StatefulSetSpec{Replicas: int32Ptr(3)},
		Status: appsv1.StatefulSetStatus{ReadyReplicas: 1},
	}
	data, _ := json.Marshal(sts)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthDegraded, health.Status)
	assert.Equal(t, "PartiallyReady", health.Reason)
}

func TestStatefulSetHealth_NoneReady(t *testing.T) {
	r := NewStatefulSetResourcer(zap.NewNop().Sugar())
	sts := appsv1.StatefulSet{
		Spec:   appsv1.StatefulSetSpec{Replicas: int32Ptr(3)},
		Status: appsv1.StatefulSetStatus{ReadyReplicas: 0},
	}
	data, _ := json.Marshal(sts)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthUnhealthy, health.Status)
	assert.Equal(t, "NotReady", health.Reason)
}

func TestStatefulSetHealth_NilReplicas(t *testing.T) {
	r := NewStatefulSetResourcer(zap.NewNop().Sugar())
	sts := appsv1.StatefulSet{
		Spec:   appsv1.StatefulSetSpec{}, // nil → defaults to 1
		Status: appsv1.StatefulSetStatus{ReadyReplicas: 1},
	}
	data, _ := json.Marshal(sts)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthHealthy, health.Status)
}

// ====================== DAEMONSET HEALTH ====================== //

func TestDaemonSetHealth_AllReady(t *testing.T) {
	r := NewDaemonSetResourcer(zap.NewNop().Sugar())
	ds := appsv1.DaemonSet{
		Status: appsv1.DaemonSetStatus{DesiredNumberScheduled: 3, NumberReady: 3},
	}
	data, _ := json.Marshal(ds)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthHealthy, health.Status)
	assert.Equal(t, "Ready", health.Reason)
}

func TestDaemonSetHealth_PartiallyReady(t *testing.T) {
	r := NewDaemonSetResourcer(zap.NewNop().Sugar())
	ds := appsv1.DaemonSet{
		Status: appsv1.DaemonSetStatus{DesiredNumberScheduled: 3, NumberReady: 1},
	}
	data, _ := json.Marshal(ds)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthDegraded, health.Status)
	assert.Equal(t, "PartiallyReady", health.Reason)
}

func TestDaemonSetHealth_NoneReady(t *testing.T) {
	r := NewDaemonSetResourcer(zap.NewNop().Sugar())
	ds := appsv1.DaemonSet{
		Status: appsv1.DaemonSetStatus{DesiredNumberScheduled: 3, NumberReady: 0},
	}
	data, _ := json.Marshal(ds)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthUnhealthy, health.Status)
	assert.Equal(t, "NotReady", health.Reason)
}

func TestDaemonSetHealth_ZeroDesired(t *testing.T) {
	r := NewDaemonSetResourcer(zap.NewNop().Sugar())
	ds := appsv1.DaemonSet{
		Status: appsv1.DaemonSetStatus{DesiredNumberScheduled: 0, NumberReady: 0},
	}
	data, _ := json.Marshal(ds)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	assert.Equal(t, resource.HealthHealthy, health.Status)
	assert.Equal(t, "NoScheduled", health.Reason)
}

// ====================== INVALID JSON ====================== //

func TestHealth_InvalidJSON(t *testing.T) {
	badData := json.RawMessage(`{invalid}`)

	tests := []struct {
		name string
		fn   func() (*resource.ResourceHealth, error)
	}{
		{"Node", func() (*resource.ResourceHealth, error) {
			return NewNodeResourcer(zap.NewNop().Sugar()).AssessHealth(context.Background(), nil, resource.ResourceMeta{}, badData)
		}},
		{"Deployment", func() (*resource.ResourceHealth, error) {
			return NewDeploymentResourcer(zap.NewNop().Sugar()).AssessHealth(context.Background(), nil, resource.ResourceMeta{}, badData)
		}},
		{"StatefulSet", func() (*resource.ResourceHealth, error) {
			return NewStatefulSetResourcer(zap.NewNop().Sugar()).AssessHealth(context.Background(), nil, resource.ResourceMeta{}, badData)
		}},
		{"DaemonSet", func() (*resource.ResourceHealth, error) {
			return NewDaemonSetResourcer(zap.NewNop().Sugar()).AssessHealth(context.Background(), nil, resource.ResourceMeta{}, badData)
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			health, err := tt.fn()
			assert.Error(t, err)
			assert.Nil(t, health)
		})
	}
}

// ====================== NODE CONDITIONS ====================== //

func TestNodeHealth_ConditionsPopulated(t *testing.T) {
	r := NewNodeResourcer(zap.NewNop().Sugar())
	now := metav1.Now()
	node := corev1.Node{
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:               corev1.NodeReady,
					Status:             corev1.ConditionTrue,
					Reason:             "KubeletReady",
					Message:            "kubelet is posting ready status",
					LastTransitionTime: now,
				},
			},
		},
	}
	data, _ := json.Marshal(node)

	health, err := r.AssessHealth(context.Background(), nil, resource.ResourceMeta{}, data)
	require.NoError(t, err)
	require.Len(t, health.Conditions, 1)
	assert.Equal(t, "Ready", health.Conditions[0].Type)
	assert.Equal(t, "KubeletReady", health.Conditions[0].Reason)
}
