package resource

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/connid"
	"github.com/omniview/kubernetes/pkg/connid/connidtest"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniview/kubernetes/pkg/utils"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// writeInventoryKubeconfig writes a kubeconfig whose contexts are the given names, all at one server.
func writeInventoryKubeconfig(t *testing.T, path, server string, contexts ...string) {
	t.Helper()
	config := clientcmdapi.NewConfig()
	config.Clusters["c"] = &clientcmdapi.Cluster{Server: server}
	config.AuthInfos["u"] = &clientcmdapi.AuthInfo{Token: "fixture-token"}
	for _, name := range contexts {
		config.Contexts[name] = &clientcmdapi.Context{Cluster: "c", AuthInfo: "u"}
	}
	require.NoError(t, clientcmd.WriteToFile(*config, path))
}

// inventoryLocator is the locator of the file at path, worked out here from the definition and not
// by the code under test: filepath.Abs, then filepath.Clean, no symlink resolved.
func inventoryLocator(t *testing.T, path string) string {
	t.Helper()
	abs, err := filepath.Abs(path)
	require.NoError(t, err)
	return connid.FileLocator(filepath.Clean(abs), runtime.GOOS)
}

// inventoryLoaders are the three ways that the inventory of a list of kubeconfig files is built: the
// load that the host starts on plugin start and after a settings change, the rebuild after a change
// of a file that is being watched, and the first snapshot that the watch sends.
func inventoryLoaders(t *testing.T) map[string]func(paths ...string) []types.Connection {
	t.Helper()
	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}
	return map[string]func(paths ...string) []types.Connection{
		"LoadConnections": func(paths ...string) []types.Connection {
			connections, err := p.LoadConnections(connectionTestSession(context.Background(), paths...))
			require.NoError(t, err)
			return connections
		},
		"loadConnectionsFromPaths": func(paths ...string) []types.Connection {
			connections, err := p.loadConnectionsFromPaths(paths)
			require.NoError(t, err)
			return connections
		},
		"WatchConnections": func(paths ...string) []types.Connection {
			ctx, cancel := context.WithCancel(connectionTestSession(context.Background(), paths...))
			defer cancel()
			updates, err := p.WatchConnections(ctx)
			require.NoError(t, err)
			select {
			case connections := <-updates:
				return connections
			case <-time.After(5 * time.Second):
				t.Fatal("the watch sent no first snapshot")
				return nil
			}
		},
	}
}

func namesOf(connections []types.Connection) []string {
	names := make([]string, 0, len(connections))
	for _, connection := range connections {
		names = append(names, connection.Name)
	}
	slices.Sort(names)
	return names
}

func assertDistinctIDs(t *testing.T, connections []types.Connection) {
	t.Helper()
	seen := make(map[string]string, len(connections))
	for _, connection := range connections {
		previous, duplicate := seen[connection.ID]
		assert.False(t, duplicate, "ID %q is held by %q and by %q", connection.ID, previous, connection.Name)
		seen[connection.ID] = connection.Name
	}
}

