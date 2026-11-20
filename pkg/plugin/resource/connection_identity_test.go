package resource

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// A connection's ID used to be the kubeconfig context name
// (connections.go connectionsFromKubeconfig: ID: contextName). Two kubeconfig
// files that each define a context with the same name therefore yielded two
// connections with one ID, which collide in every ID-keyed map downstream, and
// the SDK rejects an inventory that holds a duplicate ID.
//
// Connections loaded from different kubeconfig files (or different servers)
// have distinct, stable IDs even when their context names are equal; the
// display Name stays the context name.
func TestLoadConnectionsGivesDistinctIDsToSameNamedContextsInDifferentKubeconfigs(t *testing.T) {
	dir := t.TempDir()
	write := func(file, server string) string {
		path := filepath.Join(dir, file)
		content := "apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: " + server +
			"\nusers:\n- name: u\n  user: {}\ncontexts:\n- name: prod\n  context:\n    cluster: c\n    user: u\ncurrent-context: prod\n"
		require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
		return path
	}
	first := write("team-a.yaml", "https://10.0.0.1:6443")
	second := write("team-b.yaml", "https://10.0.0.2:6443")

	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}
	connections, err := p.LoadConnections(connectionTestSession(context.Background(), first, second))
	require.NoError(t, err)
	require.Len(t, connections, 2, "both kubeconfig contexts must load")
	require.NotEqual(t, connections[0].Labels["server"], connections[1].Labels["server"], "fixture must point at different servers")
	require.NotEqual(t, connections[0].ID, connections[1].ID,
		"contexts %q from two kubeconfigs (servers %v, %v) share connection ID %q",
		connections[0].Name, connections[0].Labels["server"], connections[1].Labels["server"], connections[0].ID)
}
