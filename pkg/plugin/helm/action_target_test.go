package helm

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chartutil"
	kubefake "helm.sh/helm/v3/pkg/kube/fake"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/repo"
	"helm.sh/helm/v3/pkg/storage"
	"helm.sh/helm/v3/pkg/storage/driver"
	helmtime "helm.sh/helm/v3/pkg/time"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	k8stypes "k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
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

type helmActionStoredRelease struct {
	metadata metav1.ObjectMeta
	secret   corev1.Secret
}

type helmReleaseActionFixture struct {
	ctx       context.Context
	client    *clients.ClientSet
	ancillary *HelmAncillary
	reference resource.ResourceReference
	installed *release.Release
	current   atomic.Pointer[helmActionStoredRelease]
	mutations atomic.Int64
	afterRead atomic.Pointer[helmActionStoredRelease]
}

func newHelmReleaseActionFixture(t *testing.T) *helmReleaseActionFixture {
	t.Helper()
	t.Setenv("HELM_DRIVER", "secrets")
	fixture := &helmReleaseActionFixture{
		ctx:       resource.WithSession(context.Background(), resource.Session{Connection: &types.Connection{ID: "owned-cluster"}}),
		ancillary: NewHelmAncillary(zap.NewNop().Sugar()),
		reference: resource.ResourceReference{Address: resource.ResourceAddress{
			Provider: "kubernetes", Authority: "fixture-authority", Type: ReleaseType, ID: "installed",
			Scope: []resource.ScopeEntry{{Dimension: "namespace", Value: "selected"}},
		}},
		installed: &release.Release{
			Name: "installed", Namespace: "selected", Version: 1,
			Info: &release.Info{FirstDeployed: helmtime.Date(2026, time.November, 1, 10, 0, 0, 123, time.UTC), Status: release.StatusDeployed},
			Chart: &chart.Chart{
				Metadata: &chart.Metadata{Name: "fixture", Version: "1.0.0", APIVersion: "v2"},
				Values:   map[string]interface{}{"default": "chart-default"},
			},
			Config: map[string]interface{}{"marker": "original"},
		},
	}
	fixture.store(t, fixture.installed, "original-storage-uid")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if request.Method != http.MethodGet {
			fixture.mutations.Add(1)
			http.Error(w, "unexpected mutation", http.StatusInternalServerError)
			return
		}
		current := fixture.current.Load()
		switch {
		case request.URL.Path == "/version":
			fmt.Fprint(w, `{"major":"1","minor":"35","gitVersion":"v1.35.0"}`)
		case request.URL.Path == "/api/v1/namespaces/selected/secrets" && strings.Contains(request.Header.Get("Accept"), "as=PartialObjectMetadataList"):
			json.NewEncoder(w).Encode(metav1.PartialObjectMetadataList{
				TypeMeta: metav1.TypeMeta{APIVersion: "meta.k8s.io/v1", Kind: "PartialObjectMetadataList"},
				Items:    []metav1.PartialObjectMetadata{{ObjectMeta: current.metadata}},
			})
		case request.URL.Path == "/api/v1/namespaces/selected/secrets":
			json.NewEncoder(w).Encode(corev1.SecretList{
				TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "SecretList"}, Items: []corev1.Secret{current.secret},
			})
		case request.URL.Path == "/api/v1/namespaces/selected/secrets/"+current.metadata.Name:
			if replacement := fixture.afterRead.Swap(nil); replacement != nil {
				fixture.current.Store(replacement)
			}
			json.NewEncoder(w).Encode(current.secret)
		default:
			http.Error(w, "unexpected Helm action endpoint: "+request.URL.Path, http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	fixture.client = &clients.ClientSet{
		RESTConfig: &rest.Config{Host: server.URL}, HTTPClient: &http.Client{Transport: http.DefaultTransport},
	}
	return fixture
}

func (fixture *helmReleaseActionFixture) store(t *testing.T, rel *release.Release, uid string) {
	t.Helper()
	raw, err := json.Marshal(rel)
	require.NoError(t, err)
	var compressed bytes.Buffer
	compressor := gzip.NewWriter(&compressed)
	_, err = compressor.Write(raw)
	require.NoError(t, err)
	require.NoError(t, compressor.Close())
	metadata := metav1.ObjectMeta{
		Name: fmt.Sprintf("sh.helm.release.v1.%s.v%d", rel.Name, rel.Version), Namespace: rel.Namespace, UID: k8stypes.UID(uid),
		Labels: map[string]string{"owner": "helm", "name": rel.Name, "version": fmt.Sprint(rel.Version), "status": "deployed"},
	}
	fixture.current.Store(&helmActionStoredRelease{metadata: metadata, secret: corev1.Secret{
		TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "Secret"}, ObjectMeta: metadata,
		Type: "helm.sh/release.v1", Data: map[string][]byte{"release": []byte(base64.StdEncoding.EncodeToString(compressed.Bytes()))},
	}})
}

