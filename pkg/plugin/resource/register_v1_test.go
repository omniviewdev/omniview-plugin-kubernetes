package resource

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"github.com/omniview/kubernetes/pkg/plugin/resource/resourcers"
	oldtypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// ====================== convertDefinition ====================== //

func TestConvertDefinition_BasicFields(t *testing.T) {
	old := oldtypes.ResourceDefinition{
		IDAccessor:        "metadata.name",
		NamespaceAccessor: "metadata.namespace",
		MemoizerAccessor:  "metadata.uid",
	}

	result := convertDefinition(old)

	assert.Equal(t, "metadata.name", result.IDAccessor)
	assert.Equal(t, "metadata.namespace", result.NamespaceAccessor)
	assert.Equal(t, "metadata.uid", result.MemoizerAccessor)
}

func TestConvertDefinition_ColumnDefs(t *testing.T) {
	old := oldtypes.ResourceDefinition{
		IDAccessor: "metadata.name",
		ColumnDefs: []oldtypes.ColumnDef{
			{
				ID:        "name",
				Header:    "Name",
				Accessors: "metadata.name",
				Hidden:    false,
				Width:     200,
			},
			{
				ID:        "namespace",
				Header:    "Namespace",
				Accessors: "metadata.namespace",
				Hidden:    true,
				Width:     150,
			},
		},
	}

	result := convertDefinition(old)

	require.Len(t, result.ColumnDefs, 2)

	col0 := result.ColumnDefs[0]
	assert.Equal(t, "name", col0.ID)
	assert.Equal(t, "Name", col0.Header)
	assert.Equal(t, "metadata.name", col0.Accessors)
	assert.False(t, col0.Hidden)
	assert.Equal(t, 200, col0.Width)

	col1 := result.ColumnDefs[1]
	assert.Equal(t, "namespace", col1.ID)
	assert.True(t, col1.Hidden)
}

func TestConvertDefinition_EmptyColumns(t *testing.T) {
	old := oldtypes.ResourceDefinition{
		IDAccessor: "metadata.name",
		ColumnDefs: []oldtypes.ColumnDef{},
	}

	result := convertDefinition(old)
	assert.Empty(t, result.ColumnDefs)
}

// ====================== buildRegistrations ====================== //

func TestBuildRegistrations_SpecializedOverrides(t *testing.T) {
	logger := zap.NewNop().Sugar()
	regs := buildRegistrations(logger)

	// Build a lookup map of resource key → registration
	regMap := make(map[string]resource.ResourceRegistration[clients.ClientSet])
	for _, reg := range regs {
		regMap[reg.Meta.Key()] = reg
	}

	specializedKeys := []string{
		"core::v1::Node",
		"core::v1::Pod",
		"apps::v1::Deployment",
		"apps::v1::DaemonSet",
		"apps::v1::StatefulSet",
	}

	for _, key := range specializedKeys {
		reg, ok := regMap[key]
		if !assert.True(t, ok, "expected %s in registrations", key) {
			continue
		}
		// Specialized resourcers should not be the base type.
		_, isBase := reg.Resourcer.(*resourcers.KubernetesResourcerBase[resourcers.MetaAccessor])
		assert.False(t, isBase, "%s should have a specialized resourcer, not base", key)
	}
}

func TestBuildRegistrations_SyncNeverForEvents(t *testing.T) {
	logger := zap.NewNop().Sugar()
	regs := buildRegistrations(logger)

	for _, reg := range regs {
		if reg.Meta.Key() == "core::v1::Event" {
			// The Event resource should use a base resourcer with SyncNever policy.
			base, ok := reg.Resourcer.(*resourcers.KubernetesResourcerBase[resourcers.MetaAccessor])
			require.True(t, ok, "Event resourcer should be a base resourcer")
			assert.Equal(t, resource.SyncNever, base.SyncPolicy())
			return
		}
	}
	t.Fatal("core::v1::Event not found in registrations")
}

func TestBuildRegistrations_DefaultSyncOnConnect(t *testing.T) {
	logger := zap.NewNop().Sugar()
	regs := buildRegistrations(logger)

	for _, reg := range regs {
		key := reg.Meta.Key()
		// Skip specialized resourcers and Events — check a non-specialized, non-Event resource.
		if key == "core::v1::Event" || key == "core::v1::Node" || key == "core::v1::Pod" ||
			key == "apps::v1::Deployment" || key == "apps::v1::DaemonSet" || key == "apps::v1::StatefulSet" {
			continue
		}
		// Skip benchmark and helm resources.
		if reg.Meta.Group == "extras" || reg.Meta.Group == "helm" {
			continue
		}
		base, ok := reg.Resourcer.(*resourcers.KubernetesResourcerBase[resourcers.MetaAccessor])
		if !ok {
			continue
		}
		assert.Equal(t, resource.SyncOnConnect, base.SyncPolicy(),
			"%s should have SyncOnConnect policy", key)
		return // only need to verify one
	}
}

func TestBuildRegistrations_DefinitionsAttached(t *testing.T) {
	logger := zap.NewNop().Sugar()
	regs := buildRegistrations(logger)

	// Check that resources with known definitions have them set.
	definedKeys := make(map[string]bool)
	for key := range resourcers.ResourceDefs {
		definedKeys[key] = true
	}

	for _, reg := range regs {
		key := reg.Meta.Key()
		if definedKeys[key] {
			assert.NotNil(t, reg.Definition, "%s should have a definition attached", key)
		}
	}
}

func TestBuildRegistrations_BenchmarkIncluded(t *testing.T) {
	logger := zap.NewNop().Sugar()
	regs := buildRegistrations(logger)

	for _, reg := range regs {
		if reg.Meta.Key() == "extras::v1::ClusterBenchmark" {
			return // found
		}
	}
	t.Fatal("extras::v1::ClusterBenchmark not found in registrations")
}
