package execv2

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"reflect"
	"testing"

	"github.com/gorilla/websocket"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/remotecommand"
	utilexec "k8s.io/client-go/util/exec"
	"k8s.io/streaming/pkg/httpstream"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec/exectest"
)

type script func(ctx context.Context, opts remotecommand.StreamOptions) error

func (s script) Stream(opts remotecommand.StreamOptions) error { return s(context.Background(), opts) }
func (s script) StreamWithContext(ctx context.Context, opts remotecommand.StreamOptions) error {
	return s(ctx, opts)
}

func podRef() resourcev2.ResourceReference {
	return resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
		Provider: "kubernetes", Type: podType, ID: "web-0",
		Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "shop"}},
	}}
}

// runPod runs podExec in the rig of a Pod command against a cluster whose stream is ws, and returns the rig and what the
// function returned.
func runPod(t *testing.T, req exec.Request, ws remotecommand.Executor) (*exectest.ProcRig, exec.Exit, error) {
	t.Helper()
	previous := newExecutors
	t.Cleanup(func() { newExecutors = previous })
	newExecutors = func(*exec.Proc) (remotecommand.Executor, remotecommand.Executor, error) {
		return ws, script(func(context.Context, remotecommand.StreamOptions) error { return errors.New("spdy was used") }), nil
	}
	if req.Ref.Address.ID == "" {
		req.Ref = podRef()
	}
	if req.Selection == nil {
		req.Selection = map[string]string{"container": "app", "mode": modeExec}
	}
	rig := exectest.NewProcRig(t, req, exectest.RigCapabilities(capabilities()))
	_ = rig.Input().Close() // the host sent no input: a read of Proc.Stdin returns io.EOF at once
	exit, err := rig.Run(context.Background(), podExec)
	return rig, exit, err
}

func code(e exec.Exit) int64 {
	if e.Code == nil {
		return -1
	}
	return *e.Code
}

// The exit status the API relays on its error channel is the command's own, whatever its value, and nothing is inferred
// from its range.
func TestAnExitStatusIsReportedAsTheProcessOwn(t *testing.T) {
	for _, status := range []int{0, 1, 3, 137} {
		_, exit, err := runPod(t, exec.Request{Argv: []string{"sh"}}, script(func(context.Context, remotecommand.StreamOptions) error {
			return fmt.Errorf("wrapped: %w", utilexec.CodeExitError{Err: errors.New("command terminated"), Code: status})
		}))
		if err != nil || code(exit) != int64(status) || exit.Source != exec.SourceProcess || exit.Signal != "" || exit.Lost != exec.LostUnspecified {
			t.Errorf("status %d: exit = %+v, err = %v; want ExitCode(%d)", status, exit, err, status)
		}
	}
}

// client-go returns nil for a Success status and for an error channel that closed empty alike: the end carries no code.
func TestANilEndIsNeverAnExitCode(t *testing.T) {
	for _, mode := range []string{modeExec, modeAttach} {
		_, exit, err := runPod(t, exec.Request{Argv: []string{"sh"}, Selection: map[string]string{"container": "app", "mode": mode}},
			script(func(context.Context, remotecommand.StreamOptions) error { return nil }))
		if err != nil || exit.Code != nil || exit.Lost != exec.LostNoStatus {
			t.Errorf("%s: exit = %+v, err = %v; want ExitLost(LostNoStatus) and nothing else", mode, exit, err)
		}
	}
}

