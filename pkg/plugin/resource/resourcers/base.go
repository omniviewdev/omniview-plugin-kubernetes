package resourcers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	"go.uber.org/zap"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/tools/cache"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

const (
	AddChannelBufferSize    = 100
	UpdateChannelBufferSize = 100
	DeleteChannelBufferSize = 100
)

// All kubernetes objects extending this implement the following base interface.
type MetaAccessor interface {
	GetName() string
	GetNamespace() string
	GetLabels() map[string]string
}

// KubernetesResourcerBase provides a base implementation for Kubernetes resources.
type KubernetesResourcerBase[T MetaAccessor] struct {
	sync.RWMutex
	log           *zap.SugaredLogger
	resourceType  schema.GroupVersionResource
	syncPolicy    resource.SyncPolicy
	relationships []resource.RelationshipDescriptor
}

// Option configures a KubernetesResourcerBase.
type Option func(o *baseOptions)

type baseOptions struct {
	syncPolicy    resource.SyncPolicy
	relationships []resource.RelationshipDescriptor
}

// WithSyncPolicy sets the sync policy for the resourcer.
func WithSyncPolicy(p resource.SyncPolicy) Option {
	return func(o *baseOptions) { o.syncPolicy = p }
}

// WithRelationships sets the relationship descriptors for the resourcer.
func WithRelationships(r []resource.RelationshipDescriptor) Option {
	return func(o *baseOptions) { o.relationships = r }
}

// NewKubernetesResourcerBase creates a new instance of KubernetesResourcerBase.
func NewKubernetesResourcerBase[T MetaAccessor](
	logger *zap.SugaredLogger,
	resourceType schema.GroupVersionResource,
	opts ...Option,
) *KubernetesResourcerBase[T] {
	o := baseOptions{syncPolicy: resource.SyncOnConnect}
	for _, apply := range opts {
		apply(&o)
	}
	return &KubernetesResourcerBase[T]{
		RWMutex:       sync.RWMutex{},
		log:           logger.With("service", resourceType.Resource+"Service"),
		resourceType:  resourceType,
		syncPolicy:    o.syncPolicy,
		relationships: o.relationships,
	}
}

// GroupVersionResource returns the GVR for this resource.
func (s *KubernetesResourcerBase[T]) GroupVersionResource() schema.GroupVersionResource {
	return s.resourceType
}

// SyncPolicy implements resource.SyncPolicyDeclarer.
func (s *KubernetesResourcerBase[T]) SyncPolicy() resource.SyncPolicy {
	return s.syncPolicy
}

// DeclareRelationships implements resource.RelationshipDeclarer.
func (s *KubernetesResourcerBase[T]) DeclareRelationships() []resource.RelationshipDescriptor {
	return s.relationships
}

// Compile-time interface checks.
var (
	_ resource.Resourcer[clients.ClientSet]  = (*KubernetesResourcerBase[MetaAccessor])(nil)
	_ resource.Watcher[clients.ClientSet]    = (*KubernetesResourcerBase[MetaAccessor])(nil)
	_ resource.SyncPolicyDeclarer            = (*KubernetesResourcerBase[MetaAccessor])(nil)
	_ resource.RelationshipDeclarer          = (*KubernetesResourcerBase[MetaAccessor])(nil)
)

// ============================ CRUD METHODS ============================ //

func (s *KubernetesResourcerBase[T]) Get(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	input resource.GetInput,
) (*resource.GetResult, error) {
	var obj runtime.Object
	var err error

	informer := client.DynamicInformerFactory.ForResource(s.resourceType).Informer()
	if !informer.HasSynced() {
		lister := client.DynamicClient.Resource(s.resourceType)
		if input.Namespace != "" {
			obj, err = lister.Namespace(input.Namespace).Get(ctx, input.ID, v1.GetOptions{})
		} else {
			obj, err = lister.Get(ctx, input.ID, v1.GetOptions{})
		}
	} else {
		lister := client.DynamicInformerFactory.ForResource(s.resourceType).Lister()
		if input.Namespace != "" {
			obj, err = lister.ByNamespace(input.Namespace).Get(input.ID)
		} else {
			obj, err = lister.Get(input.ID)
		}
	}

	if err != nil {
		return nil, err
	}

	unstructuredObj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(obj)
	if err != nil {
		return nil, err
	}

	data, err := json.Marshal(unstructuredObj)
	if err != nil {
		return nil, err
	}

	return &resource.GetResult{Success: true, Result: data}, nil
}

