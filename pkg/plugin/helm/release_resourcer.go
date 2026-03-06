package helm

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"go.uber.org/zap"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/release"
)

// ReleaseResourcer implements Resourcer[clients.ClientSet] and ActionResourcer[clients.ClientSet]
// for helm::v1::Release.
type ReleaseResourcer struct {
	log         *zap.SugaredLogger
	helmService *HelmService
}

// Compile-time checks.
var (
	_ resource.Resourcer[clients.ClientSet]      = (*ReleaseResourcer)(nil)
	_ resource.ActionResourcer[clients.ClientSet] = (*ReleaseResourcer)(nil)
)

// NewReleaseResourcer creates a new ReleaseResourcer.
func NewReleaseResourcer(logger *zap.SugaredLogger, svc *HelmService) *ReleaseResourcer {
	return &ReleaseResourcer{
		log:         logger.Named("HelmReleaseResourcer"),
		helmService: svc,
	}
}

func (r *ReleaseResourcer) getConfig(
	ctx context.Context,
	client *clients.ClientSet,
	namespace string,
) (*action.Configuration, error) {
	conn := resource.ConnectionFromContext(ctx)
	if conn == nil {
		return nil, fmt.Errorf("no connection in context")
	}
	if namespace == "" {
		namespace = "default"
	}
	return r.helmService.GetActionConfig(conn.ID, client.RESTConfig, namespace)
}

// releaseToMap converts a Helm release to a map for the SDK.
func releaseToMap(rel *release.Release) map[string]interface{} {
	data, err := json.Marshal(rel)
	if err != nil {
		return map[string]interface{}{"name": rel.Name, "namespace": rel.Namespace}
	}
	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return map[string]interface{}{"name": rel.Name, "namespace": rel.Namespace}
	}
	return result
}

// marshalMap marshals a map to json.RawMessage.
func marshalMap(m map[string]interface{}) (json.RawMessage, error) {
	data, err := json.Marshal(m)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal result: %w", err)
	}
	return data, nil
}

// ================================= CRUD ================================= //

func (r *ReleaseResourcer) Get(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	input resource.GetInput,
) (*resource.GetResult, error) {
	cfg, err := r.getConfig(ctx, client, input.Namespace)
	if err != nil {
		return nil, err
	}

	get := action.NewGet(cfg)
	rel, err := get.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get release %s: %w", input.ID, err)
	}

	data, err := marshalMap(releaseToMap(rel))
	if err != nil {
		return nil, err
	}
	return &resource.GetResult{Result: data, Success: true}, nil
}

func (r *ReleaseResourcer) List(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	input resource.ListInput,
) (*resource.ListResult, error) {
	// List across all requested namespaces, or all namespaces if none specified.
	namespaces := input.Namespaces
	if len(namespaces) == 0 {
		namespaces = []string{""}
	}

	var allReleases []json.RawMessage
	for _, ns := range namespaces {
		cfg, err := r.getConfig(ctx, client, ns)
		if err != nil {
			r.log.Warnw("failed to get config for namespace", "namespace", ns, "error", err)
			continue
		}

		list := action.NewList(cfg)
		list.AllNamespaces = ns == ""
		list.StateMask = action.ListAll

		releases, err := list.Run()
		if err != nil {
			r.log.Warnw("failed to list releases", "namespace", ns, "error", err)
			continue
		}

		for _, rel := range releases {
			data, err := marshalMap(releaseToMap(rel))
			if err != nil {
				r.log.Warnw("failed to marshal release", "name", rel.Name, "error", err)
				continue
			}
			allReleases = append(allReleases, data)
		}
	}

	return &resource.ListResult{Result: allReleases, Success: true}, nil
}

func (r *ReleaseResourcer) Find(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	input resource.FindInput,
) (*resource.FindResult, error) {
	// Find is like List with filtering -- delegate to List for now.
	listResult, err := r.List(ctx, client, meta, resource.ListInput{
		Namespaces: input.Namespaces,
	})
	if err != nil {
		return nil, err
	}
	return &resource.FindResult{
		Result:  listResult.Result,
		Success: listResult.Success,
	}, nil
}