func captureConnectionLogs(t *testing.T) *logtest.RecordingSink {
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

func TestInventoryConnectionsCarryTheExactContextNameAndADerivedID(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config")
	names := []string{"prod", "Prod", "arn:aws:eks:us-east-1:111122223333:cluster/prod", "odd name;$(x)", "日本語"}
	writeInventoryKubeconfig(t, path, "https://127.0.0.1:6443", names...)

	connections, _, err := connectionsFromKubeconfig(path)

	require.NoError(t, err)
	require.Len(t, connections, len(names))
	assertDistinctIDs(t, connections) // "prod" and "Prod" have one slug, and still two IDs
	for _, connection := range connections {
		assert.Contains(t, names, connection.Name, "the display name is the exact context name")
		assert.Equal(t, connection.Name, connection.Data[connid.DataKeyContext], "the kube context travels in the data")
		assert.Equal(t, connid.ID(connid.KindFile, inventoryLocator(t, path), connection.Name), connection.ID)
		assert.NotEqual(t, connection.Name, connection.ID)
		assert.Equal(t, path, connection.Data["kubeconfig"], "the path of the file is what the clients read")
	}
}

// Two kubeconfigs, each with a context named prod: one connection each, with an ID of its own.
func TestSameNamedContextsOfDifferentKubeconfigsAreDistinctInEveryLoader(t *testing.T) {
	dir := t.TempDir()
	first, second := filepath.Join(dir, "team-a"), filepath.Join(dir, "team-b")
	writeInventoryKubeconfig(t, first, "https://10.0.0.1:6443", "prod")
	writeInventoryKubeconfig(t, second, "https://10.0.0.2:6443", "prod")
	for loaderName, load := range inventoryLoaders(t) {
		t.Run(loaderName, func(t *testing.T) {
			connections := load(first, second)

			require.Len(t, connections, 2)
			assertDistinctIDs(t, connections)
			assert.Equal(t, []string{"prod", "prod"}, namesOf(connections))
			wantIDs := []string{
				connid.ID(connid.KindFile, inventoryLocator(t, first), "prod"),
				connid.ID(connid.KindFile, inventoryLocator(t, second), "prod"),
			}
			assert.ElementsMatch(t, wantIDs, []string{connections[0].ID, connections[1].ID})
		})
	}
}

// Adding a kubeconfig later, or listing them in another order, must not change an ID that exists.
func TestConnectionIDsDoNotChangeWhenAKubeconfigIsAddedOrReordered(t *testing.T) {
	dir := t.TempDir()
	first, second := filepath.Join(dir, "first"), filepath.Join(dir, "second")
	writeInventoryKubeconfig(t, first, "https://10.0.0.1:6443", "prod", "dev")
	writeInventoryKubeconfig(t, second, "https://10.0.0.2:6443", "prod", "qa")
	for loaderName, load := range inventoryLoaders(t) {
		t.Run(loaderName, func(t *testing.T) {
			alone := load(first)
			require.Len(t, alone, 2)
			assert.Equal(t, alone, load(first), "stable from one load to the next")

			for _, list := range [][]string{{first, second}, {second, first}} {
				both := load(list...)
				require.Len(t, both, 4)
				assertDistinctIDs(t, both)
				for _, before := range alone {
					index := slices.IndexFunc(both, func(c types.Connection) bool { return c.ID == before.ID })
					require.GreaterOrEqual(t, index, 0, "%q lost its ID", before.Name)
					assert.Equal(t, before, both[index])
				}
			}
		})
	}
}

// Listing one file twice would put every one of its contexts in the inventory twice, under one ID.
func TestTheSameKubeconfigListedTwiceYieldsOneConnectionPerContext(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config")
	writeInventoryKubeconfig(t, path, "https://10.0.0.1:6443", "prod", "dev")
	for loaderName, load := range inventoryLoaders(t) {
		t.Run(loaderName, func(t *testing.T) {
			connections := load(path, path)

			assertDistinctIDs(t, connections)
			assert.Equal(t, []string{"dev", "prod"}, namesOf(connections))
		})
	}
}

// One file reached by two paths is one file: by a link to it, or through a link to a directory. The
// first in the configured order stays, whatever its spelling, and it keeps the ID of its own path.
func TestTheSameKubeconfigReachedByTwoPathsYieldsOneConnectionPerContext(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("creating a symlink needs a privilege on Windows")
	}
	dir := t.TempDir()
	real := filepath.Join(dir, "real")
	writeInventoryKubeconfig(t, real, "https://10.0.0.1:6443", "prod", "dev")
	link := filepath.Join(dir, "link")
	require.NoError(t, os.Symlink(real, link))
	dirLink := filepath.Join(dir, "dir-link")
	require.NoError(t, os.Symlink(dir, dirLink))
	viaDirLink := filepath.Join(dirLink, "real")

	for loaderName, load := range inventoryLoaders(t) {
		t.Run(loaderName, func(t *testing.T) {
			for _, tt := range []struct {
				name  string
				paths []string
				kept  string
			}{
				{"file then link to it", []string{real, link}, real},
				{"link to it then file", []string{link, real}, link},
				{"file then path through a directory link", []string{real, viaDirLink}, real},
				{"path through a directory link then file", []string{viaDirLink, real}, viaDirLink},
				{"three spellings", []string{link, viaDirLink, real}, link},
			} {
				t.Run(tt.name, func(t *testing.T) {
					connections := load(tt.paths...)

					require.Len(t, connections, 2)
					assertDistinctIDs(t, connections)
					assert.Equal(t, []string{"dev", "prod"}, namesOf(connections))
					for _, connection := range connections {
						assert.Equal(t, connid.ID(connid.KindFile, inventoryLocator(t, tt.kept), connection.Name), connection.ID,
							"the ID comes from the path of the first listed file; no symlink is resolved for it")
						assert.Equal(t, tt.kept, connection.Data["kubeconfig"])
					}
				})
			}
		})
	}
}

