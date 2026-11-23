package main

// Launching the real plugin binary exactly as the Omniview host does (go-plugin, the SDK handshake, AutoMTLS, the
// broker multiplexed on the process listener, the SDK's dial options), with a throwaway HOME. Adapted from the earlier
// proof harness (sdk3-k8s-proof-out hack/zz-proof/harness/plugin.go); it dispenses "exec" as well.

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/hashicorp/go-hclog"
	goplugin "github.com/hashicorp/go-plugin"
	"google.golang.org/grpc"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	ep "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	lp "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	mp "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	np "github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	sp "github.com/omniviewdev/plugin-sdk/pkg/v1/settings"
	tp "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

// pluginID is the id the plugin is installed under; it is also the magic cookie value.
const pluginID = "kubernetes"

type launchOpts struct {
	Name         string
	Binary       string
	PluginYAML   string
	Kubeconfig   string
	Dir          string // scratch directory (HOME, state, logs); must not exist
	LogLevel     string
	StartTimeout time.Duration
	ExtraEnv     []string
}

// plugin is a running plugin process and its dispensed capabilities.
type plugin struct {
	Name       string
	Dir        string
	Home       string
	Binary     string
	Launched   time.Time
	Ready      time.Time
	StderrPath string
	HostLog    string

	Client   *goplugin.Client
	RPC      goplugin.ClientProtocol
	Conn     *grpc.ClientConn
	Resource *resourceplugin.Client
	Exec     *ep.PluginClient
	V2       ep.Client

	stderr *stampWriter
	hostFD *os.File
	once   sync.Once
}

func launch(opts launchOpts) (*plugin, error) {
	if opts.StartTimeout == 0 {
		opts.StartTimeout = 30 * time.Second
	}
	dir, err := filepath.Abs(opts.Dir)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(dir); err == nil {
		return nil, fmt.Errorf("scratch dir %s exists", dir)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	// The SDK refuses a state directory that is not absolute and symlink-free.
	if dir, err = filepath.EvalSymlinks(dir); err != nil {
		return nil, err
	}
	home := filepath.Join(dir, "home")
	state := filepath.Join(home, ".omniview")
	pluginDir := filepath.Join(state, "plugins", pluginID)
	for _, d := range []string{filepath.Join(home, ".kube"), pluginDir} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return nil, err
		}
	}
	if err := copyFile(opts.Kubeconfig, filepath.Join(home, ".kube", "config"), 0o600); err != nil {
		return nil, fmt.Errorf("kubeconfig: %w", err)
	}
	if err := copyFile(opts.PluginYAML, filepath.Join(pluginDir, "plugin.yaml"), 0o600); err != nil {
		return nil, fmt.Errorf("plugin.yaml: %w", err)
	}
	binary, err := filepath.Abs(opts.Binary)
	if err != nil {
		return nil, err
	}

	// The host's child environment (internal/instance Profile.ChildEnvironment): the host's own environment plus
	// GOWORK=off and the OMNIVIEW_* identity of the instance. HOME is the scratch one, KUBECONFIG is dropped (the plugin
	// reads only $HOME/.kube/config), the OTLP variables are dropped as the host does.
	var env []string
	for _, e := range os.Environ() {
		k, _, _ := strings.Cut(e, "=")
		switch {
		case k == "HOME", k == "KUBECONFIG", k == "GOWORK", k == "OMNIVIEW_PLUGIN_LOG_LEVEL", strings.HasPrefix(k, "KPROOF_"),
			strings.HasPrefix(k, "OMNIVIEW_"), strings.HasPrefix(k, "OTEL_EXPORTER_OTLP_"):
			continue
		}
		env = append(env, e)
	}
	env = append(env,
		"HOME="+home,
		"GOWORK=off",
		"OMNIVIEW_STATE_DIR="+state,
		"OMNIVIEW_INSTANCE_ID="+uuid.NewString(),
		"OMNIVIEW_GENERATION="+uuid.NewString(),
		"OMNIVIEW_WORKSPACE_ID=",
		"OMNIVIEW_PLUGIN_ID="+pluginID,
	)
	if opts.LogLevel != "" {
		env = append(env, sdk.LogLevelEnvironment+"="+opts.LogLevel)
	}
	env = append(env, opts.ExtraEnv...)

	p := &plugin{Name: opts.Name, Dir: dir, Home: home, Binary: binary, Launched: time.Now(),
		StderrPath: filepath.Join(dir, "plugin-stderr.log"), HostLog: filepath.Join(dir, "go-plugin-hclog.log")}
	errFD, err := os.Create(p.StderrPath)
	if err != nil {
		return nil, err
	}
	p.stderr = &stampWriter{w: errFD, closer: errFD}
	if p.hostFD, err = os.Create(p.HostLog); err != nil {
		return nil, err
	}

	meta := config.PluginMeta{ID: pluginID}
	cmd := exec.CommandContext(context.Background(), binary)
	cmd.Env = env
	p.Client = goplugin.NewClient(&goplugin.ClientConfig{
		HandshakeConfig: meta.GenerateHandshakeConfig(),
		VersionedPlugins: map[int]goplugin.PluginSet{
			1: {
				"resource":  &resourceplugin.GRPCPlugin{},
				"exec":      &ep.Plugin{Plugin: nil, Impl: nil},
				"networker": &np.Plugin{Plugin: nil, Impl: nil},
				"log":       &lp.Plugin{Plugin: nil, Impl: nil},
				"metric":    &mp.Plugin{Plugin: nil, Impl: nil},
				"settings":  &sp.SettingsPlugin{Plugin: nil, Impl: nil},
				"tools":     &tp.Plugin{Plugin: nil, Impl: nil},
				"lifecycle": &lc.Plugin{Plugin: nil, Impl: nil},
			},
		},
		GRPCBrokerMultiplex: true,
		AutoMTLS:            true,
		GRPCDialOptions:     sdk.GRPCDialOptions(),
		Cmd:                 cmd,
		SkipHostEnv:         true,
		StartTimeout:        opts.StartTimeout,
		AllowedProtocols:    []goplugin.Protocol{goplugin.ProtocolGRPC},
		Stderr:              p.stderr,
		Logger: hclog.New(&hclog.LoggerOptions{
			Name:   pluginID,
			Output: p.hostFD,
			Level:  hclog.Debug,
		}),
	})
	rpc, err := p.Client.Client()
	if err != nil {
		p.Client.Kill()
		p.closeFiles()
		return nil, fmt.Errorf("launch %s: %w", opts.Name, err)
	}
	p.RPC = rpc
	gc, ok := rpc.(*goplugin.GRPCClient)
	if !ok {
		p.Client.Kill()
		p.closeFiles()
		return nil, fmt.Errorf("launch %s: client is %T, not a gRPC client", opts.Name, rpc)
	}
	p.Conn = gc.Conn
	rawRes, err := rpc.Dispense("resource")
	if err != nil {
		p.close()
		return nil, fmt.Errorf("dispense resource: %w", err)
	}
	if p.Resource, ok = rawRes.(*resourceplugin.Client); !ok {
		p.close()
		return nil, fmt.Errorf("resource capability is %T", rawRes)
	}
	rawExec, err := rpc.Dispense("exec")
	if err != nil {
		p.close()
		return nil, fmt.Errorf("dispense exec: %w", err)
	}
	if p.Exec, ok = rawExec.(*ep.PluginClient); !ok {
		p.close()
		return nil, fmt.Errorf("exec capability is %T", rawExec)
	}
	p.V2 = p.Exec.V2()
	p.Ready = time.Now()
	return p, nil
}

