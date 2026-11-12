package helm

import (
	"context"
	"fmt"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/repo"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

func (h *HelmAncillary) Get(ctx context.Context, client *clients.ClientSet, request resource.GetRequest) (resource.Record, error) {
	if err := validateReference(request.Reference); err != nil {
		return resource.Record{}, err
	}
	if request.Representation != "" && request.Representation != helmRepresentation {
		return resource.Record{}, resource.NewError("UNSUPPORTED", "unknown Helm representation")
	}
	switch request.Reference.Address.Type {
	case ReleaseType:
		cfg, err := h.release.getReadConfig(ctx, client, namespaceOf(request.Reference))
		if err != nil {
			return resource.Record{}, err
		}
		snapshot, err := getNamedRelease(ctx, client, cfg, namespaceOf(request.Reference), request.Reference.Address.ID, nil)
		if err != nil {
			return resource.Record{}, err
		}
		return helmReleaseRecord(request.Reference, snapshot)
	case RepositoryType:
		file, err := loadRepoFile()
		if err != nil {
			return resource.Record{}, err
		}
		for _, entry := range file.Repositories {
			if entry.Name == request.Reference.Address.ID {
				return helmRecord(request.Reference, repoEntryToMap(entry))
			}
		}
	case ChartType:
		parts := strings.SplitN(request.Reference.Address.ID, "/", 2)
		if len(parts) != 2 {
			return resource.Record{}, resource.NewError("INVALID_REQUEST", "chart ID must be repo/chart")
		}
		index, err := loadIndex(parts[0])
		if err != nil {
			return resource.Record{}, err
		}
		versions := index.Entries[parts[1]]
		if len(versions) > 0 {
			return helmRecord(request.Reference, chartVersionToMap(parts[0], versions[0]))
		}
	}
	return resource.Record{}, resource.NewError("NOT_FOUND", "Helm resource not found")
}

// loadIndex returns the parsed cached index of a repository. Parsing a large
// index is expensive and paged chart reads repeat it, so parsed indexes are kept
// and reused while the file's modification time and size are unchanged. The
// returned index is shared and must not be modified.
func loadIndex(name string) (*repo.IndexFile, error) {
	path := filepath.Join(cli.New().RepositoryCache, name+"-index.yaml")
	info, e := os.Stat(path)
	if e != nil {
		parsedIndexes.forget(path)
		return nil, e
	}
	if info.Size() > maxIndexBytes {
		return nil, fmt.Errorf("Helm index exceeds 16 MiB")
	}
	if index := parsedIndexes.get(path, info); index != nil {
		return index, nil
	}
	index, err := repo.LoadIndexFile(path)
	if err != nil {
		return nil, err
	}
	parsedIndexes.put(path, info, index)
	return index, nil
}

// The parsed index cache is bounded by the total size of the index files it
// holds, since a parsed index occupies several times its file size, and by entry
// count. The least recently used entries are dropped first; an index larger than
// the byte budget by itself is not retained.
const (
	maxParsedIndexBytes = 32 << 20
	maxParsedIndexes    = 16
)

type parsedIndex struct {
	modTime time.Time
	size    int64
	index   *repo.IndexFile
	used    uint64
}

type parsedIndexCache struct {
	mu      sync.Mutex
	clock   uint64
	bytes   int64
	entries map[string]*parsedIndex
}

var parsedIndexes parsedIndexCache

func (c *parsedIndexCache) get(path string, info os.FileInfo) *repo.IndexFile {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry := c.entries[path]
	if entry == nil || entry.size != info.Size() || !entry.modTime.Equal(info.ModTime()) {
		return nil
	}
	c.clock++
	entry.used = c.clock
	return entry.index
}

func (c *parsedIndexCache) put(path string, info os.FileInfo, index *repo.IndexFile) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = make(map[string]*parsedIndex, maxParsedIndexes)
	}
	c.removeLocked(path)
	if info.Size() > maxParsedIndexBytes {
		return
	}
	for len(c.entries) > 0 && (len(c.entries) >= maxParsedIndexes || c.bytes+info.Size() > maxParsedIndexBytes) {
		var oldest string
		var oldestUse uint64
		for key, entry := range c.entries {
			if oldest == "" || entry.used < oldestUse {
				oldest, oldestUse = key, entry.used
			}
		}
		c.removeLocked(oldest)
	}
	c.clock++
	c.entries[path] = &parsedIndex{modTime: info.ModTime(), size: info.Size(), index: index, used: c.clock}
	c.bytes += info.Size()
}

