package resource

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"runtime/pprof"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"go.uber.org/zap"
)

var (
	nativeProfileEnabled       = flag.Bool("native-profile", false, "Enable the isolated native Kubernetes connection/source profile")
	nativeProfilePods          = flag.Int("native-profile-pods", 20000, "Synthetic Pod inventory; 1..100000")
	nativeProfileNamespaces    = flag.Int("native-profile-namespaces", 100, "Namespaces represented in the all-namespace Pod source; 1..1000")
	nativeProfileGroupVersions = flag.Int("native-profile-groupversions", 80, "Additional discovered group/versions, each with one list/watch Widget type; 0..255")
	nativeProfileGETLatency    = flag.Duration("native-profile-get-latency", 10*time.Millisecond, "Fixed server delay per GET, including WATCH establishment; 0..1s")
	nativeProfileAcquisition   = flag.Int("native-profile-acquisition-seconds", 10, "Actual provider connection acquisition setting; 1..300")
	nativeProfileLiveHold      = flag.Duration("native-profile-live-hold", time.Second, "Hold a usable source after its first live change; 0..30s")
	nativeProfileRetainedHeap  = flag.String("native-profile-retained-heap", "", "Optional heap profile at EndSnapshot or Reset, before informer teardown; requires -benchtime=1x")
)

// BenchmarkNativeClusterProfile runs the real provider, SDK controller, bounded
// kubeconfig clients, discovery/schema acquisition, and native informer source.
// The only substitute is an isolated TLS HTTP API with deterministic inventory.
// Overflow is a measured outcome, not a successful source or a benchmark failure.
func BenchmarkNativeClusterProfile(b *testing.B) {
	if !*nativeProfileEnabled {
		b.Skip("opt in with -args -native-profile; see plugin-profile-harness.md in the investigation workspace")
	}
	if *nativeProfilePods < 1 || *nativeProfilePods > 100000 || *nativeProfileNamespaces < 1 || *nativeProfileNamespaces > min(*nativeProfilePods, 1000) || *nativeProfileGroupVersions < 0 || *nativeProfileGroupVersions > maxNativeDiscoveryVersions-1 || *nativeProfileGETLatency < 0 || *nativeProfileGETLatency > time.Second || *nativeProfileAcquisition < 1 || *nativeProfileAcquisition > 300 || *nativeProfileLiveHold < 0 || *nativeProfileLiveHold > 30*time.Second {
		b.Fatal("native profile flag outside its documented bounds")
	}
	if *nativeProfileRetainedHeap != "" && b.N != 1 {
		b.Fatal("retained heap output requires -benchtime=1x to avoid overwriting a profile")
	}
	// Production phase labels (phase, connection) are off unless the host enables
	// profiling; turn them on so -tagfocus splits this run the same way.
	diag.SetProfileLabels(true)
	b.Cleanup(func() { diag.SetProfileLabels(false) })
	b.StopTimer()
	directory := b.TempDir()
	var fixture *nativeProfileFixture
	pprof.Do(context.Background(), pprof.Labels("native-profile-phase", "fixture-build"), func(context.Context) {
		fixture = newNativeProfileFixture(b, directory, *nativeProfilePods, *nativeProfileNamespaces, *nativeProfileGroupVersions)
	})
	b.ReportAllocs()
	b.ResetTimer()
	totals, samples := make(map[string]float64), make(map[string]int)
	for iteration := range b.N {
		result := runNativeClusterProfile(b, fixture, directory, iteration)
		for unit, value := range result.metrics {
			totals[unit] += value
			samples[unit]++
		}
		encoded, err := json.Marshal(result)
		if err != nil {
			b.Fatal(err)
		}
		b.Logf("NATIVE_PROFILE %s", encoded)
	}
	for unit, total := range totals {
		b.ReportMetric(total/float64(samples[unit]), unit)
	}
	b.ReportMetric(float64(fixture.offsets[fixture.count])/(1<<20), "fixture-disk-MiB")
}

