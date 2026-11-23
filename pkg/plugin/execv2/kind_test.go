package execv2

// Tests against a real cluster, skipped unless KPROOF_KUBECONFIG names a kubeconfig whose context KPROOF_CONTEXT has a Pod
// kproof/quiet with a running container "main" (the K-proof's fixtures on kind). They call podExec as the SDK does, with a
// Proc whose connection is that context, and say what client-go gave and what the provider made of it.

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"os"
	osexec "os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/connid"
	"github.com/omniview/kubernetes/pkg/utils"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// kindPod is the Pod of the session; a test that needs a Pod of its own sets it.
var kindPod = "quiet"

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// kindSession is one command in the Pod of the fixtures, with the pipes the SDK would give it.
type kindSession struct {
	proc           *exec.Proc
	input          *os.File
	stdout, stderr *syncBuffer
	resize         chan exec.Size
}

// kindKubeconfig, when set, is the kubeconfig the sessions use instead of KPROOF_KUBECONFIG (a copy that goes through a
// proxy), and kindDeadline bounds a session.
var (
	kindKubeconfig string
	kindDeadline   = 60 * time.Second
)

func kindSetup(t *testing.T, argv []string, tty bool, size exec.Size) (*kindSession, context.Context) {
	t.Helper()
	kubeconfig := os.Getenv("KPROOF_KUBECONFIG")
	if kubeconfig == "" {
		t.Skip("KPROOF_KUBECONFIG is not set")
	}
	if kindKubeconfig != "" {
		kubeconfig = kindKubeconfig
	}
	ctx, cancel := context.WithTimeout(context.Background(), kindDeadline)
	t.Cleanup(cancel)
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reader.Close(); _ = writer.Close() })
	s := &kindSession{input: writer, stdout: &syncBuffer{}, stderr: &syncBuffer{}, resize: make(chan exec.Size, 8)}
	connection := &types.Connection{ID: "kproof", Data: map[string]any{"kubeconfig": kubeconfig, connid.DataKeyContext: os.Getenv("KPROOF_CONTEXT")}}
	ref := podRef()
	ref.Address.ID, ref.Address.Scope[0].Value = kindPod, "kproof"
	s.proc = &exec.Proc{
		Context: &types.PluginContext{Context: ctx, Connection: connection},
		Request: exec.Request{Ref: ref, Argv: argv, TTY: tty, Size: size, Selection: map[string]string{"container": "main"}},
		Stdin:   reader, Stdout: s.stdout, Resize: s.resize,
		Started: func(exec.SessionFacts) {}, Link: func(exec.LinkState) {},
	}
	if !tty {
		s.proc.Stderr = s.stderr
	}
	if !size.IsZero() {
		s.resize <- size
	}
	return s, ctx
}

func (s *kindSession) run(ctx context.Context) (exec.Exit, error) {
	exit, err := podExec(ctx, s.proc)
	close(s.resize)
	return exit, err
}

// What a real API server relays for a command that ends by itself: its own status, and for a status of 0 the nil that
// client-go cannot tell from an empty channel.
func TestKindEnds(t *testing.T) {
	for _, tc := range []struct {
		argv []string
		code int64 // -1: no code
	}{
		{[]string{"sh", "-c", "exit 3"}, 3},
		{[]string{"sh", "-c", "exit 0"}, 0},
		{[]string{"sh", "-c", "kill -9 $$"}, 137},
		{[]string{"sh", "-c", "echo out; echo err >&2"}, 0},
	} {
		s, ctx := kindSetup(t, tc.argv, false, exec.Size{})
		_ = s.input.Close()
		exit, err := s.run(ctx)
		t.Logf("%q: exit %+v err %v stdout %q stderr %q", tc.argv, describe(exit), err, s.stdout.String(), s.stderr.String())
		want := tc.code
		if want == 0 && os.Getenv("KPROOF_EXECUTOR") != "own" && os.Getenv("KPROOF_NIL") == "" {
			want = -1 // nil: client-go cannot say whether the status was Success
		}
		if err != nil || (want >= 0 && code(exit) != want) || (want < 0 && exit.Lost != exec.LostNoStatus) {
			t.Errorf("%q: exit = %+v, err = %v, want code %d", tc.argv, exit, err, want)
		}
	}
	s, ctx := kindSetup(t, []string{"sh", "-c", "echo out; echo err >&2"}, false, exec.Size{})
	_ = s.input.Close()
	if _, err := s.run(ctx); err != nil || s.stdout.String() != "out\n" || s.stderr.String() != "err\n" {
		t.Errorf("stdout %q stderr %q err %v, want the two streams apart", s.stdout.String(), s.stderr.String(), err)
	}
}

