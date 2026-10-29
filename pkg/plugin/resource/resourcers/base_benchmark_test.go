package resourcers

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// representativePodJSON models a running Deployment pod, including the managedFields
// returned by Kubernetes. Keep this payload shared between callback and List benchmarks.
const representativePodJSON = `{
  "apiVersion": "v1",
  "kind": "Pod",
  "metadata": {
    "name": "web-7c8b6c9d5f-00000",
    "namespace": "production",
    "uid": "86c3ac40-2f5c-4cc1-8b6c-000000000000",
    "resourceVersion": "10000",
    "creationTimestamp": "2026-10-01T12:00:00Z",
    "labels": {
      "app.kubernetes.io/name": "web",
      "app.kubernetes.io/instance": "production",
      "app.kubernetes.io/component": "frontend",
      "app.kubernetes.io/managed-by": "Helm",
      "pod-template-hash": "7c8b6c9d5f"
    },
    "annotations": {
      "checksum/config": "f20cbb678e8ad1f9a45d65317b60794a5da5d148c3b872a3f603d9acb76f29b3",
      "prometheus.io/scrape": "true",
      "prometheus.io/port": "8080",
      "kubectl.kubernetes.io/restartedAt": "2026-10-01T12:00:00Z"
    },
    "ownerReferences": [{
      "apiVersion": "apps/v1", "kind": "ReplicaSet", "name": "web-7c8b6c9d5f",
      "uid": "75243ca2-aa97-42b5-849a-a358b9929783", "controller": true, "blockOwnerDeletion": true
    }],
    "managedFields": [{
      "manager": "kube-controller-manager", "operation": "Update", "apiVersion": "v1",
      "time": "2026-10-01T12:00:00Z", "fieldsType": "FieldsV1",
      "fieldsV1": {
        "f:metadata": {
          "f:annotations": {".": {}, "f:checksum/config": {}, "f:prometheus.io/scrape": {}, "f:prometheus.io/port": {}, "f:kubectl.kubernetes.io/restartedAt": {}},
          "f:labels": {".": {}, "f:app.kubernetes.io/name": {}, "f:app.kubernetes.io/instance": {}, "f:app.kubernetes.io/component": {}, "f:app.kubernetes.io/managed-by": {}, "f:pod-template-hash": {}},
          "f:ownerReferences": {".": {}, "k:{\"uid\":\"75243ca2-aa97-42b5-849a-a358b9929783\"}": {}}
        },
        "f:spec": {
          "f:containers": {
            "k:{\"name\":\"web\"}": {
              ".": {}, "f:name": {}, "f:image": {}, "f:imagePullPolicy": {},
              "f:ports": {".": {}, "k:{\"containerPort\":8080,\"protocol\":\"TCP\"}": {".": {}, "f:containerPort": {}, "f:name": {}, "f:protocol": {}}},
              "f:env": {".": {}, "k:{\"name\":\"APP_ENV\"}": {".": {}, "f:name": {}, "f:value": {}}, "k:{\"name\":\"CONFIG_PATH\"}": {".": {}, "f:name": {}, "f:value": {}}},
              "f:resources": {".": {}, "f:limits": {".": {}, "f:cpu": {}, "f:memory": {}}, "f:requests": {".": {}, "f:cpu": {}, "f:memory": {}}},
              "f:readinessProbe": {".": {}, "f:httpGet": {".": {}, "f:path": {}, "f:port": {}, "f:scheme": {}}, "f:initialDelaySeconds": {}, "f:periodSeconds": {}},
              "f:volumeMounts": {".": {}, "k:{\"mountPath\":\"/etc/web\"}": {".": {}, "f:mountPath": {}, "f:name": {}, "f:readOnly": {}}}
            }
          },
          "f:dnsPolicy": {}, "f:restartPolicy": {}, "f:schedulerName": {}, "f:serviceAccountName": {},
          "f:terminationGracePeriodSeconds": {}, "f:volumes": {".": {}, "k:{\"name\":\"config\"}": {".": {}, "f:name": {}, "f:configMap": {".": {}, "f:name": {}}}}
        }
      }
    }, {
      "manager": "kubelet", "operation": "Update", "apiVersion": "v1", "subresource": "status",
      "time": "2026-10-01T12:00:12Z", "fieldsType": "FieldsV1",
      "fieldsV1": {"f:status": {
        "f:conditions": {"k:{\"type\":\"Initialized\"}": {".": {}, "f:lastTransitionTime": {}, "f:status": {}, "f:type": {}}, "k:{\"type\":\"Ready\"}": {".": {}, "f:lastTransitionTime": {}, "f:status": {}, "f:type": {}}, "k:{\"type\":\"ContainersReady\"}": {".": {}, "f:lastTransitionTime": {}, "f:status": {}, "f:type": {}}},
        "f:containerStatuses": {}, "f:hostIP": {}, "f:phase": {}, "f:podIP": {}, "f:podIPs": {".": {}, "k:{\"ip\":\"10.244.2.17\"}": {".": {}, "f:ip": {}}}, "f:startTime": {}
      }}
    }]
  },
  "spec": {
    "nodeName": "worker-02",
    "serviceAccountName": "web",
    "restartPolicy": "Always",
    "dnsPolicy": "ClusterFirst",
    "schedulerName": "default-scheduler",
    "terminationGracePeriodSeconds": 30,
    "securityContext": {"runAsNonRoot": true, "runAsUser": 1000, "fsGroup": 1000},
    "containers": [{
      "name": "web", "image": "registry.example.com/web:2026.10.1", "imagePullPolicy": "IfNotPresent",
      "ports": [{"name": "http", "containerPort": 8080, "protocol": "TCP"}],
      "env": [{"name": "APP_ENV", "value": "production"}, {"name": "CONFIG_PATH", "value": "/etc/web/config.yaml"}],
      "resources": {"requests": {"cpu": "100m", "memory": "128Mi"}, "limits": {"cpu": "500m", "memory": "512Mi"}},
      "readinessProbe": {"httpGet": {"path": "/ready", "port": "http", "scheme": "HTTP"}, "initialDelaySeconds": 5, "periodSeconds": 10},
      "volumeMounts": [{"name": "config", "mountPath": "/etc/web", "readOnly": true}]
    }],
    "volumes": [{"name": "config", "configMap": {"name": "web-config"}}],
    "tolerations": [{"key": "node.kubernetes.io/not-ready", "operator": "Exists", "effect": "NoExecute", "tolerationSeconds": 300}]
  },
  "status": {
    "phase": "Running", "hostIP": "192.168.1.12", "podIP": "10.244.2.17", "podIPs": [{"ip": "10.244.2.17"}],
    "startTime": "2026-10-01T12:00:01Z",
    "conditions": [
      {"type": "Initialized", "status": "True", "lastTransitionTime": "2026-10-01T12:00:01Z"},
      {"type": "Ready", "status": "True", "lastTransitionTime": "2026-10-01T12:00:12Z"},
      {"type": "ContainersReady", "status": "True", "lastTransitionTime": "2026-10-01T12:00:12Z"},
      {"type": "PodScheduled", "status": "True", "lastTransitionTime": "2026-10-01T12:00:01Z"}
    ],
    "containerStatuses": [{
      "name": "web", "ready": true, "restartCount": 0, "started": true,
      "image": "registry.example.com/web:2026.10.1",
      "imageID": "registry.example.com/web@sha256:5484c30da375b576128f9937e3caa9d977b857b93c19623dce79e73042cbe701",
      "containerID": "containerd://492d2264a908164daa266a8be2abca5482d83008ea909e393e08eac56f087345",
      "state": {"running": {"startedAt": "2026-10-01T12:00:10Z"}}
    }]
  }
}`