type nativeProfileResult struct {
	Iteration      int                      `json:"iteration"`
	Pods           int                      `json:"pods"`
	Namespaces     int                      `json:"namespaces"`
	ExtraVersions  int                      `json:"extraGroupVersions"`
	GETLatencyMS   float64                  `json:"getLatencyMS"`
	Outcome        string                   `json:"outcome"`
	MilestonesMS   map[string]float64       `json:"milestonesMS"`
	SnapshotItems  int                      `json:"snapshotItems"`
	ResetReason    string                   `json:"resetReason,omitempty"`
	ResetMessage   string                   `json:"resetMessage,omitempty"`
	Heap           nativeProfileHeap        `json:"inflightHeap"`
	API            nativeProfileAPICounters `json:"api"`
	RetiredClients int32                    `json:"retiredClients"`
	metrics        map[string]float64
}

type nativeProfileHeap struct {
	BeforeGCBytes uint64 `json:"beforeGCBytes"`
	AfterGCBytes  uint64 `json:"afterGCBytes,omitempty"`
	Path          string `json:"path,omitempty"`
}

type nativeProfileEvent struct {
	kind    string
	at      time.Time
	count   int
	reason  string
	message string
	heap    nativeProfileHeap
	err     error
}

func runNativeClusterProfile(b *testing.B, fixture *nativeProfileFixture, directory string, iteration int) nativeProfileResult {
	b.Helper()
	api := newNativeProfileAPI(fixture, *nativeProfileGETLatency)
	defer api.close()
	configPath := filepath.Join(directory, fmt.Sprintf("config-%d", iteration))
	config := fmt.Sprintf("apiVersion: v1\nkind: Config\nclusters:\n- name: native-profile\n  cluster:\n    server: %s\n    insecure-skip-tls-verify: true\ncontexts:\n- name: native-profile\n  context:\n    cluster: native-profile\n    user: native-profile\ncurrent-context: native-profile\nusers:\n- name: native-profile\n  user:\n    token: %s\n", api.server.URL, nativeProfileToken)
	if err := os.WriteFile(configPath, []byte(config), 0600); err != nil {
		b.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	// Reuse the existing acquisition-setting test provider. No lifecycle,
	// native client, discovery response, or source callback is replaced.
	ctx = resourcev2.WithSession(ctx, resourcev2.Session{PluginConfig: refreshTimeoutSettings{read: func() (any, error) {
		return *nativeProfileAcquisition, nil
	}}})
	result := nativeProfileResult{Iteration: iteration, Pods: fixture.count, Namespaces: fixture.namespaces, ExtraVersions: *nativeProfileGroupVersions, GETLatencyMS: float64(*nativeProfileGETLatency) / float64(time.Millisecond), MilestonesMS: make(map[string]float64), metrics: make(map[string]float64)}
	var provider *kubernetesProvider
	var retired atomic.Int32
	var closeOnce sync.Once
	closed := make(chan struct{})
	var closeErr error
	closeProvider := func() error {
		if provider == nil {
			return nil
		}
		closeOnce.Do(func() {
			go func() {
				closeErr = provider.Close()
				close(closed)
			}()
		})
		timer := time.NewTimer(15 * time.Second)
		defer timer.Stop()
		select {
		case <-closed:
			return closeErr
		case <-timer.C:
			api.close()
			return fmt.Errorf("provider shutdown exceeded 15s; fixture connections forcibly closed")
		}
	}
	defer func() {
		cancel()
		if err := closeProvider(); err != nil {
			b.Error(err)
		}
	}()
	start := time.Now()
	api.mu.Lock()
	api.start = start
	api.mu.Unlock()
	milestone := func(name string, at time.Time) {
		result.MilestonesMS[name] = float64(at.Sub(start)) / float64(time.Millisecond)
	}
	b.StartTimer()
	var err error
	pprof.Do(ctx, pprof.Labels("native-profile-phase", "connection"), func(ctx context.Context) {
		provider, err = newKubernetesProvider(zap.NewNop().Sugar(), func(string) { retired.Add(1) })
		if err != nil {
			return
		}
		connection := types.Connection{ID: nativeProfileConnection, Name: "Isolated profiling API", Data: map[string]any{"kubeconfig": configPath, "watchScopeMode": "all"}}
		if err = provider.ApplyConnections(ctx, []types.Connection{connection}); err != nil {
			return
		}
		var status types.ConnectionStatus
		status, err = provider.StartConnection(ctx, nativeProfileConnection)
		if err == nil && status.Status != types.ConnectionStatusConnected {
			err = fmt.Errorf("provider start returned %q", status.Status)
		}
	})
	if err != nil {
		b.Fatalf("real provider startup failed: %v; API=%+v", err, api.snapshot())
	}
	milestone("connectionReady", time.Now())
	result.metrics["connect-ms/op"] = result.MilestonesMS["connectionReady"]
	route := resourcev2.AccessRoute{Connection: nativeProfileConnection}
	catalog, err := provider.Catalog(ctx, resourcev2.CatalogRequest{Route: route})
	if err != nil {
		b.Fatal(err)
	}
	var representation resourcev2.Representation
	for _, descriptor := range catalog.Types {
		if descriptor.Type != "k8s:/pods" {
			continue
		}
		for _, candidate := range descriptor.Representations {
			if candidate.ID == descriptor.DefaultRepresentation {
				representation = candidate
			}
		}
	}
	if representation.ID == "" || representation.Revision == "" {
		b.Fatalf("real Pod catalog binding unavailable: %+v", representation)
	}
	milestone("catalogReady", time.Now())
	events := make(chan nativeProfileEvent, 8)
	sourceDone := make(chan error, 1)
	sourceCtx, cancelSource := context.WithCancel(resourcev2.WithCatalogRevision(ctx, catalog.Revision))
	defer cancelSource()
	namespaceNames := make([]string, fixture.namespaces)
	for index := range namespaceNames {
		namespaceNames[index] = fmt.Sprintf("workload-%03d", index)
	}
	emitter := &nativeProfileEmitter{fixture: fixture, namespaceNames: namespaceNames, events: events, seen: make([]uint64, (fixture.count+63)/64), heapPath: *nativeProfileRetainedHeap}
	request := resourcev2.SourceOpenRequest{
		SessionID: "native-profile-session", Generation: "native-profile-generation",
		Target: resourcev2.ReadTarget{Route: route, Provider: catalog.Provider, Authority: "native-profile-host-authority", Type: "k8s:/pods", Scope: resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeAny}}, Representation: representation.ID},
		Mode:   resourcev2.SourceModeSnapshotAndUpdates, Acquisition: resourcev2.SourceAcquisition{Kind: resourcev2.SourceAcquisitionEnumerate},
		Limits: resourcev2.SourceLimits{MaxFrameBytes: resourcev2.MaxSourceFrameBytes, MaxBatchItems: resourcev2.MaxSourceBatchItems}, Binding: resourcev2.RepresentationBinding{Representation: representation},
	}
	sourceStart := time.Now()
	milestone("sourceOpen", sourceStart)
	go func() {
		var sourceErr error
		pprof.Do(sourceCtx, pprof.Labels("native-profile-phase", "source"), func(ctx context.Context) {
			sourceErr = provider.OpenSource(ctx, request, emitter)
		})
		events <- nativeProfileEvent{kind: "returned", at: time.Now(), err: sourceErr}
		sourceDone <- sourceErr
	}()
	finished := false
	for !finished {
		select {
		case event := <-events:
			switch event.kind {
			case "firstObservation":
				milestone(event.kind, event.at)
			case "snapshotComplete":
				milestone(event.kind, event.at)
				result.SnapshotItems, result.Heap = event.count, event.heap
				result.metrics["ready-ms/op"] = result.MilestonesMS[event.kind]
				close(api.update)
			case "firstLiveChange":
				milestone(event.kind, event.at)
				result.Outcome = "usable-snapshot-and-live-update"
				result.metrics["source-ms/op"] = float64(event.at.Sub(sourceStart)) / float64(time.Millisecond)
				finished = true
			case "reset":
				if event.reason != resourcev2.SourceResetOverflow {
					b.Fatalf("unexpected source reset: %s: %s", event.reason, event.message)
				}
				milestone("overflowReset", event.at)
				result.Outcome, result.ResetReason, result.ResetMessage = "reset-before-usable-source", event.reason, event.message
				result.SnapshotItems, result.Heap = event.count, event.heap
				result.metrics["source-ms/op"] = float64(event.at.Sub(sourceStart)) / float64(time.Millisecond)
				result.metrics["reset/op"] = 1
				finished = true
			case "returned":
				b.Fatalf("source returned before a usable snapshot/live update or overflow reset: %v; API=%+v", event.err, api.snapshot())
			}
		case <-ctx.Done():
			b.Fatalf("profile timed out before a source outcome: %v; API=%+v", ctx.Err(), api.snapshot())
		}
	}
	if result.Outcome == "usable-snapshot-and-live-update" && *nativeProfileLiveHold > 0 {
		timer := time.NewTimer(*nativeProfileLiveHold)
		select {
		case <-timer.C:
		case err := <-sourceDone:
			timer.Stop()
			b.Fatalf("source stopped during live hold: %v", err)
		case <-ctx.Done():
			timer.Stop()
			b.Fatal(ctx.Err())
		}
	}
	shutdownStart := time.Now()
	pprof.Do(ctx, pprof.Labels("native-profile-phase", "shutdown"), func(context.Context) {
		cancelSource()
		err = closeProvider()
		api.close()
	})
	if err != nil {
		b.Fatal(err)
	}
	select {
	case sourceErr := <-sourceDone:
		if sourceErr != nil && !errors.Is(sourceErr, context.Canceled) && resourcev2.ErrorCode(sourceErr) != "CANCELLED" {
			b.Fatalf("source shutdown returned an unexpected error: %v", sourceErr)
		}
	case <-time.After(5 * time.Second):
		b.Fatal("source goroutine did not retire after provider Close")
	}
	milestone("closed", time.Now())
	result.metrics["shutdown-ms/op"] = float64(time.Since(shutdownStart)) / float64(time.Millisecond)
	b.StopTimer()
	result.API = api.snapshot()
	result.RetiredClients = retired.Load()
	if result.API.Error != "" || api.active.Load() != 0 || result.RetiredClients != 1 || result.API.Watches == 0 {
		b.Fatalf("invalid API/lifecycle outcome: counters=%+v activeWatches=%d retired=%d", result.API, api.active.Load(), result.RetiredClients)
	}
	if result.API.FirstWatchNS != 0 {
		result.MilestonesMS["watchOpened"] = float64(result.API.FirstWatchNS) / float64(time.Millisecond)
	}
	result.metrics["snapshot-items/op"] = float64(result.SnapshotItems)
	result.metrics["pod-list-requests/op"] = float64(result.API.Lists)
	result.metrics["pod-watch-requests/op"] = float64(result.API.Watches)
	result.metrics["inflight-heap-MiB"] = float64(result.Heap.BeforeGCBytes) / (1 << 20)
	if result.Heap.AfterGCBytes != 0 {
		result.metrics["retained-heap-MiB"] = float64(result.Heap.AfterGCBytes) / (1 << 20)
	}
	return result
}

