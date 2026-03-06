package resourcers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/gobuffalo/flect"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"go.uber.org/zap"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// Compile-time check.
var _ resource.Resourcer[clients.ClientSet] = (*KubernetesPatternResourcer)(nil)

// KubernetesPatternResourcer provides a fallback resourcer for arbitrary Kubernetes resources.
type KubernetesPatternResourcer struct {
	sync.RWMutex
	log *zap.SugaredLogger
}

// NewKubernetesPatternResourcer creates a new pattern resourcer.
func NewKubernetesPatternResourcer(logger *zap.SugaredLogger) *KubernetesPatternResourcer {
	return &KubernetesPatternResourcer{
		RWMutex: sync.RWMutex{},
		log:     logger.With("service", "PatternResourcerService"),
	}
}

func parseListV1(list *unstructured.UnstructuredList) ([]json.RawMessage, error) {
	result := make([]json.RawMessage, 0, len(list.Items))
	for _, r := range list.Items {
		data, err := json.Marshal(r.Object)
		if err != nil {
			return nil, err
		}
		result = append(result, data)
	}
	return result, nil
}

// resourceNameV1 returns the pluralized, lowercase resource name from a ResourceMeta Kind.
func resourceNameV1(meta resource.ResourceMeta) string {
	return flect.Pluralize(strings.ToLower(meta.Kind))
}

// gvrFromMetaV1 constructs a GroupVersionResource from v1 ResourceMeta.
func gvrFromMetaV1(meta resource.ResourceMeta) schema.GroupVersionResource {
	group := meta.Group
	if group == "core" {
		group = ""
	}
	return schema.GroupVersionResource{
		Group:    group,
		Version:  meta.Version,
		Resource: resourceNameV1(meta),
	}
}

func apiBasePathV1(group, version string) string {
	if group == "" || group == "core" {
		return fmt.Sprintf("/api/%s", version)
	}
	return fmt.Sprintf("/apis/%s/%s", group, version)
}

func (s *KubernetesPatternResourcer) Get(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	input resource.GetInput,
) (*resource.GetResult, error) {
	base := apiBasePathV1(meta.Group, meta.Version)
	resName := resourceNameV1(meta)

	var abspath string
	if input.Namespace != "" {
		abspath = fmt.Sprintf("%s/namespaces/%s/%s/%s", base, input.Namespace, resName, input.ID)
	} else {
		abspath = fmt.Sprintf("%s/%s/%s", base, resName, input.ID)
	}

	result := client.Clientset.RESTClient().Get().AbsPath(abspath).Do(ctx)
	retBytes, err := result.Raw()
	if err != nil {
		return nil, err
	}
	uncastObj, err := runtime.Decode(unstructured.UnstructuredJSONScheme, retBytes)
	if err != nil {
		return nil, err
	}

	obj, ok := uncastObj.(*unstructured.Unstructured)
	if !ok {
		return nil, fmt.Errorf("expected unstructured.Unstructured, got %T", uncastObj)
	}

	data, err := json.Marshal(obj.Object)
	if err != nil {
		return nil, err
	}
	return &resource.GetResult{Success: true, Result: data}, nil
}

func (s *KubernetesPatternResourcer) List(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	_ resource.ListInput,
) (*resource.ListResult, error) {
	base := apiBasePathV1(meta.Group, meta.Version)
	resName := resourceNameV1(meta)

	result := client.Clientset.RESTClient().Get().
		AbsPath(fmt.Sprintf("%s/%s", base, resName)).Do(ctx)

	retBytes, err := result.Raw()
	if err != nil {
		return nil, err
	}
	uncastObj, err := runtime.Decode(unstructured.UnstructuredJSONScheme, retBytes)
	if err != nil {
		return nil, err
	}

	resources, ok := uncastObj.(*unstructured.UnstructuredList)
	if ok {
		resultObj, err := parseListV1(resources)
		if err != nil {
			return nil, err
		}
		return &resource.ListResult{Success: true, Result: resultObj}, nil
	}

	resources, err = uncastObj.(*unstructured.Unstructured).ToList()
	if err != nil {
		return nil, err
	}
	resultObj, err := parseListV1(resources)
	if err != nil {
		return nil, err
	}
	return &resource.ListResult{Success: true, Result: resultObj}, nil
}

func (s *KubernetesPatternResourcer) Find(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	_ resource.FindInput,
) (*resource.FindResult, error) {
	listResult, err := s.List(ctx, client, meta, resource.ListInput{})
	if err != nil {
		return nil, err
	}
	return &resource.FindResult{Success: listResult.Success, Result: listResult.Result}, nil
}

func (s *KubernetesPatternResourcer) Create(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	input resource.CreateInput,
) (*resource.CreateResult, error) {
	var obj map[string]interface{}
	if err := json.Unmarshal(input.Input, &obj); err != nil {
		return nil, fmt.Errorf("failed to unmarshal create input: %w", err)
	}

	object := &unstructured.Unstructured{Object: obj}
	lister := client.DynamicClient.Resource(gvrFromMetaV1(meta)).Namespace(input.Namespace)
	created, err := lister.Create(ctx, object, v1.CreateOptions{})
	if err != nil {
		return nil, err
	}

	data, err := json.Marshal(created.Object)
	if err != nil {
		return nil, err
	}
	return &resource.CreateResult{Success: true, Result: data}, nil
}

func (s *KubernetesPatternResourcer) Update(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	input resource.UpdateInput,
) (*resource.UpdateResult, error) {
	var obj map[string]interface{}
	if err := json.Unmarshal(input.Input, &obj); err != nil {
		return nil, fmt.Errorf("failed to unmarshal update input: %w", err)
	}

	lister := client.DynamicClient.Resource(gvrFromMetaV1(meta)).Namespace(input.Namespace)
	existing, err := lister.Get(ctx, input.ID, v1.GetOptions{})
	if err != nil {
		return nil, err
	}

	// Preserve resourceVersion from the existing object so the update succeeds.
	if existingMeta, ok := existing.Object["metadata"].(map[string]interface{}); ok {
		if rv, ok := existingMeta["resourceVersion"]; ok {
			objMeta, ok := obj["metadata"].(map[string]interface{})
			if !ok {
				objMeta = make(map[string]interface{})
				obj["metadata"] = objMeta
			}
			objMeta["resourceVersion"] = rv
		}
	}
	existing.Object = obj

	updated, err := lister.Update(ctx, existing, v1.UpdateOptions{})
	if err != nil {
		return nil, err
	}

	data, err := json.Marshal(updated.Object)
	if err != nil {
		return nil, err
	}
	return &resource.UpdateResult{Success: true, Result: data}, nil
}

func (s *KubernetesPatternResourcer) Delete(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	input resource.DeleteInput,
) (*resource.DeleteResult, error) {
	lister := client.DynamicClient.Resource(gvrFromMetaV1(meta)).Namespace(input.Namespace)

	existing, err := lister.Get(ctx, input.ID, v1.GetOptions{})
	if err != nil {
		return nil, err
	}

	if err = lister.Delete(ctx, input.ID, v1.DeleteOptions{}); err != nil {
		return nil, err
	}

	data, err := json.Marshal(existing.Object)
	if err != nil {
		return nil, err
	}
	return &resource.DeleteResult{Success: true, Result: data}, nil
}
