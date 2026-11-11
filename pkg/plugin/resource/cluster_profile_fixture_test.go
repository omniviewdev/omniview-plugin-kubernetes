package resource

import (
	"bufio"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime/pprof"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
)

const (
	nativeProfileConnection = "native-profile"
	nativeProfileToken      = "native-profile-fixture-token"
	nativeProfileRV         = "10000"
	nativeProfileUpdatedRV  = "10001"
	nativeProfilePageItems  = 500
)

var nativeProfileContainerResources = corev1.ResourceRequirements{
	Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("100m"), corev1.ResourceMemory: resource.MustParse("128Mi")},
	Limits:   corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("500m"), corev1.ResourceMemory: resource.MustParse("512Mi")},
}

// The API fixture retains byte offsets, not 20,000 typed or unstructured Pods.
// Immutable, comma-delimited objects live on disk. ReadAt permits concurrent
// bounded LIST pages and WATCH frames without an in-memory inventory copy.
type nativeProfileFixture struct {
	pods       *os.File
	offsets    []int64
	count      int
	namespaces int
	documents  map[string][]byte
	changed    []byte
}

func newNativeProfileFixture(b *testing.B, directory string, pods, namespaces, groupVersions int) *nativeProfileFixture {
	b.Helper()
	file, err := os.Create(filepath.Join(directory, "pods.json.data"))
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = file.Close() })
	fixture := &nativeProfileFixture{pods: file, count: pods, namespaces: namespaces, offsets: make([]int64, pods+1), documents: make(map[string][]byte, 2*groupVersions+6)}
	writer := bufio.NewWriterSize(file, 64<<10)
	for index := range pods {
		object := nativeProfilePod(index, namespaces)
		encoded, err := json.Marshal(&object)
		if err != nil {
			b.Fatal(err)
		}
		if _, err = writer.Write(encoded); err != nil {
			b.Fatal(err)
		}
		if err = writer.WriteByte(','); err != nil {
			b.Fatal(err)
		}
		fixture.offsets[index+1] = fixture.offsets[index] + int64(len(encoded)+1)
	}
	if err = writer.Flush(); err != nil {
		b.Fatal(err)
	}
	changed := nativeProfilePod(0, namespaces)
	changed.ResourceVersion = nativeProfileUpdatedRV
	changed.Labels["profile.omniview.dev/revision"] = "updated"
	changed.Status.ContainerStatuses[0].RestartCount = 1
	fixture.changed, err = json.Marshal(&changed)
	if err != nil {
		b.Fatal(err)
	}
	encode := func(path string, value any) {
		encoded, err := json.Marshal(value)
		if err != nil {
			b.Fatal(err)
		}
		fixture.documents[path] = encoded
	}
	readVerbs := metav1.Verbs{"get", "list", "watch"}
	encode("/api", metav1.APIVersions{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "APIVersions"}, Versions: []string{"v1"}})
	encode("/api/v1", metav1.APIResourceList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "APIResourceList"}, GroupVersion: "v1", APIResources: []metav1.APIResource{
		{Name: "pods", SingularName: "pod", Kind: "Pod", Namespaced: true, Verbs: readVerbs, ShortNames: []string{"po"}},
		{Name: "namespaces", SingularName: "namespace", Kind: "Namespace", Verbs: metav1.Verbs{"get", "list"}, ShortNames: []string{"ns"}},
	}})
	groups := metav1.APIGroupList{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "APIGroupList"}, Groups: make([]metav1.APIGroup, 0, groupVersions)}
	for index := range groupVersions {
		group := fmt.Sprintf("profile-%03d.example.invalid", index)
		version := metav1.GroupVersionForDiscovery{GroupVersion: group + "/v1", Version: "v1"}
		groups.Groups = append(groups.Groups, metav1.APIGroup{Name: group, Versions: []metav1.GroupVersionForDiscovery{version}, PreferredVersion: version})
		encode("/apis/"+version.GroupVersion, metav1.APIResourceList{GroupVersion: version.GroupVersion, APIResources: []metav1.APIResource{{Name: "widgets", SingularName: "widget", Kind: "Widget", Namespaced: true, Verbs: readVerbs}}})
		fixture.documents["/openapi/v3/apis/"+version.GroupVersion] = []byte(fmt.Sprintf(`{"openapi":"3.0.0","info":{"title":"Native profile fixture","version":"v1"},"paths":{},"components":{"schemas":{"profile.Widget":{"type":"object","x-kubernetes-group-version-kind":[{"group":%q,"version":"v1","kind":"Widget"}],"properties":{"apiVersion":{"type":"string"},"kind":{"type":"string"},"metadata":{"type":"object"},"spec":{"type":"object","properties":{"replicas":{"type":"integer"}}}}}}}}`, group))
	}
	encode("/apis", groups)
	fixture.documents["/version"] = []byte(`{"major":"1","minor":"37","gitVersion":"v1.37.2","platform":"linux/arm64"}`)
	encode("/api/v1/namespaces/kube-system", corev1.Namespace{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "Namespace"}, ObjectMeta: metav1.ObjectMeta{Name: "kube-system", UID: types.UID("00000000-0000-4000-8000-ffffffffffff"), ResourceVersion: nativeProfileRV}})
	// Reuse the recorded core/v1 OpenAPI document from native_pod_schema_walk_test.go.
	compressed, err := os.Open("testdata/openapi-v3-api-v1.json.gz")
	if err != nil {
		b.Fatal(err)
	}
	defer compressed.Close()
	reader, err := gzip.NewReader(compressed)
	if err != nil {
		b.Fatal(err)
	}
	defer reader.Close()
	document, err := io.ReadAll(io.LimitReader(reader, maxNativeSchemaBytes+1))
	if err != nil || len(document) > maxNativeSchemaBytes {
		b.Fatalf("read bounded core/v1 OpenAPI fixture: bytes=%d error=%v", len(document), err)
	}
	fixture.documents["/openapi/v3/api/v1"] = document
	return fixture
}