// A stream that breaks while it is read says nothing of the command; a failure to open one is an error for Classify.
func TestExitOfBrokenStreams(t *testing.T) {
	timeout := &net.OpError{Op: "read", Err: os.ErrDeadlineExceeded}
	for name, tc := range map[string]struct {
		err  error
		lost exec.LostCause
		fail bool
	}{
		"close frame":         {err: fmt.Errorf("next reader: %w", &websocket.CloseError{Code: websocket.CloseAbnormalClosure}), lost: exec.LostNoStatus},
		"reset":               {err: fmt.Errorf("next reader: %w", &net.OpError{Op: "read", Err: errors.New("connection reset by peer")}), lost: exec.LostNoStatus},
		"unexpected EOF":      {err: fmt.Errorf("error reading from error stream: %w", io.ErrUnexpectedEOF), lost: exec.LostNoStatus},
		"heartbeat gave up":   {err: fmt.Errorf("next reader: %w", timeout), lost: exec.LostLinkDead},
		"dial":                {err: &net.OpError{Op: "dial", Err: errors.New("connection refused")}, fail: true},
		"runtime text":        {err: errors.New("OCI runtime exec failed"), fail: true},
		"context cancelled":   {err: context.Canceled, fail: true},
		"upgrade failure":     {err: &httpstream.UpgradeFailureError{Cause: errors.New("bad handshake")}, fail: true},
		"status not an exit":  {err: apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "web-0", errors.New("no")), fail: true},
		"error channel error": {err: errors.New("error stream protocol error: unknown error"), fail: true},
	} {
		exit, err := exitOf(tc.err, false)
		switch {
		case tc.fail && (err == nil || exit.Lost != exec.LostUnspecified || exit.Code != nil):
			t.Errorf("%s: exit = %+v, err = %v; want the error and an empty Exit", name, exit, err)
		case !tc.fail && (err != nil || exit.Lost != tc.lost || exit.Code != nil):
			t.Errorf("%s: exit = %+v, err = %v; want ExitLost(%v)", name, exit, err, tc.lost)
		}
	}
}

// A terminal has no Stderr and takes sizes; a command without one has Stderr and no size queue. The input is the session's.
func TestStreamOptionsFollowTheTerminal(t *testing.T) {
	for _, tty := range []bool{true, false} {
		var got remotecommand.StreamOptions
		rig, _, err := runPod(t, exec.Request{Argv: []string{"sh"}, TTY: tty, Size: exec.Size{Cols: 100, Rows: 30}},
			script(func(_ context.Context, opts remotecommand.StreamOptions) error { got = opts; return nil }))
		if err != nil {
			t.Fatal(err)
		}
		proc := rig.Proc()
		if got.Tty != tty || got.Stdin != proc.Stdin || got.Stdout != proc.Stdout || (got.Stderr != nil) == tty || (got.TerminalSizeQueue != nil) != tty {
			t.Errorf("tty %v: options = %+v, want stdin and stdout of the proc, stderr only without a terminal, a size queue only with one", tty, got)
		}
		if tty {
			size := got.TerminalSizeQueue.Next()
			if size == nil || *size != (remotecommand.TerminalSize{Width: 100, Height: 30}) {
				t.Errorf("the first size is %+v, want the size at open: 100x30", size)
			}
		}
	}
}

// A command's output reaches the host on the stream it was written to, and the size queue ends with the command.
func TestOutputAndResizeReachTheStream(t *testing.T) {
	sizes := make(chan *remotecommand.TerminalSize, 4)
	var rig *exectest.ProcRig
	rig, exit, err := runPod(t, exec.Request{Argv: []string{"sh"}}, script(func(_ context.Context, opts remotecommand.StreamOptions) error {
		_, _ = opts.Stdout.Write([]byte("out"))
		_, _ = opts.Stderr.Write([]byte("err"))
		return utilexec.CodeExitError{Err: errors.New("x"), Code: 3}
	}))
	_ = sizes
	if err != nil || code(exit) != 3 || string(rig.Stdout()) != "out" || string(rig.Stderr()) != "err" {
		t.Errorf("exit = %+v, err = %v, stdout = %q, stderr = %q", exit, err, rig.Stdout(), rig.Stderr())
	}
	resize := make(chan exec.Size, 2)
	queue := sizeQueue{resize}
	resize <- exec.Size{Cols: 80, Rows: 24}
	if got := queue.Next(); got == nil || *got != (remotecommand.TerminalSize{Width: 80, Height: 24}) {
		t.Errorf("Next = %+v, want 80x24", got)
	}
	close(resize)
	if got := queue.Next(); got != nil {
		t.Errorf("Next after the command ended = %+v, want nil", got)
	}
}