func TestHelmReleaseDraftActionsRejectChangedSource(t *testing.T) {
	for _, actionID := range []string{"get-values", "dry-run-upgrade", "upgrade"} {
		for _, change := range []string{"upgrade", "reinstall", "storage replacement", "missing current evidence"} {
			t.Run(actionID+"/"+change, func(t *testing.T) {
				fixture := newHelmReleaseActionFixture(t)
				record, err := fixture.ancillary.Get(fixture.ctx, fixture.client, resource.GetRequest{Reference: fixture.reference})
				require.NoError(t, err)
				require.NotNil(t, record.SourceRevision)
				replacement := *fixture.installed
				replacement.Info = &release.Info{FirstDeployed: fixture.installed.Info.FirstDeployed, Status: release.StatusDeployed}
				replacement.Config = map[string]interface{}{"marker": "replacement"}
				uid := "replacement-storage-uid"
				switch change {
				case "upgrade":
					replacement.Version = 2
				case "reinstall":
					replacement.Info.FirstDeployed = fixture.installed.Info.FirstDeployed.Add(time.Hour)
				case "missing current evidence":
					uid = ""
					replacement.Info.FirstDeployed = helmtime.Time{}
				}
				fixture.store(t, &replacement, uid)
				input, err := resource.ValueFromNative(map[string]interface{}{
					"expectedSourceRevision": *record.SourceRevision, "all": true,
					"chart": filepath.Join(t.TempDir(), "must-not-load-chart"), "values": map[string]interface{}{"marker": "old-draft"},
				})
				require.NoError(t, err)
				_, err = fixture.ancillary.Action(fixture.ctx, fixture.client, resource.ActionRequest{
					Reference: fixture.reference, Action: actionID, Input: input,
				})
				require.Equal(t, "RESET_REQUIRED", resource.ErrorCode(err), "stale %s must fail before acting on %s: %v", actionID, change, err)
				require.Zero(t, fixture.mutations.Load(), "stale drafts must not reach native mutation")
			})
		}
	}
}

func TestHelmReleaseDraftActionsRequireRevisionEvidence(t *testing.T) {
	for _, actionID := range []string{"dry-run-upgrade", "upgrade"} {
		for _, invalid := range []string{"absent", "empty", "wrong type"} {
			t.Run(actionID+"/"+invalid, func(t *testing.T) {
				params := map[string]interface{}{"chart": "must-not-load-chart"}
				switch invalid {
				case "empty":
					params["expectedSourceRevision"] = ""
				case "wrong type":
					params["expectedSourceRevision"] = true
				}
				input, err := resource.ValueFromNative(params)
				require.NoError(t, err)
				_, err = NewHelmAncillary(zap.NewNop().Sugar()).Action(context.Background(), nil, resource.ActionRequest{
					Reference: resource.ResourceReference{Address: resource.ResourceAddress{
						Type: ReleaseType, ID: "installed", Scope: []resource.ScopeEntry{{Dimension: "namespace", Value: "selected"}},
					}},
					Action: actionID, Input: input,
				})
				require.Equal(t, "INVALID_REQUEST", resource.ErrorCode(err), "invalid revision must fail before native acquisition: %v", err)
			})
		}
	}
}

