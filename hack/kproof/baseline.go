package main

// Baselines without the plugin: a direct client-go remotecommand run (WebSocket v5 and SPDY, the two transports the
// provider's executors use) and kubectl exec, against the same cluster, pod and command as the flood scenario.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"hash"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/remotecommand"
)

const floodBytes = 67108864

var floodScript = fmt.Sprintf("yes | head -c %d", floodBytes)

// hashWriter counts and hashes what it is given.
type hashWriter struct {
	n atomic.Int64
	h hash.Hash
}

func newHashWriter() *hashWriter { return &hashWriter{h: sha256.New()} }

func (w *hashWriter) Write(p []byte) (int, error) {
	w.n.Add(int64(len(p)))
	w.h.Write(p)
	return len(p), nil
}

func (w *hashWriter) sum() string { return fmt.Sprintf("%x", w.h.Sum(nil)) }

// expectedSHA is the sha256 of pattern repeated count times.
func expectedSHA(pattern string, count int) string {
	h := sha256.New()
	chunk := bytes.Repeat([]byte(pattern), 4096)
	total := len(pattern) * count
	for written := 0; written < total; {
		n := len(chunk)
		if total-written < n {
			n = total - written
		}
		h.Write(chunk[:n])
		written += n
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}

type baseRes struct {
	Tool      string  `json:"tool"`
	TTY       bool    `json:"tty"`
	Bytes     int64   `json:"bytes"`
	WallMs    float64 `json:"wall_ms"`
	MBps      float64 `json:"mb_per_s"`
	MiBps     float64 `json:"mib_per_s"`
	SHA256    string  `json:"sha256"`
	Matches   bool    `json:"sha256_matches_expected"`
	Expected  string  `json:"expected_sha256"`
	StreamErr string  `json:"stream_error,omitempty"`
	Uptime    string  `json:"uptime"`
}

// blockingStdin is an open stdin that never has anything to say, like the host's input of an idle session.
type blockingStdin struct{ done <-chan struct{} }

func (b blockingStdin) Read([]byte) (int, error) {
	<-b.done
	return 0, io.EOF
}

// clientGoRun runs the flood command through client-go's remotecommand directly (proto "ws" or "spdy").
func clientGoRun(ctx context.Context, kubeconfig, pod, container string, tty bool, proto string) baseRes {
	res := baseRes{Tool: "client-go " + proto, TTY: tty, Uptime: uptimeStr()}
	cfg, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
	if err != nil {
		res.StreamErr = err.Error()
		return res
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		res.StreamErr = err.Error()
		return res
	}
	req := cs.CoreV1().RESTClient().Post().Resource("pods").Name(pod).Namespace(namespace).SubResource("exec").VersionedParams(
		&corev1.PodExecOptions{Command: []string{"sh", "-c", floodScript}, Container: container, Stdin: true, Stdout: true, Stderr: !tty, TTY: tty}, scheme.ParameterCodec)
	var ex remotecommand.Executor
	switch proto {
	case "ws":
		ex, err = remotecommand.NewWebSocketExecutor(cfg, "GET", req.URL().String())
	case "spdy":
		ex, err = remotecommand.NewSPDYExecutor(cfg, "POST", req.URL())
	default:
		err = fmt.Errorf("unknown protocol %q", proto)
	}
	if err != nil {
		res.StreamErr = err.Error()
		return res
	}
	out, errw := newHashWriter(), newHashWriter()
	done := make(chan struct{})
	opts := remotecommand.StreamOptions{Stdin: blockingStdin{done}, Stdout: out, Tty: tty}
	if !tty {
		opts.Stderr = errw
	}
	t0 := time.Now()
	err = ex.StreamWithContext(ctx, opts)
	dur := time.Since(t0)
	close(done)
	if err != nil {
		res.StreamErr = fmt.Sprintf("%T: %v", err, err)
	}
	fill(&res, out.n.Load(), dur, out.sum(), tty)
	return res
}

func fill(res *baseRes, n int64, dur time.Duration, sum string, tty bool) {
	res.Bytes, res.WallMs, res.SHA256 = n, ms(dur), sum
	if dur > 0 {
		res.MBps = float64(n) / dur.Seconds() / 1e6
		res.MiBps = float64(n) / dur.Seconds() / (1 << 20)
	}
	res.Expected = expectedFloodSHA(tty)
	res.Matches = sum == res.Expected
}

var expectedCache = map[bool]string{}

func expectedFloodSHA(tty bool) string {
	if s, ok := expectedCache[tty]; ok {
		return s
	}
	if tty {
		expectedCache[tty] = expectedSHA("y\r\n", floodBytes/2)
	} else {
		expectedCache[tty] = expectedSHA("y\n", floodBytes/2)
	}
	return expectedCache[tty]
}

// kubectlRun is `kubectl exec ... -- sh -c "yes | head -c 67108864" | shasum -a 256`, timed as one pipeline (the
// number includes kubectl's own start-up and the pipe to shasum).
func kubectlRun(ctx context.Context, kubeconfig, pod, container string, tty bool) baseRes {
	res := baseRes{Tool: "kubectl exec | shasum -a 256", TTY: tty, Uptime: uptimeStr()}
	ttyFlags := ""
	if tty {
		ttyFlags = "-t"
	}
	// -t needs a terminal on kubectl's stdin; without one kubectl warns and runs without. So the tty variant is only
	// meaningful through client-go; here -t is passed and the warning recorded.
	script := fmt.Sprintf("kubectl --kubeconfig %q -n %s exec %s -c %s %s -- sh -c %q | shasum -a 256", kubeconfig, namespace, pod, container, ttyFlags, floodScript)
	cmd := exec.CommandContext(ctx, "bash", "-o", "pipefail", "-c", script)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	t0 := time.Now()
	err := cmd.Run()
	dur := time.Since(t0)
	if err != nil {
		res.StreamErr = fmt.Sprintf("%v: %s", err, strings.TrimSpace(errb.String()))
	} else if errb.Len() > 0 {
		res.StreamErr = "stderr: " + strings.TrimSpace(errb.String())
	}
	sum := strings.Fields(out.String())
	got := ""
	if len(sum) > 0 {
		got = sum[0]
	}
	// kubectl's stdout byte count is not observable through shasum; the expected hash matching proves it
	res.WallMs = ms(dur)
	res.SHA256 = got
	res.Expected = expectedFloodSHA(tty)
	res.Matches = got == res.Expected
	if res.Matches {
		res.Bytes = floodBytes
		if tty {
			res.Bytes = floodBytes * 3 / 2
		}
		res.MBps = float64(res.Bytes) / dur.Seconds() / 1e6
		res.MiBps = float64(res.Bytes) / dur.Seconds() / (1 << 20)
	}
	return res
}

func uptimeStr() string {
	out, err := exec.Command("uptime").Output()
	if err != nil {
		return "uptime: " + err.Error()
	}
	return strings.TrimSpace(string(out))
}

// cmdBaseline runs the baselines on their own: kproof baseline -kubeconfig KC [-runs 3].
func cmdBaseline(args []string) error {
	fs := flag.NewFlagSet("baseline", flag.ExitOnError)
	kc := fs.String("kubeconfig", "", "kubeconfig of the kind cluster")
	runs := fs.Int("runs", 3, "runs of each baseline")
	pod := fs.String("pod", "quiet", "pod")
	container := fs.String("container", "main", "container")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *kc == "" {
		return errors.New("-kubeconfig is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	enc := json.NewEncoder(os.Stdout)
	for _, tty := range []bool{false, true} {
		for i := 1; i <= *runs; i++ {
			for _, proto := range []string{"ws", "spdy"} {
				_ = enc.Encode(clientGoRun(ctx, *kc, *pod, *container, tty, proto))
			}
			if !tty {
				_ = enc.Encode(kubectlRun(ctx, *kc, *pod, *container, tty))
			}
		}
	}
	return nil
}