// A terminal: the size at open is what the first command sees, a resize changes it, and the exit code is relayed.
func TestKindTerminal(t *testing.T) {
	s, ctx := kindSetup(t, []string{"/bin/sh"}, true, exec.Size{Cols: 100, Rows: 30})
	done := make(chan exec.Exit, 1)
	go func() { exit, _ := s.run(ctx); done <- exit }()
	send := func(text string) { _, _ = s.input.WriteString(text) }
	await := func(want string) {
		t.Helper()
		for deadline := time.Now().Add(20 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
			if strings.Contains(s.stdout.String(), want) {
				return
			}
		}
		t.Fatalf("no %q in %q", want, s.stdout.String())
	}
	send("stty size\n")
	await("30 100")
	s.resize <- exec.Size{Cols: 120, Rows: 40}
	time.Sleep(500 * time.Millisecond)
	send("stty size\n")
	await("40 120")
	send("exit 3\n")
	select {
	case exit := <-done:
		t.Logf("exit %+v", describe(exit))
		if code(exit) != 3 || exit.Source != exec.SourceProcess {
			t.Errorf("exit = %+v, want ExitCode(3)", exit)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("the shell did not end")
	}
}

// kindNode is the docker container of the cluster's node, and sh runs a command with the cluster's kubectl and docker.
const kindNode = "kproof-exec-v2-control-plane"

func sh(t *testing.T, stdin, command string) string {
	t.Helper()
	cmd := osexec.Command("sh", "-c", command)
	cmd.Env = append(os.Environ(), "KUBECONFIG="+os.Getenv("KPROOF_KUBECONFIG"))
	cmd.Stdin = strings.NewReader(stdin)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%s: %v: %s", command, err, out)
	}
	return strings.TrimSpace(string(out))
}

