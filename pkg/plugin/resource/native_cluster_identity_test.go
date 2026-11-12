package resource

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

const kubeSystemPath = "/api/v1/namespaces/kube-system"

func respondNamespace(uid string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"kind":"Namespace","apiVersion":"v1","metadata":{"name":"kube-system","uid":%q}}`, uid)
	}
}

type identityFixture struct {
	*refreshHTTPFixture
	provider   *kubernetesProvider
	client     *clients.ClientSet
	ctx        context.Context
	connection sdktypes.Connection
}

// serveIdentity answers the kube-system Namespace GET with handler and every
// other path with the fixture's discovery documents.
func (f *refreshHTTPFixture) serveIdentity(handler func(http.ResponseWriter, *http.Request)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hook = func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path != kubeSystemPath {
			return false
		}
		handler(w, r)
		return true
	}
}

// newIdentityFixture prepares a connection whose cluster identity is read over
// HTTP from the fixture, so its failures are real transport and status errors.
func newIdentityFixture(t *testing.T, serve func(http.ResponseWriter, *http.Request)) *identityFixture {
	t.Helper()
	f, client := newRefreshHTTPFixture(t)
	kube, err := kubernetes.NewForConfig(&rest.Config{Host: f.url})
	require.NoError(t, err)
	dyn, err := dynamic.NewForConfig(&rest.Config{Host: f.url})
	require.NoError(t, err)
	client.KubeClient, client.DynamicClient = kube, dyn
	f.serveIdentity(serve)
	ctx, connection := refreshTestContext("identity")
	i := &identityFixture{refreshHTTPFixture: f, provider: refreshTestProvider(), client: client, ctx: ctx, connection: connection}
	t.Cleanup(func() { i.provider.retireNativeCatalog(connection.ID) })
	return i
}

func (i *identityFixture) start() error {
	return i.provider.startNativeConnection(i.ctx, i.connection, i.client)
}

func (i *identityFixture) check() error {
	status, err := i.provider.checkConnection(i.ctx, i.connection, i.client)
	if err == nil && status.Status != sdktypes.ConnectionStatusConnected {
		return fmt.Errorf("connection status %s", status.Status)
	}
	return err
}

func (i *identityFixture) hint() *resourcev2.NativeAuthorityHint {
	return i.provider.catalogs[i.connection.ID].identityHint
}

func TestNativeStartReadsIdentityThroughTransientFailures(t *testing.T) {
	recorder := recordRetries(t, 3)
	var gets atomic.Int64
	i := newIdentityFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if gets.Add(1) == 1 {
			respondUnavailable(w, r)
			return
		}
		respondNamespace("uid-1")(w, r)
	})
	require.NoError(t, i.start())
	require.EqualValues(t, 2, gets.Load())
	require.Equal(t, 1, recorder.count())
	require.NotNil(t, i.hint(), "a recovered read still yields the identity hint")
	require.Equal(t, "uid-1", i.hint().ID)
}

func TestNativeStartFailsRetryablyWhenIdentityStaysUnreadable(t *testing.T) {
	recordRetries(t, 3)
	i := newIdentityFixture(t, respondUnavailable)
	err := i.start()
	require.Error(t, err)
	require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(err), "retryable, not an identity change")
	require.True(t, k8serrors.IsServiceUnavailable(err), "the cause stays inspectable: %v", err)
	require.Equal(t, 3, i.count(kubeSystemPath))
	require.NotContains(t, i.provider.catalogs, i.connection.ID, "a catalog without the hint must not be published as if identity were unknown")
}

func TestNativeCheckConnectionDistinguishesUnreadableFromChangedIdentity(t *testing.T) {
	forbidden := respondStatus(http.StatusForbidden, metav1.StatusReasonForbidden)
	unauthorized := respondStatus(http.StatusUnauthorized, metav1.StatusReasonUnauthorized)
	for _, tc := range []struct {
		name  string
		serve func(http.ResponseWriter, *http.Request)
		code  string // "" means the check passes
		gets  int
	}{
		{"same identity", respondNamespace("uid-1"), "", 1},
		{"different identity", respondNamespace("uid-2"), "RESET_REQUIRED", 1},
		{"503", respondUnavailable, "UNAVAILABLE", 3},
		{"429", respondTooManyRequests, "UNAVAILABLE", 3},
		{"500", respondServerError, "UNAVAILABLE", 3},
		// Losing permission to read the UID keeps today's documented result.
		{"forbidden", forbidden, "RESET_REQUIRED", 1},
		{"unauthorized", unauthorized, "RESET_REQUIRED", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recordRetries(t, 3)
			i := newIdentityFixture(t, respondNamespace("uid-1"))
			require.NoError(t, i.start())
			require.Equal(t, "uid-1", i.hint().ID)
			i.serveIdentity(tc.serve)
			before := i.count(kubeSystemPath)
			err := i.check()
			if tc.code == "" {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
				require.Equal(t, tc.code, resourcev2.ErrorCode(err), "%v", err)
			}
			require.Equal(t, tc.gets, i.count(kubeSystemPath)-before)
			require.Equal(t, "uid-1", i.hint().ID, "a failed check never replaces the stored hint")
			i.serveIdentity(respondNamespace("uid-1"))
			require.NoError(t, i.check(), "the connection recovers on the next check")
		})
	}
}

// client-go retries an EOF or reset on a typed GET by itself, after a pause of
// at least a second, so the plugin's own retry is exercised with a failure
// client-go leaves to the caller.
func TestNativeCheckConnectionRetriesHandshakeTimeout(t *testing.T) {
	recorder := recordRetries(t, 3)
	i := newIdentityFixture(t, respondNamespace("uid-1"))
	require.NoError(t, i.start())
	var faults atomic.Int64
	kube, err := kubernetes.NewForConfig(&rest.Config{
		Host: i.url,
		WrapTransport: func(base http.RoundTripper) http.RoundTripper {
			return faultTransport{base: base, fail: func(r *http.Request) error {
				if r.URL.Path == kubeSystemPath && faults.Add(1) == 1 {
					return fakeTimeoutError{"net/http: TLS handshake timeout"}
				}
				return nil
			}}
		},
	})
	require.NoError(t, err)
	i.client.KubeClient = kube
	require.NoError(t, i.check())
	require.EqualValues(t, 2, faults.Load())
	require.Equal(t, 1, recorder.count())
}

func TestNativeCheckConnectionWithoutHintDoesNotReadIdentity(t *testing.T) {
	recordRetries(t, 3)
	i := newIdentityFixture(t, respondStatus(http.StatusForbidden, metav1.StatusReasonForbidden))
	require.NoError(t, i.start())
	require.Nil(t, i.hint(), "an unreadable UID at start leaves the identity unknown")
	i.serveIdentity(respondUnavailable)
	before := i.count(kubeSystemPath)
	require.NoError(t, i.check(), "nothing to compare, so an unreadable identity cannot fail the check")
	require.Equal(t, before, i.count(kubeSystemPath), "no identity request without a stored hint")
}

func TestNativeRefreshKeepsStoredHintWhenIdentityIsUnreadable(t *testing.T) {
	recordRetries(t, 3)
	i := newIdentityFixture(t, respondNamespace("uid-1"))
	require.NoError(t, i.start())
	original := i.provider.catalogs[i.connection.ID]
	refresh := func() error {
		expireRefresh(i.provider, i.connection.ID)
		return i.provider.refreshNativeCatalog(i.ctx, i.connection.ID, i.client)
	}

	i.serveIdentity(respondUnavailable)
	err := refresh()
	require.Error(t, err)
	require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(err), "unreadable is retryable, not RESET_REQUIRED")
	require.Same(t, original, i.provider.catalogs[i.connection.ID], "the installed snapshot and its hint are kept")

	i.serveIdentity(respondNamespace("uid-2"))
	err = refresh()
	require.Error(t, err)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err), "a UID that was read and differs still requires a reconnect")
	require.Same(t, original, i.provider.catalogs[i.connection.ID])

	i.serveIdentity(respondNamespace("uid-1"))
	require.NoError(t, refresh())
	require.Equal(t, "uid-1", i.hint().ID)
}

func TestNativeClusterIdentityPreservesDocumentedUnknownCases(t *testing.T) {
	recordRetries(t, 3)
	for name, serve := range map[string]func(http.ResponseWriter, *http.Request){
		"forbidden":    respondStatus(http.StatusForbidden, metav1.StatusReasonForbidden),
		"unauthorized": respondStatus(http.StatusUnauthorized, metav1.StatusReasonUnauthorized),
		"not found":    respondStatus(http.StatusNotFound, metav1.StatusReasonNotFound),
		"empty uid":    respondNamespace(""),
	} {
		t.Run(name, func(t *testing.T) {
			i := newIdentityFixture(t, serve)
			identity, err := nativeClusterIdentity(i.ctx, i.client.KubeClient)
			require.NoError(t, err)
			require.Nil(t, identity, "permission or data gaps leave the identity unknown")
			require.Equal(t, 1, i.count(kubeSystemPath), "and are not retried")
		})
	}
	t.Run("canceled", func(t *testing.T) {
		i := newIdentityFixture(t, respondNamespace("uid-1"))
		ctx, cancel := context.WithCancel(i.ctx)
		cancel()
		_, err := nativeClusterIdentity(ctx, i.client.KubeClient)
		require.True(t, errors.Is(err, context.Canceled))
	})
}
