package helm

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"go.uber.org/zap"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/repo"
)

// ChartResourcer implements a read-only Resourcer for helm::v1::Chart.
// It reads chart metadata from Helm's local repo index cache files.
type ChartResourcer struct {
	log *zap.SugaredLogger
}

var (
	_ resource.Resourcer[clients.ClientSet]      = (*ChartResourcerWithActions)(nil)
	_ resource.ActionResourcer[clients.ClientSet] = (*ChartResourcerWithActions)(nil)
)

// NewChartResourcer creates a new ChartResourcer.
func NewChartResourcer(logger *zap.SugaredLogger) *ChartResourcer {
	return &ChartResourcer{
		log: logger.Named("HelmChartResourcer"),
	}
}

// loadAllIndexes loads all repo index files from the Helm cache directory.
func loadAllIndexes() (map[string]*repo.IndexFile, error) {
	f, err := loadRepoFile()
	if err != nil {
		return nil, err
	}

	settings := cli.New()
	cachePath := settings.RepositoryCache

	indexes := make(map[string]*repo.IndexFile, len(f.Repositories))
	for _, entry := range f.Repositories {
		indexPath := filepath.Join(cachePath, entry.Name+"-index.yaml")
		if _, statErr := os.Stat(indexPath); os.IsNotExist(statErr) {
			continue
		}
		idx, loadErr := repo.LoadIndexFile(indexPath)
		if loadErr != nil {
			continue
		}
		indexes[entry.Name] = idx
	}

	return indexes, nil
}

// chartVersionToMap converts a ChartVersion into a flat map suitable for the SDK.
// All slice values must use []interface{} (not typed slices) for structpb compatibility.
func chartVersionToMap(repoName string, cv *repo.ChartVersion) map[string]interface{} {
	m := map[string]interface{}{
		"id":          repoName + "/" + cv.Name,
		"name":        cv.Name,
		"description": cv.Description,
		"version":     cv.Version,
		"appVersion":  cv.AppVersion,
		"repository":  repoName,
		"deprecated":  cv.Deprecated,
		"type":        cv.Type,
	}

	if cv.Icon != "" {
		m["icon"] = cv.Icon
	}
	if cv.Home != "" {
		m["home"] = cv.Home
	}
	if len(cv.Keywords) > 0 {
		keywords := make([]interface{}, len(cv.Keywords))
		for i, kw := range cv.Keywords {
			keywords[i] = kw
		}
		m["keywords"] = keywords
	}
	if cv.KubeVersion != "" {
		m["kubeVersion"] = cv.KubeVersion
	}
	if len(cv.Maintainers) > 0 {
		maintainers := make([]interface{}, 0, len(cv.Maintainers))
		for _, maint := range cv.Maintainers {
			entry := map[string]interface{}{"name": maint.Name}
			if maint.Email != "" {
				entry["email"] = maint.Email
			}
			if maint.URL != "" {
				entry["url"] = maint.URL
			}
			maintainers = append(maintainers, entry)
		}
		m["maintainers"] = maintainers
	}

	return m
}

func (r *ChartResourcer) Get(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	input resource.GetInput,
) (*resource.GetResult, error) {
	parts := strings.SplitN(input.ID, "/", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("chart ID must be in the form repo/chart, got %q", input.ID)
	}
	repoName, chartName := parts[0], parts[1]

	indexes, err := loadAllIndexes()
	if err != nil {
		return nil, err
	}

	idx, ok := indexes[repoName]
	if !ok {
		return nil, fmt.Errorf("repository %s not found in local cache", repoName)
	}

	versions, found := idx.Entries[chartName]
	if !found || len(versions) == 0 {
		return nil, fmt.Errorf("chart %s not found in repository %s", chartName, repoName)
	}

	// Return the latest version as the main entry, plus all versions.
	result := chartVersionToMap(repoName, versions[0])

	allVersions := make([]interface{}, 0, len(versions))
	for _, v := range versions {
		entry := map[string]interface{}{
			"version":    v.Version,
			"appVersion": v.AppVersion,
			"created":    v.Created.Format(time.RFC3339),
			"deprecated": v.Deprecated,
		}
		if v.Description != "" {
			entry["description"] = v.Description
		}
		if v.KubeVersion != "" {
			entry["kubeVersion"] = v.KubeVersion
		}
		if v.Home != "" {
			entry["home"] = v.Home
		}
		if v.Icon != "" {
			entry["icon"] = v.Icon
		}
		if v.Type != "" {
			entry["type"] = v.Type
		}
		allVersions = append(allVersions, entry)
	}
	result["versions"] = allVersions
	result["totalVersions"] = len(allVersions)

	data, err := marshalMap(result)
	if err != nil {
		return nil, err
	}
	return &resource.GetResult{Result: data, Success: true}, nil
}