func (r *ReleaseResourcer) Create(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	input resource.CreateInput,
) (*resource.CreateResult, error) {
	// Unmarshal input from json.RawMessage.
	var inputMap map[string]interface{}
	if err := json.Unmarshal(input.Input, &inputMap); err != nil {
		return nil, fmt.Errorf("failed to unmarshal create input: %w", err)
	}

	cfg, err := r.getConfig(ctx, client, input.Namespace)
	if err != nil {
		return nil, err
	}

	chartRef, _ := inputMap["chart"].(string)
	releaseName, _ := inputMap["name"].(string)
	valuesYAML, _ := inputMap["values"].(map[string]interface{})

	if chartRef == "" {
		return nil, fmt.Errorf("chart reference is required")
	}

	// Locate and load the chart.
	settings := cli.New()
	settings.SetNamespace(input.Namespace)

	chartPath, err := (&action.ChartPathOptions{}).LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("failed to locate chart %s: %w", chartRef, err)
	}

	chart, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart %s: %w", chartPath, err)
	}

	install := action.NewInstall(cfg)
	install.ReleaseName = releaseName
	install.Namespace = input.Namespace
	install.CreateNamespace = true

	rel, err := install.Run(chart, valuesYAML)
	if err != nil {
		return nil, fmt.Errorf("failed to install release: %w", err)
	}

	data, err := marshalMap(releaseToMap(rel))
	if err != nil {
		return nil, err
	}
	return &resource.CreateResult{Result: data, Success: true}, nil
}

func (r *ReleaseResourcer) Update(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	_ resource.UpdateInput,
) (*resource.UpdateResult, error) {
	// Update is not directly supported -- use the "upgrade" action instead.
	return nil, fmt.Errorf("use the 'upgrade' action to update a release")
}

func (r *ReleaseResourcer) Delete(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	input resource.DeleteInput,
) (*resource.DeleteResult, error) {
	cfg, err := r.getConfig(ctx, client, input.Namespace)
	if err != nil {
		return nil, err
	}

	uninstall := action.NewUninstall(cfg)
	resp, err := uninstall.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to uninstall release %s: %w", input.ID, err)
	}

	data, err := marshalMap(releaseToMap(resp.Release))
	if err != nil {
		return nil, err
	}
	return &resource.DeleteResult{Result: data, Success: true}, nil
}

// ================================= ACTIONS ================================= //

