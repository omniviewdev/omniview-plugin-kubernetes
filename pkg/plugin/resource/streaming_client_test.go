package resource

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
)

func TestGenerationStreamingClientReturnsBeforeEOFAndRetires(t *testing.T) {
	for _, emitting := range []bool{false, true} {
		for _, retirement := range []bool{false, true} {
			t.Run(fmt.Sprintf("emitting=%v/retirement=%v", emitting, retirement), func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				serverStopped := make(chan struct{})
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path != "/api/v1/namespaces/team/pods/pod/log" {
						http.NotFound(w, r)
						return
					}
					w.Header().Set("Content-Type", "text/plain")
					w.WriteHeader(http.StatusOK)
					w.(http.Flusher).Flush()
					if emitting {
						_, _ = io.WriteString(w, "first\n")
						w.(http.Flusher).Flush()
					}
					<-r.Context().Done()
					close(serverStopped)
				}))
				defer server.Close()
				path := filepath.Join(t.TempDir(), "config")
				require.NoError(t, os.WriteFile(path, []byte(fmt.Sprintf("apiVersion: v1\nkind: Config\nclusters:\n- name: cluster\n  cluster:\n    server: %s\ncontexts:\n- name: owned\n  context:\n    cluster: cluster\n    user: user\ncurrent-context: owned\nusers:\n- name: user\n  user: {}\n", server.URL)), 0600))
				connection := types.Connection{ID: "owned", Data: map[string]interface{}{"kubeconfig": path}}
				owner := &kubeConnectionProvider{}
				destroyed := make(chan struct{})
				controller, err := resourcev2.NewController(resourcev2.Config[clients.ClientSet]{
					Catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
						return resourcev2.Catalog{}, nil
					},
					Lifecycle: &resourcev2.Lifecycle[clients.ClientSet]{
						LoadConnections: func(context.Context) ([]types.Connection, error) { return []types.Connection{connection}, nil },
						CreateClient: func(native context.Context, _ types.Connection) (*clients.ClientSet, error) {
							return owner.CreateClient(native)
						},
						DestroyClient: func(native context.Context, client *clients.ClientSet) error {
							defer close(destroyed)
							return owner.DestroyClient(native, client)
						},
					},
				})
				require.NoError(t, err)
				defer controller.Close()
				_, err = controller.LoadConnections(ctx)
				require.NoError(t, err)
				_, err = controller.StartConnection(ctx, connection.ID)
				require.NoError(t, err)
				provider := &kubernetesProvider{Controller: controller}
				request, cancelRequest := context.WithCancel(ctx)
				defer cancelRequest()
				opened := make(chan io.ReadCloser, 1)
				finished := make(chan error, 1)
				go func() {
					finished <- provider.withStreamingClient(request, resourcev2.AccessRoute{Connection: connection.ID}, func(native context.Context, client *kubernetes.Clientset) error {
						body, err := client.CoreV1().Pods("team").GetLogs("pod", &corev1.PodLogOptions{Follow: true}).Stream(native)
						if err != nil {
							return err
						}
						defer body.Close()
						opened <- body
						<-native.Done()
						return nil
					})
				}()
				var body io.ReadCloser
				select {
				case body = <-opened:
				case err := <-finished:
					t.Fatalf("stream failed before ready: %v", err)
				case <-ctx.Done():
					t.Fatal("stream did not return after headers")
				}
				if emitting {
					line := make([]byte, len("first\n"))
					_, err = io.ReadFull(body, line)
					require.NoError(t, err)
					require.Equal(t, "first\n", string(line))
				}
				readDone := make(chan error, 1)
				go func() { _, err := body.Read(make([]byte, 1)); readDone <- err }()
				if retirement {
					_, err = controller.StopConnection(ctx, connection.ID)
					require.NoError(t, err)
				} else {
					cancelRequest()
				}
				select {
				case err := <-readDone:
					require.Error(t, err)
				case <-ctx.Done():
					t.Fatal("stream read survived lease cancellation")
				}
				select {
				case <-finished:
				case <-ctx.Done():
					t.Fatal("stream lease was not released")
				}
				select {
				case <-serverStopped:
				case <-ctx.Done():
					t.Fatal("native HTTP stream survived cancellation")
				}
				if retirement {
					select {
					case <-destroyed:
					case <-ctx.Done():
						t.Fatal("generation client was not destroyed")
					}
				}
			})
		}
	}
}
