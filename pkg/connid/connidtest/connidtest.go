// Package connidtest builds the fixtures that tests of every lane (resource,
// exec, logs, metrics, port-forward) share to prove that a connection whose ID
// is not its context name still gets clients for the right context.
package connidtest

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/omniview/kubernetes/pkg/connid"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// Decoy is the current context of every kubeconfig that Kubeconfig writes. Code
// that fails to select its context, and so falls back to the current one, builds
// clients for Server(Decoy).
const Decoy = "decoy"

// Server returns the API server that Kubeconfig gives to the context name: one
// host per exact name, whatever characters the name holds. No DNS name under
// .invalid resolves, so nothing is ever reached.
func Server(contextName string) string {
	sum := sha256.Sum256([]byte(contextName))
	return "https://" + hex.EncodeToString(sum[:6]) + ".invalid:6443"
}

// Kubeconfig writes a kubeconfig with one context per name, each at its own
// server (Server) and each with the user "user", and returns its path. Its current
// context is Decoy, which is also defined, at Server(Decoy). Names may hold any
// character a context name can.
func Kubeconfig(t testing.TB, contexts ...string) string {
	t.Helper()
	servers := make(map[string]string, len(contexts))
	for _, name := range contexts {
		servers[name] = Server(name)
	}
	return KubeconfigAt(t, servers)
}

// KubeconfigAt is Kubeconfig with the server of every context given, for tests
// of two kubeconfigs that define a context of the same name at different servers.
func KubeconfigAt(t testing.TB, servers map[string]string) string {
	t.Helper()
	config := clientcmdapi.NewConfig()
	config.AuthInfos["user"] = &clientcmdapi.AuthInfo{Token: "fixture-token"}
	config.Clusters["cluster-of-"+Decoy] = &clientcmdapi.Cluster{Server: Server(Decoy)}
	config.Contexts[Decoy] = &clientcmdapi.Context{Cluster: "cluster-of-" + Decoy, AuthInfo: "user"}
	for name, server := range servers {
		config.Clusters["cluster-of-"+name] = &clientcmdapi.Cluster{Server: server}
		config.Contexts[name] = &clientcmdapi.Context{Cluster: "cluster-of-" + name, AuthInfo: "user"}
	}
	config.CurrentContext = Decoy
	path := filepath.Join(t.TempDir(), "kubeconfig")
	require.NoError(t, clientcmd.WriteToFile(*config, path))
	return path
}

// Connection returns the connection that the inventory builds for the context
// contextName of the kubeconfig at path: its Name is the context name, its ID is
// the derived one, and its public data carries the context under
// connid.DataKeyContext. Its ID is never equal to the context name.
func Connection(t testing.TB, path, contextName string) *types.Connection {
	t.Helper()
	abs, err := filepath.Abs(path)
	require.NoError(t, err)
	locator := connid.FileLocator(filepath.Clean(abs), runtime.GOOS)
	connection := &types.Connection{
		ID:   connid.ID(connid.KindFile, locator, contextName),
		Name: contextName,
		Data: map[string]any{
			"kubeconfig":          path,
			connid.DataKeyContext: contextName,
			"cluster":             "cluster-of-" + contextName,
			"user":                "user",
		},
	}
	require.NotEqual(t, contextName, connection.ID)
	return connection
}
