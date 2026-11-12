package resource

import (
	"context"
	"errors"
	"runtime/pprof"
	"testing"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

func TestProfilingLabelWrappersTagPhaseAndConnection(t *testing.T) {
	t.Cleanup(func() { diag.SetProfileLabels(false) })
	sentinel := errors.New("next failed")
	label := func(ctx context.Context, key string) string { value, _ := pprof.Label(ctx, key); return value }

	var phase, connection string
	start := labelConnectStart(func(ctx context.Context, _ types.Connection, _ *clients.ClientSet) error {
		phase, connection = label(ctx, "phase"), label(ctx, "connection")
		return sentinel
	})
	source := labelSource(func(ctx context.Context, _ *clients.ClientSet, _ resourcev2.SourceRequest, _ resourcev2.SourceEmitter) error {
		phase, connection = label(ctx, "phase"), label(ctx, "connection")
		return sentinel
	})
	request := resourcev2.SourceRequest{Target: resourcev2.ReadTarget{Route: resourcev2.AccessRoute{Connection: "ctx-b"}}}

	diag.SetProfileLabels(false)
	if err := start(context.Background(), types.Connection{ID: "ctx-a"}, nil); err != sentinel || phase != "" || connection != "" {
		t.Fatalf("disabled: err=%v phase=%q connection=%q", err, phase, connection)
	}
	diag.SetProfileLabels(true)
	if err := start(context.Background(), types.Connection{ID: "ctx-a"}, nil); err != sentinel || phase != diag.PhaseConnect || connection != "ctx-a" {
		t.Fatalf("connect: err=%v phase=%q connection=%q", err, phase, connection)
	}
	if err := source(context.Background(), nil, request, nil); err != sentinel || phase != diag.PhaseSource || connection != "ctx-b" {
		t.Fatalf("source: err=%v phase=%q connection=%q", err, phase, connection)
	}
}