func (s *KubernetesResourcerBase[T]) List(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	_ resource.ListInput,
) (*resource.ListResult, error) {
	informer := client.DynamicInformerFactory.ForResource(s.resourceType).Informer()
	if !informer.HasSynced() {
		resources, err := client.DynamicClient.Resource(s.resourceType).List(ctx, v1.ListOptions{})
		if err != nil {
			return nil, err
		}

		result := make([]json.RawMessage, 0, len(resources.Items))
		for _, r := range resources.Items {
			p := r
			data, err := json.Marshal(p.Object)
			if err != nil {
				return nil, err
			}
			result = append(result, data)
		}
		return &resource.ListResult{Success: true, Result: result}, nil
	}

	lister := client.DynamicInformerFactory.ForResource(s.resourceType).Lister()
	resources, err := lister.List(labels.Everything())
	if err != nil {
		return nil, err
	}

	result := make([]json.RawMessage, 0, len(resources))
	for _, r := range resources {
		obj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(r)
		if err != nil {
			return nil, err
		}
		data, err := json.Marshal(obj)
		if err != nil {
			return nil, err
		}
		result = append(result, data)
	}

	return &resource.ListResult{Success: true, Result: result}, nil
}

func (s *KubernetesResourcerBase[T]) Find(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	_ resource.FindInput,
) (*resource.FindResult, error) {
	listResult, err := s.List(ctx, client, meta, resource.ListInput{})
	if err != nil {
		return nil, err
	}
	return &resource.FindResult{
		Success: listResult.Success,
		Result:  listResult.Result,
	}, nil
}

func (s *KubernetesResourcerBase[T]) Create(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	input resource.CreateInput,
) (*resource.CreateResult, error) {
	var obj map[string]interface{}
	if err := json.Unmarshal(input.Input, &obj); err != nil {
		return nil, fmt.Errorf("failed to unmarshal create input: %w", err)
	}

	object := &unstructured.Unstructured{Object: obj}
	lister := client.DynamicClient.Resource(s.resourceType).Namespace(input.Namespace)
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

func (s *KubernetesResourcerBase[T]) Update(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	input resource.UpdateInput,
) (*resource.UpdateResult, error) {
	var obj map[string]interface{}
	if err := json.Unmarshal(input.Input, &obj); err != nil {
		return nil, fmt.Errorf("failed to unmarshal update input: %w", err)
	}

	lister := client.DynamicClient.Resource(s.resourceType).Namespace(input.Namespace)
	existing, err := lister.Get(ctx, input.ID, v1.GetOptions{})
	if err != nil {
		return nil, err
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

func (s *KubernetesResourcerBase[T]) Delete(
	ctx context.Context,
	client *clients.ClientSet,
	_ resource.ResourceMeta,
	input resource.DeleteInput,
) (*resource.DeleteResult, error) {
	lister := client.DynamicClient.Resource(s.resourceType).Namespace(input.Namespace)

	existing, err := lister.Get(ctx, input.ID, v1.GetOptions{})
	if err != nil {
		return nil, err
	}

	deleteOpts := v1.DeleteOptions{}
	if input.GracePeriodSeconds != nil {
		deleteOpts.GracePeriodSeconds = input.GracePeriodSeconds
	}
	if err = lister.Delete(ctx, input.ID, deleteOpts); err != nil {
		return nil, err
	}

	data, err := json.Marshal(existing.Object)
	if err != nil {
		return nil, err
	}
	return &resource.DeleteResult{Success: true, Result: data}, nil
}

// ============================ WATCH ============================ //

// watchErrorClassification holds the result of classifying a watch-related error.
type watchErrorClassification struct {
	isForbidden        bool
	isNotFound         bool
	isMethodNotAllowed bool
	code               string
	message            string
}

// classifyWatchError inspects a K8s API error and classifies it for watch state emission.
func classifyWatchError(err error) watchErrorClassification {
	var statusErr *k8serrors.StatusError
	if errors.As(err, &statusErr) {
		switch statusErr.ErrStatus.Code {
		case 403:
			return watchErrorClassification{isForbidden: true, code: "FORBIDDEN", message: "Access denied: " + statusErr.ErrStatus.Message}
		case 401:
			return watchErrorClassification{isForbidden: true, code: "UNAUTHORIZED", message: "Authentication failed: " + statusErr.ErrStatus.Message}
		case 404:
			return watchErrorClassification{isNotFound: true, code: "NOT_FOUND", message: "Resource type not found: " + statusErr.ErrStatus.Message}
		case 405:
			return watchErrorClassification{isMethodNotAllowed: true, code: "METHOD_NOT_ALLOWED", message: "Resource does not support this method: " + statusErr.ErrStatus.Message}
		}
	}
	return watchErrorClassification{code: "UNKNOWN", message: err.Error()}
}

// makeEventHandler creates a cache.ResourceEventHandlerFuncs for watch event forwarding.
func makeEventHandler(meta resource.ResourceMeta, sink resource.WatchEventSink) cache.ResourceEventHandlerFuncs {
	return cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			u, ok := obj.(*unstructured.Unstructured)
			if !ok || u == nil {
				return
			}
			data, err := u.MarshalJSON()
			if err != nil {
				return
			}
			sink.OnAdd(resource.WatchAddPayload{
				Data:      data,
				Key:       meta.Key(),
				ID:        u.GetName(),
				Namespace: u.GetNamespace(),
			})
		},
		UpdateFunc: func(_, newObj interface{}) {
			u, ok := newObj.(*unstructured.Unstructured)
			if !ok || u == nil {
				return
			}
			data, err := u.MarshalJSON()
			if err != nil {
				return
			}
			sink.OnUpdate(resource.WatchUpdatePayload{
				Data:      data,
				Key:       meta.Key(),
				ID:        u.GetName(),
				Namespace: u.GetNamespace(),
			})
		},
		DeleteFunc: func(obj interface{}) {
			u, ok := obj.(*unstructured.Unstructured)
			if !ok || u == nil {
				if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
					u, ok = tombstone.Obj.(*unstructured.Unstructured)
					if !ok || u == nil {
						return
					}
				} else {
					return
				}
			}
			data, err := u.MarshalJSON()
			if err != nil {
				return
			}
			sink.OnDelete(resource.WatchDeletePayload{
				Data:      data,
				Key:       meta.Key(),
				ID:        u.GetName(),
				Namespace: u.GetNamespace(),
			})
		},
	}
}

