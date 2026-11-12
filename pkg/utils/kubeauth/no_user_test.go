package kubeauth

import (
	"context"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// authorizationRecorder is an API server double that answers the requests the
// auth tests make and remembers the Authorization header of every request.
type authorizationRecorder struct {
	mu     sync.Mutex
	values []string
}

func (r *authorizationRecorder) handler(w http.ResponseWriter, req *http.Request) {
	r.mu.Lock()
	r.values = append(r.values, req.Header.Get("Authorization"))
	r.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch req.URL.Path {
	case "/version":
		io.WriteString(w, `{"major":"1","minor":"31","gitVersion":"v1.31.0"}`)
	case "/api/v1/namespaces/ns/pods/one":
		io.WriteString(w, `{"apiVersion":"v1","kind":"Pod","metadata":{"name":"one","namespace":"ns"}}`)
	default:
		http.Error(w, `{"kind":"Status","apiVersion":"v1","status":"Failure","code":404}`, http.StatusNotFound)
	}
}

func (r *authorizationRecorder) seen() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.values...)
}

func TestLoadClients_ContextWithoutUser(t *testing.T) {
	loaders := map[string]func(context.Context, string, string) (*KubeClientBundle, error){
		"LoadKubeClients":         LoadKubeClients,
		"LoadResourceKubeClients": LoadResourceKubeClients,
	}
	for loaderName, load := range loaders {
		for userName, contextUser := range map[string]string{"empty user": "", "user missing from list": "ghost"} {
			t.Run(loaderName+"/"+userName, func(t *testing.T) {
				recorder := &authorizationRecorder{}
				server := httptest.NewServer(http.HandlerFunc(recorder.handler))
				defer server.Close()
				path := writeContextOnlyKubeconfig(t, server.URL, contextUser)

				bundle, err := load(context.Background(), path, "test-context")
				require.NoError(t, err)

				version, err := bundle.Discovery.ServerVersion()
				require.NoError(t, err)
				assert.Equal(t, "v1.31.0", version.GitVersion)
				seen := recorder.seen()
				require.NotEmpty(t, seen)
				for _, authorization := range seen {
					assert.Empty(t, authorization, "an anonymous context must send no credentials")
				}
			})
		}
	}
}

// writeTLSKubeconfig writes a kubeconfig that trusts the server's certificate
// through certificate-authority-data and has the given users. The only context
// names contextUser as its user.
func writeTLSKubeconfig(t *testing.T, server *httptest.Server, users map[string]*clientcmdapi.AuthInfo, contextUser string) string {
	t.Helper()

	cfg := clientcmdapi.NewConfig()
	cfg.Clusters["test-cluster"] = &clientcmdapi.Cluster{
		Server:                   server.URL,
		CertificateAuthorityData: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}),
	}
	for name, info := range users {
		cfg.AuthInfos[name] = info
	}
	cfg.Contexts["test-context"] = &clientcmdapi.Context{Cluster: "test-cluster", AuthInfo: contextUser}
	cfg.CurrentContext = "test-context"

	path := filepath.Join(t.TempDir(), "kubeconfig")
	require.NoError(t, clientcmd.WriteToFile(*cfg, path))
	return path
}

// A kubeconfig that is no longer an EKS exec user by the time the EKS strategy
// builds its config (edited between detection and build) must fall back to the
// default loader, and the clients it returns must be real default clients that
// trust the cluster CA and send the user's credentials.
func TestEKSAuthStrategy_NonExecUserFallsBackToDefaultClients(t *testing.T) {
	cases := map[string]struct {
		users       map[string]*clientcmdapi.AuthInfo
		contextUser string
		wantAuth    string
	}{
		"empty user":             {contextUser: ""},
		"user missing from list": {contextUser: "ghost"},
		"user without exec": {
			users:       map[string]*clientcmdapi.AuthInfo{"static": {Token: "static-token"}},
			contextUser: "static",
			wantAuth:    "Bearer static-token",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			recorder := &authorizationRecorder{}
			server := httptest.NewTLSServer(http.HandlerFunc(recorder.handler))
			defer server.Close()
			path := writeTLSKubeconfig(t, server, tc.users, tc.contextUser)

			strategy := &EKSAuthStrategy{}
			config, err := strategy.BuildRestConfig(context.Background(), path, "test-context")
			require.NoError(t, err)
			require.True(t, strategy.useDefault)

			clientset, err := strategy.NewForConfig(config)
			require.NoError(t, err)
			dynamicClient, err := strategy.NewDynamicForConfig(config)
			require.NoError(t, err)
			discoveryClient, err := strategy.NewDiscoveryForConfig(config)
			require.NoError(t, err)

			_, err = clientset.Discovery().ServerVersion()
			require.NoError(t, err)
			_, err = discoveryClient.ServerVersion()
			require.NoError(t, err)
			pod, err := dynamicClient.Resource(schema.GroupVersionResource{Version: "v1", Resource: "pods"}).
				Namespace("ns").Get(context.Background(), "one", metav1.GetOptions{})
			require.NoError(t, err)
			assert.Equal(t, "one", pod.GetName())

			seen := recorder.seen()
			require.Len(t, seen, 3)
			for _, authorization := range seen {
				assert.Equal(t, tc.wantAuth, authorization)
			}
		})
	}
}
