package helm

import (
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"go.uber.org/zap"
)

var (
	// ReleaseMeta is the resource meta for helm::v1::Release.
	ReleaseMeta = resource.ResourceMeta{
		Group:       "helm",
		Version:     "v1",
		Kind:        "Release",
		Description: "Installed Helm releases",
	}

	// RepoMeta is the resource meta for helm::v1::Repository.
	RepoMeta = resource.ResourceMeta{
		Group:       "helm",
		Version:     "v1",
		Kind:        "Repository",
		Description: "Helm chart repositories",
	}

	// ChartMeta is the resource meta for helm::v1::Chart.
	ChartMeta = resource.ResourceMeta{
		Group:       "helm",
		Version:     "v1",
		Kind:        "Chart",
		Description: "Available Helm charts from configured repositories",
	}
)

// HelmResourceGroup returns the resource group for Helm resources.
func HelmResourceGroup() resource.ResourceGroup {
	return resource.ResourceGroup{
		ID:   "helm",
		Name: "Helm",
		Icon: "SiHelm",
	}
}

// HelmResourceDefinitions returns the resource definitions for Helm resources.
func HelmResourceDefinitions() map[string]resource.ResourceDefinition {
	return map[string]resource.ResourceDefinition{
		ReleaseMeta.String(): {
			IDAccessor:        "name",
			NamespaceAccessor: "namespace",
			MemoizerAccessor:  "name",
			ColumnDefs: []resource.ColumnDefinition{
				{
					ID:        "name",
					Header:    "Name",
					Accessors: "name",
				},
				{
					ID:        "namespace",
					Header:    "Namespace",
					Accessors: "namespace",
				},
				{
					ID:        "chart",
					Header:    "Chart",
					Accessors: "chart.metadata.name",
				},
				{
					ID:        "app_version",
					Header:    "App Version",
					Accessors: "chart.metadata.appVersion",
				},
				{
					ID:        "revision",
					Header:    "Revision",
					Accessors: "version",
				},
				{
					ID:        "status",
					Header:    "Status",
					Accessors: "info.status",
					ColorMap: map[string]string{
						"deployed":         "success",
						"failed":           "danger",
						"pending-install":  "warning",
						"pending-upgrade":  "warning",
						"pending-rollback": "warning",
						"superseded":       "neutral",
						"uninstalling":     "warning",
						"uninstalled":      "neutral",
					},
				},
				{
					ID:        "updated",
					Header:    "Updated",
					Accessors: "info.last_deployed",
					Formatter: "AGE",
				},
			},
		},
		RepoMeta.String(): {
			IDAccessor:       "name",
			MemoizerAccessor: "name",
			ColumnDefs: []resource.ColumnDefinition{
				{
					ID:        "name",
					Header:    "Name",
					Accessors: "name",
				},
				{
					ID:        "url",
					Header:    "URL",
					Accessors: "url",
				},
			},
		},
		ChartMeta.String(): {
			IDAccessor:       "id",
			MemoizerAccessor: "id",
			ColumnDefs: []resource.ColumnDefinition{
				{
					ID:        "name",
					Header:    "Name",
					Accessors: "name",
				},
				{
					ID:        "description",
					Header:    "Description",
					Accessors: "description",
				},
				{
					ID:        "version",
					Header:    "Version",
					Accessors: "version",
				},
				{
					ID:        "appVersion",
					Header:    "App Version",
					Accessors: "appVersion",
				},
				{
					ID:        "repository",
					Header:    "Repository",
					Accessors: "repository",
				},
			},
		},
	}
}

// HelmResourcers returns the resourcer implementations for Helm resources.
func HelmResourcers(logger *zap.SugaredLogger, svc *HelmService) map[resource.ResourceMeta]resource.Resourcer[clients.ClientSet] {
	return map[resource.ResourceMeta]resource.Resourcer[clients.ClientSet]{
		ReleaseMeta: NewReleaseResourcer(logger, svc),
		RepoMeta:    NewRepoResourcerWithActions(logger),
		ChartMeta:   NewChartResourcerWithActions(logger),
	}
}
