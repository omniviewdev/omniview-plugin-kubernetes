package exec

import (
	"context"
	"os"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniview/kubernetes/pkg/pluginid"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// plugin-sdk v0.22.0 refuses an exec session that starts after the manager was closed with a
// CONNECTION_ERROR, before it runs the plugin's handler. The plugin does not call Close itself
// (the SDK's shutdown does), so it has no code to change: this says what its sessions do now.
func TestAnExecSessionStartedAfterTheManagerClosedIsAConnectionError(t *testing.T) {
	var ran atomic.Int32
	handler := podExecHandler(nil)
	handler.TTYHandler = func(*types.PluginContext, sdkexec.SessionOptions, *os.File, chan error, <-chan sdkexec.SessionResizeInput) error {
		ran.Add(1)
		return nil
	}
	manager := sdkexec.NewManager(sdkexec.ManagerConfig{
		Handlers: map[string]sdkexec.Handler{handler.Plugin + "/" + handler.Resource: handler},
	})
	manager.Close()
	manager.Close() // idempotent

	ctx := &types.PluginContext{Context: context.Background()}
	for name, start := range map[string]func() (*sdkexec.Session, error){
		"a resource session": func() (*sdkexec.Session, error) {
			return manager.CreateResourceSession(ctx, sdkexec.SessionOptions{ID: "late-1", ResourcePlugin: pluginid.ResourceProvider, ResourceKey: "k8s:/pods"})
		},
		"a session": func() (*sdkexec.Session, error) {
			return manager.CreateSession(ctx, sdkexec.SessionOptions{ID: "late-2", Command: []string{"/bin/sh"}, TTY: true})
		},
	} {
		t.Run(name, func(t *testing.T) {
			session, err := start()

			require.Error(t, err)
			assert.Nil(t, session)
			assert.Equal(t, "CONNECTION_ERROR", resourcev2.ErrorCode(err), "the plugin is stopping: a retry into the same manager cannot succeed")
			assert.Zero(t, ran.Load(), "refused before the plugin's handler starts anything")
		})
	}
}