// What the end of a session is when the container or the Pod goes away under it: the probes of the K-proof (the log is the
// result). Each runs in a Pod of its own, and the fault comes a second after the command started.
func TestKindFaults(t *testing.T) {
	if os.Getenv("KPROOF_KUBECONFIG") == "" {
		t.Skip("KPROOF_KUBECONFIG is not set")
	}
	faults := map[string]func(t *testing.T, pod string){
		"kill-container-init": func(t *testing.T, pod string) {
			id := sh(t, "", "docker exec "+kindNode+" crictl ps -q --name main --label io.kubernetes.pod.name="+pod)
			pid := sh(t, "", "docker exec "+kindNode+" crictl inspect --output go-template --template '{{.info.pid}}' "+id)
			sh(t, "", "docker exec "+kindNode+" kill -9 "+pid)
		},
		"delete-force": func(t *testing.T, pod string) {
			sh(t, "", "kubectl -n kproof delete pod "+pod+" --force --grace-period=0 --wait=false")
		},
		"delete-graceful": func(t *testing.T, pod string) {
			sh(t, "", "kubectl -n kproof delete pod "+pod+" --wait=false")
		},
		"kubelet-restart": func(t *testing.T, pod string) {
			sh(t, "", "docker exec "+kindNode+" systemctl restart kubelet")
			t.Cleanup(func() {
				sh(t, "", "kubectl wait --for=condition=Ready node/"+kindNode+" --timeout=120s && kubectl -n kproof wait --for=condition=Ready pod/"+pod+" --timeout=120s")
			})
		},
	}
	for name, fault := range faults {
		for _, tty := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/tty=%v", name, tty), func(t *testing.T) {
				pod := fmt.Sprintf("lead-%s-%v", name, tty)
				sh(t, "apiVersion: v1\nkind: Pod\nmetadata: {name: "+pod+", namespace: kproof}\nspec:\n  terminationGracePeriodSeconds: 1\n  containers:\n  - {name: main, image: 'busybox:1.37.0', imagePullPolicy: IfNotPresent, command: [sleep, '3600']}\n",
					"kubectl apply -f - && kubectl -n kproof wait --for=condition=Ready pod/"+pod+" --timeout=90s")
				t.Cleanup(func() {
					sh(t, "", "kubectl -n kproof delete pod "+pod+" --force --grace-period=0 --ignore-not-found --wait=false")
				})
				previous := kindPod
				kindPod = pod
				t.Cleanup(func() { kindPod = previous })
				argv := []string{"sleep", "600"}
				size := exec.Size{}
				if tty {
					argv, size = []string{"/bin/sh"}, exec.Size{Cols: 80, Rows: 24}
				}
				s, ctx := kindSetup(t, argv, tty, size)
				began := time.Now()
				done := make(chan struct{})
				var exit exec.Exit
				var err error
				go func() { exit, err = s.run(ctx); close(done) }()
				time.Sleep(1500 * time.Millisecond)
				faulted := time.Now()
				fault(t, pod)
				select {
				case <-done:
					t.Logf("%s tty=%v: ended %v after the fault (%v after start): exit %+v, err %v, stdout %q", name, tty, time.Since(faulted).Round(time.Millisecond), time.Since(began).Round(time.Millisecond), describe(exit), err, s.stdout.String())
					// Does the command still run in the container? (The Pod is gone after a delete: the answer is then an error.)
					var out []byte
					var psErr error
					for attempt := 0; attempt < 12; attempt++ {
						cmd := osexec.Command("kubectl", "-n", "kproof", "exec", pod, "-c", "main", "--", "ps", "-o", "pid,args")
						cmd.Env = append(os.Environ(), "KUBECONFIG="+os.Getenv("KPROOF_KUBECONFIG"))
						if out, psErr = cmd.CombinedOutput(); psErr == nil {
							break
						}
						time.Sleep(2 * time.Second)
					}
					t.Logf("%s tty=%v: ps in the container after the end (err %v):\n%s", name, tty, psErr, out)
				case <-time.After(45 * time.Second):
					t.Errorf("%s tty=%v: the session did not end within 45s of the fault", name, tty)
				}
			})
		}
	}
}

// What ending a session (the SDK cancels the function's context) does to the process in the container: the probe of the
// Kill capability. The command is a marker a second `sleep` of its own length can be told from.
func TestKindCancel(t *testing.T) {
	if os.Getenv("KPROOF_KUBECONFIG") == "" {
		t.Skip("KPROOF_KUBECONFIG is not set")
	}
	pod := "lead-cancel"
	sh(t, "apiVersion: v1\nkind: Pod\nmetadata: {name: "+pod+", namespace: kproof}\nspec:\n  terminationGracePeriodSeconds: 1\n  containers:\n  - {name: main, image: 'busybox:1.37.0', imagePullPolicy: IfNotPresent, command: [sleep, '3600']}\n",
		"kubectl apply -f - && kubectl -n kproof wait --for=condition=Ready pod/"+pod+" --timeout=90s")
	t.Cleanup(func() {
		sh(t, "", "kubectl -n kproof delete pod "+pod+" --force --grace-period=0 --ignore-not-found --wait=false")
	})
	previous := kindPod
	kindPod = pod
	t.Cleanup(func() { kindPod = previous })
	for _, tty := range []bool{false, true} {
		argv, size := []string{"sleep", "601"}, exec.Size{}
		if tty {
			argv, size = []string{"/bin/sh", "-c", "sleep 602; echo done"}, exec.Size{Cols: 80, Rows: 24}
		}
		s, ctx := kindSetup(t, argv, tty, size)
		cancelCtx, cancel := context.WithCancel(ctx)
		done := make(chan struct{})
		var exit exec.Exit
		var err error
		go func() { exit, err = s.run(cancelCtx); close(done) }()
		time.Sleep(1500 * time.Millisecond)
		cancel()
		<-done
		t.Logf("tty=%v: cancelled: exit %+v, err %v", tty, describe(exit), err)
		for _, wait := range []time.Duration{0, 3 * time.Second, 10 * time.Second} {
			time.Sleep(wait)
			cmd := osexec.Command("kubectl", "-n", "kproof", "exec", kindPod, "-c", "main", "--", "ps", "-o", "pid,args")
			cmd.Env = append(os.Environ(), "KUBECONFIG="+os.Getenv("KPROOF_KUBECONFIG"))
			out, psErr := cmd.CombinedOutput()
			t.Logf("tty=%v: %v after the cancel, ps (err %v):\n%s", tty, wait, psErr, out)
		}
	}
}

