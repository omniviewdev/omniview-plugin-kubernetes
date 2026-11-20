package resource

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// writeContextsConfig writes a kubeconfig whose contexts each point at a cluster
// named "cluster-of-<context>-<tag>", so the winner of a duplicate is observable.
func writeContextsConfig(t *testing.T, path, tag string, contexts ...string) {
	t.Helper()
	var b strings.Builder
	b.WriteString("apiVersion: v1\nkind: Config\nclusters:\n")
	for _, name := range contexts {
		b.WriteString("- name: cluster-of-" + name + "-" + tag + "\n  cluster:\n    server: https://127.0.0.1:6443\n")
	}
	b.WriteString("users:\n- name: local\n  user: {}\ncontexts:\n")
	for _, name := range contexts {
		b.WriteString("- name: " + name + "\n  context:\n    cluster: cluster-of-" + name + "-" + tag + "\n    user: local\n")
	}
	require.NoError(t, os.WriteFile(path, []byte(b.String()), 0600))
}

func recordConnectionLogs(t *testing.T) *logtest.RecordingSink {
	t.Helper()
	sink := &logtest.RecordingSink{}
	previous := logging.Default()
	logging.SetDefault(logging.New(logging.Config{
		Name:    "test",
		Level:   logging.NewLevelController(logging.LevelTrace),
		Backend: logging.NewSinkBackend(sink),
	}))
	t.Cleanup(func() { logging.SetDefault(previous) })
	return sink
}

func connectionByID(connections []types.Connection) map[string][]types.Connection {
	byID := make(map[string][]types.Connection, len(connections))
	for _, connection := range connections {
		byID[connection.ID] = append(byID[connection.ID], connection)
	}
	return byID
}

type duplicateFixture struct {
	dir, first, second string
}

func newDuplicateFixture(t *testing.T) duplicateFixture {
	t.Helper()
	dir := t.TempDir()
	f := duplicateFixture{dir: dir, first: filepath.Join(dir, "first"), second: filepath.Join(dir, "second")}
	writeContextsConfig(t, f.first, "first", "only-first", "shared")
	writeContextsConfig(t, f.second, "second", "shared", "only-second")
	return f
}

// requireDuplicateResilient asserts that every unique context loads, that the
// shared ID is held once by the winning kubeconfig, and that the loser is logged.
func requireDuplicateResilient(t *testing.T, connections []types.Connection, sink *logtest.RecordingSink, winnerCluster string, winnerIndex, skippedIndex int) {
	t.Helper()
	byID := connectionByID(connections)
	require.Len(t, byID, 3, "ids=%v", connections)
	require.Contains(t, byID, "only-first")
	require.Contains(t, byID, "only-second")
	require.Len(t, byID["shared"], 1)
	require.Equal(t, winnerCluster, byID["shared"][0].Data["cluster"])

	var reports int
	for _, record := range sink.Records() {
		if record.Message != "kubeconfig duplicate connection skipped" {
			continue
		}
		reports++
		fields := record.ToMap()
		require.Equal(t, "shared", fields["connection"])
		require.EqualValues(t, winnerIndex, fields["kept_kubeconfig_index"])
		require.EqualValues(t, skippedIndex, fields["skipped_kubeconfig_index"])
	}
	require.Equal(t, 1, reports, "duplicate must be reported exactly once")
}

func TestLoadConnectionsDuplicateContextKeepsInventory(t *testing.T) {
	f := newDuplicateFixture(t)
	sink := recordConnectionLogs(t)
	provider, err := newKubernetesProvider(zap.NewNop().Sugar(), func(string) {})
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(connectionTestSession(context.Background(), f.first, f.second), 10*time.Second)
	defer cancel()

	connections, err := provider.LoadConnections(ctx)
	require.NoError(t, err)
	requireDuplicateResilient(t, connections, sink, "cluster-of-shared-first", 0, 1)
}

func TestLoadConnectionsDuplicateContextFollowsConfiguredOrder(t *testing.T) {
	f := newDuplicateFixture(t)
	sink := recordConnectionLogs(t)
	provider, err := newKubernetesProvider(zap.NewNop().Sugar(), func(string) {})
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(connectionTestSession(context.Background(), f.second, f.first), 10*time.Second)
	defer cancel()

	connections, err := provider.LoadConnections(ctx)
	require.NoError(t, err)
	requireDuplicateResilient(t, connections, sink, "cluster-of-shared-second", 0, 1)
}

func TestWatchConnectionsDuplicateContextKeepsInventory(t *testing.T) {
	f := newDuplicateFixture(t)
	sink := recordConnectionLogs(t)
	provider, err := newKubernetesProvider(zap.NewNop().Sugar(), func(string) {})
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(connectionTestSession(context.Background(), f.first, f.second), 10*time.Second)
	defer cancel()

	stream := make(chan []types.Connection, 4)
	done := make(chan error, 1)
	go func() { done <- provider.WatchConnections(ctx, stream) }()
	select {
	case connections := <-stream:
		requireDuplicateResilient(t, connections, sink, "cluster-of-shared-first", 0, 1)
	case err := <-done:
		t.Fatalf("watch ended before the first inventory: %v", err)
	case <-ctx.Done():
		t.Fatal("no inventory published for duplicate kubeconfig contexts")
	}
	cancel()
	select {
	case err := <-done:
		require.ErrorIs(t, err, context.Canceled)
	case <-time.After(5 * time.Second):
		t.Fatal("watch did not stop after cancellation")
	}
}
