package resource

import (
	"context"
	"fmt"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestActionPreflightRejectsInvalidRequestWithoutLoggingInput(t *testing.T) {
	core, logs := observer.New(zap.InfoLevel)
	provider, err := newKubernetesProvider(zap.New(core).Sugar(), func(string) {})
	require.NoError(t, err)
	request := resourcev2.ActionRequest{
		Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Type: "k8s:apps/deployments", ID: "web"}},
		Action:    "scale",
		Input:     resourcev2.Value{Kind: "string", String: "private-input"},
	}
	_, err = provider.Action(context.Background(), request)
	require.Error(t, err)
	entries := logs.FilterMessage("Kubernetes action preflight failed").All()
	require.Len(t, entries, 1)
	fields := entries[0].ContextMap()
	require.Equal(t, "scale", fields["action"])
	require.Equal(t, "web", fields["resource_id"])
	require.Equal(t, "preflight", fields["stage"])
	require.NotContains(t, fmt.Sprint(fields), "private-input")
}