func (r *ReleaseResourcer) GetActions(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
) ([]resource.ActionDescriptor, error) {
	chartVersionParams := &resource.Schema{
		Properties: map[string]resource.SchemaProperty{
			"chart":        {Type: resource.SchemaString, Description: "Chart reference (e.g. repo/chart)"},
			"values":       {Type: resource.SchemaObject, Description: "Override values"},
			"version":      {Type: resource.SchemaString, Description: "Chart version constraint"},
			"reuse_values": {Type: resource.SchemaBoolean, Default: false, Description: "Reuse existing values from the release"},
		},
		Required: []string{"chart"},
	}

	installParams := &resource.Schema{
		Properties: map[string]resource.SchemaProperty{
			"chart":     {Type: resource.SchemaString, Description: "Chart reference (e.g. repo/chart)"},
			"name":      {Type: resource.SchemaString, Description: "Release name"},
			"namespace": {Type: resource.SchemaString, Description: "Target namespace"},
			"values":    {Type: resource.SchemaObject, Description: "Override values"},
			"version":   {Type: resource.SchemaString, Description: "Chart version constraint"},
		},
		Required: []string{"chart", "name"},
	}

	dryRunInstallParams := &resource.Schema{
		Properties: map[string]resource.SchemaProperty{
			"chart":     {Type: resource.SchemaString, Description: "Chart reference (e.g. repo/chart)"},
			"name":      {Type: resource.SchemaString, Description: "Release name"},
			"namespace": {Type: resource.SchemaString, Description: "Target namespace"},
			"values":    {Type: resource.SchemaObject, Description: "Override values"},
			"version":   {Type: resource.SchemaString, Description: "Chart version constraint"},
		},
		Required: []string{"chart"},
	}

	return []resource.ActionDescriptor{
		{
			ID:           "upgrade",
			Label:        "Upgrade Release",
			Description:  "Upgrade an installed release with new chart or values",
			Icon:         "LuArrowUpCircle",
			Scope:        resource.ActionScopeInstance,
			Dangerous:    true,
			ParamsSchema: chartVersionParams,
		},
		{
			ID:          "rollback",
			Label:       "Rollback Release",
			Description: "Rollback a release to a previous revision",
			Icon:        "LuUndo2",
			Scope:       resource.ActionScopeInstance,
			Dangerous:   true,
			ParamsSchema: &resource.Schema{
				Properties: map[string]resource.SchemaProperty{
					"revision": {Type: resource.SchemaInteger, Minimum: resource.PtrFloat64(0), Description: "Revision number to rollback to (0 = previous)"},
				},
			},
		},
		{
			ID:          "get-values",
			Label:       "Get Values",
			Description: "Get the computed values for a release",
			Icon:        "LuFileText",
			Scope:       resource.ActionScopeInstance,
			ParamsSchema: &resource.Schema{
				Properties: map[string]resource.SchemaProperty{
					"all": {Type: resource.SchemaBoolean, Default: false, Description: "Return all computed values (including defaults)"},
				},
			},
		},
		{
			ID:          "get-manifest",
			Label:       "Get Manifest",
			Description: "Get the rendered manifest for a release",
			Icon:        "LuFileCode",
			Scope:       resource.ActionScopeInstance,
			ParamsSchema: &resource.Schema{
				Properties: map[string]resource.SchemaProperty{
					"revision": {Type: resource.SchemaInteger, Minimum: resource.PtrFloat64(1), Description: "Specific revision to get manifest for"},
				},
			},
		},
		{
			ID:          "get-notes",
			Label:       "Get Notes",
			Description: "Get the release notes",
			Icon:        "LuStickyNote",
			Scope:       resource.ActionScopeInstance,
		},
		{
			ID:          "get-hooks",
			Label:       "Get Hooks",
			Description: "Get the release hooks",
			Icon:        "LuAnchor",
			Scope:       resource.ActionScopeInstance,
		},
		{
			ID:          "get-history",
			Label:       "Get History",
			Description: "Get the revision history for a release",
			Icon:        "LuHistory",
			Scope:       resource.ActionScopeInstance,
			ParamsSchema: &resource.Schema{
				Properties: map[string]resource.SchemaProperty{
					"max": {Type: resource.SchemaInteger, Minimum: resource.PtrFloat64(1), Description: "Maximum number of revisions to return"},
				},
			},
		},
		{
			ID:           "install",
			Label:        "Install Chart",
			Description:  "Install a chart as a new release",
			Icon:         "LuDownload",
			Scope:        resource.ActionScopeType,
			ParamsSchema: installParams,
		},
		{
			ID:           "dry-run-install",
			Label:        "Dry Run Install",
			Description:  "Preview what an install would render without applying",
			Icon:         "LuEye",
			Scope:        resource.ActionScopeType,
			ParamsSchema: dryRunInstallParams,
		},
		{
			ID:           "dry-run-upgrade",
			Label:        "Dry Run Upgrade",
			Description:  "Preview what an upgrade would render without applying",
			Icon:         "LuEye",
			Scope:        resource.ActionScopeInstance,
			ParamsSchema: chartVersionParams,
		},
		{
			ID:          "diff-revisions",
			Label:       "Diff Revisions",
			Description: "Compare manifests between two revisions",
			Icon:        "LuGitCompare",
			Scope:       resource.ActionScopeInstance,
			ParamsSchema: &resource.Schema{
				Properties: map[string]resource.SchemaProperty{
					"revision1": {Type: resource.SchemaInteger, Minimum: resource.PtrFloat64(1), Description: "First revision to compare"},
					"revision2": {Type: resource.SchemaInteger, Minimum: resource.PtrFloat64(1), Description: "Second revision to compare"},
				},
				Required: []string{"revision1", "revision2"},
			},
		},
		{
			ID:          "test",
			Label:       "Test Release",
			Description: "Run test hooks for a release",
			Icon:        "LuFlaskConical",
			Scope:       resource.ActionScopeInstance,
		},
	}, nil
}

