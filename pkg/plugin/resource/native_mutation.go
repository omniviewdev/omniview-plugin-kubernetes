package resource

import (
	"context"
	"strconv"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
)

// NativeMutate admits the selected native verb independently. A type supporting
// create does not thereby promise update or delete.
func NativeMutate(ctx context.Context, client dynamic.Interface, gvr schema.GroupVersionResource, namespaced bool, verbs []string, request resourcev2.MutationRequest, representation resourcev2.Representation) (result resourcev2.Record, retErr error) {
	ctx, crud := startNativeCRUD(ctx, nativeCRUDVerb(request.Operation), request.Reference.Address.Type, nativeScopeNamespace(request.Reference.Address.Scope), request.Reference.Address.ID)
	defer func() { crud.end(retErr) }()
	if err := resourcev2.ValidateMutationRequest(request); err != nil {
		return resourcev2.Record{}, err
	}
	if err := ctx.Err(); err != nil {
		return resourcev2.Record{}, err
	}
	if request.Operation != "create" && request.Operation != "update" && request.Operation != "delete" {
		return resourcev2.Record{}, resourcev2.NewError("UNSUPPORTED", "Unknown native Kubernetes mutation")
	}
	if !verbSliceContains(verbs, request.Operation) {
		return resourcev2.Record{}, resourcev2.NewError("UNSUPPORTED", "Kubernetes type does not support the selected native mutation")
	}
	namespace, err := nativeIdentityNamespace(request.Reference.Address.Scope, namespaced)
	if err != nil {
		return resourcev2.Record{}, err
	}
	resource := nativeResourceClient(client, gvr, namespaced, namespace)
	if request.Operation == "delete" {
		grace, err := nativeDeleteGrace(request.Input)
		if err != nil {
			return resourcev2.Record{}, err
		}
		object, err := resource.Get(ctx, request.Reference.Address.ID, metav1.GetOptions{})
		if err != nil {
			return resourcev2.Record{}, err
		}
		if request.Reference.Incarnation != nil && string(object.GetUID()) != *request.Reference.Incarnation {
			return resourcev2.Record{}, resourcev2.NewError("RESET_REQUIRED", "Kubernetes object incarnation changed")
		}
		if request.ExpectedRevision != nil && object.GetResourceVersion() != *request.ExpectedRevision {
			return resourcev2.Record{}, resourcev2.NewError("CONFLICT", "Kubernetes object revision changed")
		}
		record, err := nativeRecord(object, request.Reference.Address, namespaced, namespace, representation)
		if err != nil {
			return resourcev2.Record{}, err
		}
		uid, revision := object.GetUID(), object.GetResourceVersion()
		if uid == "" || revision == "" {
			return resourcev2.Record{}, resourcev2.NewError("UNAVAILABLE", "Kubernetes delete requires an observed UID and resource version")
		}
		preconditions := &metav1.Preconditions{UID: &uid, ResourceVersion: &revision}
		if err := resource.Delete(ctx, request.Reference.Address.ID, metav1.DeleteOptions{Preconditions: preconditions, GracePeriodSeconds: grace}); err != nil {
			return resourcev2.Record{}, err
		}
		return record, nil
	}

	body, err := resourcev2.NativeFromValue(request.Input)
	if err != nil {
		return resourcev2.Record{}, err
	}
	body, err = nativeMutationJSON(body)
	if err != nil {
		return resourcev2.Record{}, err
	}
	objectMap, ok := body.(map[string]any)
	if !ok {
		return resourcev2.Record{}, resourcev2.NewError("INVALID_REQUEST", "Kubernetes mutation body must be an object")
	}
	object := &unstructured.Unstructured{Object: objectMap}
	if object.GetName() != request.Reference.Address.ID {
		return resourcev2.Record{}, resourcev2.NewError("INVALID_REQUEST", "Kubernetes body name does not match its exact address")
	}
	if object.GetNamespace() != "" && object.GetNamespace() != namespace {
		return resourcev2.Record{}, resourcev2.NewError("INVALID_REQUEST", "Kubernetes body namespace does not match its exact address")
	}
	object.SetNamespace(namespace)
	if request.Operation == "create" {
		if request.Reference.Incarnation != nil || request.ExpectedRevision != nil {
			return resourcev2.Record{}, resourcev2.NewError("INVALID_REQUEST", "Create cannot require an existing incarnation or revision")
		}
		created, err := resource.Create(ctx, object, metav1.CreateOptions{})
		if err != nil {
			return resourcev2.Record{}, err
		}
		return nativeRecord(created, request.Reference.Address, namespaced, namespace, representation)
	}
	if request.Reference.Incarnation != nil {
		if object.GetUID() != "" && string(object.GetUID()) != *request.Reference.Incarnation {
			return resourcev2.Record{}, resourcev2.NewError("INVALID_REQUEST", "Kubernetes body UID does not match its incarnation precondition")
		}
		object.SetUID(types.UID(*request.Reference.Incarnation))
	}
	if request.ExpectedRevision != nil {
		if object.GetResourceVersion() != "" && object.GetResourceVersion() != *request.ExpectedRevision {
			return resourcev2.Record{}, resourcev2.NewError("INVALID_REQUEST", "Kubernetes body revision does not match its revision precondition")
		}
		object.SetResourceVersion(*request.ExpectedRevision)
	}
	updated, err := resource.Update(ctx, object, metav1.UpdateOptions{})
	if err != nil {
		return resourcev2.Record{}, err
	}
	return nativeRecord(updated, request.Reference.Address, namespaced, namespace, representation)
}

// Kubernetes unstructured JSON has signed integers and date-time strings. This
// adapter rejects unsupported unsigned numbers rather than rounding them.
func nativeMutationJSON(value any) (any, error) {
	switch value := value.(type) {
	case uint64:
		return nil, resourcev2.NewError("UNSUPPORTED", "Kubernetes unstructured documents do not support uint64 values")
	case time.Time:
		return value.UTC().Format(time.RFC3339Nano), nil
	case map[string]any:
		for key, child := range value {
			converted, err := nativeMutationJSON(child)
			if err != nil {
				return nil, err
			}
			value[key] = converted
		}
	case []any:
		for index, child := range value {
			converted, err := nativeMutationJSON(child)
			if err != nil {
				return nil, err
			}
			value[index] = converted
		}
	}
	return value, nil
}

func nativeDeleteGrace(input resourcev2.Value) (*int64, error) {
	if input.Kind == "null" {
		return nil, nil
	}
	if input.Kind != "map" {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Delete input must be an options object or null")
	}
	for key := range input.Map {
		if key != "gracePeriodSeconds" {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Unknown Kubernetes delete option")
		}
	}
	value, present := input.Map["gracePeriodSeconds"]
	if !present {
		return nil, nil
	}
	if value.Kind != "int64" {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Delete gracePeriodSeconds must be an exact int64")
	}
	seconds, err := strconv.ParseInt(value.Int, 10, 64)
	if err != nil || seconds < 0 {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Delete gracePeriodSeconds must be nonnegative")
	}
	return &seconds, nil
}