func (c *parsedIndexCache) removeLocked(path string) {
	if entry, ok := c.entries[path]; ok {
		c.bytes -= entry.size
		delete(c.entries, path)
	}
}

func (c *parsedIndexCache) forget(path string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.removeLocked(path)
}

func (h *HelmAncillary) Enumerate(ctx context.Context, c *clients.ClientSet, r resource.EnumerateRequest) (resource.SourcePage, error) {
	if r.Target.Representation != "" && r.Target.Representation != helmRepresentation {
		return resource.SourcePage{}, fmt.Errorf("unknown Helm representation")
	}
	if r.Target.Type != ReleaseType && r.Target.Type != RepositoryType && r.Target.Type != ChartType {
		return resource.SourcePage{}, fmt.Errorf("unknown Helm type")
	}
	if r.PageSize > 256 {
		return resource.SourcePage{}, fmt.Errorf("page size exceeds 256")
	}
	scope, err := queryScope(r.Target)
	if err != nil {
		return resource.SourcePage{}, err
	}
	if r.Target.Type == ReleaseType {
		if len(scope) == 0 {
			return finishPage([]resource.Record{}, 0, 0, false), nil
		}
		return h.enumerateReleases(ctx, c, r)
	}
	size, offset, err := pageBounds(r)
	if err != nil {
		return resource.SourcePage{}, err
	}
	if len(scope) == 0 {
		return finishPage([]resource.Record{}, offset, size, false), nil
	}
	selected := map[string]bool{}
	if r.Target.Type == ChartType {
		for _, constraint := range r.Target.Scope {
			if constraint.Dimension == "repository" && constraint.Match == resource.ScopeOneOf {
				for _, name := range *constraint.Values {
					selected[name] = false
				}
			}
		}
	}
	file, err := loadRepoFile()
	if err != nil {
		return resource.SourcePage{}, err
	}
	// Bind selected query values against native configuration before any index or cursor work.
	for _, entry := range file.Repositories {
		if _, exists := selected[entry.Name]; exists {
			selected[entry.Name] = true
		}
	}
	for name, exists := range selected {
		if !exists {
			return resource.SourcePage{}, resource.NewError("NOT_FOUND", "Helm repository is not configured: "+name)
		}
	}
	sort.Slice(file.Repositories, func(i, j int) bool { return file.Repositories[i].Name < file.Repositories[j].Name })
	records := make([]resource.Record, 0, size)
	seen, budget := 0, 0
	add := func(id string, body map[string]interface{}) error {
		record, err := helmRecord(targetReference(r.Target, id, scope), body)
		if err != nil {
			return err
		}
		encodedSize, err := resource.RecordWireSize(record)
		if err != nil {
			return err
		}
		if encodedSize > (32<<20)-budget {
			return fmt.Errorf("Helm source page exceeds 32 MiB")
		}
		budget += encodedSize
		records = append(records, record)
		return nil
	}
	for _, entry := range file.Repositories {
		if err := ctx.Err(); err != nil {
			return resource.SourcePage{}, err
		}
		switch r.Target.Type {
		case RepositoryType:
			if seen >= offset && len(records) < size {
				if err := add(entry.Name, repoEntryToMap(entry)); err != nil {
					return resource.SourcePage{}, err
				}
			}
			seen++
			if seen > offset+size {
				return finishPage(records, offset, size, true), nil
			}
		case ChartType:
			if len(selected) > 0 && !selected[entry.Name] {
				continue
			}
			index, err := loadIndex(entry.Name)
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				return resource.SourcePage{}, err
			}
			names := make([]string, 0, len(index.Entries))
			for name := range index.Entries {
				names = append(names, name)
			}
			sort.Strings(names)
			for _, name := range names {
				versions := index.Entries[name]
				if len(versions) == 0 {
					continue
				}
				if seen >= offset && len(records) < size {
					if err := add(entry.Name+"/"+name, chartVersionToMap(entry.Name, versions[0])); err != nil {
						return resource.SourcePage{}, err
					}
				}
				seen++
				if seen > offset+size {
					return finishPage(records, offset, size, true), nil
				}
			}
		default:
			return resource.SourcePage{}, fmt.Errorf("unknown Helm type")
		}
	}
	return finishPage(records, offset, size, false), nil
}