func (r *ReleaseResourcer) ExecuteAction(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	actionID string,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	cfg, err := r.getConfig(ctx, client, input.Namespace)
	if err != nil {
		return nil, err
	}

	switch actionID {
	case "upgrade":
		return r.executeUpgrade(cfg, input)
	case "rollback":
		return r.executeRollback(cfg, input)
	case "get-values":
		return r.executeGetValues(cfg, input)
	case "get-manifest":
		return r.executeGetManifest(cfg, input)
	case "get-notes":
		return r.executeGetNotes(cfg, input)
	case "get-hooks":
		return r.executeGetHooks(cfg, input)
	case "get-history":
		return r.executeGetHistory(cfg, input)
	case "install":
		return r.executeInstall(cfg, input)
	case "dry-run-install":
		return r.executeDryRunInstall(cfg, input)
	case "dry-run-upgrade":
		return r.executeDryRunUpgrade(cfg, input)
	case "diff-revisions":
		return r.executeDiffRevisions(cfg, input)
	case "test":
		return r.executeTest(cfg, input)
	default:
		return nil, fmt.Errorf("unknown action: %s", actionID)
	}
}

func (r *ReleaseResourcer) StreamAction(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	_ string,
	_ resource.ActionInput,
	_ chan<- resource.ActionEvent,
) error {
	return fmt.Errorf("streaming actions not yet implemented for releases")
}

// ================================= SCHEMA ================================= //

// GetEditorSchemas extracts values.schema.json from installed Helm chart releases.
// Implements resource.SchemaProvider[clients.ClientSet] at the connection level.
func (r *ReleaseResourcer) GetEditorSchemas(
	ctx context.Context,
	client *clients.ClientSet,
) ([]resource.EditorSchema, error) {
	cfg, err := r.getConfig(ctx, client, "")
	if err != nil {
		return nil, err
	}

	list := action.NewList(cfg)
	list.AllNamespaces = true
	list.StateMask = action.ListDeployed | action.ListFailed | action.ListPendingInstall | action.ListPendingUpgrade

	releases, err := list.Run()
	if err != nil {
		return nil, fmt.Errorf("failed to list releases for schema extraction: %w", err)
	}

	conn := resource.ConnectionFromContext(ctx)
	connID := ""
	if conn != nil {
		connID = conn.ID
	}

	var schemas []resource.EditorSchema
	for _, rel := range releases {
		if rel.Chart == nil {
			continue
		}
		for _, f := range rel.Chart.Raw {
			if f.Name == "values.schema.json" {
				schemas = append(schemas, resource.EditorSchema{
					ResourceKey: "helm::v1::Release",
					FileMatch:   fmt.Sprintf("**/helm::v1::Release/%s.yaml", rel.Name),
					Content:     f.Data,
					Language:    "yaml",
					URI: fmt.Sprintf("helm://%s/%s/%s/values-schema",
						connID,
						rel.Chart.Metadata.Name,
						rel.Chart.Metadata.Version,
					),
				})
				break
			}
		}
	}

	return schemas, nil
}

// ================================= ACTION IMPLEMENTATIONS ================================= //

func (r *ReleaseResourcer) executeUpgrade(
	cfg *action.Configuration,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	chartRef, _ := input.Params["chart"].(string)
	values, _ := input.Params["values"].(map[string]interface{})
	reuseValues, _ := input.Params["reuse_values"].(bool)

	if chartRef == "" {
		return nil, fmt.Errorf("chart reference is required for upgrade")
	}

	settings := cli.New()
	settings.SetNamespace(input.Namespace)

	chartPath, err := (&action.ChartPathOptions{}).LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("failed to locate chart %s: %w", chartRef, err)
	}

	chart, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart %s: %w", chartPath, err)
	}

	upgrade := action.NewUpgrade(cfg)
	upgrade.Namespace = input.Namespace
	upgrade.ReuseValues = reuseValues

	rel, err := upgrade.Run(input.ID, chart, values)
	if err != nil {
		return nil, fmt.Errorf("failed to upgrade release: %w", err)
	}

	return &resource.ActionResult{
		Success: true,
		Data:    releaseToMap(rel),
		Message: fmt.Sprintf("Release %s upgraded to revision %d", rel.Name, rel.Version),
	}, nil
}

func (r *ReleaseResourcer) executeRollback(
	cfg *action.Configuration,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	revisionF, _ := input.Params["revision"].(float64)
	revision := int(revisionF)

	rollback := action.NewRollback(cfg)
	rollback.Version = revision

	if err := rollback.Run(input.ID); err != nil {
		return nil, fmt.Errorf("failed to rollback release: %w", err)
	}

	return &resource.ActionResult{
		Success: true,
		Message: fmt.Sprintf("Release %s rolled back to revision %d", input.ID, revision),
	}, nil
}

