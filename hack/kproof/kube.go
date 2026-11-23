package main

// kubectl and node helpers. Every kubectl call passes --kubeconfig: nothing here reads ~/.kube/config. The node is the
// docker container of the kind node; only that container is touched.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type kube struct {
	kubeconfig string // the kind kubeconfig (admin client certificate)
	node       string // the kind node's docker container name
	fixtures   string // path to fixtures.sh
}

func (k *kube) run(ctx context.Context, timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	err := cmd.Run()
	if err != nil {
		return out.String(), fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, strings.TrimSpace(errb.String()))
	}
	return out.String(), nil
}

func (k *kube) kubectl(ctx context.Context, args ...string) (string, error) {
	return k.run(ctx, 90*time.Second, "kubectl", append([]string{"--kubeconfig", k.kubeconfig}, args...)...)
}

func (k *kube) kubectlT(ctx context.Context, timeout time.Duration, args ...string) (string, error) {
	return k.run(ctx, timeout, "kubectl", append([]string{"--kubeconfig", k.kubeconfig}, args...)...)
}

// nodeExec runs a command in the kind node's container (docker exec).
func (k *kube) nodeExec(ctx context.Context, timeout time.Duration, args ...string) (string, error) {
	return k.run(ctx, timeout, "docker", append([]string{"exec", k.node}, args...)...)
}

// inPod runs a shell snippet in a container of a pod with kubectl exec (the control channel of a check, never the
// thing under test).
func (k *kube) inPod(ctx context.Context, pod, container, script string) (string, error) {
	return k.kubectl(ctx, "-n", namespace, "exec", pod, "-c", container, "--", "sh", "-c", script)
}

func (k *kube) containerID(ctx context.Context, pod, container string) (string, error) {
	out, err := k.kubectl(ctx, "-n", namespace, "get", "pod", pod, "-o",
		fmt.Sprintf(`jsonpath={.status.containerStatuses[?(@.name=="%s")].containerID}`, container))
	if err != nil {
		return "", err
	}
	id := strings.TrimSpace(out)
	id = strings.TrimPrefix(id, "containerd://")
	if id == "" {
		return "", fmt.Errorf("pod %s container %s has no containerID", pod, container)
	}
	return id, nil
}

// containerPID returns the pid, in the node's pid namespace, of PID 1 of a container (crictl inspect).
func (k *kube) containerPID(ctx context.Context, pod, container string) (int, string, error) {
	id, err := k.containerID(ctx, pod, container)
	if err != nil {
		return 0, "", err
	}
	out, err := k.nodeExec(ctx, 30*time.Second, "crictl", "inspect", id)
	if err != nil {
		return 0, id, err
	}
	var doc struct {
		Info struct {
			Pid int `json:"pid"`
		} `json:"info"`
	}
	if err := json.Unmarshal([]byte(out), &doc); err != nil {
		return 0, id, fmt.Errorf("crictl inspect %s: %w", id, err)
	}
	if doc.Info.Pid == 0 {
		return 0, id, fmt.Errorf("crictl inspect %s: no pid", id)
	}
	return doc.Info.Pid, id, nil
}

func (k *kube) waitReady(ctx context.Context, pod string, timeout time.Duration) error {
	_, err := k.kubectlT(ctx, timeout+10*time.Second, "-n", namespace, "wait", "--for=condition=Ready", "pod/"+pod, "--timeout="+strconv.Itoa(int(timeout.Seconds()))+"s")
	return err
}

// waitGone waits until a pod (by name) no longer exists.
func (k *kube) waitGone(ctx context.Context, pod string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		out, err := k.kubectl(ctx, "-n", namespace, "get", "pod", pod, "--ignore-not-found", "-o", "name")
		if err == nil && strings.TrimSpace(out) == "" {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	return fmt.Errorf("pod %s still exists after %v", pod, timeout)
}

// applyFixtures runs fixtures.sh (idempotent: it recreates what is missing and waits for the states the scenarios need).
func (k *kube) applyFixtures(ctx context.Context) (string, error) {
	return k.run(ctx, 6*time.Minute, "bash", k.fixtures, k.kubeconfig)
}

// apiReady polls the API server's readyz through the admin kubeconfig.
func (k *kube) apiReady(ctx context.Context, timeout time.Duration) (time.Duration, error) {
	start := time.Now()
	for time.Since(start) < timeout {
		out, err := k.kubectlT(ctx, 10*time.Second, "get", "--raw", "/readyz")
		if err == nil && strings.TrimSpace(out) == "ok" {
			return time.Since(start), nil
		}
		select {
		case <-ctx.Done():
			return time.Since(start), ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return time.Since(start), fmt.Errorf("API server not ready after %v", timeout)
}

func (k *kube) uptime() string {
	out, err := exec.Command("uptime").Output()
	if err != nil {
		return "uptime: " + err.Error()
	}
	return strings.TrimSpace(string(out))
}

// containerStates is what the kubelet reports for every container of a pod, in one word each: "running",
// "waiting:<reason>", "terminated:<reason>(<exit code>)", with the kind in front ("init/", "ephemeral/").
func (k *kube) containerStates(ctx context.Context, pod string) (map[string]string, error) {
	out, err := k.kubectl(ctx, "-n", namespace, "get", "pod", pod, "-o", "json")
	if err != nil {
		return nil, err
	}
	var doc struct {
		Status struct {
			Init      []containerStatus `json:"initContainerStatuses"`
			Regular   []containerStatus `json:"containerStatuses"`
			Ephemeral []containerStatus `json:"ephemeralContainerStatuses"`
		} `json:"status"`
	}
	if err := json.Unmarshal([]byte(out), &doc); err != nil {
		return nil, err
	}
	states := map[string]string{}
	for _, c := range doc.Status.Regular {
		states[c.Name] = "container/" + c.describe()
	}
	for _, c := range doc.Status.Init {
		states[c.Name] = "init/" + c.describe()
	}
	for _, c := range doc.Status.Ephemeral {
		states[c.Name] = "ephemeral/" + c.describe()
	}
	return states, nil
}

type containerStatus struct {
	Name         string `json:"name"`
	RestartCount int    `json:"restartCount"`
	State        struct {
		Running *struct{} `json:"running"`
		Waiting *struct {
			Reason string `json:"reason"`
		} `json:"waiting"`
		Terminated *struct {
			Reason   string `json:"reason"`
			ExitCode int    `json:"exitCode"`
		} `json:"terminated"`
	} `json:"state"`
}

func (c containerStatus) describe() string {
	switch {
	case c.State.Running != nil:
		return fmt.Sprintf("running(restarts=%d)", c.RestartCount)
	case c.State.Waiting != nil:
		return fmt.Sprintf("waiting:%s(restarts=%d)", c.State.Waiting.Reason, c.RestartCount)
	case c.State.Terminated != nil:
		return fmt.Sprintf("terminated:%s(%d)(restarts=%d)", c.State.Terminated.Reason, c.State.Terminated.ExitCode, c.RestartCount)
	}
	return "unknown"
}