func newRepresentativeBenchmarkPod(b *testing.B, index int) *unstructured.Unstructured {
	b.Helper()
	pod := &unstructured.Unstructured{}
	if err := json.Unmarshal([]byte(representativePodJSON), pod); err != nil {
		b.Fatal(err)
	}
	pod.SetName(fmt.Sprintf("web-7c8b6c9d5f-%05d", index))
	pod.SetUID(types.UID(fmt.Sprintf("86c3ac40-2f5c-4cc1-8b6c-%012d", index)))
	return pod
}

// benchmarkUpdateSink counts delivery without retaining every serialized payload.
// This measures producer serialization and callback cost, not host SDK ingestion.
type benchmarkUpdateSink struct {
	updates int64
	bytes   int64
}

func (*benchmarkUpdateSink) OnAdd(resource.WatchAddPayload) {}
func (s *benchmarkUpdateSink) OnUpdate(p resource.WatchUpdatePayload) {
	s.updates++
	s.bytes += int64(len(p.Data))
}
func (*benchmarkUpdateSink) OnDelete(resource.WatchDeletePayload)   {}
func (*benchmarkUpdateSink) OnStateChange(resource.WatchStateEvent) {}

func BenchmarkMakeEventHandler_Update300Pods(b *testing.B) {
	for _, mode := range []string{"Changed", "UnchangedReplay", "EmptyVersion"} {
		b.Run(mode, func(b *testing.B) {
			const count = 300
			oldPods := make([]*unstructured.Unstructured, count)
			newPods := make([]*unstructured.Unstructured, count)
			for i := range oldPods {
				oldPods[i] = newRepresentativeBenchmarkPod(b, i)
				newPods[i] = oldPods[i].DeepCopy()
				switch mode {
				case "Changed":
					newPods[i].SetResourceVersion("10001")
					if err := unstructured.SetNestedField(newPods[i].Object, "192.168.1.13", "status", "hostIP"); err != nil {
						b.Fatal(err)
					}
				case "EmptyVersion":
					oldPods[i].SetResourceVersion("")
					newPods[i].SetResourceVersion("")
				}
			}
			sink := &benchmarkUpdateSink{}
			// Invoke the exact handler used by both scoped and unscoped watches.
			// Direct invocation isolates replay filtering from fake-client scheduling.
			handler := makeEventHandler(resource.ResourceMeta{Group: "core", Version: "v1", Kind: "Pod"}, sink)
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				for i := range oldPods {
					handler.UpdateFunc(oldPods[i], newPods[i])
				}
			}
			b.StopTimer()
			want := int64(b.N) * count
			if mode == "UnchangedReplay" {
				want = 0
			}
			if sink.updates != want {
				b.Fatalf("delivered %d updates, want %d", sink.updates, want)
			}
			b.ReportMetric(count, "pods/op")
			b.ReportMetric(float64(sink.updates)/float64(b.N), "events/op")
			b.ReportMetric(float64(sink.bytes)/float64(b.N), "encoded-B/op")
		})
	}
}