// Duplicates are reported by their index in the configured list. Nothing that names a path is logged.
func TestDuplicateKubeconfigIsLoggedByIndexNotByPath(t *testing.T) {
	sink := captureConnectionLogs(t)
	dir := t.TempDir()
	repeated, other := filepath.Join(dir, "secret-kubeconfig-name"), filepath.Join(dir, "other")
	writeInventoryKubeconfig(t, repeated, "https://10.0.0.1:6443", "prod", "dev")
	writeInventoryKubeconfig(t, other, "https://10.0.0.2:6443", "qa")
	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}

	for name, tt := range map[string]struct {
		load  func() error
		level logging.Level
	}{
		// The load runs when the plugin starts and after a settings change: a warning.
		"initial load": {func() error {
			_, err := p.LoadConnections(connectionTestSession(context.Background(), repeated, other, repeated))
			return err
		}, logging.LevelWarn},
		// A rebuild runs on every change of a watched file: it would repeat the warning, so it is debug.
		"watch refresh": {func() error {
			_, err := p.loadConnectionsFromPaths([]string{repeated, other, repeated})
			return err
		}, logging.LevelDebug},
	} {
		t.Run(name, func(t *testing.T) {
			sink.Reset()
			require.NoError(t, tt.load())

			reported := 0
			for _, record := range sink.Records() {
				text := fmt.Sprint(record.Message, record.Fields)
				assert.NotContains(t, text, "secret-kubeconfig-name")
				assert.NotContains(t, text, dir)
				if record.Message != "kubeconfig contexts skipped as duplicates" {
					continue
				}
				reported++
				fields := record.ToMap()
				assert.Equal(t, tt.level, record.Level)
				assert.Equal(t, 2, fields["kubeconfig_index"])
				assert.Equal(t, 0, fields["first_kubeconfig_index"])
				assert.Equal(t, 2, fields["contexts"])
				assert.Equal(t, "same_file", fields["cause"])
			}
			assert.Equal(t, 1, reported, "one record for the file, not one for each of its contexts")
		})
	}
}

func TestMergeInventoryKeepsTheFirstOfTwoSourcesThatShareAnID(t *testing.T) {
	sink := captureConnectionLogs(t)
	named := func(id, name string) types.Connection {
		return types.Connection{ID: id, Name: name, Data: map[string]any{connid.DataKeyContext: name}}
	}
	first, collides, distinct := named("prod-0123456789", "prod"), named("prod-0123456789", "other-context"), named("dev-aaaaaaaaaa", "dev")

	merged := mergeInventory(context.Background(), []inventoryFile{
		{index: 0, target: "/files/a", connections: []types.Connection{first}},
		{index: 3, target: "/files/b", connections: []types.Connection{collides, distinct}},
	}, logging.LevelWarn)

	assert.Equal(t, []types.Connection{distinct, first}, merged, "the later one is dropped, and the rest is sorted by name")
	reported := 0
	for _, record := range sink.Records() {
		if record.Message != "kubeconfig contexts skipped as duplicates" {
			continue
		}
		reported++
		fields := record.ToMap()
		assert.Equal(t, logging.LevelWarn, record.Level)
		assert.Equal(t, 3, fields["kubeconfig_index"])
		assert.Equal(t, 0, fields["first_kubeconfig_index"])
		assert.Equal(t, 1, fields["contexts"])
		assert.Equal(t, "id_collision", fields["cause"])
	}
	assert.Equal(t, 1, reported)
}