func (r *ChartResourcer) List(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	_ resource.ListInput,
) (*resource.ListResult, error) {
	indexes, err := loadAllIndexes()
	if err != nil {
		return nil, err
	}

	var charts []json.RawMessage
	for repoName, idx := range indexes {
		for _, versions := range idx.Entries {
			if len(versions) == 0 {
				continue
			}
			// Use the latest (first) version for list display.
			data, err := marshalMap(chartVersionToMap(repoName, versions[0]))
			if err != nil {
				return nil, fmt.Errorf("failed to marshal chart %s/%s: %w", repoName, versions[0].Name, err)
			}
			charts = append(charts, data)
		}
	}

	return &resource.ListResult{Result: charts, Success: true}, nil
}

func (r *ChartResourcer) Find(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	_ resource.FindInput,
) (*resource.FindResult, error) {
	listResult, err := r.List(ctx, client, meta, resource.ListInput{})
	if err != nil {
		return nil, err
	}
	return &resource.FindResult{
		Result:  listResult.Result,
		Success: listResult.Success,
	}, nil
}

func (r *ChartResourcer) Create(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	_ resource.CreateInput,
) (*resource.CreateResult, error) {
	return nil, fmt.Errorf("creating charts is not supported")
}

func (r *ChartResourcer) Update(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	_ resource.UpdateInput,
) (*resource.UpdateResult, error) {
	return nil, fmt.Errorf("updating charts is not supported")
}

func (r *ChartResourcer) Delete(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	_ resource.DeleteInput,
) (*resource.DeleteResult, error) {
	return nil, fmt.Errorf("deleting charts is not supported")
}

// ChartResourcerWithActions combines ChartResourcer with action support.
type ChartResourcerWithActions struct {
	ChartResourcer
}

// NewChartResourcerWithActions creates a new ChartResourcerWithActions.
func NewChartResourcerWithActions(logger *zap.SugaredLogger) *ChartResourcerWithActions {
	return &ChartResourcerWithActions{
		ChartResourcer: *NewChartResourcer(logger),
	}
}

func (r *ChartResourcerWithActions) GetActions(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
) ([]resource.ActionDescriptor, error) {
	versionParams := &resource.Schema{
		Properties: map[string]resource.SchemaProperty{
			"version": {Type: resource.SchemaString, Description: "Chart version (defaults to latest)"},
		},
	}

	return []resource.ActionDescriptor{
		{
			ID:           "get-values",
			Label:        "Get Default Values",
			Description:  "Get the default values.yaml for this chart",
			Icon:         "LuFileText",
			Scope:        resource.ActionScopeInstance,
			ParamsSchema: versionParams,
		},
		{
			ID:           "get-readme",
			Label:        "Get README",
			Description:  "Get the README for this chart",
			Icon:         "LuBookOpen",
			Scope:        resource.ActionScopeInstance,
			ParamsSchema: versionParams,
		},
		{
			ID:          "get-versions",
			Label:       "Get All Versions",
			Description: "Get all available versions of this chart",
			Icon:        "LuList",
			Scope:       resource.ActionScopeInstance,
		},
		{
			ID:           "get-chart-detail",
			Label:        "Get Chart Detail",
			Description:  "Get values, readme, versions, and dependencies for a chart in one call",
			Icon:         "LuInfo",
			Scope:        resource.ActionScopeInstance,
			ParamsSchema: versionParams,
		},
	}, nil
}

func (r *ChartResourcerWithActions) ExecuteAction(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	actionID string,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	parts := strings.SplitN(input.ID, "/", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("chart ID must be in the form repo/chart, got %q", input.ID)
	}
	repoName, chartName := parts[0], parts[1]

	switch actionID {
	case "get-values":
		return r.executeGetValues(repoName, chartName, input)
	case "get-readme":
		return r.executeGetReadme(repoName, chartName, input)
	case "get-versions":
		return r.executeGetVersions(repoName, chartName)
	case "get-chart-detail":
		return r.executeGetChartDetail(repoName, chartName, input)
	default:
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
}

func (r *ChartResourcerWithActions) executeGetValues(repoName, chartName string, input resource.ActionInput) (*resource.ActionResult, error) {
	chartRef := repoName + "/" + chartName

	settings := cli.New()
	version, _ := input.Params["version"].(string)

	chartPathOpts := &action.ChartPathOptions{Version: version}
	chartPath, err := chartPathOpts.LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("failed to locate chart %s: %w", chartRef, err)
	}

	ch, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart %s: %w", chartPath, err)
	}

	values := ""
	for _, f := range ch.Raw {
		if f.Name == "values.yaml" {
			values = string(f.Data)
			break
		}
	}

	return &resource.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"values": values,
		},
	}, nil
}