func TestHelmReleaseValuesKeepCurrentDraftSource(t *testing.T) {
	fixture := newHelmReleaseActionFixture(t)
	record, err := fixture.ancillary.Get(fixture.ctx, fixture.client, resource.GetRequest{Reference: fixture.reference})
	require.NoError(t, err)
	require.NotNil(t, record.SourceRevision)
	input, err := resource.ValueFromNative(map[string]interface{}{"all": true, "expectedSourceRevision": *record.SourceRevision})
	require.NoError(t, err)
	value, err := fixture.ancillary.Action(fixture.ctx, fixture.client, resource.ActionRequest{
		Reference: fixture.reference, Action: "get-values", Input: input,
	})
	require.NoError(t, err)
	native, err := resource.NativeFromValue(value)
	require.NoError(t, err)
	require.Equal(t, map[string]interface{}{"marker": "original", "default": "chart-default"}, native.(map[string]interface{})["data"].(map[string]interface{})["values"])
	require.Zero(t, fixture.mutations.Load())
}

func TestHelmReleaseValuesRejectReplacementDuringRead(t *testing.T) {
	fixture := newHelmReleaseActionFixture(t)
	record, err := fixture.ancillary.Get(fixture.ctx, fixture.client, resource.GetRequest{Reference: fixture.reference})
	require.NoError(t, err)
	require.NotNil(t, record.SourceRevision)
	original := fixture.current.Load()
	replacement := *fixture.installed
	replacement.Config = map[string]interface{}{"marker": "replacement"}
	fixture.store(t, &replacement, "replacement-storage-uid")
	fixture.afterRead.Store(fixture.current.Load())
	fixture.current.Store(original)
	input, err := resource.ValueFromNative(map[string]interface{}{"all": true, "expectedSourceRevision": *record.SourceRevision})
	require.NoError(t, err)
	_, err = fixture.ancillary.Action(fixture.ctx, fixture.client, resource.ActionRequest{
		Reference: fixture.reference, Action: "get-values", Input: input,
	})
	require.Equal(t, "RESET_REQUIRED", resource.ErrorCode(err), "a replacement during values loading must retire the load: %v", err)
	require.Zero(t, fixture.mutations.Load())
}

func TestHelmReleaseValuesRemainReadableWithoutGenerationEvidence(t *testing.T) {
	fixture := newHelmReleaseActionFixture(t)
	unversioned := *fixture.installed
	unversioned.Info = &release.Info{Status: release.StatusDeployed}
	fixture.store(t, &unversioned, "")
	value, err := fixture.ancillary.Action(fixture.ctx, fixture.client, resource.ActionRequest{
		Reference: fixture.reference, Action: "get-values", Input: resource.Value{Kind: "map"},
	})
	require.NoError(t, err)
	require.Equal(t, "original", value.Map["data"].Map["values"].Map["marker"].String)
	require.Zero(t, fixture.mutations.Load())
}

