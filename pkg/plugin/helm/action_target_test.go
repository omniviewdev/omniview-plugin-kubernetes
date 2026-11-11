package helm

import (
	"context"
	"path/filepath"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/repo"
)

func TestHelmRegisteredActionsMatchCatalog(t *testing.T) {
	h := NewHelmAncillary(zap.NewNop().Sugar())
	for _, registration := range h.Registrations() {
		descriptors, err := h.GetActions(context.Background(), nil, registration.Type)
		require.NoError(t, err)
		require.NotEmpty(t, registration.Actions)
		require.Equal(t, descriptors, registration.Actions)
		require.NoError(t, resource.ValidateActionDescriptors(registration.Actions))
	}
}

func TestHelmTypeActionScopeAndInputAdmission(t *testing.T) {
	h := NewHelmAncillary(zap.NewNop().Sugar())
	for _, typ := range []string{ReleaseType, RepositoryType} {
		dimension, value, id := "namespace", "team", "install"
		if typ == RepositoryType {
			dimension, value, id = "domain", helmLocalDomain, "add"
		}
		values := []string{value}
		target := &resource.TypeActionTarget{Type: typ, Scope: resource.QueryScope{{Dimension: dimension, Match: resource.ScopeOneOf, Values: &values}}}
		request := resource.ActionRequest{TypeTarget: target, Action: id, Input: resource.Value{Kind: "map"}}
		_, err := actionNamespace(request)
		require.NoError(t, err)
		_, err = h.Action(context.Background(), nil, request)
		require.Equal(t, "INVALID_REQUEST", resource.ErrorCode(err), "missing explicit name must fail before native work")
		request.Reference.Address = resource.ResourceAddress{Type: typ, ID: "fabricated", Scope: []resource.ScopeEntry{{Dimension: dimension, Value: value}}}
		_, err = h.Action(context.Background(), nil, request)
		require.Equal(t, "INVALID_REQUEST", resource.ErrorCode(err))
		request.TypeTarget = nil
		_, err = h.Action(context.Background(), nil, request)
		require.Equal(t, "INVALID_REQUEST", resource.ErrorCode(err), "type action cannot use instance reference")
		request.Reference = resource.ResourceReference{}
		request.TypeTarget = target
		values = append(values, "other")
		_, err = actionNamespace(request)
		require.Equal(t, "INVALID_REQUEST", resource.ErrorCode(err))
		target.Scope[0] = resource.ScopeConstraint{Dimension: dimension, Match: resource.ScopeAny}
		_, err = actionNamespace(request)
		require.Equal(t, "INVALID_REQUEST", resource.ErrorCode(err))
	}
}

func TestHelmInstallHandlersRequireExplicitName(t *testing.T) {
	r := NewHelmAncillary(zap.NewNop().Sugar()).release
	values := []string{"team"}
	request := resource.ActionRequest{
		TypeTarget: &resource.TypeActionTarget{Type: ReleaseType, Scope: resource.QueryScope{{Dimension: "namespace", Match: resource.ScopeOneOf, Values: &values}}},
		Input:      resource.Value{Kind: "map", Map: map[string]resource.Value{"chart": {Kind: "string", String: "unused"}}},
	}
	_, err := r.executeInstall(context.Background(), &action.Configuration{}, request)
	require.EqualError(t, err, "release name is required")
	_, err = r.executeDryRunInstall(context.Background(), &action.Configuration{}, request)
	require.EqualError(t, err, "release name is required")
}

func TestHelmTypeActionInputCannotWidenNativeScope(t *testing.T) {
	h := NewHelmAncillary(zap.NewNop().Sugar())
	for _, typ := range []string{ReleaseType, RepositoryType} {
		dimension, selected, action := "namespace", "team", "install"
		if typ == RepositoryType {
			dimension, selected, action = "domain", helmLocalDomain, "add"
		}
		values := []string{selected}
		request := resource.ActionRequest{
			TypeTarget: &resource.TypeActionTarget{Type: typ, Scope: resource.QueryScope{{Dimension: dimension, Match: resource.ScopeOneOf, Values: &values}}},
			Action:     action,
			Input: resource.Value{Kind: "map", Map: map[string]resource.Value{
				"name":    {Kind: "string", String: "native-name"},
				"chart":   {Kind: "string", String: "unused"},
				"url":     {Kind: "string", String: "https://unused.example"},
				dimension: {Kind: "string", String: "other"},
			}},
		}
		_, err := h.Action(context.Background(), nil, request)
		require.Equal(t, "INVALID_REQUEST", resource.ErrorCode(err), "scope mismatch must fail before native client access")
		request.Input.Map[dimension] = resource.Value{Kind: "string", String: selected}
		actualNamespace, err := actionNamespace(request)
		require.NoError(t, err)
		if typ == ReleaseType {
			require.Equal(t, selected, actualNamespace)
		} else {
			require.Empty(t, actualNamespace)
		}
	}
}

func TestHelmActionDiagnostics(t *testing.T) {
	directory := chartPagingFixture(t)
	require.NoError(t, repo.NewIndexFile().WriteFile(filepath.Join(directory, "z-selected-index.yaml"), 0600))
	core, logs := observer.New(zap.InfoLevel)
	h := NewHelmAncillary(zap.New(core).Sugar())
	request := resource.ActionRequest{
		Reference: resource.ResourceReference{Address: resource.ResourceAddress{
			Type: RepositoryType, ID: "z-selected",
			Scope: []resource.ScopeEntry{{Dimension: "domain", Value: helmLocalDomain}},
		}},
		Action: "list-charts", Input: resource.Value{Kind: "map"},
	}
	_, err := h.Action(context.Background(), nil, request)
	require.NoError(t, err)
	entry := logs.All()[0]
	require.Equal(t, "Helm action finished", entry.Message)
	require.Equal(t, "success", entry.ContextMap()["outcome"])
	require.Equal(t, "execution", entry.ContextMap()["stage"])
	require.Equal(t, "list-charts", entry.ContextMap()["action"])

	request.Reference.Address.ID = "missing"
	_, err = h.Action(context.Background(), nil, request)
	require.Error(t, err)
	entry = logs.All()[1]
	require.Equal(t, "failure", entry.ContextMap()["outcome"])
	require.Equal(t, "execution", entry.ContextMap()["stage"])
	require.Equal(t, "other", entry.ContextMap()["error_class"])

	request.Action = "secret-action"
	request.Input = resource.Value{Kind: "string", String: "secret-payload"}
	_, err = h.Action(context.Background(), nil, request)
	require.Error(t, err)
	entry = logs.All()[2]
	require.Equal(t, "admission", entry.ContextMap()["stage"])
	require.Equal(t, "validation", entry.ContextMap()["error_class"])
	require.Equal(t, "unknown", entry.ContextMap()["action"])
	require.NotContains(t, entry.ContextMap(), "error")
	require.NotContains(t, entry.ContextMap(), "input")
	require.NotContains(t, entry.Message, "secret")
}