func (r *ReleaseResourcer) executeGetValues(
	cfg *action.Configuration,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	getValues := action.NewGetValues(cfg)
	allValues, _ := input.Params["all"].(bool)
	getValues.AllValues = allValues

	values, err := getValues.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get values: %w", err)
	}

	return &resource.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"values": values,
		},
	}, nil
}

func (r *ReleaseResourcer) executeGetManifest(
	cfg *action.Configuration,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	get := action.NewGet(cfg)

	// Support fetching a specific revision's manifest.
	if revF, ok := input.Params["revision"].(float64); ok && revF > 0 {
		get.Version = int(revF)
	}

	rel, err := get.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get release: %w", err)
	}

	return &resource.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"manifest": rel.Manifest,
		},
	}, nil
}

func (r *ReleaseResourcer) executeGetNotes(
	cfg *action.Configuration,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	get := action.NewGet(cfg)
	rel, err := get.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get release: %w", err)
	}

	notes := ""
	if rel.Info != nil {
		notes = rel.Info.Notes
	}

	return &resource.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"notes": notes,
		},
	}, nil
}

func (r *ReleaseResourcer) executeGetHooks(
	cfg *action.Configuration,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	get := action.NewGet(cfg)
	rel, err := get.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get release: %w", err)
	}

	hooks := make([]interface{}, 0, len(rel.Hooks))
	for _, hook := range rel.Hooks {
		h := map[string]interface{}{
			"name":   hook.Name,
			"kind":   hook.Kind,
			"path":   hook.Path,
			"weight": hook.Weight,
		}
		events := make([]interface{}, 0, len(hook.Events))
		for _, e := range hook.Events {
			events = append(events, string(e))
		}
		h["events"] = events
		hooks = append(hooks, h)
	}

	return &resource.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"hooks": hooks,
		},
	}, nil
}

func (r *ReleaseResourcer) executeGetHistory(
	cfg *action.Configuration,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	history := action.NewHistory(cfg)
	maxF, ok := input.Params["max"].(float64)
	if ok && maxF > 0 {
		history.Max = int(maxF)
	}

	releases, err := history.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get history: %w", err)
	}

	revisions := make([]interface{}, 0, len(releases))
	for _, rel := range releases {
		revisions = append(revisions, releaseToMap(rel))
	}

	return &resource.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"revisions": revisions,
		},
	}, nil
}

func (r *ReleaseResourcer) executeInstall(
	cfg *action.Configuration,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	chartRef, _ := input.Params["chart"].(string)
	releaseName, _ := input.Params["name"].(string)
	namespace, _ := input.Params["namespace"].(string)
	values, _ := input.Params["values"].(map[string]interface{})
	version, _ := input.Params["version"].(string)

	if chartRef == "" {
		return nil, fmt.Errorf("chart reference is required")
	}
	if releaseName == "" {
		return nil, fmt.Errorf("release name is required")
	}

	settings := cli.New()
	if namespace != "" {
		settings.SetNamespace(namespace)
	}

	chartPathOpts := &action.ChartPathOptions{Version: version}
	chartPath, err := chartPathOpts.LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("failed to locate chart %s: %w", chartRef, err)
	}

	chart, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart %s: %w", chartPath, err)
	}

	install := action.NewInstall(cfg)
	install.ReleaseName = releaseName
	install.Namespace = namespace
	install.CreateNamespace = true
	if version != "" {
		install.Version = version
	}

	rel, err := install.Run(chart, values)
	if err != nil {
		return nil, fmt.Errorf("failed to install release: %w", err)
	}

	return &resource.ActionResult{
		Success: true,
		Data:    releaseToMap(rel),
		Message: fmt.Sprintf("Release %s installed in namespace %s", rel.Name, rel.Namespace),
	}, nil
}