func TestMergeInventoryKeepsSameNamedContextsOfDifferentFiles(t *testing.T) {
	named := func(id, name string) types.Connection {
		return types.Connection{ID: id, Name: name, Data: map[string]any{connid.DataKeyContext: name}}
	}
	merged := mergeInventory(context.Background(), []inventoryFile{
		{index: 0, target: "/files/a", connections: []types.Connection{named("prod-aaaaaaaaaa", "prod")}},
		{index: 1, target: "/files/b", connections: []types.Connection{named("prod-bbbbbbbbbb", "prod")}},
	}, logging.LevelWarn)

	require.Len(t, merged, 2)
	assert.Equal(t, []string{"prod-aaaaaaaaaa", "prod-bbbbbbbbbb"}, []string{merged[0].ID, merged[1].ID}, "equal names are ordered by ID")
}

// Connections of one name are ordered by ID, whatever order their files were listed in, so the
// inventory that the SDK gets is the same for the same set of files.
func TestMergeInventoryOrdersEqualNamesByIDWhateverTheOrderOfTheFiles(t *testing.T) {
	named := func(id string) types.Connection {
		return types.Connection{ID: id, Name: "prod", Data: map[string]any{connid.DataKeyContext: "prod"}}
	}
	low, high := named("prod-aaaaaaaaaa"), named("prod-bbbbbbbbbb")
	for name, files := range map[string][]inventoryFile{
		"low ID first":  {{index: 0, target: "/files/a", connections: []types.Connection{low}}, {index: 1, target: "/files/b", connections: []types.Connection{high}}},
		"high ID first": {{index: 0, target: "/files/a", connections: []types.Connection{high}}, {index: 1, target: "/files/b", connections: []types.Connection{low}}},
	} {
		t.Run(name, func(t *testing.T) {
			merged := mergeInventory(context.Background(), files, logging.LevelWarn)

			assert.Equal(t, []types.Connection{low, high}, merged)
		})
	}
}

// A file that cannot be loaded is reported by its index, and at the level of the load: a warning when
// the plugin starts and after a settings change, a debug record on every rebuild that a change of a
// watched file starts, which would otherwise repeat the warning. Nothing that names a path is logged.
func TestSkippedKubeconfigIsLoggedByIndexAtTheLevelOfItsLoad(t *testing.T) {
	sink := captureConnectionLogs(t)
	dir := t.TempDir()
	present, missing := filepath.Join(dir, "present"), filepath.Join(dir, "secret-missing-name")
	writeInventoryKubeconfig(t, present, "https://10.0.0.1:6443", "prod")
	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}

	for name, tt := range map[string]struct {
		load  func() ([]types.Connection, error)
		level logging.Level
	}{
		"initial load": {func() ([]types.Connection, error) {
			return p.LoadConnections(connectionTestSession(context.Background(), present, missing))
		}, logging.LevelWarn},
		"watch refresh": {func() ([]types.Connection, error) {
			return p.loadConnectionsFromPaths([]string{present, missing})
		}, logging.LevelDebug},
	} {
		t.Run(name, func(t *testing.T) {
			sink.Reset()
			connections, err := tt.load()
			require.NoError(t, err)
			assert.Equal(t, []string{"prod"}, namesOf(connections), "the file that loads is not held back by the one that does not")

			reported := 0
			for _, record := range sink.Records() {
				text := fmt.Sprint(record.Message, record.Fields)
				assert.NotContains(t, text, "secret-missing-name")
				assert.NotContains(t, text, dir)
				if record.Message != "kubeconfig context skipped" {
					continue
				}
				reported++
				fields := record.ToMap()
				assert.Equal(t, tt.level, record.Level)
				assert.Equal(t, 1, fields["kubeconfig_index"])
				assert.Equal(t, "not_found", fields["cause"])
			}
			assert.Equal(t, 1, reported)
		})
	}
}