func nativeProfilePod(index, namespaces int) corev1.Pod {
	created := metav1.NewTime(time.Date(2026, time.November, 1, 12, 0, 0, 0, time.UTC))
	controller, blockDeletion := true, true
	var mode int32 = 420
	var grace int64 = 30
	pod := corev1.Pod{
		TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "Pod"},
		ObjectMeta: metav1.ObjectMeta{
			Name: fmt.Sprintf("pod-%06d", index), Namespace: fmt.Sprintf("workload-%03d", index%namespaces),
			UID: types.UID(fmt.Sprintf("00000000-0000-4000-8000-%012d", index)), ResourceVersion: nativeProfileRV, CreationTimestamp: created,
			Labels:          map[string]string{"app.kubernetes.io/name": fmt.Sprintf("service-%03d", index%200), "app.kubernetes.io/instance": "production", "app.kubernetes.io/component": "api", "app.kubernetes.io/managed-by": "Helm", "pod-template-hash": "7b96c74489", "profile.omniview.dev/revision": "initial"},
			Annotations:     map[string]string{"prometheus.io/scrape": "true", "prometheus.io/port": "8080", "checksum/config": "cb56e89ac9b745bf4c66a8f701be8298596a8176c7fd256a32218b3920e85374"},
			OwnerReferences: []metav1.OwnerReference{{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: fmt.Sprintf("service-%03d-7b96c74489", index%200), UID: types.UID(fmt.Sprintf("11111111-1111-4111-8111-%012d", index%200)), Controller: &controller, BlockOwnerDeletion: &blockDeletion}},
		},
		Spec: corev1.PodSpec{
			NodeName: fmt.Sprintf("worker-%03d", index%100), ServiceAccountName: "application", RestartPolicy: corev1.RestartPolicyAlways, DNSPolicy: corev1.DNSClusterFirst, SchedulerName: "default-scheduler", TerminationGracePeriodSeconds: &grace,
			Containers: []corev1.Container{
				{Name: "application", Image: "registry.example.invalid/application:2026.11.1", ImagePullPolicy: corev1.PullIfNotPresent, Ports: []corev1.ContainerPort{{Name: "http", ContainerPort: 8080, Protocol: corev1.ProtocolTCP}}, Env: []corev1.EnvVar{{Name: "LOG_LEVEL", Value: "info"}, {Name: "POD_NAME", ValueFrom: &corev1.EnvVarSource{FieldRef: &corev1.ObjectFieldSelector{APIVersion: "v1", FieldPath: "metadata.name"}}}, {Name: "DATABASE_URL", ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: "database"}, Key: "url"}}}}, VolumeMounts: []corev1.VolumeMount{{Name: "configuration", MountPath: "/etc/application", ReadOnly: true}}, ReadinessProbe: &corev1.Probe{ProbeHandler: corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/ready", Port: intstr.FromInt32(8080), Scheme: corev1.URISchemeHTTP}}, InitialDelaySeconds: 5, PeriodSeconds: 10, TimeoutSeconds: 1, FailureThreshold: 3}, LivenessProbe: &corev1.Probe{ProbeHandler: corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/health", Port: intstr.FromInt32(8080), Scheme: corev1.URISchemeHTTP}}, InitialDelaySeconds: 10, PeriodSeconds: 20, TimeoutSeconds: 1, FailureThreshold: 3}},
				{Name: "log-forwarder", Image: "registry.example.invalid/log-forwarder:3.1.0", ImagePullPolicy: corev1.PullIfNotPresent, Args: []string{"--config=/etc/application/logging.yaml"}, VolumeMounts: []corev1.VolumeMount{{Name: "configuration", MountPath: "/etc/application", ReadOnly: true}}},
			},
			Volumes:     []corev1.Volume{{Name: "configuration", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: "application-config"}, DefaultMode: &mode}}}},
			Tolerations: []corev1.Toleration{{Key: "node.kubernetes.io/not-ready", Operator: corev1.TolerationOpExists, Effect: corev1.TaintEffectNoExecute, TolerationSeconds: &grace}},
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning, HostIP: fmt.Sprintf("10.0.%d.10", index%100), PodIP: fmt.Sprintf("10.%d.%d.%d", 32+index/60000, (index/250)%240, 1+index%250), StartTime: &created, QOSClass: corev1.PodQOSBurstable},
	}
	for index := range pod.Spec.Containers {
		pod.Spec.Containers[index].Resources = nativeProfileContainerResources
	}
	pod.Status.PodIPs = []corev1.PodIP{{IP: pod.Status.PodIP}}
	for _, condition := range []corev1.PodConditionType{corev1.PodScheduled, corev1.PodInitialized, corev1.ContainersReady, corev1.PodReady} {
		pod.Status.Conditions = append(pod.Status.Conditions, corev1.PodCondition{Type: condition, Status: corev1.ConditionTrue, LastTransitionTime: created})
	}
	for _, container := range pod.Spec.Containers {
		pod.Status.ContainerStatuses = append(pod.Status.ContainerStatuses, corev1.ContainerStatus{Name: container.Name, Image: container.Image, ImageID: "containerd://sha256:34103f7c1059da9767981deed47be422fd743dd00564b71cb494f7c5372d175e", ContainerID: fmt.Sprintf("containerd://%064d", 2*index+len(pod.Status.ContainerStatuses)), Ready: true, Started: &controller, State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{StartedAt: created}}})
	}
	return pod
}