func TestHelmReleaseUpgradeActionsKeepCurrentSource(t *testing.T) {
	for _, actionID := range []string{"dry-run-upgrade", "upgrade"} {
		t.Run(actionID, func(t *testing.T) {
			t.Setenv("HELM_DRIVER", "memory")
			memory := driver.NewMemory()
			memory.SetNamespace("selected")
			cfg := &action.Configuration{
				Releases: storage.Init(memory), KubeClient: &kubefake.PrintingKubeClient{Out: io.Discard},
				Capabilities: chartutil.DefaultCapabilities, Log: func(string, ...interface{}) {},
			}
			ch := &chart.Chart{
				Metadata:  &chart.Metadata{Name: "fixture", Version: "1.0.0", APIVersion: "v2"},
				Values:    map[string]interface{}{},
				Templates: []*chart.File{{Name: "templates/configmap.yaml", Data: []byte("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: fixture\ndata:\n  marker: {{ .Values.marker | quote }}\n")}},
			}
			installed := &release.Release{
				Name: "installed", Namespace: "selected", Version: 1, Chart: ch,
				Info:   &release.Info{FirstDeployed: helmtime.Date(2026, time.November, 1, 10, 0, 0, 123, time.UTC), Status: release.StatusDeployed},
				Config: map[string]interface{}{"marker": "original"},
			}
			require.NoError(t, cfg.Releases.Create(installed))
			snapshot, err := getNamedRelease(context.Background(), nil, cfg, "selected", "installed", nil)
			require.NoError(t, err)
			require.NotNil(t, snapshot.sourceRevision())
			directory := t.TempDir()
			require.NoError(t, chartutil.SaveDir(ch, directory))
			input, err := resource.ValueFromNative(map[string]interface{}{
				"chart": filepath.Join(directory, "fixture"), "reuse_values": true,
				"values": map[string]interface{}{"marker": "current-draft"}, "expectedSourceRevision": *snapshot.sourceRevision(),
			})
			require.NoError(t, err)
			request := resource.ActionRequest{
				Reference: resource.ResourceReference{Address: resource.ResourceAddress{
					Type: ReleaseType, ID: "installed", Scope: []resource.ScopeEntry{{Dimension: "namespace", Value: "selected"}},
				}},
				Action: actionID, Input: input,
			}
			r := NewReleaseResourcer(zap.NewNop().Sugar())
			var value resource.Value
			if actionID == "upgrade" {
				value, err = r.executeUpgrade(context.Background(), nil, cfg, request, snapshot)
			} else {
				value, err = r.executeDryRunUpgrade(context.Background(), nil, cfg, request, snapshot)
			}
			require.NoError(t, err)
			require.True(t, value.Map["success"].Bool)
			current, err := cfg.Releases.Last(installed.Name)
			require.NoError(t, err)
			if actionID == "upgrade" {
				require.Equal(t, 2, current.Version)
				require.Equal(t, "current-draft", current.Config["marker"])
			} else {
				require.Equal(t, 1, current.Version)
				require.Equal(t, "original", current.Config["marker"])
				require.Contains(t, value.Map["data"].Map["manifest"].String, "current-draft")
			}
		})
	}
}

func TestHelmReleaseUpgradeActionsRecheckAfterChartAcquisition(t *testing.T) {
	for _, actionID := range []string{"dry-run-upgrade", "upgrade"} {
		t.Run(actionID, func(t *testing.T) {
			fixture := newHelmReleaseActionFixture(t)
			repositoryDirectory := t.TempDir()
			repositoryConfig := filepath.Join(repositoryDirectory, "repositories.yaml")
			t.Setenv("HELM_REPOSITORY_CACHE", repositoryDirectory)
			t.Setenv("HELM_REPOSITORY_CONFIG", repositoryConfig)
			require.NoError(t, os.WriteFile(repositoryConfig, []byte("apiVersion: v1\nrepositories: []\n"), 0600))
			record, err := fixture.ancillary.Get(fixture.ctx, fixture.client, resource.GetRequest{Reference: fixture.reference})
			require.NoError(t, err)
			require.NotNil(t, record.SourceRevision)
			original := fixture.current.Load()
			fixture.store(t, fixture.installed, "replacement-storage-uid")
			replacement := fixture.current.Load()
			fixture.current.Store(original)
			archive, err := chartutil.Save(fixture.installed.Chart, t.TempDir())
			require.NoError(t, err)
			chartBytes, err := os.ReadFile(archive)
			require.NoError(t, err)
			var downloads atomic.Int64
			chartServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				downloads.Add(1)
				fixture.current.Store(replacement)
				w.Header().Set("Content-Type", "application/gzip")
				w.Write(chartBytes)
			}))
			t.Cleanup(chartServer.Close)
			input, err := resource.ValueFromNative(map[string]interface{}{
				"chart": chartServer.URL + "/fixture-1.0.0.tgz", "expectedSourceRevision": *record.SourceRevision,
				"values": map[string]interface{}{"marker": "old-draft"},
			})
			require.NoError(t, err)
			_, err = fixture.ancillary.Action(fixture.ctx, fixture.client, resource.ActionRequest{
				Reference: fixture.reference, Action: actionID, Input: input,
			})
			require.Equal(t, "RESET_REQUIRED", resource.ErrorCode(err), "replacement during chart acquisition must fail before Helm runs: %v", err)
			require.EqualValues(t, 1, downloads.Load())
			require.Zero(t, fixture.mutations.Load())
		})
	}
}
