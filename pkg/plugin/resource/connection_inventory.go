package resource

import (
	"cmp"
	"context"
	"path/filepath"
	"runtime"
	"slices"
	"strings"

	"github.com/omniview/kubernetes/pkg/connid"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Why a connection was left out of the inventory.
const (
	// duplicateSameFile: an earlier configured path reaches the same file, and so already gave the context.
	duplicateSameFile = "same_file"
	// duplicateIDCollision: two different sources gave one ID. The SDK rejects an inventory that holds
	// an ID twice, so the later source loses the connection and the rest of the inventory stays.
	duplicateIDCollision = "id_collision"
)

// inventoryFile is what one configured kubeconfig file gave.
type inventoryFile struct {
	// index is the position of the file in the configured list: the way a file is named in logs,
	// which never carry a path.
	index int
	// target is the key under which the file is recognized when another path reaches it (see
	// kubeconfigIdentity).
	target      string
	connections []types.Connection
}

// kubeconfigIdentity names the kubeconfig file at path in the two ways the inventory needs.
//
// The locator is the identity of the file inside the ID of its connections: its cleaned absolute
// path, which is filepath.Abs followed by filepath.Clean, with no symlink resolved (see
// connid.FileLocator).
//
// The target is what tells that two configured paths are one file: the cleaned absolute path with
// every symlink resolved, or the cleaned absolute path itself when it cannot be resolved, folded in
// the same way as the locator. A file that is listed twice, or that is reached through a link, has
// one target and two locators.
func kubeconfigIdentity(path string) (locator, target string, err error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", "", err
	}
	abs = filepath.Clean(abs)
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		resolved = abs
	}
	return connid.FileLocator(abs, runtime.GOOS), connid.FileLocator(resolved, runtime.GOOS), nil
}

// buildInventory is the one place the connection inventory is built from the configured kubeconfig
// files, for the load that runs when the plugin starts and after a settings change, and for the
// rebuild that follows a change of a watched file. A file that cannot be loaded is skipped, and
// reported at the given level (see mergeInventory for the level of the other reports).
func buildInventory(ctx context.Context, kubeconfigs []string, level logging.Level) []types.Connection {
	files := make([]inventoryFile, 0, len(kubeconfigs))
	for i, kubeconfigPath := range kubeconfigs {
		connections, target, err := connectionsFromKubeconfig(kubeconfigPath)
		if err != nil {
			logKubeconfigSkipped(ctx, level, i, err)
			continue
		}
		files = append(files, inventoryFile{index: i, target: target, connections: connections})
	}
	return mergeInventory(ctx, files, level)
}

// mergeInventory merges the connections of the files, in the configured order, into the inventory
// that is handed to the SDK, sorted by name and then by ID.
//
// The same context of one file is one connection however many configured paths reach the file: the
// first in the configured order stays. Two different sources can never give one ID either: the first
// stays and the later one is dropped. Either way the drop is reported as a warning (a debug record
// when level is not warn, for the rebuild that follows every change of a watched file) that names
// files by their index in the configured list and never by path.
func mergeInventory(ctx context.Context, files []inventoryFile, level logging.Level) []types.Connection {
	type contextKey struct{ target, name string }
	suppliedContext := make(map[contextKey]int)
	suppliedID := make(map[string]int)
	merged := make([]types.Connection, 0, len(files)*EstimatedContexts)
	for _, file := range files {
		var drops []duplicateDrop
		for _, connection := range file.connections {
			contextName, err := connid.ContextFromData(connection.Data)
			key := contextKey{target: file.target, name: contextName}
			if first, duplicate := suppliedContext[key]; err == nil && duplicate {
				drops = countDuplicateDrop(drops, first, duplicateSameFile)
				continue
			}
			if first, collision := suppliedID[connection.ID]; collision {
				drops = countDuplicateDrop(drops, first, duplicateIDCollision)
				continue
			}
			if err == nil {
				suppliedContext[key] = file.index
			}
			suppliedID[connection.ID] = file.index
			merged = append(merged, connection)
		}
		logDuplicateDrops(ctx, level, file.index, drops)
	}
	slices.SortFunc(merged, func(a, b types.Connection) int {
		return cmp.Or(strings.Compare(a.Name, b.Name), strings.Compare(a.ID, b.ID))
	})
	return merged
}

// duplicateDrop counts the connections of one file that were dropped for one cause, because an
// earlier file gave them.
type duplicateDrop struct {
	first int
	cause string
	count int
}

func countDuplicateDrop(drops []duplicateDrop, first int, cause string) []duplicateDrop {
	for i := range drops {
		if drops[i].first == first && drops[i].cause == cause {
			drops[i].count++
			return drops
		}
	}
	return append(drops, duplicateDrop{first: first, cause: cause, count: 1})
}

// logDuplicateDrops reports the connections that the file at index left out, one record for each
// earlier file and cause. Neither a path nor a context name is logged.
func logDuplicateDrops(ctx context.Context, level logging.Level, index int, drops []duplicateDrop) {
	slices.SortFunc(drops, func(a, b duplicateDrop) int {
		return cmp.Or(cmp.Compare(a.first, b.first), strings.Compare(a.cause, b.cause))
	})
	for _, drop := range drops {
		fields := []any{"kubeconfig_index", index, "first_kubeconfig_index", drop.first, "cause", drop.cause, "contexts", drop.count}
		if level == logging.LevelWarn {
			connectionLogger().Warnw(ctx, "kubeconfig contexts skipped as duplicates", fields...)
			continue
		}
		connectionLogger().Debugw(ctx, "kubeconfig contexts skipped as duplicates", fields...)
	}
}
