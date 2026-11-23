package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// cmdOut runs a command and returns its trimmed combined output (or the error text).
func cmdOut(timeout time.Duration, name string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	s := strings.TrimSpace(string(out))
	if err != nil {
		return s + " [" + err.Error() + "]"
	}
	return s
}

// writeEnvInfo records what the numbers were measured on: raw/env.json.
func writeEnvInfo(f *flags, kb *kube) error {
	st, _ := os.Stat(f.plugin)
	info := map[string]any{
		"date":                 time.Now().Format(time.RFC3339),
		"host":                 cmdOut(5*time.Second, "uname", "-a"),
		"go_runtime":           runtime.Version(),
		"hw_ncpu":              cmdOut(5*time.Second, "sysctl", "-n", "hw.ncpu"),
		"hw_memsize":           cmdOut(5*time.Second, "sysctl", "-n", "hw.memsize"),
		"uptime":               kb.uptime(),
		"kind_version":         cmdOut(10*time.Second, "kind", "version"),
		"kubectl_client":       cmdOut(10*time.Second, "kubectl", "version", "--client"),
		"docker_info_ncpu_mem": cmdOut(20*time.Second, "docker", "info", "--format", "NCPU={{.NCPU}} MemTotal={{.MemTotal}} Server={{.ServerVersion}} OS={{.OperatingSystem}}"),
		"node_image":           cmdOut(10*time.Second, "docker", "inspect", kb.node, "--format", "{{.Config.Image}} {{.Image}}"),
		"cluster_nodes":        cmdOut(30*time.Second, "kubectl", "--kubeconfig", kb.kubeconfig, "get", "nodes", "-o", "wide"),
		"cluster_version":      cmdOut(30*time.Second, "kubectl", "--kubeconfig", kb.kubeconfig, "version", "-o", "json"),
		"pods":                 cmdOut(30*time.Second, "kubectl", "--kubeconfig", kb.kubeconfig, "-n", namespace, "get", "pods", "-o", "wide"),
		"containerd_version":   cmdOut(30*time.Second, "docker", "exec", kb.node, "containerd", "--version"),
		"plugin_binary":        f.plugin,
		"plugin_sha256":        sha256File(f.plugin),
		"plugin_extra_env":     f.extraEnv,
		"plugin_yaml":          f.pluginYAML,
		"tool_args":            os.Args,
	}
	if st != nil {
		info["plugin_size"] = st.Size()
		info["plugin_mtime"] = st.ModTime().Format(time.RFC3339)
	}
	// the SDK pin and client-go version the tool (and the plugin) were built with
	if mod, err := os.ReadFile(filepath.Join(filepath.Dir(f.pluginYAML), "go.mod")); err == nil {
		for _, l := range strings.Split(string(mod), "\n") {
			l = strings.TrimSpace(l)
			if strings.HasPrefix(l, "github.com/omniviewdev/plugin-sdk ") || strings.HasPrefix(l, "k8s.io/client-go ") ||
				strings.HasPrefix(l, "k8s.io/streaming ") || strings.HasPrefix(l, "github.com/gorilla/websocket ") {
				info["go_mod: "+strings.Fields(l)[0]] = strings.Fields(l)[1]
			}
		}
	}
	b, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(f.out, "raw"), 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(f.out, "raw", "env-"+f.runID+".json"), b, 0o644)
}