// A server that refuses the WebSocket upgrade is served over SPDY, and the protocol that carried the session is known.
func TestStreamFallsBackToSPDYWhenTheUpgradeFails(t *testing.T) {
	spdy := script(func(context.Context, remotecommand.StreamOptions) error { return nil })
	refuse := script(func(context.Context, remotecommand.StreamOptions) error {
		return &httpstream.UpgradeFailureError{Cause: errors.New("bad handshake")}
	})
	if protocol, err := stream(context.Background(), refuse, spdy, remotecommand.StreamOptions{}); protocol != "k8s-spdy" || err != nil {
		t.Errorf("refused upgrade: protocol %q, err %v; want k8s-spdy and nil", protocol, err)
	}
	broken := script(func(context.Context, remotecommand.StreamOptions) error { return errors.New("boom") })
	if protocol, err := stream(context.Background(), broken, spdy, remotecommand.StreamOptions{}); protocol != "k8s-ws-v5" || err == nil {
		t.Errorf("other failure: protocol %q, err %v; want k8s-ws-v5 and the error", protocol, err)
	}
}

// What a failed open and a refused command become, with the facts a host words them from.
func TestClassifyByTypeThenText(t *testing.T) {
	forbidden := apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "web-0", errors.New("no"))
	for name, tc := range map[string]struct {
		err    error
		class  exec.ErrorClass
		reason exec.ErrorReason
	}{
		"forbidden":      {forbidden, exec.ErrorClassForbidden, exec.ErrorReasonTargetDenied},
		"wrapped":        {fmt.Errorf("open: %w", forbidden), exec.ErrorClassForbidden, exec.ErrorReasonTargetDenied},
		"unauthorized":   {apierrors.NewUnauthorized("x"), exec.ErrorClassUnauthorized, exec.ErrorReasonUnspecified},
		"not found":      {apierrors.NewNotFound(schema.GroupResource{Resource: "pods"}, "web-0"), exec.ErrorClassNotFound, exec.ErrorReasonTargetGone},
		"no executable":  {errors.New(`OCI runtime exec failed: exec: "bash": executable file not found in $PATH: unknown`), exec.ErrorClassNotFound, exec.ErrorReasonNoSuchExecutable},
		"not running":    {errors.New("unable to upgrade connection: container not found (\"app\")"), exec.ErrorClassUnavailable, exec.ErrorReasonNotRunning},
		"no upgrade":     {&httpstream.UpgradeFailureError{Cause: errors.New("x")}, exec.ErrorClassUnavailable, exec.ErrorReasonUnspecified},
		"rbac as text":   {errors.New(`unable to upgrade connection: pods "quiet" is forbidden: User "system:serviceaccount:kproof:noexec" cannot create resource "pods/exec" in API group "" in the namespace "kproof"`), exec.ErrorClassForbidden, exec.ErrorReasonTargetDenied},
		"401 as text":    {errors.New("unable to upgrade connection: Unauthorized"), exec.ErrorClassUnauthorized, exec.ErrorReasonUnspecified},
		"pod unknown":    {errors.New("Internal error occurred: unable to upgrade connection: pod does not exist"), exec.ErrorClassUnavailable, exec.ErrorReasonNotRunning},
		"text is secret": {errors.New("Forbidden: token abc"), exec.ErrorClassUnspecified, exec.ErrorReasonUnspecified},
	} {
		got, ok := classify(tc.err)
		switch {
		case tc.class == exec.ErrorClassUnspecified && ok:
			t.Errorf("%s: classified as %+v, want not the API's", name, got)
		case tc.class != exec.ErrorClassUnspecified && (!ok || got.Class != tc.class || got.Reason != tc.reason):
			t.Errorf("%s: classified as %+v (%v), want %v/%v", name, got, ok, tc.class, tc.reason)
		}
	}
	e, _ := classify(errors.New(`exec: "bash": executable file not found`))
	if got := withFacts(exec.Request{Argv: []string{"bash", "-l"}}, e).Facts.Program; got != "bash" {
		t.Errorf("the program that was not found is %q, want bash", got)
	}
}

