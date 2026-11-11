package helm

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/lib/pq"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/settings"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage/driver"
	helmtime "helm.sh/helm/v3/pkg/time"
	"k8s.io/client-go/rest"
)

func TestHelmSQLNamedReadCancelsConnectionStartup(t *testing.T) {
	for _, ending := range []string{"cancel", "deadline"} {
		t.Run(ending, func(t *testing.T) {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			require.NoError(t, err)
			t.Cleanup(func() { _ = listener.Close() })
			accepted := make(chan net.Conn, 1)
			entered, disconnected := make(chan struct{}), make(chan struct{})
			go func() {
				connection, acceptErr := listener.Accept()
				if acceptErr != nil {
					return
				}
				defer connection.Close()
				accepted <- connection
				// Accept the PostgreSQL startup packet but never send its reply.
				var startup [1024]byte
				if _, readErr := connection.Read(startup[:]); readErr != nil {
					return
				}
				close(entered)
				_, _ = io.Copy(io.Discard, connection)
				close(disconnected)
			}()
			t.Setenv("HELM_DRIVER", "sql")
			t.Setenv("HELM_DRIVER_SQL_CONNECTION_STRING", "postgres://fixture@"+listener.Addr().String()+"/helm?sslmode=disable")
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprint(w, `{"major":"1","minor":"35","gitVersion":"v1.35.0"}`)
			}))
			t.Cleanup(server.Close)
			client := &clients.ClientSet{RESTConfig: &rest.Config{Host: server.URL}, HTTPClient: &http.Client{Transport: http.DefaultTransport}}
			base, finish := context.WithTimeout(context.Background(), 10*time.Second)
			t.Cleanup(finish)
			operationCtx, cancel := context.WithCancel(base)
			want := context.Canceled
			if ending == "deadline" {
				cancel()
				operationCtx, cancel = context.WithTimeout(base, 2*time.Second)
				want = context.DeadlineExceeded
			}
			operationCtx = resource.WithSession(operationCtx, resource.Session{Connection: &types.Connection{ID: "startup-fixture"}})
			target := resource.AuxiliarySchemaTarget{
				Key: "values",
				Reference: resource.ResourceReference{Address: resource.ResourceAddress{
					Provider: "kubernetes", Authority: "fixture-authority", Type: ReleaseType, ID: "installed",
					Scope: []resource.ScopeEntry{{Dimension: "namespace", Value: "selected"}},
				}},
			}
			done := make(chan error, 1)
			returned := false
			var connection net.Conn
			t.Cleanup(func() {
				cancel()
				if connection != nil {
					_ = connection.Close()
				}
				_ = listener.Close()
				if !returned {
					select {
					case <-done:
					case <-time.After(time.Second):
						t.Error("SQL connection survived startup cleanup")
					}
				}
			})
			go func() {
				_, operationErr := NewReleaseResourcer(zap.NewNop().Sugar()).ResolveSchema(operationCtx, client, target)
				done <- operationErr
			}()
			select {
			case connection = <-accepted:
			case <-base.Done():
				t.Fatal("Helm did not open the SQL connection")
			}
			select {
			case <-entered:
			case <-base.Done():
				t.Fatal("Helm did not send the PostgreSQL startup packet")
			}
			if ending == "cancel" {
				cancel()
			}
			select {
			case err := <-done:
				returned = true
				require.ErrorIs(t, err, want)
			case <-time.After(3 * time.Second):
				t.Fatal("request cancellation did not close the stalled PostgreSQL startup connection")
			}
			select {
			case <-disconnected:
			case <-time.After(time.Second):
				t.Fatal("canceled startup left its SQL socket connected")
			}
		})
	}
}