func (s *KubernetesResourcerBase[T]) Watch(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	sink resource.WatchEventSink,
) error {
	scope := resource.WatchScopeFromContext(ctx)
	if scope != nil && len(scope.Partitions) > 0 {
		return s.watchScoped(ctx, client, meta, sink, scope.Partitions)
	}
	return s.watchUnscoped(ctx, client, meta, sink)
}

// watchUnscoped runs a cluster-wide watch using the main DynamicInformerFactory.
func (s *KubernetesResourcerBase[T]) watchUnscoped(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	sink resource.WatchEventSink,
) error {
	// Register the informer with the factory BEFORE starting it.
	informer := client.DynamicInformerFactory.ForResource(s.resourceType).Informer()
	client.EnsureFactoryStarted()

	registration, err := informer.AddEventHandler(makeEventHandler(meta, sink))
	if err != nil {
		return fmt.Errorf("failed to add event handler: %w", err)
	}

	// Signal syncing
	log.Printf("[k8s-watch] %s: emitting SYNCING", meta.Key())
	sink.OnStateChange(resource.WatchStateEvent{
		ResourceKey: meta.Key(),
		State:       resource.WatchStateSyncing,
	})

	// Wait for cache sync with 30s timeout instead of unbounded wait
	syncCtx, syncCancel := context.WithTimeout(ctx, 30*time.Second)
	defer syncCancel()
	synced := cache.WaitForCacheSync(syncCtx.Done(), informer.HasSynced)

	if !synced {
		// Sync failed — probe the API to classify the error
		_, listErr := client.DynamicClient.Resource(s.resourceType).List(ctx, v1.ListOptions{Limit: 1})
		if listErr != nil {
			classified := classifyWatchError(listErr)
			if classified.isForbidden {
				log.Printf("[k8s-watch] %s: emitting FORBIDDEN: %s", meta.Key(), classified.message)
				sink.OnStateChange(resource.WatchStateEvent{
					ResourceKey: meta.Key(),
					State:       resource.WatchStateForbidden,
					Message:     classified.message,
					ErrorCode:   classified.code,
				})
				if err := informer.RemoveEventHandler(registration); err != nil {
					log.Printf("failed to remove event handler for %s: %v", meta.Key(), err)
				}
				// Block until context is cancelled — nil return so runWatch doesn't retry
				<-ctx.Done()
				return nil
			}
			if classified.isNotFound {
				log.Printf("[k8s-watch] %s: emitting SKIPPED (404): %s", meta.Key(), classified.message)
				sink.OnStateChange(resource.WatchStateEvent{
					ResourceKey: meta.Key(),
					State:       resource.WatchStateSkipped,
					Message:     classified.message,
					ErrorCode:   classified.code,
				})
				if err := informer.RemoveEventHandler(registration); err != nil {
					log.Printf("failed to remove event handler for %s: %v", meta.Key(), err)
				}
				<-ctx.Done()
				return nil
			}
			if classified.isMethodNotAllowed {
				log.Printf("[k8s-watch] %s: emitting SKIPPED (405): %s", meta.Key(), classified.message)
				sink.OnStateChange(resource.WatchStateEvent{
					ResourceKey: meta.Key(),
					State:       resource.WatchStateSkipped,
					Message:     classified.message,
					ErrorCode:   classified.code,
				})
				if err := informer.RemoveEventHandler(registration); err != nil {
					log.Printf("failed to remove event handler for %s: %v", meta.Key(), err)
				}
				<-ctx.Done()
				return nil
			}
			// Non-forbidden, non-404, non-405: emit ERROR, return error for retry with backoff
			log.Printf("[k8s-watch] %s: emitting ERROR: %s", meta.Key(), classified.message)
			sink.OnStateChange(resource.WatchStateEvent{
				ResourceKey: meta.Key(),
				State:       resource.WatchStateError,
				Message:     classified.message,
				ErrorCode:   classified.code,
			})
			if err := informer.RemoveEventHandler(registration); err != nil {
				log.Printf("failed to remove event handler for %s: %v", meta.Key(), err)
			}
			return listErr
		}
		// LIST ok but sync timed out — transient issue
		log.Printf("[k8s-watch] %s: emitting ERROR (cache sync timed out)", meta.Key())
		sink.OnStateChange(resource.WatchStateEvent{
			ResourceKey: meta.Key(),
			State:       resource.WatchStateError,
			Message:     "cache sync timed out",
			ErrorCode:   "TIMEOUT",
		})
		if err := informer.RemoveEventHandler(registration); err != nil {
			log.Printf("failed to remove event handler for %s: %v", meta.Key(), err)
		}
		return fmt.Errorf("cache sync timed out for %s", meta.Key())
	}

	// Burst existing items as ADD
	items, err := client.DynamicInformerFactory.ForResource(s.resourceType).Lister().List(labels.Everything())
	count := 0
	if err == nil {
		count = len(items)
		for _, item := range items {
			u, ok := item.(*unstructured.Unstructured)
			if !ok || u == nil {
				continue
			}
			data, marshalErr := u.MarshalJSON()
			if marshalErr != nil {
				continue
			}
			sink.OnAdd(resource.WatchAddPayload{
				Data:      data,
				Key:       meta.Key(),
				ID:        u.GetName(),
				Namespace: u.GetNamespace(),
			})
		}
	}

	log.Printf("[k8s-watch] %s: emitting SYNCED count=%d", meta.Key(), count)
	sink.OnStateChange(resource.WatchStateEvent{
		ResourceKey:   meta.Key(),
		State:         resource.WatchStateSynced,
		ResourceCount: count,
	})

	// Block until context is cancelled
	<-ctx.Done()

	// Cleanup the event handler
	if err := informer.RemoveEventHandler(registration); err != nil {
		log.Printf("failed to remove event handler for %s: %v", meta.Key(), err)
	}

	return nil
}