func pod() *corev1.Pod {
	running := corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}
	waiting := func(reason string) corev1.ContainerState {
		return corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: reason}}
	}
	done := func(reason string) corev1.ContainerState {
		return corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: reason}}
	}
	named := func(names ...string) []corev1.Container {
		var out []corev1.Container
		for _, n := range names {
			out = append(out, corev1.Container{Name: n})
		}
		return out
	}
	return &corev1.Pod{
		Spec: corev1.PodSpec{
			Containers:          named("app", "side", "slow", "crashy", "pulling", "broken", "new"),
			InitContainers:      named("setup", "failed-init"),
			EphemeralContainers: []corev1.EphemeralContainer{{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debug"}}},
		},
		Status: corev1.PodStatus{
			ContainerStatuses: []corev1.ContainerStatus{
				{Name: "app", State: running}, {Name: "side", State: running}, {Name: "slow", State: waiting("PodInitializing")},
				{Name: "crashy", State: waiting("CrashLoopBackOff")}, {Name: "pulling", State: waiting("ImagePullBackOff")},
				{Name: "broken", State: waiting("CreateContainerConfigError")},
			},
			InitContainerStatuses:      []corev1.ContainerStatus{{Name: "setup", State: done("Completed")}, {Name: "failed-init", State: done("Error")}},
			EphemeralContainerStatuses: []corev1.ContainerStatus{{Name: "debug", State: running}},
		},
	}
}

// The picker shows every container with the state its status reports, and only a running one can run a command.
func TestContainerChoicesCarryTheirStates(t *testing.T) {
	type row struct {
		kind   string
		state  exec.ChoiceState
		detail string
	}
	want := map[string]row{
		"app": {"container", exec.ChoiceStateReady, ""}, "side": {"container", exec.ChoiceStateReady, ""},
		"slow": {"container", exec.ChoiceStateStarting, "creating"}, "crashy": {"container", exec.ChoiceStateStopped, "crash-loop"},
		"pulling": {"container", exec.ChoiceStateStopped, "image-pull"}, "broken": {"container", exec.ChoiceStateStopped, "waiting"},
		"new":   {"container", exec.ChoiceStateStarting, "pending"},
		"setup": {"init", exec.ChoiceStateStopped, "completed"}, "failed-init": {"init", exec.ChoiceStateStopped, "terminated"},
		"debug": {"ephemeral", exec.ChoiceStateReady, ""},
	}
	got := map[string]row{}
	defaults := 0
	for _, c := range containerChoices(pod()) {
		got[c.Value] = row{c.Kind, c.State, c.Detail}
		if c.IsDefault {
			defaults++
			if c.Value != "app" {
				t.Errorf("the default is %q, want the first regular container", c.Value)
			}
		}
	}
	if !reflect.DeepEqual(got, want) || defaults != 1 {
		t.Errorf("choices = %+v (%d defaults), want %+v", got, defaults, want)
	}
	annotated := pod()
	annotated.Annotations = map[string]string{"kubectl.kubernetes.io/default-container": "side"}
	for _, c := range containerChoices(annotated) {
		if c.IsDefault != (c.Value == "side") {
			t.Errorf("annotated: %q default = %v", c.Value, c.IsDefault)
		}
	}
}

// The kind registers, the two modes are served with their own capabilities, and the target passes the conformance suite
// behind a Pod the callback can read.
func TestTheTargetRegistersAndConforms(t *testing.T) {
	if _, err := exec.NewTargetPlugin([]exec.Target{Target()}); err != nil {
		t.Fatal(err)
	}
	previous := getPod
	t.Cleanup(func() { getPod = previous })
	getPod = func(_ *types.PluginContext, namespace, name string) (*corev1.Pod, error) {
		if namespace != "shop" || name != "web-0" {
			return nil, apierrors.NewNotFound(schema.GroupResource{Resource: "pods"}, name)
		}
		return pod(), nil
	}
	target := Target()
	inner := target.Options
	target.Options = func(ctx *types.PluginContext, ref resourcev2.ResourceReference) ([]exec.Option, error) {
		ref.Address.Scope = podRef().Address.Scope // the suite's references carry no scope
		return inner(ctx, ref)
	}
	options, err := target.Options(nil, podRef())
	if err != nil || len(options) != 2 || options[0].Name != "container" || options[1].Name != "mode" {
		t.Fatalf("options = %+v, err = %v", options, err)
	}
	wantExec, wantAttach := modeCapabilities()
	if !reflect.DeepEqual(*options[1].Choices[0].Capabilities, wantExec) || !reflect.DeepEqual(*options[1].Choices[1].Capabilities, wantAttach) {
		t.Errorf("the modes are served with %+v and %+v", options[1].Choices[0].Capabilities, options[1].Choices[1].Capabilities)
	}
	if wantExec.HostRestart != exec.SurvivalNone || wantAttach.ExitReport != exec.ExitReportNone {
		t.Errorf("exec %+v, attach %+v: an exec cannot be reached after a host restart and an attach has no status", wantExec, wantAttach)
	}
	if _, _, err := podAddress(resourcev2.ResourceReference{}); err == nil {
		t.Error("a reference without a namespace is accepted")
	}
	exectest.Conformance(t, target, exectest.ConformanceResource("web-0"))
}

// A reference that names a Pod which has been replaced since the host read it is refused, and the same Pod is not.
func TestAReplacedPodIsRefused(t *testing.T) {
	previous := getPod
	t.Cleanup(func() { getPod = previous })
	getPod = func(*types.PluginContext, string, string) (*corev1.Pod, error) {
		return &corev1.Pod{ObjectMeta: metav1.ObjectMeta{UID: "uid-2"}}, nil
	}
	for uid, replaced := range map[string]bool{"uid-1": true, "uid-2": false} {
		ref := podRef()
		ref.Incarnation = &uid
		_, exit, err := runPod(t, exec.Request{Ref: ref, Argv: []string{"sh"}}, script(func(context.Context, remotecommand.StreamOptions) error {
			return utilexec.CodeExitError{Err: errors.New("x"), Code: 4}
		}))
		var refusal *exec.Error
		switch {
		case replaced && (!errors.As(err, &refusal) || refusal.Class != exec.ErrorClassConflict || refusal.Reason != exec.ErrorReasonTargetReplaced):
			t.Errorf("incarnation %s: err = %v, want Conflict/TargetReplaced", uid, err)
		case !replaced && (err != nil || code(exit) != 4):
			t.Errorf("incarnation %s: exit = %+v, err = %v, want the command to run", uid, exit, err)
		}
	}
}

// A request that omits the container runs in the default choice of Options: the SDK leaves the default out of the selection.
func TestAnOmittedContainerIsTheDefaultChoice(t *testing.T) {
	previous := getPod
	t.Cleanup(func() { getPod = previous })
	annotated := ""
	getPod = func(*types.PluginContext, string, string) (*corev1.Pod, error) {
		p := pod()
		if annotated != "" {
			p.Annotations = map[string]string{"kubectl.kubernetes.io/default-container": annotated}
		}
		return p, nil
	}
	proc := &exec.Proc{Context: &types.PluginContext{}, Request: exec.Request{Ref: podRef(), Selection: map[string]string{}}}
	for annotation, want := range map[string]string{"": "app", "side": "side"} {
		annotated = annotation
		if got, err := containerOf(proc); err != nil || got != want {
			t.Errorf("annotation %q: container = %q, err = %v, want %q", annotation, got, err, want)
		}
	}
	proc.Request.Selection["container"] = "debug"
	if got, err := containerOf(proc); err != nil || got != "debug" {
		t.Errorf("named container: %q, %v, want debug without reading the Pod", got, err)
	}
}
