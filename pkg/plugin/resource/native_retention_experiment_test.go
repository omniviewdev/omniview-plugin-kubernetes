//go:build native_retention_experiment

package resource

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"maps"
	"math"
	"os"
	"reflect"
	"runtime"
	"runtime/metrics"
	"runtime/pprof"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourcepb "github.com/omniviewdev/plugin-sdk/proto/resource/v2"
	"google.golang.org/protobuf/proto"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	k8sruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
)

var (
	nativeRetentionEnabled = flag.Bool("native-retention-experiment", false, "Enable the isolated single-body informer retention experiment")
	nativeRetentionMode    = flag.String("native-retention-mode", "unstructured", "Retained informer object: unstructured, tagged or proto")
	nativeRetentionHeap    = flag.String("native-retention-heap", "", "Optional exclusive-create post-GC snapshot heap profile; requires -benchtime=1x")
)

// nativeRetentionObject owns exactly one encoded body. PartialObjectMetadata
// supplies client-go's key, namespace-index and resourceVersion accessors.
// The remaining metadata, including unknown fields, stays inside body.
// This is an experiment, not a second production cache or a wire format.
type nativeRetentionObject struct {
	metav1.PartialObjectMetadata
	body     []byte
	bodyErr  error
	protobuf bool
}

func (object *nativeRetentionObject) DeepCopyObject() k8sruntime.Object {
	if object == nil {
		return nil
	}
	copy := *object
	copy.PartialObjectMetadata = *object.PartialObjectMetadata.DeepCopy()
	copy.body = append([]byte(nil), object.body...)
	return &copy
}

func nativeRetentionTransform(input any) (any, error) {
	return nativeRetentionPack(input, false)
}

func nativeRetentionProtoTransform(input any) (any, error) {
	return nativeRetentionPack(input, true)
}

func nativeRetentionPack(input any, protobuf bool) (any, error) {
	if object, ok := input.(*nativeRetentionObject); ok && object != nil {
		return object, nil
	}
	object, ok := input.(*unstructured.Unstructured)
	if !ok || object == nil {
		return nil, fmt.Errorf("retention transform received %T", input)
	}
	packed := &nativeRetentionObject{PartialObjectMetadata: metav1.PartialObjectMetadata{
		TypeMeta: metav1.TypeMeta{APIVersion: object.GetAPIVersion(), Kind: object.GetKind()},
		ObjectMeta: metav1.ObjectMeta{
			Name: object.GetName(), Namespace: object.GetNamespace(), UID: object.GetUID(),
			ResourceVersion: object.GetResourceVersion(), CreationTimestamp: object.GetCreationTimestamp(),
			Labels: object.GetLabels(),
		},
	}}
	packed.protobuf = protobuf
	body, err := resourcev2.ValueFromNative(object.Object)
	if err == nil {
		if protobuf {
			var message *resourcepb.Value
			message, err = resourcev2.ToProtoValue(body)
			if err == nil {
				packed.body, err = proto.Marshal(message)
			}
		} else {
			packed.body, err = body.MarshalJSON()
		}
	}
	// Do not return body errors to the reflector's retry loop. A source must
	// receive the same conversion failure instead of hanging before HasSynced.
	// No invalid full map is retained as a fallback.
	packed.bodyErr = err
	return packed, nil
}