type nativeProfileAPICounters struct {
	Requests      map[string]int `json:"requests"`
	Lists         int            `json:"podLists"`
	ListItems     int            `json:"podListItems"`
	Watches       int            `json:"podWatches"`
	InitialEvents int            `json:"podWatchInitialEvents"`
	FirstWatchNS  int64          `json:"firstWatchNanoseconds"`
	Error         string         `json:"error,omitempty"`
}

type nativeProfileAPI struct {
	fixture *nativeProfileFixture
	server  *httptest.Server
	latency time.Duration
	start   time.Time
	stop    chan struct{}
	update  chan struct{}
	once    sync.Once
	updated atomic.Bool
	active  atomic.Int32
	mu      sync.Mutex
	counts  nativeProfileAPICounters
}

func newNativeProfileAPI(fixture *nativeProfileFixture, latency time.Duration) *nativeProfileAPI {
	api := &nativeProfileAPI{fixture: fixture, latency: latency, stop: make(chan struct{}), update: make(chan struct{}), counts: nativeProfileAPICounters{Requests: make(map[string]int)}}
	api.server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pprof.Do(r.Context(), pprof.Labels("native-profile-phase", "fixture-api"), func(ctx context.Context) {
			api.serve(w, r.WithContext(ctx))
		})
	}))
	return api
}