func BenchmarkBase_ListRepresentativePods(b *testing.B) {
	for _, count := range []int{300, 3000} {
		for _, synced := range []bool{true, false} {
			path := "UnsyncedClient"
			if synced {
				path = "SyncedCache"
			}
			b.Run(fmt.Sprintf("%s/Pods%d", path, count), func(b *testing.B) {
				objects := make([]runtime.Object, count)
				for i := range objects {
					objects[i] = newRepresentativeBenchmarkPod(b, i)
				}
				ctx, cancel := context.WithCancel(context.Background())
				cs := newFakeClientSet(defaultGVRListKinds(), objects...)
				b.Cleanup(func() {
					cancel()
					cs.DynamicInformerFactory.Shutdown()
				})
				informer := cs.DynamicInformerFactory.ForResource(testGVR).Informer()
				if synced {
					syncCtx, syncCancel := context.WithTimeout(ctx, 10*time.Second)
					cs.DynamicInformerFactory.Start(ctx.Done())
					cs.DynamicInformerFactory.WaitForCacheSync(syncCtx.Done())
					syncCancel()
					if !informer.HasSynced() {
						b.Fatal("pod informer did not sync")
					}
				}
				r := newBaseResourcer()
				result, err := r.List(ctx, cs, resource.ResourceMeta{}, resource.ListInput{})
				if err != nil {
					b.Fatal(err)
				}
				if len(result.Result) != count {
					b.Fatalf("listed %d pods, want %d", len(result.Result), count)
				}
				var payloadBytes int
				for _, pod := range result.Result {
					payloadBytes += len(pod)
				}
				b.ReportAllocs()
				b.ResetTimer()
				for range b.N {
					result, err = r.List(ctx, cs, resource.ResourceMeta{}, resource.ListInput{})
					if err != nil {
						b.Fatal(err)
					}
				}
				b.StopTimer()
				if len(result.Result) != count {
					b.Fatalf("listed %d pods, want %d", len(result.Result), count)
				}
				b.ReportMetric(float64(count), "pods/op")
				b.ReportMetric(float64(payloadBytes), "encoded-B/op")
			})
		}
	}
}
