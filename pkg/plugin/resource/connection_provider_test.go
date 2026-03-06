package resource

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

func TestCheckConnection_NilConn(t *testing.T) {
	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}
	status, err := p.CheckConnection(context.Background(), nil, nil)
	assert.NoError(t, err)
	assert.Equal(t, types.ConnectionStatusError, status.Status)
	assert.Contains(t, status.Error, "connection is required")
}

func TestCheckConnection_NilClient(t *testing.T) {
	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}
	conn := &types.Connection{ID: "test"}
	status, err := p.CheckConnection(context.Background(), conn, nil)
	assert.NoError(t, err)
	assert.Equal(t, types.ConnectionStatusError, status.Status)
	assert.Contains(t, status.Error, "client is required")
}

func TestCreateClient_NoSession(t *testing.T) {
	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}
	client, err := p.CreateClient(context.Background())
	assert.Error(t, err)
	assert.Nil(t, client)
	assert.Contains(t, err.Error(), "no session")
}

func TestLoadConnections_NoSession(t *testing.T) {
	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}
	conns, err := p.LoadConnections(context.Background())
	assert.Error(t, err)
	assert.Nil(t, conns)
	assert.Contains(t, err.Error(), "no session")
}

func TestRefreshClient_NoSession(t *testing.T) {
	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}
	err := p.RefreshClient(context.Background(), nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no session")
}

func TestDestroyClient_NilClient(t *testing.T) {
	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}
	err := p.DestroyClient(context.Background(), nil)
	assert.NoError(t, err)
}

func TestDestroyClient_NilFactory(t *testing.T) {
	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}
	// ClientSet with nil DynamicInformerFactory — should not panic.
	cs := &clients.ClientSet{}
	err := p.DestroyClient(context.Background(), cs)
	assert.NoError(t, err)
}
