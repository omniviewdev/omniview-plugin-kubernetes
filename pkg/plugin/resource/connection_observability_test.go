package resource

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
)

func TestLoadConnectionsFromPathsLogsSkippedKubeconfigWithoutPath(t *testing.T) {
	sink := &logtest.RecordingSink{}
	previous := logging.Default()
	logging.SetDefault(logging.New(logging.Config{
		Name:    "test",
		Level:   logging.NewLevelController(logging.LevelTrace),
		Backend: logging.NewSinkBackend(sink),
	}))
	t.Cleanup(func() { logging.SetDefault(previous) })

	secretPath := filepath.Join(t.TempDir(), "secret-kubeconfig-name")
	p := &kubeConnectionProvider{}
	conns, err := p.loadConnectionsFromPaths([]string{secretPath})
	if err != nil || len(conns) != 0 {
		t.Fatalf("conns=%v err=%v", conns, err)
	}
	found := false
	for _, r := range sink.Records() {
		if strings.Contains(fmt.Sprint(r.Message, r.Fields), "secret-kubeconfig-name") {
			t.Fatalf("log leaked kubeconfig path: %v", r)
		}
		if r.Message == "kubeconfig context skipped" {
			found = true
			if r.ToMap()["cause"] != "not_found" || r.ToMap()["kubeconfig_index"] != 0 {
				t.Fatalf("fields = %v", r.Fields)
			}
		}
	}
	if !found {
		t.Fatal("skipped kubeconfig was not logged")
	}
}