// tcpProxy forwards TCP to the API server and can drop every connection it holds: closed (FIN), reset (RST), or kept open
// and silent (a blackhole, which only client-go's heartbeat can find out).
type tcpProxy struct {
	listener  net.Listener
	upstream  string
	mu        sync.Mutex
	conns     []*net.TCPConn
	blackhole atomic.Bool
}

func newTCPProxy(t *testing.T, upstream string) *tcpProxy {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := &tcpProxy{listener: listener, upstream: upstream}
	t.Cleanup(func() { _ = listener.Close(); p.drop(false) })
	go func() {
		for {
			client, err := listener.Accept()
			if err != nil {
				return
			}
			server, err := net.Dial("tcp", upstream)
			if err != nil {
				_ = client.Close()
				continue
			}
			c, s := client.(*net.TCPConn), server.(*net.TCPConn)
			p.mu.Lock()
			p.conns = append(p.conns, c, s)
			p.mu.Unlock()
			go p.pump(c, s)
			go p.pump(s, c)
		}
	}()
	return p
}

func (p *tcpProxy) pump(from, to *net.TCPConn) {
	buf := make([]byte, 32*1024)
	for {
		n, err := from.Read(buf)
		if n > 0 && !p.blackhole.Load() {
			if _, werr := to.Write(buf[:n]); werr != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}

// drop closes every connection: with a reset when reset is set.
func (p *tcpProxy) drop(reset bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, c := range p.conns {
		if reset {
			_ = c.SetLinger(0)
		}
		_ = c.Close()
	}
	p.conns = nil
}

// What the end of a session is when the connection to the API server breaks under it: the probes of the K-proof.
func TestKindDrops(t *testing.T) {
	if os.Getenv("KPROOF_KUBECONFIG") == "" {
		t.Skip("KPROOF_KUBECONFIG is not set")
	}
	pod := "lead-drops"
	sh(t, "apiVersion: v1\nkind: Pod\nmetadata: {name: "+pod+", namespace: kproof}\nspec:\n  terminationGracePeriodSeconds: 1\n  containers:\n  - {name: main, image: 'busybox:1.37.0', imagePullPolicy: IfNotPresent, command: [sleep, '3600']}\n",
		"kubectl apply -f - && kubectl -n kproof wait --for=condition=Ready pod/"+pod+" --timeout=90s")
	t.Cleanup(func() {
		sh(t, "", "kubectl -n kproof delete pod "+pod+" --force --grace-period=0 --ignore-not-found --wait=false")
	})
	server := sh(t, "", "kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}'")
	proxy := newTCPProxy(t, strings.TrimPrefix(server, "https://"))
	config := strings.ReplaceAll(sh(t, "", "kubectl config view --minify --raw"), server, "https://"+proxy.listener.Addr().String())
	path := filepath.Join(t.TempDir(), "kubeconfig")
	if err := os.WriteFile(path, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	previous, previousDeadline := kindKubeconfig, kindDeadline
	kindKubeconfig, kindDeadline = path, 200*time.Second
	t.Cleanup(func() { kindKubeconfig, kindDeadline = previous, previousDeadline })
	kindPod = pod
	t.Cleanup(func() { kindPod = "quiet" })

	modes := []string{"fin", "rst"}
	if os.Getenv("KPROOF_SLOW") != "" {
		modes = append(modes, "blackhole")
	}
	for _, mode := range modes {
		for _, tty := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/tty=%v", mode, tty), func(t *testing.T) {
				argv, size := []string{"sleep", "600"}, exec.Size{}
				if tty {
					argv, size = []string{"/bin/sh"}, exec.Size{Cols: 80, Rows: 24}
				}
				s, ctx := kindSetup(t, argv, tty, size)
				done := make(chan struct{})
				var exit exec.Exit
				var err error
				go func() { exit, err = s.run(ctx); close(done) }()
				time.Sleep(1500 * time.Millisecond)
				faulted := time.Now()
				switch mode {
				case "fin":
					proxy.drop(false)
				case "rst":
					proxy.drop(true)
				case "blackhole":
					proxy.blackhole.Store(true)
					t.Cleanup(func() { proxy.blackhole.Store(false) })
				}
				select {
				case <-done:
					t.Logf("%s tty=%v: ended %v after the fault: exit %+v, err %v", mode, tty, time.Since(faulted).Round(time.Millisecond), describe(exit), err)
				case <-time.After(150 * time.Second):
					t.Errorf("%s tty=%v: the session did not end within 150s of the fault", mode, tty)
				}
				proxy.blackhole.Store(false)
			})
		}
	}
}

