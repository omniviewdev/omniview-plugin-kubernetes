package benchmark

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"

	// benchmarker powered by fairwinds polaris
	conf "github.com/fairwindsops/polaris/pkg/config"
	"github.com/fairwindsops/polaris/pkg/kube"
	"github.com/fairwindsops/polaris/pkg/validator"
)

type ClusterBenchmarker struct{}

var _ resource.Resourcer[clients.ClientSet] = (*ClusterBenchmarker)(nil)

// ============================ CRUD METHODS ============================ //.

func (cb *ClusterBenchmarker) Get(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	_ resource.GetInput,
) (*resource.GetResult, error) {
	return nil, nil
}

// List returns a map of resources for the provided cluster contexts.
func (s *ClusterBenchmarker) List(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	_ resource.ListInput,
) (*resource.ListResult, error) {
	config := createPolarisConf()
	resources, err := createPolarisResourceProvider(ctx, config, client)
	if err != nil {
		return nil, err
	}

	auditData, err := validator.RunAudit(config, resources)
	if err != nil {
		return nil, err
	}

	jsonData, err := json.Marshal(ToBenchmarkResults(auditData))
	if err != nil {
		return nil, err
	}

	return &resource.ListResult{Result: []json.RawMessage{jsonData}, Success: true}, nil
}

func (s *ClusterBenchmarker) Find(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	_ resource.FindInput,
) (*resource.FindResult, error) {
	return &resource.FindResult{}, nil
}

func (s *ClusterBenchmarker) Create(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	_ resource.CreateInput,
) (*resource.CreateResult, error) {
	return nil, fmt.Errorf("create operation not supported")
}

func (s *ClusterBenchmarker) Update(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	_ resource.UpdateInput,
) (*resource.UpdateResult, error) {
	return nil, fmt.Errorf("update operation not supported")
}

func (s *ClusterBenchmarker) Delete(
	_ context.Context,
	_ *clients.ClientSet,
	_ resource.ResourceMeta,
	_ resource.DeleteInput,
) (*resource.DeleteResult, error) {
	return nil, fmt.Errorf("delete operation not supported")
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