// These integration tests opt in with HELM_SQL_TEST_DSN. They use actual Helm SQL
// migrations, PostgreSQL table locks, and pg_stat_activity, not a mock SQL driver.
// The database user must be able to create schemas and roles in a disposable DB.
func TestHelmSQLNamedReadCancelsBlockedQueries(t *testing.T) {
	for _, phase := range []string{"schema acquisition", "initial named read", "custom labels", "current verification"} {
		for _, ending := range []string{"cancel", "deadline", "acquisition policy"} {
			if ending == "acquisition policy" && phase != "schema acquisition" {
				continue
			}
			t.Run(phase+"/"+ending, func(t *testing.T) {
				fixture := newHelmSQLFixture(t)
				snapshot, err := getNamedRelease(fixture.ctx, fixture.client, fixture.cfg, "selected", "installed", nil)
				require.NoError(t, err)

				lock, err := fixture.db.BeginTx(fixture.ctx, nil)
				require.NoError(t, err)
				tables := "releases_v1"
				if phase == "schema acquisition" {
					// Old configuration acquisition blocks on migrations before it can
					// read the release. Named-read configuration must avoid migrations.
					tables += ", gorp_migrations"
				} else if phase == "custom labels" {
					tables = "custom_labels_v1"
				}
				_, err = lock.ExecContext(fixture.ctx, "LOCK TABLE "+tables+" IN ACCESS EXCLUSIVE MODE")
				require.NoError(t, err)

				operationCtx, cancel := context.WithCancel(fixture.ctx)
				want := context.Canceled
				if ending == "deadline" {
					cancel()
					operationCtx, cancel = context.WithTimeout(fixture.ctx, 2*time.Second)
					want = context.DeadlineExceeded
				}
				if ending == "acquisition policy" {
					setting := resource.ConnectionAcquisitionTimeoutSetting()
					provider := settings.NewProvider(settings.ProviderOpts{
						Logger: zap.NewNop().Sugar(), PluginID: "sql-fixture",
						PluginSettings: []settings.Category{{ID: "plugin", Settings: map[string]settings.Setting{setting.ID: setting}}},
					})
					require.NoError(t, provider.SetSetting(setting.ID, float64(1)))
					session, _ := resource.SessionFromContext(operationCtx)
					session.PluginConfig = provider
					operationCtx = resource.WithSession(operationCtx, session)
					want = context.DeadlineExceeded
				}
				done := make(chan error, 1)
				returned := false
				t.Cleanup(func() {
					cancel()
					_ = lock.Rollback()
					if !returned {
						select {
						case <-done:
						case <-time.After(5 * time.Second):
							t.Error("blocked SQL worker survived lock cleanup")
						}
					}
				})
				go func() {
					var operationErr error
					switch phase {
					case "schema acquisition":
						if ending == "acquisition policy" {
							_, operationErr = NewHelmAncillary(zap.NewNop().Sugar()).ResolveSchema(operationCtx, fixture.client, resource.SchemaRequest{
								Route: resource.AccessRoute{Connection: "sql-fixture"}, Type: ReleaseType,
								Target: resource.SchemaTarget{Auxiliary: &fixture.target},
							})
						} else {
							_, operationErr = NewReleaseResourcer(zap.NewNop().Sugar()).ResolveSchema(operationCtx, fixture.client, fixture.target)
						}
					case "current verification":
						operationErr = snapshot.verifyCurrent(operationCtx, fixture.client, fixture.cfg)
					default:
						_, operationErr = getNamedRelease(operationCtx, fixture.client, fixture.cfg, "selected", "installed", nil)
					}
					done <- operationErr
				}()

				require.Eventually(t, func() bool {
					return fixture.activeQueries(t, true) == 1
				}, time.Second, 10*time.Millisecond, "operation must actually block inside PostgreSQL before cancellation")
				require.NoError(t, operationCtx.Err())
				if ending == "cancel" {
					cancel()
				}
				select {
				case err := <-done:
					returned = true
					require.ErrorIs(t, err, want)
				case <-time.After(3 * time.Second):
					t.Fatal("request cancellation did not interrupt the PostgreSQL query while its lock stayed held")
				}
				require.Eventually(t, func() bool {
					return fixture.activeQueries(t, false) == 0
				}, time.Second, 10*time.Millisecond, "returning early must not leave a blocked PostgreSQL query behind")

				require.NoError(t, lock.Rollback())
				current, err := getNamedRelease(fixture.ctx, fixture.client, fixture.cfg, "selected", "installed", snapshot.sourceRevision())
				require.NoError(t, err, "canceled read must not poison another operation using the same native configuration")
				require.Equal(t, snapshot.sourceRevision(), current.sourceRevision())
			})
		}
	}
}