// watchScoped runs per-namespace watches using namespace-scoped informer factories.
// One informer per namespace, aggregated sync, per-namespace error probing.
func (s *KubernetesResourcerBase[T]) watchScoped(
	ctx context.Context,
	client *clients.ClientSet,
	meta resource.ResourceMeta,
	sink resource.WatchEventSink,
	namespaces []string,
) error {
	log.Printf("[k8s-watch] %s: starting scoped watch for %d namespaces", meta.Key(), len(namespaces))

	sink.OnStateChange(resource.WatchStateEvent{
		ResourceKey: meta.Key(),
		State:       resource.WatchStateSyncing,
	})

	type nsInformer struct {
		ns           string
		factory      dynamicinformer.DynamicSharedInformerFactory
		registration cache.ResourceEventHandlerRegistration
	}

	handler := makeEventHandler(meta, sink)
	var active []nsInformer
	forbiddenCount := 0

	for _, ns := range namespaces {
		factory := client.GetOrCreateNamespaceFactory(ns)
		informer := factory.ForResource(s.resourceType).Informer()
		factory.Start(ctx.Done())

		reg, err := informer.AddEventHandler(handler)
		if err != nil {
			log.Printf("[k8s-watch] %s/%s: failed to add event handler: %v", meta.Key(), ns, err)
			continue
		}
		active = append(active, nsInformer{ns: ns, factory: factory, registration: reg})
	}

	if len(active) == 0 {
		sink.OnStateChange(resource.WatchStateEvent{
			ResourceKey: meta.Key(),
			State:       resource.WatchStateForbidden,
			Message:     "no accessible namespaces",
			ErrorCode:   "FORBIDDEN",
		})
		<-ctx.Done()
		return nil
	}

	// Wait for cache sync with 30s timeout, per namespace
	syncCtx, syncCancel := context.WithTimeout(ctx, 30*time.Second)
	defer syncCancel()

	var synced []nsInformer
	for _, ni := range active {
		informer := ni.factory.ForResource(s.resourceType).Informer()
		if cache.WaitForCacheSync(syncCtx.Done(), informer.HasSynced) {
			synced = append(synced, ni)
			continue
		}

		// Sync failed for this namespace — probe to classify
		_, listErr := client.DynamicClient.Resource(s.resourceType).Namespace(ni.ns).List(ctx, v1.ListOptions{Limit: 1})
		if listErr != nil {
			classified := classifyWatchError(listErr)
			if classified.isForbidden {
				log.Printf("[k8s-watch] %s/%s: FORBIDDEN: %s", meta.Key(), ni.ns, classified.message)
				forbiddenCount++
				if err := informer.RemoveEventHandler(ni.registration); err != nil {
					log.Printf("failed to remove event handler for %s/%s: %v", meta.Key(), ni.ns, err)
				}
				continue
			}
			if classified.isNotFound {
				log.Printf("[k8s-watch] %s/%s: NOT_FOUND (404): %s", meta.Key(), ni.ns, classified.message)
				if err := informer.RemoveEventHandler(ni.registration); err != nil {
					log.Printf("failed to remove event handler for %s/%s: %v", meta.Key(), ni.ns, err)
				}
				continue
			}
			if classified.isMethodNotAllowed {
				log.Printf("[k8s-watch] %s/%s: METHOD_NOT_ALLOWED (405): %s", meta.Key(), ni.ns, classified.message)
				if err := informer.RemoveEventHandler(ni.registration); err != nil {
					log.Printf("failed to remove event handler for %s/%s: %v", meta.Key(), ni.ns, err)
				}
				continue
			}
		}
		// Non-forbidden, non-404, non-405 failure — still include but log
		log.Printf("[k8s-watch] %s/%s: sync timed out, will include anyway", meta.Key(), ni.ns)
		synced = append(synced, ni)
	}

	if len(synced) == 0 {
		// All namespaces forbidden or failed
		sink.OnStateChange(resource.WatchStateEvent{
			ResourceKey: meta.Key(),
			State:       resource.WatchStateForbidden,
			Message:     fmt.Sprintf("access denied in all %d namespaces", len(namespaces)),
			ErrorCode:   "FORBIDDEN",
		})
		<-ctx.Done()
		return nil
	}

	// Burst existing items from all synced namespace listers
	totalCount := 0
	for _, ni := range synced {
		items, err := ni.factory.ForResource(s.resourceType).Lister().List(labels.Everything())
		if err != nil {
			continue
		}
		totalCount += len(items)
		for _, item := range items {
			u, ok := item.(*unstructured.Unstructured)
			if !ok || u == nil {
				continue
			}
			data, marshalErr := u.MarshalJSON()
			if marshalErr != nil {
				continue
			}
			sink.OnAdd(resource.WatchAddPayload{
				Data:      data,
				Key:       meta.Key(),
				ID:        u.GetName(),
				Namespace: u.GetNamespace(),
			})
		}
	}

	log.Printf("[k8s-watch] %s: scoped SYNCED count=%d (forbidden=%d)", meta.Key(), totalCount, forbiddenCount)
	sink.OnStateChange(resource.WatchStateEvent{
		ResourceKey:   meta.Key(),
		State:         resource.WatchStateSynced,
		ResourceCount: totalCount,
	})

	// Block until context is cancelled
	<-ctx.Done()

	// Cleanup event handlers
	for _, ni := range active {
		informer := ni.factory.ForResource(s.resourceType).Informer()
		if err := informer.RemoveEventHandler(ni.registration); err != nil {
			log.Printf("failed to remove event handler for %s/%s: %v", meta.Key(), ni.ns, err)
		}
	}

	return nil
}
