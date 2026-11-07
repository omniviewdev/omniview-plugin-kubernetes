package benchmark

import (
	"context"
	"encoding/json"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	// benchmarker powered by fairwinds polaris
	conf "github.com/fairwindsops/polaris/pkg/config"
	"github.com/fairwindsops/polaris/pkg/kube"
	"github.com/fairwindsops/polaris/pkg/validator"
)

type ClusterBenchmarker struct{}

// Audit runs the native cluster benchmark without claiming generic CRUD support.
func (s *ClusterBenchmarker) Audit(
	ctx context.Context,
	client *clients.ClientSet,
) (resource.Value, error) {
	config := createPolarisConf()
	resources, err := createPolarisResourceProvider(ctx, config, client)
	if err != nil {
		return resource.Value{}, err
	}

	auditData, err := validator.RunAudit(ctx, config, resources)
	if err != nil {
		return resource.Value{}, err
	}

	jsonData, err := json.Marshal(ToBenchmarkResults(auditData))
	if err != nil {
		return resource.Value{}, err
	}

	return resource.JSONToValue(jsonData)
}

// ============================ PRIVATE METHODS ============================ //.

func createPolarisConf() conf.Configuration {
	conf, _ := conf.MergeConfigAndParseFile("", true)
	return conf
}

func createPolarisResourceProvider(
	ctx context.Context,
	c conf.Configuration,
	client *clients.ClientSet,
) (*kube.ResourceProvider, error) {
	return kube.CreateResourceProviderFromAPI(
		ctx,
		client.Clientset,
		client.RESTConfig.Host,
		client.DynamicClient,
		c,
	)
}