func (r *ReleaseResourcer) executeDryRunInstall(
	cfg *action.Configuration,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	chartRef, _ := input.Params["chart"].(string)
	releaseName, _ := input.Params["name"].(string)
	namespace, _ := input.Params["namespace"].(string)
	values, _ := input.Params["values"].(map[string]interface{})
	version, _ := input.Params["version"].(string)

	if chartRef == "" {
		return nil, fmt.Errorf("chart reference is required")
	}

	settings := cli.New()
	if namespace != "" {
		settings.SetNamespace(namespace)
	}

	chartPathOpts := &action.ChartPathOptions{Version: version}
	chartPath, err := chartPathOpts.LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("failed to locate chart %s: %w", chartRef, err)
	}

	chart, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart %s: %w", chartPath, err)
	}

	install := action.NewInstall(cfg)
	install.ReleaseName = releaseName
	install.Namespace = namespace
	install.DryRun = true
	install.ClientOnly = true
	if version != "" {
		install.Version = version
	}

	rel, err := install.Run(chart, values)
	if err != nil {
		return nil, fmt.Errorf("dry-run install failed: %w", err)
	}

	notes := ""
	if rel != nil && rel.Info != nil {
		notes = rel.Info.Notes
	}

	return &resource.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"manifest": rel.Manifest,
			"notes":    notes,
		},
		Message: "Dry-run install completed",
	}, nil
}

func (r *ReleaseResourcer) executeDryRunUpgrade(
	cfg *action.Configuration,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	chartRef, _ := input.Params["chart"].(string)
	values, _ := input.Params["values"].(map[string]interface{})
	reuseValues, _ := input.Params["reuse_values"].(bool)
	version, _ := input.Params["version"].(string)

	if chartRef == "" {
		return nil, fmt.Errorf("chart reference is required for upgrade")
	}

	settings := cli.New()
	settings.SetNamespace(input.Namespace)

	chartPathOpts := &action.ChartPathOptions{Version: version}
	chartPath, err := chartPathOpts.LocateChart(chartRef, settings)
	if err != nil {
		return nil, fmt.Errorf("failed to locate chart %s: %w", chartRef, err)
	}

	chart, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart %s: %w", chartPath, err)
	}

	upgrade := action.NewUpgrade(cfg)
	upgrade.Namespace = input.Namespace
	upgrade.DryRun = true
	upgrade.ReuseValues = reuseValues

	rel, err := upgrade.Run(input.ID, chart, values)
	if err != nil {
		return nil, fmt.Errorf("dry-run upgrade failed: %w", err)
	}

	return &resource.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"manifest": rel.Manifest,
		},
		Message: "Dry-run upgrade completed",
	}, nil
}

func (r *ReleaseResourcer) executeDiffRevisions(
	cfg *action.Configuration,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	rev1F, _ := input.Params["revision1"].(float64)
	rev2F, _ := input.Params["revision2"].(float64)
	rev1 := int(rev1F)
	rev2 := int(rev2F)

	get1 := action.NewGet(cfg)
	get1.Version = rev1
	rel1, err := get1.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get revision %d: %w", rev1, err)
	}

	get2 := action.NewGet(cfg)
	get2.Version = rev2
	rel2, err := get2.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get revision %d: %w", rev2, err)
	}

	return &resource.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"revision1": map[string]interface{}{
				"revision": rev1,
				"manifest": rel1.Manifest,
			},
			"revision2": map[string]interface{}{
				"revision": rev2,
				"manifest": rel2.Manifest,
			},
		},
	}, nil
}

func (r *ReleaseResourcer) executeTest(
	cfg *action.Configuration,
	input resource.ActionInput,
) (*resource.ActionResult, error) {
	test := action.NewReleaseTesting(cfg)

	rel, err := test.Run(input.ID)
	if err != nil {
		return nil, fmt.Errorf("release test failed: %w", err)
	}

	hooks := make([]interface{}, 0)
	for _, hook := range rel.Hooks {
		events := make([]interface{}, 0, len(hook.Events))
		for _, e := range hook.Events {
			events = append(events, string(e))
		}
		hooks = append(hooks, map[string]interface{}{
			"name":     hook.Name,
			"kind":     hook.Kind,
			"events":   events,
			"lastRun":  hook.LastRun,
		})
	}

	return &resource.ActionResult{
		Success: true,
		Data: map[string]interface{}{
			"hooks": hooks,
		},
		Message: fmt.Sprintf("Release %s tests completed", input.ID),
	}, nil
}