// close kills the plugin process (the host's Kill) and closes the files. Safe to call twice.
func (p *plugin) close() {
	p.once.Do(func() {
		if p.Client != nil {
			p.Client.Kill()
		}
		p.closeFiles()
	})
}

func (p *plugin) closeFiles() {
	if p.stderr != nil {
		p.stderr.Close()
	}
	if p.hostFD != nil {
		_ = p.hostFD.Close()
	}
}

// resourceSession is the resource session metadata the host attaches to a plugin call.
func resourceSession() resourcev2.Session {
	return resourcev2.Session{RequestID: uuid.NewString(), RequesterID: "kproof"}
}

// sctx returns ctx carrying a resource session, as a host call does.
func sctx(ctx context.Context) context.Context {
	return resourcev2.WithSession(ctx, resourceSession())
}

func copyFile(src, dst string, mode os.FileMode) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, mode)
}

// stampWriter writes every complete line it is given with a RFC3339Nano prefix of the harness clock.
type stampWriter struct {
	mu     sync.Mutex
	w      io.Writer
	closer io.Closer
	buf    bytes.Buffer
}

func (s *stampWriter) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.buf.Write(p)
	for {
		i := bytes.IndexByte(s.buf.Bytes(), '\n')
		if i < 0 {
			break
		}
		line := s.buf.Next(i + 1)
		if _, err := fmt.Fprintf(s.w, "%s | %s", time.Now().UTC().Format("2006-01-02T15:04:05.000000Z"), line); err != nil {
			return len(p), err
		}
	}
	return len(p), nil
}

func (s *stampWriter) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.buf.Len() > 0 {
		_, _ = fmt.Fprintf(s.w, "%s | %s\n", time.Now().UTC().Format("2006-01-02T15:04:05.000000Z"), s.buf.String())
		s.buf.Reset()
	}
	if s.closer != nil {
		_ = s.closer.Close()
		s.closer = nil
	}
}