type nativeProfileEmitter struct {
	fixture        *nativeProfileFixture
	namespaceNames []string
	events         chan<- nativeProfileEvent
	seen           []uint64
	count          int
	first          bool
	live           bool
	heapPath       string
}

func (emitter *nativeProfileEmitter) checkRecord(record resourcev2.SourceRecord, revision string) (int, error) {
	name := record.Reference.Address.ID
	if len(name) != 10 || !strings.HasPrefix(name, "pod-") {
		return 0, fmt.Errorf("unexpected fixture Pod ID %q", name)
	}
	for _, digit := range name[4:] {
		if digit < '0' || digit > '9' {
			return 0, fmt.Errorf("invalid fixture Pod ID %q", name)
		}
	}
	index, err := strconv.Atoi(name[4:])
	if err != nil || index >= emitter.fixture.count {
		return 0, fmt.Errorf("invalid fixture Pod ID %q", name)
	}
	scope := record.Reference.Address.Scope
	if len(scope) != 1 || scope[0].Dimension != "namespace" || scope[0].Value != emitter.namespaceNames[index%emitter.fixture.namespaces] {
		return 0, fmt.Errorf("fixture Pod %s has wrong namespace scope", name)
	}
	if record.Reference.Incarnation == nil || record.SourceRevision == nil || *record.SourceRevision != revision {
		return 0, fmt.Errorf("fixture Pod %s has missing/wrong UID/resourceVersion", name)
	}
	uid := *record.Reference.Incarnation
	if len(uid) != 36 || !strings.HasPrefix(uid, "00000000-0000-4000-8000-") {
		return 0, fmt.Errorf("fixture Pod %s has wrong UID", name)
	}
	for _, digit := range uid[24:] {
		if digit < '0' || digit > '9' {
			return 0, fmt.Errorf("fixture Pod %s has invalid UID", name)
		}
	}
	uidIndex, err := strconv.Atoi(uid[24:])
	if err != nil || uidIndex != index {
		return 0, fmt.Errorf("fixture Pod %s has wrong UID", name)
	}
	return index, nil
}