// A change to a watched file is rebuilt through the same inventory: IDs stay distinct and the ones
// that exist keep their value.
func TestWatchRefreshKeepsIDsDistinctAndStable(t *testing.T) {
	dir := t.TempDir()
	first, second := filepath.Join(dir, "first"), filepath.Join(dir, "second")
	writeInventoryKubeconfig(t, first, "https://10.0.0.1:6443", "prod")
	writeInventoryKubeconfig(t, second, "https://10.0.0.2:6443", "prod")
	ctx, cancel := context.WithCancel(connectionTestSession(context.Background(), first, second))
	defer cancel()
	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}
	updates, err := p.WatchConnections(ctx)
	require.NoError(t, err)

	var initial []types.Connection
	select {
	case initial = <-updates:
	case <-time.After(5 * time.Second):
		t.Fatal("missing first snapshot")
	}
	require.Len(t, initial, 2)
	assertDistinctIDs(t, initial)

	replacement := filepath.Join(dir, "replacement")
	writeInventoryKubeconfig(t, replacement, "https://10.0.0.1:6443", "prod", "added")
	require.NoError(t, os.Rename(replacement, first))
	deadline := time.After(5 * time.Second)
	for {
		select {
		case snapshot := <-updates:
			if len(snapshot) != 3 {
				continue
			}
			assertDistinctIDs(t, snapshot)
			for _, before := range initial {
				assert.Contains(t, snapshot, before, "%q kept its ID and data", before.Name)
			}
			return
		case <-deadline:
			t.Fatal("missing snapshot after the kubeconfig changed")
		}
	}
}

// The SDK rejects an inventory that holds one ID twice, which used to hide every connection when two
// kubeconfigs shared a context name. Through the real controller, both are accepted and each is reached
// by its own ID.
func TestSDKAcceptsTheInventoryOfSameNamedContexts(t *testing.T) {
	dir := t.TempDir()
	first, second := filepath.Join(dir, "team-a"), filepath.Join(dir, "team-b")
	writeInventoryKubeconfig(t, first, "https://10.0.0.1:6443", "prod")
	writeInventoryKubeconfig(t, second, "https://10.0.0.2:6443", "prod")
	provider, err := newKubernetesProvider(zap.NewNop().Sugar(), func(string) {})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, provider.Close()) })
	ctx := connectionTestSession(context.Background(), first, second)

	connections, err := provider.LoadConnections(ctx)

	require.NoError(t, err)
	require.Len(t, connections, 2)
	assertDistinctIDs(t, connections)
	for _, connection := range connections {
		got, err := provider.GetConnection(ctx, connection.ID)
		require.NoError(t, err)
		assert.Equal(t, connection.Data["kubeconfig"], got.Data["kubeconfig"], "an ID reaches its own connection")
	}
}