func TestHelmSQLNamedReadPreservesIdentityAndAuthorization(t *testing.T) {
	fixture := newHelmSQLFixture(t)
	first, err := getNamedRelease(fixture.ctx, fixture.client, fixture.cfg, "selected", "installed", nil)
	require.NoError(t, err)
	require.NotNil(t, first.sourceRevision())
	require.Equal(t, "selected-label", first.release.Labels["source"])

	other := *fixture.installed
	other.Namespace, other.Version = "other", 99
	require.NoError(t, fixture.cfg.Releases.Create(&other))
	upgraded := *fixture.installed
	upgraded.Version = 2
	upgraded.Chart = &chart.Chart{Schema: []byte(`{"type":"object","properties":{"next":{"type":"integer"}}}`)}
	require.NoError(t, fixture.cfg.Releases.Create(&upgraded))
	foreignOwner := *fixture.installed
	foreignOwner.Version = 100
	require.NoError(t, fixture.cfg.Releases.Create(&foreignOwner))
	_, err = fixture.db.ExecContext(fixture.ctx, "UPDATE releases_v1 SET owner = 'not-helm' WHERE version = 100")
	require.NoError(t, err)
	_, err = fixture.db.ExecContext(fixture.ctx, "INSERT INTO releases_v1 SELECT 'unrelated-key', type, 'invalid-body', 'unrelated', namespace, 101, status, owner, createdAt, modifiedAt FROM releases_v1 WHERE name = 'installed' AND namespace = 'selected' AND version = 1")
	require.NoError(t, err)

	current, err := getNamedRelease(fixture.ctx, fixture.client, fixture.cfg, "selected", "installed", nil)
	require.NoError(t, err)
	require.Equal(t, 2, current.release.Version, "namespace, owner and name must constrain the SQL lookup")
	require.Equal(t, "selected", current.release.Namespace)
	_, err = getNamedRelease(fixture.ctx, fixture.client, fixture.cfg, "selected", "missing", nil)
	require.ErrorIs(t, err, driver.ErrReleaseNotFound)
	_, err = getNamedRelease(fixture.ctx, fixture.client, fixture.cfg, "selected", "installed", first.sourceRevision())
	require.Equal(t, "RESET_REQUIRED", resource.ErrorCode(err))
	require.Equal(t, "RESET_REQUIRED", resource.ErrorCode(first.verifyCurrent(fixture.ctx, fixture.client, fixture.cfg)))

	// A same-name, same-version reinstall must not reuse the old source revision.
	reinstalled := upgraded
	reinstalled.Info = &release.Info{FirstDeployed: fixture.installed.Info.FirstDeployed.Add(time.Hour), Status: release.StatusDeployed}
	require.NoError(t, fixture.cfg.Releases.Update(&reinstalled))
	require.Equal(t, "RESET_REQUIRED", resource.ErrorCode(current.verifyCurrent(fixture.ctx, fixture.client, fixture.cfg)))

	// Give a non-owner role SELECT rights but no permission on Helm's migration
	// table. Named reads must neither bypass RLS nor require migration rights.
	role := fixture.application + "_reader"
	_, err = fixture.db.ExecContext(fixture.ctx, "CREATE ROLE "+pq.QuoteIdentifier(role)+" NOLOGIN")
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := fixture.db.ExecContext(context.Background(), "DROP OWNED BY "+pq.QuoteIdentifier(role))
		require.NoError(t, cleanupErr)
		_, cleanupErr = fixture.db.ExecContext(context.Background(), "DROP ROLE "+pq.QuoteIdentifier(role))
		require.NoError(t, cleanupErr)
	})
	_, err = fixture.db.ExecContext(fixture.ctx, "GRANT USAGE ON SCHEMA "+pq.QuoteIdentifier(fixture.application)+" TO "+pq.QuoteIdentifier(role))
	require.NoError(t, err)
	_, err = fixture.db.ExecContext(fixture.ctx, "CREATE POLICY selected_releases ON releases_v1 FOR SELECT TO "+pq.QuoteIdentifier(role)+" USING (namespace = 'selected')")
	require.NoError(t, err)
	_, err = fixture.db.ExecContext(fixture.ctx, "CREATE POLICY selected_labels ON custom_labels_v1 FOR SELECT TO "+pq.QuoteIdentifier(role)+" USING (releaseNamespace = 'selected')")
	require.NoError(t, err)
	t.Setenv("HELM_DRIVER_SQL_CONNECTION_STRING", helmSQLTestDSN(fixture.dsn, map[string]string{"role": role}))
	ancillary := NewHelmAncillary(zap.NewNop().Sugar())
	allowed, err := ancillary.Get(fixture.ctx, fixture.client, resource.GetRequest{Reference: fixture.target.Reference})
	require.NoError(t, err, "named reads must work with SELECT-only RLS credentials")
	require.NotNil(t, allowed.SourceRevision)
	denied := fixture.target.Reference
	denied.Address.Scope = []resource.ScopeEntry{{Dimension: "namespace", Value: "other"}}
	_, err = ancillary.Get(fixture.ctx, fixture.client, resource.GetRequest{Reference: denied})
	require.ErrorIs(t, err, driver.ErrReleaseNotFound, "RLS-hidden releases must stay hidden")
	stillOwned, err := getNamedRelease(fixture.ctx, fixture.client, fixture.cfg, "selected", "installed", nil)
	require.NoError(t, err, "configuration must keep its original SQL identity when environment changes")
	require.Equal(t, 2, stillOwned.release.Version)
}