func (emitter *nativeProfileEmitter) send(ctx context.Context, event nativeProfileEvent) error {
	select {
	case emitter.events <- event:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (emitter *nativeProfileEmitter) Snapshot(ctx context.Context, observations []resourcev2.SourceObservation) error {
	at := time.Now()
	if len(observations) == 0 || len(observations) > resourcev2.MaxSourceBatchItems {
		return fmt.Errorf("invalid native snapshot batch size %d", len(observations))
	}
	for _, observation := range observations {
		index, err := emitter.checkRecord(observation.Record, nativeProfileRV)
		if err != nil {
			return err
		}
		word, bit := index/64, uint(index%64)
		if emitter.seen[word]&(uint64(1)<<bit) != 0 {
			return fmt.Errorf("duplicate fixture Pod %d in initial snapshot", index)
		}
		emitter.seen[word] |= uint64(1) << bit
		emitter.count++
	}
	if !emitter.first {
		emitter.first = true
		return emitter.send(ctx, nativeProfileEvent{kind: "firstObservation", at: at})
	}
	return nil
}

func (emitter *nativeProfileEmitter) EndSnapshot(ctx context.Context, coverage resourcev2.SourceCoverage, continuity string) error {
	at := time.Now()
	if emitter.count != emitter.fixture.count || coverage.Enumeration != resourcev2.EnumerationExhausted || coverage.Consistency != resourcev2.ConsistencyBestEffort || continuity != resourcev2.ContinuityBestEffort {
		return fmt.Errorf("incomplete/wrong native source boundary: items=%d want=%d coverage=%+v continuity=%s", emitter.count, emitter.fixture.count, coverage, continuity)
	}
	heap, err := nativeProfileCaptureHeap(ctx, emitter.heapPath)
	if err != nil {
		return err
	}
	return emitter.send(ctx, nativeProfileEvent{kind: "snapshotComplete", at: at, count: emitter.count, heap: heap})
}

func (emitter *nativeProfileEmitter) Changes(ctx context.Context, changes []resourcev2.SourceChange, _ *resourcev2.SourceCoverage) error {
	at := time.Now()
	if emitter.live || len(changes) != 1 || changes[0].Kind != resourcev2.SourceChangeUpsert || changes[0].Observation == nil {
		return fmt.Errorf("unexpected native live changes: count=%d alreadyObserved=%t", len(changes), emitter.live)
	}
	index, err := emitter.checkRecord(changes[0].Observation.Record, nativeProfileUpdatedRV)
	if err != nil || index != 0 {
		return fmt.Errorf("invalid live update: index=%d error=%v", index, err)
	}
	emitter.live = true
	return emitter.send(ctx, nativeProfileEvent{kind: "firstLiveChange", at: at})
}

func (emitter *nativeProfileEmitter) Reset(ctx context.Context, reason, message string) error {
	at := time.Now()
	heap, err := nativeProfileCaptureHeap(ctx, emitter.heapPath)
	if err != nil {
		return err
	}
	return emitter.send(ctx, nativeProfileEvent{kind: "reset", at: at, count: emitter.count, reason: reason, message: message, heap: heap})
}

func nativeProfileCaptureHeap(ctx context.Context, path string) (nativeProfileHeap, error) {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	result := nativeProfileHeap{BeforeGCBytes: stats.HeapAlloc, Path: path}
	if path == "" {
		return result, nil
	}
	var captureErr error
	pprof.Do(ctx, pprof.Labels("native-profile-phase", "heap-checkpoint"), func(context.Context) {
		runtime.GC()
		runtime.ReadMemStats(&stats)
		result.AfterGCBytes = stats.HeapAlloc
		file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			captureErr = err
			return
		}
		captureErr = pprof.WriteHeapProfile(file)
		if err = file.Close(); captureErr == nil {
			captureErr = err
		}
	})
	return result, captureErr
}
