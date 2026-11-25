package resource

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniview/kubernetes/pkg/connid"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// The account id below is a documentation value, not a real account.
const eksAccount = "111122223333"

func TestParseEKSClusterARN(t *testing.T) {
	tests := []struct {
		name    string
		context string
		want    eksCluster
		ok      bool
	}{
		{"aws partition", "arn:aws:eks:us-east-1:" + eksAccount + ":cluster/hm2-ops", eksCluster{Cluster: "hm2-ops", Region: "us-east-1", Account: eksAccount}, true},
		{"aws-cn partition", "arn:aws-cn:eks:cn-north-1:" + eksAccount + ":cluster/prod", eksCluster{Cluster: "prod", Region: "cn-north-1", Account: eksAccount}, true},
		{"aws-us-gov partition", "arn:aws-us-gov:eks:us-gov-west-1:" + eksAccount + ":cluster/prod", eksCluster{Cluster: "prod", Region: "us-gov-west-1", Account: eksAccount}, true},
		{"hyphens", "arn:aws:eks:eu-west-1:" + eksAccount + ":cluster/my-big-cluster", eksCluster{Cluster: "my-big-cluster", Region: "eu-west-1", Account: eksAccount}, true},
		{"underscores", "arn:aws:eks:eu-west-1:" + eksAccount + ":cluster/my_big_cluster", eksCluster{Cluster: "my_big_cluster", Region: "eu-west-1", Account: eksAccount}, true},
		{"digit first", "arn:aws:eks:eu-west-1:" + eksAccount + ":cluster/7up", eksCluster{Cluster: "7up", Region: "eu-west-1", Account: eksAccount}, true},
		{"one character", "arn:aws:eks:eu-west-1:" + eksAccount + ":cluster/a", eksCluster{Cluster: "a", Region: "eu-west-1", Account: eksAccount}, true},
		{"100 characters", "arn:aws:eks:eu-west-1:" + eksAccount + ":cluster/" + strings.Repeat("a", 100), eksCluster{Cluster: strings.Repeat("a", 100), Region: "eu-west-1", Account: eksAccount}, true},

		{"101 characters", "arn:aws:eks:eu-west-1:" + eksAccount + ":cluster/" + strings.Repeat("a", 101), eksCluster{}, false},
		{"hyphen first", "arn:aws:eks:eu-west-1:" + eksAccount + ":cluster/-prod", eksCluster{}, false},
		{"underscore first", "arn:aws:eks:eu-west-1:" + eksAccount + ":cluster/_prod", eksCluster{}, false},
		{"dot in the name", "arn:aws:eks:eu-west-1:" + eksAccount + ":cluster/a.b", eksCluster{}, false},
		{"wrong service", "arn:aws:ecs:us-east-1:" + eksAccount + ":cluster/hm2-ops", eksCluster{}, false},
		{"wrong partition", "arn:azure:eks:us-east-1:" + eksAccount + ":cluster/hm2-ops", eksCluster{}, false},
		{"empty cluster", "arn:aws:eks:us-east-1:" + eksAccount + ":cluster/", eksCluster{}, false},
		{"extra path", "arn:aws:eks:us-east-1:" + eksAccount + ":cluster/a/b", eksCluster{}, false},
		{"another resource type", "arn:aws:eks:us-east-1:" + eksAccount + ":nodegroup/a", eksCluster{}, false},
		{"account of 11 digits", "arn:aws:eks:us-east-1:11112222333:cluster/hm2-ops", eksCluster{}, false},
		{"account of 13 digits", "arn:aws:eks:us-east-1:1111222233334:cluster/hm2-ops", eksCluster{}, false},
		{"account with a letter", "arn:aws:eks:us-east-1:11112222333a:cluster/hm2-ops", eksCluster{}, false},
		{"missing region", "arn:aws:eks::" + eksAccount + ":cluster/hm2-ops", eksCluster{}, false},
		{"missing account", "arn:aws:eks:us-east-1::cluster/hm2-ops", eksCluster{}, false},
		{"trailing text", "arn:aws:eks:us-east-1:" + eksAccount + ":cluster/hm2-ops-extra text", eksCluster{}, false},
		{"trailing newline", "arn:aws:eks:us-east-1:" + eksAccount + ":cluster/hm2-ops\n", eksCluster{}, false},
		{"leading text", " arn:aws:eks:us-east-1:" + eksAccount + ":cluster/hm2-ops", eksCluster{}, false},
		{"not an ARN", "kind-dev", eksCluster{}, false},
		{"empty", "", eksCluster{}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := parseEKSClusterARN(tt.context)
			assert.Equal(t, tt.ok, ok, "whether %q is an EKS cluster ARN", tt.context)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestEKSDescription(t *testing.T) {
	cluster := eksCluster{Cluster: "hm2-ops", Region: "us-east-1", Account: eksAccount}
	// A space, a middle dot (U+00B7), a space between the parts.
	assert.Equal(t, "EKS \u00B7 us-east-1 \u00B7 "+eksAccount, cluster.description())
}

func writeKubeconfigWithContexts(t *testing.T, contexts ...string) string {
	t.Helper()
	var b strings.Builder
	b.WriteString("apiVersion: v1\nkind: Config\nclusters:\n- cluster:\n    server: https://10.0.0.1:6443\n  name: shared\nusers:\n- name: shared\n  user: {}\ncontexts:\n")
	for _, name := range contexts {
		b.WriteString("- context:\n    cluster: shared\n    user: shared\n  name: " + name + "\n")
	}
	path := filepath.Join(t.TempDir(), "config")
	require.NoError(t, os.WriteFile(path, []byte(b.String()), 0o644))
	return path
}

func TestConnectionsFromKubeconfig_EKSARNContextIsNamedByItsCluster(t *testing.T) {
	arn := "arn:aws:eks:us-east-1:" + eksAccount + ":cluster/hm2-ops"
	path := writeKubeconfigWithContexts(t, arn, "kind-dev")

	connections, _, err := connectionsFromKubeconfig(path)
	require.NoError(t, err)
	require.Len(t, connections, 2)

	byContext := map[string]types.Connection{}
	for _, connection := range connections {
		context, ok := connection.Data[connid.DataKeyContext].(string)
		require.True(t, ok, "every connection carries its context name")
		byContext[context] = connection
	}

	eks, ok := byContext[arn]
	require.True(t, ok, "the data of the ARN connection holds the exact context name, the full ARN")
	assert.Equal(t, "hm2-ops", eks.Name)
	assert.Equal(t, "EKS \u00B7 us-east-1 \u00B7 "+eksAccount, eks.Description)
	// What selects the context and what keys the connection stay those of the exact context name.
	assert.Equal(t, arn, eks.Data[connid.DataKeyContext])
	assert.Equal(t, connid.ID(connid.KindFile, inventoryLocator(t, path), arn), eks.ID)
	assert.NotEqual(t, connid.ID(connid.KindFile, inventoryLocator(t, path), "hm2-ops"), eks.ID, "the ID is not derived from the display name")
	assert.Equal(t, path, eks.Data["kubeconfig"])

	plain, ok := byContext["kind-dev"]
	require.True(t, ok)
	assert.Equal(t, "kind-dev", plain.Name)
	assert.Empty(t, plain.Description)
	assert.Equal(t, connid.ID(connid.KindFile, inventoryLocator(t, path), "kind-dev"), plain.ID)
}

func TestConnectionsFromKubeconfig_MalformedARNContextKeepsItsExactName(t *testing.T) {
	malformed := []string{
		"arn:aws:ecs:us-east-1:" + eksAccount + ":cluster/hm2-ops",
		"arn:aws:eks:us-east-1:" + eksAccount + ":cluster/a/b",
		"arn:aws:eks:us-east-1:11112222333:cluster/hm2-ops",
	}
	path := writeKubeconfigWithContexts(t, malformed...)

	connections, _, err := connectionsFromKubeconfig(path)
	require.NoError(t, err)
	require.Len(t, connections, len(malformed))
	for _, connection := range connections {
		assert.Contains(t, malformed, connection.Name)
		assert.Equal(t, connection.Name, connection.Data[connid.DataKeyContext])
		assert.Empty(t, connection.Description)
	}
}

func TestConnectionsFromKubeconfig_SameClusterNameInTwoRegionsKeepsTwoIDs(t *testing.T) {
	east := "arn:aws:eks:us-east-1:" + eksAccount + ":cluster/prod"
	west := "arn:aws:eks:us-west-2:" + eksAccount + ":cluster/prod"
	path := writeKubeconfigWithContexts(t, east, west)

	connections, _, err := connectionsFromKubeconfig(path)
	require.NoError(t, err)
	require.Len(t, connections, 2)
	assert.Equal(t, "prod", connections[0].Name)
	assert.Equal(t, "prod", connections[1].Name)
	assert.NotEqual(t, connections[0].ID, connections[1].ID)
	assert.NotEqual(t, connections[0].Description, connections[1].Description, "the description is what tells them apart")
	assertDistinctIDs(t, connections)
}