// The clients of every entry point of the resource lane, and of the plugin-wide client constructor, are built for the
// context that the data of the connection names, whatever its ID is.
func TestResourceEntryPointsBuildClientsForTheContextOfTheDataNotTheID(t *testing.T) {
	dir := t.TempDir()
	first, second := filepath.Join(dir, "first"), filepath.Join(dir, "second")
	const serverOne, serverTwo = "https://one.invalid:6443", "https://two.invalid:6443"
	writeInventoryKubeconfig(t, first, serverOne, "prod", "other")
	writeInventoryKubeconfig(t, second, serverTwo, "prod")
	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}
	connections, err := p.LoadConnections(connectionTestSession(context.Background(), first, second))
	require.NoError(t, err)
	require.Len(t, connections, 3)

	for _, connection := range connections {
		t.Run(connection.Name+" of "+filepath.Base(connection.Data["kubeconfig"].(string)), func(t *testing.T) {
			server := serverOne
			if connection.Data["kubeconfig"] == second {
				server = serverTwo
			}
			require.NotEqual(t, connection.Name, connection.ID)

			bundle, err := LoadBoundedResourceClients(context.Background(), &connection)
			require.NoError(t, err)
			assert.Equal(t, server, bundle.RestConfig.Host)

			session := resourcev2.WithSession(context.Background(), resourcev2.Session{Connection: &connection})
			client, err := p.CreateClient(session)
			require.NoError(t, err)
			assert.Equal(t, server, client.RESTConfig.Host)
			require.NoError(t, p.RefreshClient(session, client))
			assert.Equal(t, server, client.RESTConfig.Host)

			legacy, err := utils.KubeClientsFromContext(&types.PluginContext{Context: context.Background(), Connection: &connection})
			require.NoError(t, err)
			assert.Equal(t, server, legacy.RestConfig.Host)
		})
	}
}

func TestResourceEntryPointsNeverReadTheIDAsTheContext(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config")
	writeInventoryKubeconfig(t, path, "https://one.invalid:6443", "prod")
	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}
	connections, err := p.LoadConnections(connectionTestSession(context.Background(), path))
	require.NoError(t, err)
	require.Len(t, connections, 1)
	connection := connections[0]
	delete(connection.Data, connid.DataKeyContext)
	connection.ID = "prod" // names a context of the file

	_, err = LoadBoundedResourceClients(context.Background(), &connection)
	require.ErrorIs(t, err, connid.ErrNoContext)

	session := resourcev2.WithSession(context.Background(), resourcev2.Session{Connection: &connection})
	_, err = p.CreateClient(session)
	require.ErrorIs(t, err, connid.ErrNoContext)
	require.ErrorIs(t, p.RefreshClient(session, &clients.ClientSet{}), connid.ErrNoContext)
}

// A connection that names no context (a saved one from before IDs were derived is one) cannot connect,
// and what the user reads is a classification and a sentence, not "Provider operation failed".
func TestAConnectionWithNoContextFailsToConnectWithAClassificationAndASentence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config")
	writeInventoryKubeconfig(t, path, "https://one.invalid:6443", "prod")
	p := &kubeConnectionProvider{logger: zap.NewNop().Sugar()}
	connections, err := p.LoadConnections(connectionTestSession(context.Background(), path))
	require.NoError(t, err)
	require.Len(t, connections, 1)
	connection := connections[0]
	delete(connection.Data, connid.DataKeyContext)
	session := resourcev2.WithSession(context.Background(), resourcev2.Session{Connection: &connection})

	_, err = LoadBoundedResourceClients(context.Background(), &connection)
	connidtest.RequireNoContextError(t, err)
	_, err = p.CreateClient(session)
	connidtest.RequireNoContextError(t, err)
	connidtest.RequireNoContextError(t, p.RefreshClient(session, &clients.ClientSet{}))
}

func TestLoadBoundedResourceClientsLabelsTheBuildWithTheConnectionID(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		require.NoError(t, provider.Shutdown(context.Background()))
	})
	path := filepath.Join(t.TempDir(), "config")
	writeInventoryKubeconfig(t, path, "https://one.invalid:6443", "prod")
	connections, _, err := connectionsFromKubeconfig(path)
	require.NoError(t, err)
	require.Len(t, connections, 1)

	_, err = LoadBoundedResourceClients(context.Background(), &connections[0])
	require.NoError(t, err)

	labelled := false
	for _, span := range exporter.GetSpans() {
		if span.Name != "kubernetes.client.build" {
			continue
		}
		labelled = true
		for _, attribute := range span.Attributes {
			if attribute.Key == "connection" {
				assert.Equal(t, connections[0].ID, attribute.Value.AsString())
			}
		}
	}
	assert.True(t, labelled, "no client build span")
}