// Attach: the container's own process, with a terminal. What the end of an attach is when that process exits, and what a
// container without stdin does to a request for it.
func TestKindAttach(t *testing.T) {
	if os.Getenv("KPROOF_KUBECONFIG") == "" {
		t.Skip("KPROOF_KUBECONFIG is not set")
	}
	for _, tc := range []struct{ pod, spec string }{
		{"lead-attach", "command: [sh]\n    stdin: true\n    tty: true"},
		{"lead-nostdin", "command: [sleep, '3600']"},
	} {
		sh(t, "apiVersion: v1\nkind: Pod\nmetadata: {name: "+tc.pod+", namespace: kproof}\nspec:\n  terminationGracePeriodSeconds: 1\n  restartPolicy: Never\n  containers:\n  - name: main\n    image: busybox:1.37.0\n    imagePullPolicy: IfNotPresent\n    "+tc.spec+"\n",
			"kubectl apply -f - && kubectl -n kproof wait --for=condition=Ready pod/"+tc.pod+" --timeout=90s")
		pod := tc.pod
		t.Cleanup(func() {
			sh(t, "", "kubectl -n kproof delete pod "+pod+" --force --grace-period=0 --ignore-not-found --wait=false")
		})
	}
	for _, pod := range []string{"lead-attach", "lead-nostdin"} {
		previous := kindPod
		kindPod = pod
		s, ctx := kindSetup(t, nil, true, exec.Size{Cols: 90, Rows: 20})
		s.proc.Request.Selection["mode"] = modeAttach
		done := make(chan struct{})
		var exit exec.Exit
		var err error
		go func() { exit, err = s.run(ctx); close(done) }()
		time.Sleep(1500 * time.Millisecond)
		_, _ = s.input.WriteString("echo attached; exit 5\n")
		select {
		case <-done:
			t.Logf("%s: attach ended: exit %+v, err %v, stdout %q", pod, describe(exit), err, s.stdout.String())
		case <-time.After(8 * time.Second):
			t.Logf("%s: attach still open after 8s: stdout %q", pod, s.stdout.String())
		}
		kindPod = previous
	}
}

// What the provider itself costs a session, before the SDK and the transport: building the connection's clients (every
// Options call and every exec does it), the Options callback, and a whole non-terminal command to its end.
func TestKindLatency(t *testing.T) {
	if os.Getenv("KPROOF_KUBECONFIG") == "" {
		t.Skip("KPROOF_KUBECONFIG is not set")
	}
	median := func(label string, run func()) {
		samples := make([]time.Duration, 20)
		for i := range samples {
			began := time.Now()
			run()
			samples[i] = time.Since(began)
		}
		sort.Slice(samples, func(a, b int) bool { return samples[a] < samples[b] })
		t.Logf("%-34s median %v  p95 %v  min %v", label, samples[len(samples)/2], samples[len(samples)*95/100], samples[0])
	}
	s, _ := kindSetup(t, []string{"true"}, false, exec.Size{})
	pc := s.proc.Context
	median("KubeClientsFromContext", func() {
		if _, err := utils.KubeClientsFromContext(pc); err != nil {
			t.Fatal(err)
		}
	})
	median("podOptions (clients + GET pod)", func() {
		if _, err := podOptions(pc, s.proc.Request.Ref); err != nil {
			t.Fatal(err)
		}
	})
	median("exec 'true' end to end (provider)", func() {
		s, ctx := kindSetup(t, []string{"true"}, false, exec.Size{})
		_ = s.input.Close()
		if _, err := s.run(ctx); err != nil {
			t.Fatal(err)
		}
	})
}