func nativeRetentionObservation(target resourcev2.ReadTarget, representation resourcev2.Representation, input any) (resourcev2.SourceObservation, error) {
	if tombstone, ok := input.(cache.DeletedFinalStateUnknown); ok {
		input = tombstone.Obj
	}
	var object metav1.Object
	var body resourcev2.Value
	var labels map[string]string
	var err error
	switch native := input.(type) {
	case *unstructured.Unstructured:
		if native == nil {
			return resourcev2.SourceObservation{}, fmt.Errorf("nil unstructured cache object")
		}
		object = native
		body, err = resourcev2.ValueFromNative(native.Object)
		labels = native.GetLabels()
	case *nativeRetentionObject:
		if native == nil {
			return resourcev2.SourceObservation{}, fmt.Errorf("nil compact cache object")
		}
		object = native
		err = native.bodyErr
		if err == nil && native.protobuf {
			var message resourcepb.Value
			err = proto.Unmarshal(native.body, &message)
			if err == nil {
				body, err = resourcev2.FromProtoValue(&message)
			}
		} else if err == nil {
			err = body.UnmarshalJSON(native.body)
		}
		labels = maps.Clone(native.Labels)
	default:
		return resourcev2.SourceObservation{}, fmt.Errorf("retention observation received %T", input)
	}
	if err != nil {
		return resourcev2.SourceObservation{}, err
	}
	address := resourcev2.ResourceAddress{Provider: target.Provider, Authority: target.Authority, Type: target.Type, ID: object.GetName(), Scope: []resourcev2.ScopeEntry{}}
	if namespace := object.GetNamespace(); namespace != "" {
		address.Scope = []resourcev2.ScopeEntry{{Dimension: "namespace", Value: namespace}}
	}
	record := resourcev2.Record{
		Reference: resourcev2.ResourceReference{Address: address, Incarnation: nativeOptionalToken(string(object.GetUID()))},
		Body:      body, Representation: representation, Coverage: nativeCompleteCoverage(),
		SourceRevision: nativeOptionalToken(object.GetResourceVersion()),
	}
	if err := resourcev2.ValidateRecord(record); err != nil {
		return resourcev2.SourceObservation{}, err
	}
	observation := resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)}
	metadata := resourcev2.ResourceMetadata{Labels: labels}
	if created := object.GetCreationTimestamp(); !created.IsZero() {
		metadata.CreatedAt = &created.Time
	}
	if len(metadata.Labels) != 0 || metadata.CreatedAt != nil {
		observation.Metadata = &metadata
	}
	return observation, nil
}

func nativeRetentionBinding() (resourcev2.ReadTarget, resourcev2.Representation) {
	return resourcev2.ReadTarget{Provider: "kubernetes", Authority: "native-profile-host-authority", Type: "k8s:/pods"}, resourcev2.Representation{ID: "native-retention-experiment", Revision: "1"}
}

type nativeRetentionResult struct {
	Mode           string                   `json:"mode"`
	Pods           int                      `json:"pods"`
	Namespaces     int                      `json:"namespaces"`
	AcquireMS      float64                  `json:"acquireMS"`
	SnapshotMS     float64                  `json:"snapshotMS"`
	LiveMS         float64                  `json:"liveMS"`
	AllocatedBytes uint64                   `json:"allocatedBytes"`
	Allocations    uint64                   `json:"allocations"`
	GCCycles       uint32                   `json:"gcCycles"`
	GCPauseNS      uint64                   `json:"gcPauseNS"`
	GCCPUSeconds   float64                  `json:"gcCPUSeconds"`
	RetainedBytes  uint64                   `json:"retainedBytes"`
	API            nativeProfileAPICounters `json:"api"`
}

// BenchmarkNativeRetention runs the actual client-go dynamic informer against
// the existing disk-backed TLS corpus. Only its retained-object transform and
// source-body conversion differ. This is not a provider-connect benchmark.
func BenchmarkNativeRetention(b *testing.B) {
	if !*nativeRetentionEnabled {
		b.Skip("opt in with -tags=native_retention_experiment and -native-retention-experiment")
	}
	if *nativeRetentionMode != "unstructured" && *nativeRetentionMode != "tagged" && *nativeRetentionMode != "proto" {
		b.Fatal("native-retention-mode must be unstructured, tagged or proto")
	}
	if *nativeProfilePods < 1 || *nativeProfilePods > 100000 || *nativeProfileNamespaces < 1 || *nativeProfileNamespaces > min(*nativeProfilePods, 1000) || *nativeProfileGroupVersions < 0 || *nativeProfileGroupVersions >= maxNativeDiscoveryVersions || *nativeProfileGETLatency < 0 || *nativeProfileGETLatency > time.Second || *nativeProfileLiveHold < 0 || *nativeProfileLiveHold > 30*time.Second {
		b.Fatal("native profile fixture flag outside its documented bounds")
	}
	if *nativeRetentionHeap != "" && b.N != 1 {
		b.Fatal("native-retention-heap requires -benchtime=1x")
	}
	b.StopTimer()
	var fixture *nativeProfileFixture
	pprof.Do(context.Background(), pprof.Labels("native-retention-phase", "fixture-build"), func(context.Context) {
		fixture = newNativeProfileFixture(b, b.TempDir(), *nativeProfilePods, *nativeProfileNamespaces, *nativeProfileGroupVersions)
	})
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		result := runNativeRetention(b, fixture)
		encoded, err := json.Marshal(result)
		if err != nil {
			b.Fatal(err)
		}
		b.Logf("NATIVE_RETENTION %s", encoded)
		b.ReportMetric(result.AcquireMS, "acquire-ms/op")
		b.ReportMetric(result.SnapshotMS, "snapshot-ms/op")
		b.ReportMetric(result.LiveMS, "live-ms/op")
		b.ReportMetric(float64(result.AllocatedBytes), "snapshot-alloc-B/op")
		b.ReportMetric(float64(result.Allocations), "snapshot-allocs/op")
		b.ReportMetric(float64(result.GCCycles), "snapshot-GC/op")
		b.ReportMetric(result.GCCPUSeconds, "snapshot-GC-cpu-s/op")
		b.ReportMetric(float64(result.RetainedBytes)/(1<<20), "retained-MiB")
	}
}