type helmSQLFixture struct {
	ctx         context.Context
	db          *sql.DB
	cfg         *action.Configuration
	client      *clients.ClientSet
	target      resource.AuxiliarySchemaTarget
	installed   *release.Release
	dsn         string
	application string
}

func newHelmSQLFixture(t *testing.T) *helmSQLFixture {
	t.Helper()
	dsn := os.Getenv("HELM_SQL_TEST_DSN")
	if dsn == "" {
		t.Skip("set HELM_SQL_TEST_DSN to run real PostgreSQL cancellation regressions")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	admin, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, admin.Close()) })
	require.NoError(t, admin.PingContext(ctx))
	application := fmt.Sprintf("helm_context_%d", time.Now().UnixNano())
	_, err = admin.ExecContext(ctx, "CREATE SCHEMA "+pq.QuoteIdentifier(application))
	require.NoError(t, err)
	t.Cleanup(func() {
		cleanupCtx, finish := context.WithTimeout(context.Background(), 5*time.Second)
		defer finish()
		_, cleanupErr := admin.ExecContext(cleanupCtx, "DROP SCHEMA "+pq.QuoteIdentifier(application)+" CASCADE")
		require.NoError(t, cleanupErr)
	})
	scopedDSN := helmSQLTestDSN(dsn, map[string]string{"search_path": application, "application_name": application})
	db, err := sql.Open("postgres", scopedDSN)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	t.Setenv("HELM_DRIVER", "sql")
	t.Setenv("HELM_DRIVER_SQL_CONNECTION_STRING", scopedDSN)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/version" {
			http.Error(w, "unexpected Kubernetes request: "+r.URL.Path, http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"major":"1","minor":"35","gitVersion":"v1.35.0"}`)
	}))
	t.Cleanup(server.Close)
	client := &clients.ClientSet{RESTConfig: &rest.Config{Host: server.URL}, HTTPClient: &http.Client{Transport: http.DefaultTransport}}
	ctx = resource.WithSession(ctx, resource.Session{Connection: &types.Connection{ID: "sql-fixture"}})
	cfg, err := newActionConfig(ctx, client.RESTConfig, client.HTTPClient, "selected")
	require.NoError(t, err)
	installed := &release.Release{
		Name: "installed", Namespace: "selected", Version: 1,
		Info: &release.Info{
			FirstDeployed: helmtime.Date(2026, time.November, 1, 10, 0, 0, 123, time.UTC),
			Status:        release.StatusDeployed,
		},
		Labels: map[string]string{"source": "selected-label"},
		Chart:  &chart.Chart{Schema: []byte(`{"type":"object","properties":{"replicas":{"type":"integer"}}}`)},
	}
	require.NoError(t, cfg.Releases.Create(installed))
	return &helmSQLFixture{
		ctx: ctx, db: db, cfg: cfg, client: client, installed: installed, dsn: scopedDSN, application: application,
		target: resource.AuxiliarySchemaTarget{
			Key: "values",
			Reference: resource.ResourceReference{Address: resource.ResourceAddress{
				Provider: "kubernetes", Authority: "fixture-authority", Type: ReleaseType, ID: "installed",
				Scope: []resource.ScopeEntry{{Dimension: "namespace", Value: "selected"}},
			}},
		},
	}
}

func (fixture *helmSQLFixture) activeQueries(t *testing.T, blockedOnly bool) int {
	t.Helper()
	query := "SELECT count(*) FROM pg_stat_activity WHERE application_name = $1 AND state = 'active' AND pid <> pg_backend_pid()"
	if blockedOnly {
		query += " AND wait_event_type = 'Lock'"
	}
	var count int
	require.NoError(t, fixture.db.QueryRowContext(fixture.ctx, query, fixture.application).Scan(&count))
	return count
}

func helmSQLTestDSN(dsn string, parameters map[string]string) string {
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			panic(err)
		}
		query := parsed.Query()
		for key, value := range parameters {
			query.Set(key, value)
		}
		parsed.RawQuery = query.Encode()
		return parsed.String()
	}
	for key, value := range parameters {
		dsn += " " + key + "='" + strings.ReplaceAll(strings.ReplaceAll(value, `\`, `\\`), "'", `\'`) + "'"
	}
	return dsn
}