func (api *nativeProfileAPI) close() {
	api.once.Do(func() {
		close(api.stop)
		api.server.CloseClientConnections()
		api.server.Close()
	})
}

func (api *nativeProfileAPI) snapshot() nativeProfileAPICounters {
	api.mu.Lock()
	defer api.mu.Unlock()
	result := api.counts
	result.Requests = make(map[string]int, len(api.counts.Requests))
	for path, count := range api.counts.Requests {
		result.Requests[path] = count
	}
	return result
}

func (api *nativeProfileAPI) fail(w http.ResponseWriter, message string, code int) {
	api.mu.Lock()
	if api.counts.Error == "" {
		api.counts.Error = message
	}
	api.mu.Unlock()
	api.status(w, message, code)
}

func (api *nativeProfileAPI) status(w http.ResponseWriter, message string, code int) {
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(metav1.Status{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "Status"}, Status: "Failure", Message: message, Reason: metav1.StatusReasonBadRequest, Code: int32(code)})
}

func (api *nativeProfileAPI) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	api.mu.Lock()
	api.counts.Requests[r.URL.Path]++
	api.mu.Unlock()
	if r.Method != http.MethodGet {
		api.fail(w, "fixture rejects mutation: "+r.Method+" "+r.URL.Path, http.StatusMethodNotAllowed)
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+nativeProfileToken {
		api.fail(w, "fixture requires its isolated kubeconfig token", http.StatusUnauthorized)
		return
	}
	if api.latency > 0 {
		timer := time.NewTimer(api.latency)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-r.Context().Done():
			return
		case <-api.stop:
			return
		}
	}
	if document, found := api.fixture.documents[r.URL.Path]; found {
		_, _ = w.Write(document)
		return
	}
	if r.URL.Path != "/api/v1/pods" {
		api.fail(w, "unexpected fixture route: "+r.URL.Path, http.StatusNotFound)
		return
	}
	if r.URL.Query().Get("labelSelector") != "" || r.URL.Query().Get("fieldSelector") != "" {
		api.fail(w, "fixture benchmark does not request selectors", http.StatusBadRequest)
		return
	}
	if r.URL.Query().Get("watch") == "true" {
		api.watch(w, r)
		return
	}
	api.list(w, r)
}

func (api *nativeProfileAPI) list(w http.ResponseWriter, r *http.Request) {
	start, end := 0, api.fixture.count
	rv := nativeProfileRV
	if api.updated.Load() {
		rv = nativeProfileUpdatedRV
	}
	if token := r.URL.Query().Get("continue"); token != "" {
		raw, err := base64.RawURLEncoding.DecodeString(token)
		parts := strings.Split(string(raw), ":")
		if err != nil || len(parts) != 3 || parts[0] != "native-profile" || (parts[1] != nativeProfileRV && parts[1] != nativeProfileUpdatedRV) {
			api.fail(w, "invalid fixture continue token", http.StatusBadRequest)
			return
		}
		start, err = strconv.Atoi(parts[2])
		if err != nil || start < 0 || start >= end {
			api.fail(w, "invalid fixture page offset", http.StatusBadRequest)
			return
		}
		rv = parts[1]
	}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 0 {
			api.fail(w, "invalid fixture page limit", http.StatusBadRequest)
			return
		}
		if limit > 0 {
			end = min(end, start+min(limit, nativeProfilePageItems))
		}
	}
	var continuation string
	if end < api.fixture.count {
		continuation = base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("native-profile:%s:%d", rv, end)))
	}
	api.mu.Lock()
	api.counts.Lists++
	api.counts.ListItems += end - start
	api.mu.Unlock()
	if _, err := fmt.Fprintf(w, `{"apiVersion":"v1","kind":"PodList","metadata":{"resourceVersion":%q,"continue":%q},"items":[`, rv, continuation); err != nil {
		return
	}
	buffer := make([]byte, 32<<10)
	if start == 0 && rv == nativeProfileUpdatedRV {
		if _, err := w.Write(api.fixture.changed); err != nil {
			return
		}
		start++
		if start < end {
			if _, err := io.WriteString(w, ","); err != nil {
				return
			}
		}
	}
	if start < end {
		section := io.NewSectionReader(api.fixture.pods, api.fixture.offsets[start], api.fixture.offsets[end]-api.fixture.offsets[start]-1)
		if _, err := io.CopyBuffer(w, section, buffer); err != nil {
			return
		}
	}
	_, _ = io.WriteString(w, "]}")
}