func nativeRetentionGCCPU() float64 {
	samples := [1]metrics.Sample{{Name: "/cpu/classes/gc/total:cpu-seconds"}}
	metrics.Read(samples[:])
	return samples[0].Value.Float64()
}

func runNativeRetention(b *testing.B, fixture *nativeProfileFixture) nativeRetentionResult {
	b.Helper()
	api := newNativeProfileAPI(fixture, *nativeProfileGETLatency)
	defer api.close()
	client, err := dynamic.NewForConfig(&rest.Config{Host: api.server.URL, BearerToken: nativeProfileToken, TLSClientConfig: rest.TLSClientConfig{Insecure: true}})
	if err != nil {
		b.Fatal(err)
	}
	factory := dynamicinformer.NewFilteredDynamicSharedInformerFactory(client, clients.DefaultResyncPeriod, metav1.NamespaceAll, nil)
	informer := factory.ForResource(schema.GroupVersionResource{Version: "v1", Resource: "pods"}).Informer()
	var transform cache.TransformFunc
	switch *nativeRetentionMode {
	case "tagged":
		transform = nativeRetentionTransform
	case "proto":
		transform = nativeRetentionProtoTransform
	}
	if transform != nil {
		if err := informer.SetTransform(transform); err != nil {
			b.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer func() {
		cancel()
		factory.Shutdown()
	}()
	updates := make(chan any, 4)
	var overflow atomic.Bool
	registration, err := informer.AddEventHandler(cache.ResourceEventHandlerFuncs{UpdateFunc: func(old, next any) {
		before, oldErr := meta.Accessor(old)
		after, newErr := meta.Accessor(next)
		beforeType, oldTypeErr := meta.TypeAccessor(old)
		afterType, newTypeErr := meta.TypeAccessor(next)
		if oldErr == nil && newErr == nil && oldTypeErr == nil && newTypeErr == nil &&
			after.GetResourceVersion() != "" && before.GetResourceVersion() == after.GetResourceVersion() &&
			before.GetUID() == after.GetUID() && before.GetName() == after.GetName() &&
			before.GetNamespace() == after.GetNamespace() &&
			beforeType.GetAPIVersion() == afterType.GetAPIVersion() && beforeType.GetKind() == afterType.GetKind() {
			return
		}
		select {
		case updates <- next:
		default:
			overflow.Store(true)
		}
	}})
	if err != nil {
		b.Fatal(err)
	}
	target, representation := nativeRetentionBinding()
	namespaces := make([]string, fixture.namespaces)
	for index := range namespaces {
		namespaces[index] = fmt.Sprintf("workload-%03d", index)
	}
	emitter := &nativeProfileEmitter{fixture: fixture, namespaceNames: namespaces, events: make(chan nativeProfileEvent, 8), seen: make([]uint64, (fixture.count+63)/64)}
	result := nativeRetentionResult{Mode: *nativeRetentionMode, Pods: fixture.count, Namespaces: fixture.namespaces}
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	gcCPU := nativeRetentionGCCPU()
	start := time.Now()
	api.mu.Lock()
	api.start = start
	api.mu.Unlock()
	b.StartTimer()
	pprof.Do(ctx, pprof.Labels("native-retention-phase", "acquire"), func(context.Context) {
		factory.Start(ctx.Done())
		if !cache.WaitForCacheSync(ctx.Done(), registration.HasSynced) {
			b.Fatalf("informer initial delivery failed: %v; API=%+v", ctx.Err(), api.snapshot())
		}
	})
	result.AcquireMS = float64(time.Since(start)) / float64(time.Millisecond)
	readCounts := api.snapshot()
	pprof.Do(ctx, pprof.Labels("native-retention-phase", "snapshot"), func(ctx context.Context) {
		batch := make([]resourcev2.SourceObservation, 0, resourcev2.MaxSourceBatchItems)
		for _, object := range informer.GetStore().List() {
			observation, err := nativeRetentionObservation(target, representation, object)
			if err != nil {
				b.Fatal(err)
			}
			batch = append(batch, observation)
			if len(batch) == resourcev2.MaxSourceBatchItems {
				if err := emitter.Snapshot(ctx, batch); err != nil {
					b.Fatal(err)
				}
				batch = make([]resourcev2.SourceObservation, 0, resourcev2.MaxSourceBatchItems)
			}
		}
		if len(batch) != 0 {
			if err := emitter.Snapshot(ctx, batch); err != nil {
				b.Fatal(err)
			}
		}
		if err := emitter.EndSnapshot(ctx, resourcev2.SourceCoverage{Enumeration: resourcev2.EnumerationExhausted, Consistency: resourcev2.ConsistencyBestEffort}, resourcev2.ContinuityBestEffort); err != nil {
			b.Fatal(err)
		}
	})
	result.SnapshotMS = float64(time.Since(start)) / float64(time.Millisecond)
	b.StopTimer()
	runtime.ReadMemStats(&after)
	result.AllocatedBytes, result.Allocations = after.TotalAlloc-before.TotalAlloc, after.Mallocs-before.Mallocs
	result.GCCycles, result.GCPauseNS = after.NumGC-before.NumGC, after.PauseTotalNs-before.PauseTotalNs
	result.GCCPUSeconds = nativeRetentionGCCPU() - gcCPU
	if counts := api.snapshot(); counts.Lists != readCounts.Lists || counts.ListItems != readCounts.ListItems {
		b.Fatalf("snapshot refetched native bodies: before=%+v after=%+v", readCounts, counts)
	}
	pprof.Do(ctx, pprof.Labels("native-retention-phase", "heap-checkpoint"), func(context.Context) {
		runtime.GC()
		runtime.ReadMemStats(&after)
		result.RetainedBytes = after.HeapAlloc
		if *nativeRetentionHeap != "" {
			file, err := os.OpenFile(*nativeRetentionHeap, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if err != nil {
				b.Fatal(err)
			}
			writeErr := pprof.WriteHeapProfile(file)
			closeErr := file.Close()
			if writeErr != nil || closeErr != nil {
				b.Fatalf("heap profile: write=%v close=%v", writeErr, closeErr)
			}
		}
		runtime.KeepAlive(informer)
	})
	// Full-body and metadata checks run outside the measured source interval.
	// They read expected bytes from disk, never from another in-memory cache.
	pprof.Do(ctx, pprof.Labels("native-retention-phase", "assertions"), func(context.Context) {
		for _, object := range informer.GetStore().List() {
			observation, err := nativeRetentionObservation(target, representation, object)
			if err != nil {
				b.Fatal(err)
			}
			index, err := emitter.checkRecord(observation.Record, nativeProfileRV)
			if err != nil {
				b.Fatal(err)
			}
			expected, err := io.ReadAll(io.NewSectionReader(fixture.pods, fixture.offsets[index], fixture.offsets[index+1]-fixture.offsets[index]-1))
			if err != nil {
				b.Fatal(err)
			}
			assertNativeRetentionBody(b, target, representation, observation, expected)
		}
	})
	if counts := api.snapshot(); counts.Lists != readCounts.Lists || counts.ListItems != readCounts.ListItems || counts.Error != "" {
		b.Fatalf("body assertions caused native requests: before=%+v after=%+v", readCounts, counts)
	}
	liveStart := time.Now()
	b.StartTimer()
	pprof.Do(ctx, pprof.Labels("native-retention-phase", "live"), func(ctx context.Context) {
		close(api.update)
		select {
		case object := <-updates:
			observation, err := nativeRetentionObservation(target, representation, object)
			if err != nil {
				b.Fatal(err)
			}
			if err := emitter.Changes(ctx, []resourcev2.SourceChange{{Kind: resourcev2.SourceChangeUpsert, Observation: &observation}}, nil); err != nil {
				b.Fatal(err)
			}
		case <-ctx.Done():
			b.Fatalf("live update not delivered: %v; API=%+v", ctx.Err(), api.snapshot())
		}
	})
	result.LiveMS = float64(time.Since(liveStart)) / float64(time.Millisecond)
	b.StopTimer()
	pprof.Do(ctx, pprof.Labels("native-retention-phase", "assertions"), func(context.Context) {
		object, exists, err := informer.GetStore().GetByKey("workload-000/pod-000000")
		if err != nil || !exists {
			b.Fatalf("updated store object unavailable: exists=%t error=%v", exists, err)
		}
		observation, err := nativeRetentionObservation(target, representation, object)
		if err != nil {
			b.Fatal(err)
		}
		assertNativeRetentionBody(b, target, representation, observation, fixture.changed)
	})
	if *nativeProfileLiveHold > 0 {
		select {
		case <-time.After(*nativeProfileLiveHold):
		case <-ctx.Done():
			b.Fatal(ctx.Err())
		}
	}
	cancel()
	factory.Shutdown()
	api.close()
	result.API = api.snapshot()
	if result.API.Error != "" || result.API.Watches == 0 || api.active.Load() != 0 || overflow.Load() || !emitter.live {
		b.Fatalf("invalid native lifecycle: API=%+v active=%d overflow=%t live=%t", result.API, api.active.Load(), overflow.Load(), emitter.live)
	}
	return result
}

func assertNativeRetentionBody(b *testing.B, target resourcev2.ReadTarget, representation resourcev2.Representation, actual resourcev2.SourceObservation, document []byte) {
	b.Helper()
	var object unstructured.Unstructured
	if err := object.UnmarshalJSON(document); err != nil {
		b.Fatal(err)
	}
	expected, err := nativeRetentionObservation(target, representation, &object)
	if err != nil {
		b.Fatal(err)
	}
	if !reflect.DeepEqual(expected, actual) {
		b.Fatalf("full native body/metadata changed for %s", actual.Record.Reference.Address.ID)
	}
}

func TestNativeRetentionContract(t *testing.T) {
	if !*nativeRetentionEnabled {
		t.Skip("opt in with -native-retention-experiment")
	}
	target, representation := nativeRetentionBinding()
	newObject := func(version string) *unstructured.Unstructured {
		return &unstructured.Unstructured{Object: map[string]any{
			"apiVersion": "unknown.example/v1", "kind": "ArbitraryWidget",
			"metadata": map[string]any{"name": "number", "namespace": "team", "uid": "opaque-uid", "resourceVersion": version, "creationTimestamp": "2026-11-01T12:00:00Z", "labels": map[string]any{"app": "original"}},
			"unknown":  map[string]any{"exact": int64(math.MaxInt64), "double": float64(3), "negativeZero": math.Copysign(0, -1), "nested": []any{nil, true, "value"}},
		}}
	}
	for _, codec := range []struct {
		name      string
		transform cache.TransformFunc
	}{{"tagged", nativeRetentionTransform}, {"proto", nativeRetentionProtoTransform}} {
		t.Run(codec.name, func(t *testing.T) {
			transform := codec.transform
			t.Run("owned-body-and-scalar-intent", func(t *testing.T) {
				object := newObject("opaque:9")
				expected, err := nativeRetentionObservation(target, representation, object)
				if err != nil {
					t.Fatal(err)
				}
				store := cache.NewIndexer(cache.DeletionHandlingMetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc}, cache.WithTransformer(transform))
				if err := store.Add(object); err != nil {
					t.Fatal(err)
				}
				stored, found, err := store.GetByKey("team/number")
				if err != nil || !found {
					t.Fatalf("compact key lookup: found=%t error=%v", found, err)
				}
				packed, ok := stored.(*nativeRetentionObject)
				if !ok || packed.bodyErr != nil || len(packed.body) == 0 {
					t.Fatalf("not one encoded cache body: %T", stored)
				}
				indexed, err := store.ByIndex(cache.NamespaceIndex, "team")
				if err != nil || len(indexed) != 1 || indexed[0] != stored {
					t.Fatal("compact metadata broke namespace index")
				}
				if same, err := transform(packed); err != nil || same != packed {
					t.Fatal("transform is not idempotent")
				}
				object.Object["unknown"].(map[string]any)["exact"] = int64(0)
				object.SetLabels(map[string]string{"app": "changed"})
				actual, err := nativeRetentionObservation(target, representation, packed)
				if err != nil || !reflect.DeepEqual(expected, actual) || !math.Signbit(actual.Record.Body.Map["unknown"].Map["negativeZero"].Double) {
					t.Fatalf("compact body lost ownership or scalar intent: %v", err)
				}
				actual.Metadata.Labels["app"] = "caller-change"
				actual.Record.Body.Map["unknown"] = resourcev2.Value{Kind: "null"}
				again, err := nativeRetentionObservation(target, representation, packed)
				if err != nil || !reflect.DeepEqual(expected, again) {
					t.Fatal("source output mutated the retained object")
				}
				copy := packed.DeepCopyObject().(*nativeRetentionObject)
				copy.body[0] = '!'
				copy.Labels["app"] = "copy-change"
				if packed.body[0] == '!' || packed.Labels["app"] != "original" {
					t.Fatal("runtime DeepCopyObject aliases compact storage")
				}
				cluster := newObject("cluster:1")
				cluster.SetNamespace("")
				clusterPacked, err := transform(cluster)
				if err != nil {
					t.Fatal(err)
				}
				clusterObservation, err := nativeRetentionObservation(target, representation, clusterPacked)
				if err != nil || len(clusterObservation.Record.Reference.Address.Scope) != 0 {
					t.Fatal("cluster scope gained a namespace")
				}
			})
			t.Run("delta-update-resync-and-tombstone", func(t *testing.T) {
				store := cache.NewStore(cache.DeletionHandlingMetaNamespaceKeyFunc)
				fifo := cache.NewDeltaFIFOWithOptions(cache.DeltaFIFOOptions{KnownObjects: store, Transformer: transform, EmitDeltaTypeReplaced: true})
				defer fifo.Close()
				var deleted any
				pop := func() {
					t.Helper()
					_, err := fifo.Pop(func(input any, _ bool) error {
						for _, delta := range input.(cache.Deltas) {
							if delta.Type == cache.Deleted {
								deleted = delta.Object
								if err := store.Delete(delta.Object); err != nil {
									return err
								}
							} else if err := store.Update(delta.Object); err != nil {
								return err
							}
						}
						return nil
					})
					if err != nil {
						t.Fatal(err)
					}
				}
				if err := fifo.Add(newObject("opaque:9")); err != nil {
					t.Fatal(err)
				}
				pop()
				first, _, _ := store.GetByKey("team/number")
				if _, ok := first.(*nativeRetentionObject); !ok {
					t.Fatalf("queue retained %T instead of compact object", first)
				}
				if err := fifo.Resync(); err != nil {
					t.Fatal(err)
				}
				pop()
				if current, _, _ := store.GetByKey("team/number"); current != first {
					t.Fatal("resync re-encoded the cached object")
				}
				if err := fifo.Update(newObject("opaque:10")); err != nil {
					t.Fatal(err)
				}
				pop()
				current, _, _ := store.GetByKey("team/number")
				if current == first || current.(*nativeRetentionObject).GetResourceVersion() != "opaque:10" {
					t.Fatal("update did not replace compact cache state")
				}
				if err := fifo.Replace(nil, "opaque:11"); err != nil {
					t.Fatal(err)
				}
				pop()
				tombstone, ok := deleted.(cache.DeletedFinalStateUnknown)
				if !ok || tombstone.Obj != current || tombstone.Key != "team/number" {
					t.Fatal("relist deletion lost the final compact object")
				}
				observation, err := nativeRetentionObservation(target, representation, tombstone)
				if err != nil || observation.Record.SourceRevision == nil || *observation.Record.SourceRevision != "opaque:10" || len(store.List()) != 0 {
					t.Fatal("tombstone lost revision/body or failed to delete cache state")
				}
			})
			t.Run("body-error-reaches-source", func(t *testing.T) {
				object := newObject("opaque:error")
				object.Object["unsupported"] = make(chan int)
				stored, err := transform(object)
				if err != nil {
					t.Fatalf("body failure escaped into reflector retries: %v", err)
				}
				packed := stored.(*nativeRetentionObject)
				if len(packed.body) != 0 || packed.bodyErr == nil {
					t.Fatal("invalid body retained a fallback or lost its error")
				}
				if _, err := nativeRetentionObservation(target, representation, packed); err == nil {
					t.Fatal("source failed to report body conversion error")
				}
			})
		})
	}
	t.Run("proto-native-limits", testNativeRetentionProtoLimits)
}

func testNativeRetentionProtoLimits(t *testing.T) {
	target, representation := nativeRetentionBinding()
	newObject := func(payload any) *unstructured.Unstructured {
		return &unstructured.Unstructured{Object: map[string]any{
			"apiVersion": "unknown.example/v1", "kind": "ArbitraryWidget",
			"metadata": map[string]any{"name": "boundary"}, "payload": payload,
		}}
	}
	check := func(t *testing.T, object *unstructured.Unstructured, wantCode string) {
		t.Helper()
		expected, expectedErr := nativeRetentionObservation(target, representation, object)
		store := cache.NewStore(cache.DeletionHandlingMetaNamespaceKeyFunc, cache.WithTransformer(nativeRetentionProtoTransform))
		if err := store.Add(object); err != nil {
			t.Fatalf("body admission escaped into store retries: %v", err)
		}
		stored, found, err := store.GetByKey(object.GetName())
		if err != nil || !found {
			t.Fatalf("boundary store lookup: found=%t error=%v", found, err)
		}
		actual, actualErr := nativeRetentionObservation(target, representation, stored)
		if wantCode != "" {
			if resourcev2.ErrorCode(expectedErr) != wantCode || resourcev2.ErrorCode(actualErr) != wantCode {
				t.Fatalf("boundary admission changed: baseline=%v proto=%v want=%s", expectedErr, actualErr, wantCode)
			}
			return
		}
		if expectedErr != nil || actualErr != nil || !reflect.DeepEqual(expected, actual) {
			t.Fatalf("admitted native boundary did not round-trip: baseline=%v proto=%v", expectedErr, actualErr)
		}
	}
	t.Run("protobuf-body-byte-boundary", func(t *testing.T) {
		text := strings.Repeat("x", resourcev2.MaxDocumentBytes)
		length := resourcev2.MaxDocumentBytes - 1024
		object := newObject(text[:length])
		body, err := resourcev2.ValueFromNative(object.Object)
		if err != nil {
			t.Fatal(err)
		}
		size, err := resourcev2.ValueWireSize(body)
		if err != nil {
			t.Fatal(err)
		}
		length += resourcev2.MaxDocumentBytes - size
		object.Object["payload"] = text[:length]
		body, err = resourcev2.ValueFromNative(object.Object)
		if err != nil {
			t.Fatal(err)
		}
		if size, err = resourcev2.ValueWireSize(body); err != nil || size != resourcev2.MaxDocumentBytes {
			t.Fatalf("fixture misses exact native byte boundary: size=%d error=%v", size, err)
		}
		check(t, object, "")
		object.Object["payload"] = text[:length+1]
		check(t, object, "RESOURCE_LIMIT")
	})
	t.Run("semantic-depth-boundary", func(t *testing.T) {
		var payload any
		for depth := 1; depth < resourcev2.MaxValueDepth; depth++ {
			payload = map[string]any{"child": payload}
		}
		object := newObject(payload)
		check(t, object, "")
		object.Object["payload"] = map[string]any{"child": payload}
		check(t, object, "RESOURCE_LIMIT")
	})
	t.Run("semantic-node-boundary", func(t *testing.T) {
		// The root, apiVersion, kind, metadata, name and payload list use six nodes.
		items := make([]any, resourcev2.MaxValueNodes-6, resourcev2.MaxValueNodes-5)
		object := newObject(items)
		check(t, object, "")
		object.Object["payload"] = append(items, nil)
		check(t, object, "RESOURCE_LIMIT")
	})
}
