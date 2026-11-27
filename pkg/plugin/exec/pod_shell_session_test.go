package exec

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/transport"
	"k8s.io/streaming/pkg/httpstream/wsstream"
)

func TestPodShellAdmitsOnlyEstablishedGenerationBoundStream(t *testing.T) {
	for _, scenario := range []string{"admitted", "replaced during upgrade", "denied upgrade", "unsupported transport"} {
		t.Run(scenario, func(t *testing.T) {
			var reads, upgrades atomic.Int32
			releaseServer := make(chan struct{})
			input := make(chan string, 1)
			const path = "/bound/api/v1/namespaces/debug-test/pods/app"
			srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer bound-principal" {
					t.Error("request did not use the current generation's auth wrapper")
					http.Error(w, "denied", http.StatusForbidden)
					return
				}
				switch r.URL.Path {
				case path:
					p := shellTargetFixture()
					if reads.Add(1) == 2 && scenario == "replaced during upgrade" {
						p.Status.ContainerStatuses[0].ContainerID = "runtime://replacement"
					}
					w.Header().Set("Content-Type", "application/json")
					if err := json.NewEncoder(w).Encode(p); err != nil {
						t.Errorf("write Pod: %v", err)
					}
				case path + "/exec":
					upgrades.Add(1)
					if r.URL.Query().Get("command") != podDefaultShell || r.URL.Query().Get("container") != "app" || r.URL.Query().Get("tty") != "true" {
						t.Error("unexpected Pod exec target")
					}
					if scenario == "denied upgrade" {
						http.Error(w, "denied", http.StatusForbidden)
						return
					}
					conn := wsstream.NewConn(map[string]wsstream.ChannelProtocolConfig{"v5.channel.k8s.io": {Binary: true, Channels: []wsstream.ChannelType{
						wsstream.ReadChannel, wsstream.WriteChannel, wsstream.IgnoreChannel, wsstream.WriteChannel, wsstream.ReadChannel,
					}}})
					_, streams, err := conn.Open(w, r)
					if err != nil {
						t.Errorf("open remotecommand streams: %v", err)
						return
					}
					defer func() { _ = conn.Close() }() // The client may already have cancelled the upgrade.
					if scenario == "replaced during upgrade" {
						_, _ = streams[1].Write([]byte("output from replacement"))
					}
					data, _ := io.ReadAll(streams[0])
					input <- string(data)
					<-releaseServer
				default:
					t.Errorf("unexpected path %s", r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			t.Cleanup(srv.Close)
			t.Cleanup(func() { close(releaseServer) })
			cfg := &rest.Config{Host: srv.URL + "/bound", QPS: -1, TLSClientConfig: rest.TLSClientConfig{Insecure: true}}
			cfg.Wrap(func(rt http.RoundTripper) http.RoundTripper {
				return transport.NewBearerAuthRoundTripper("bound-principal", rt)
			})
			kube, err := kubernetes.NewForConfig(cfg)
			require.NoError(t, err)
			if scenario == "unsupported transport" {
				cfg.Transport = http.DefaultTransport
			}
			generation, retire := context.WithCancel(t.Context())
			t.Cleanup(retire)
			released := make(chan struct{})
			borrow := func(_ context.Context, route resourcev2.AccessRoute, use func(context.Context, *clients.ClientSet) error) error {
				defer close(released)
				if route.Connection != "test" {
					t.Errorf("unexpected route %q", route.Connection)
				}
				return use(generation, &clients.ClientSet{Clientset: kube, StreamingClientset: kube, RESTConfig: cfg})
			}
			file, err := os.CreateTemp(t.TempDir(), "terminal")
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, file.Close()) })
			const stagedInput = "typed input\n"
			_, err = io.WriteString(file, stagedInput)
			require.NoError(t, err)
			_, err = file.Seek(0, io.SeekStart)
			require.NoError(t, err)
			pc := testPluginContext() // disk profile is unavailable, not the authority for this launch
			pc.Context = t.Context()
			stop := make(chan error, 1)
			err = podExecHandler(borrow).TTYHandler(pc, podShellOptionsFixture(), file, stop, nil)
			switch scenario {
			case "unsupported transport":
				require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(err))
				require.Zero(t, reads.Load())
				require.Zero(t, upgrades.Load())
			case "denied upgrade":
				require.Error(t, err)
				require.EqualValues(t, 1, reads.Load())
				require.Positive(t, upgrades.Load())
			default:
				require.EqualValues(t, 2, reads.Load())
				require.EqualValues(t, 1, upgrades.Load())
				wantInput := stagedInput
				if scenario == "admitted" {
					require.NoError(t, err)
					select {
					case <-released:
						t.Fatal("released generation while its Pod shell was live")
					default:
					}
				} else {
					require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
					wantInput = ""
				}
				select {
				case data := <-input:
					require.Equal(t, wantInput, data)
				case <-time.After(2 * time.Second):
					t.Fatal("native input stream did not close")
				}
				contents, err := os.ReadFile(file.Name())
				require.NoError(t, err)
				require.Equal(t, stagedInput, string(contents), "unverified remote output must never reach the terminal")
			}
			retire()
			select {
			case <-released:
			case <-time.After(2 * time.Second):
				t.Fatal("leased Pod shell outlived its generation")
			}
		})
	}
}