func (r *ChartResourcerWithActions) executeGetReadme(repoName, chartName string, input resource.ActionInput) (*resource.ActionResult, error) {
	chartRef := repoName + "/" + chartName

	settings := cli.New()
	version, _ := input.Params["version"].(string)

	chartPathOpts := &action.ChartPathOptions{Version: version}
	chartPath, err := chartPathOpts.LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("failed to locate chart %s: %w", chartRef, err)
	}

	ch, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart %s: %w", chartPath, err)
	}

	readme := ""
	for _, f := range ch.Files {
		if strings.EqualFold(f.Name, "readme.md") || strings.EqualFold(f.Name, "readme.txt") || strings.EqualFold(f.Name, "readme") {
			readme = string(f.Data)
			break
		}
	}

	return &resource.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"readme": readme,
		},
	}, nil
}

func (r *ChartResourcerWithActions) executeGetVersions(repoName, chartName string) (*resource.ActionResult, error) {
	indexes, err := loadAllIndexes()
	if err != nil {
		return nil, err
	}

	idx, ok := indexes[repoName]
	if !ok {
		return nil, fmt.Errorf("repository %s not found in local cache", repoName)
	}

	versions, found := idx.Entries[chartName]
	if !found {
		return nil, fmt.Errorf("chart %s not found in repository %s", chartName, repoName)
	}

	allVersions := make([]interface{}, 0, len(versions))
	for _, v := range versions {
		entry := map[string]interface{}{
			"version":    v.Version,
			"appVersion": v.AppVersion,
			"created":    v.Created.Format(time.RFC3339),
			"deprecated": v.Deprecated,
		}
		if v.Description != "" {
			entry["description"] = v.Description
		}
		if v.KubeVersion != "" {
			entry["kubeVersion"] = v.KubeVersion
		}
		if v.Digest != "" {
			entry["digest"] = v.Digest
		}
		if v.Home != "" {
			entry["home"] = v.Home
		}
		if v.Icon != "" {
			entry["icon"] = v.Icon
		}
		if v.Type != "" {
			entry["type"] = v.Type
		}
		allVersions = append(allVersions, entry)
	}

	return &resource.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"versions": allVersions,
			"total":    len(allVersions),
		},
	}, nil
}

func (r *ChartResourcerWithActions) executeGetChartDetail(repoName, chartName string, input resource.ActionInput) (*resource.ActionResult, error) {
	chartRef := repoName + "/" + chartName

	settings := cli.New()
	version, _ := input.Params["version"].(string)

	// Load the chart archive to get values and readme.
	chartPathOpts := &action.ChartPathOptions{Version: version}
	chartPath, err := chartPathOpts.LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("failed to locate chart %s: %w", chartRef, err)
	}

	ch, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart %s: %w", chartPath, err)
	}

	// Extract values.yaml
	values := ""
	for _, f := range ch.Raw {
		if f.Name == "values.yaml" {
			values = string(f.Data)
			break
		}
	}

	// Extract README
	readme := ""
	for _, f := range ch.Files {
		if strings.EqualFold(f.Name, "readme.md") || strings.EqualFold(f.Name, "readme.txt") || strings.EqualFold(f.Name, "readme") {
			readme = string(f.Data)
			break
		}
	}

	// Extract dependencies
	var deps []interface{}
	if ch.Metadata != nil && len(ch.Metadata.Dependencies) > 0 {
		deps = make([]interface{}, 0, len(ch.Metadata.Dependencies))
		for _, d := range ch.Metadata.Dependencies {
			entry := map[string]interface{}{
				"name":       d.Name,
				"repository": d.Repository,
			}
			if d.Version != "" {
				entry["version"] = d.Version
			}
			if d.Condition != "" {
				entry["condition"] = d.Condition
			}
			deps = append(deps, entry)
		}
	}

	// Get all versions from the index
	versionsResult, err := r.executeGetVersions(repoName, chartName)
	if err != nil {
		return nil, err
	}

	return &resource.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"values":       values,
			"readme":       readme,
			"versions":     versionsResult.Data["versions"],
			"total":        versionsResult.Data["total"],
			"dependencies": deps,
		},
	}, nil
}

func (r *ChartResourcerWithActions) StreamAction(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	_ string,
	_ resource.ActionInput,
	_ chan<- resource.ActionEvent,
) error {
	return fmt.Errorf("streaming actions not supported for charts")
}