func (api *nativeProfileAPI) watch(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		api.fail(w, "watch response cannot flush", http.StatusInternalServerError)
		return
	}
	api.active.Add(1)
	defer api.active.Add(-1)
	api.mu.Lock()
	api.counts.Watches++
	if api.counts.FirstWatchNS == 0 {
		api.counts.FirstWatchNS = time.Since(api.start).Nanoseconds()
	}
	api.mu.Unlock()
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	rv := nativeProfileRV
	if api.updated.Load() {
		rv = nativeProfileUpdatedRV
	}
	buffer := make([]byte, 32<<10)
	initial := r.URL.Query().Get("sendInitialEvents") == "true"
	if initial {
		for index := range api.fixture.count {
			select {
			case <-r.Context().Done():
				return
			case <-api.stop:
				return
			default:
			}
			if _, err := io.WriteString(w, `{"type":"ADDED","object":`); err != nil {
				return
			}
			if index == 0 && rv == nativeProfileUpdatedRV {
				if _, err := w.Write(api.fixture.changed); err != nil {
					return
				}
			} else {
				section := io.NewSectionReader(api.fixture.pods, api.fixture.offsets[index], api.fixture.offsets[index+1]-api.fixture.offsets[index]-1)
				if _, err := io.CopyBuffer(w, section, buffer); err != nil {
					return
				}
			}
			if _, err := io.WriteString(w, "}\n"); err != nil {
				return
			}
			api.mu.Lock()
			api.counts.InitialEvents++
			api.mu.Unlock()
			if index%256 == 255 {
				flusher.Flush()
			}
		}
	}
	if initial || r.URL.Query().Get("allowWatchBookmarks") == "true" {
		annotation := ""
		if initial {
			annotation = `,"annotations":{"k8s.io/initial-events-end":"true"}`
		}
		if _, err := fmt.Fprintf(w, "{\"type\":\"BOOKMARK\",\"object\":{\"apiVersion\":\"v1\",\"kind\":\"Pod\",\"metadata\":{\"resourceVersion\":%q%s}}}\n", rv, annotation); err != nil {
			return
		}
		flusher.Flush()
	}
	timeout := 5 * time.Minute
	if raw := r.URL.Query().Get("timeoutSeconds"); raw != "" {
		seconds, err := strconv.Atoi(raw)
		if err != nil || seconds <= 0 || seconds > 3600 {
			return
		}
		timeout = time.Duration(seconds) * time.Second
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-api.update:
		if rv == nativeProfileRV && r.URL.Query().Get("resourceVersion") != nativeProfileUpdatedRV {
			api.updated.Store(true)
			if _, err := io.WriteString(w, `{"type":"MODIFIED","object":`); err != nil {
				return
			}
			if _, err := w.Write(api.fixture.changed); err != nil {
				return
			}
			if _, err := io.WriteString(w, "}\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	case <-r.Context().Done():
		return
	case <-api.stop:
		return
	case <-timer.C:
		return
	}
	select {
	case <-r.Context().Done():
	case <-api.stop:
	case <-timer.C:
	}
}
