package metric

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/utils"
	"github.com/omniview/kubernetes/pkg/utils/remoteerr"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/util/validation"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

const (
	nativeCPU            = "kubernetes.pod.cpu.usage"
	nativeMemory         = "kubernetes.pod.memory.working_set"
	nativeNodeCPU        = "kubernetes.node.cpu.usage"
	nativeNodeMemory     = "kubernetes.node.memory.working_set"
	nativeMaxTargets     = sdkmetric.MaxFiniteTargets
	nativeMaxConnections = 128
	nativeMaxFailures    = 256
	nativeMaxBytes       = 8 << 20
	nativeMaxObjects     = 20000
	nativeMaxPages       = 64
	nativeTimeout        = 15 * time.Second
	// A missing or unavailable metrics API and a refused caller stay that way
	// until cluster configuration changes. Any other failure (a transport error,
	// a truncated body or a server error) often clears by itself. Each failure is
	// remembered for the matching initial window below, and the window doubles
	// with every consecutive failure of the same endpoint, up to the ceiling.
	nativePersistentFailureTTL = 30 * time.Second
	nativeTransientFailureTTL  = 5 * time.Second
	nativeMaxFailureTTL        = 10 * time.Minute
)

// nativeProvider has no polling or metric-result cache. Each source generation
// owns authenticated Kubernetes clients and cancellation of its finite reads.
// The host owns admission, shared demand, refresh scheduling and result reuse.
type nativeProvider struct {
	mu    sync.Mutex
	cache *ClientCache
	lanes map[string]*nativeLane
	next  uint64
	now   func() time.Time
}

type nativeLane struct {
	key           string
	ctx           context.Context
	cancel        context.CancelFunc
	namespaceTurn uint64                              // Protected by nativeProvider.mu.
	failures      map[nativeScanKey]nativeScanFailure // Protected by nativeProvider.mu.
	unavailable   map[string]nativeScanFailure        // By resource; a metrics API that is not served. Protected by nativeProvider.mu.
	failureOrder  uint64                              // Protected by nativeProvider.mu.
	logged        map[nativeLogKey]time.Time          // Protected by nativeProvider.mu.
}

// nativeScanKey names one list endpoint whose failure is remembered. Access can
// be granted to a single metadata.name and refused for the namespace as a whole,
// so the exact selector is part of the endpoint: refusing one selector says
// nothing about any other. A failure of the server itself is the same for every
// selector and uses an empty name.
type nativeScanKey struct {
	resource  string
	namespace string
	name      string // Exact metadata.name selector; empty when the list is unselected.
}

type nativeScanFailure struct {
	err     error
	until   time.Time
	order   uint64 // Insertion order; breaks eviction ties between equal expiries.
	strikes int    // Consecutive failures of the endpoint, this one included.
}

func (f nativeScanFailure) expiresBefore(other nativeScanFailure) bool {
	if !f.until.Equal(other.until) {
		return f.until.Before(other.until)
	}
	return f.order < other.order
}

// A failed endpoint is independent of which rows are currently mounted. Keep a
// bounded negative availability cache, not metric samples. Expiry or connection
// retirement permits recovery without issuing another request on every scroll.
// Entries outlive their window so that the next failure of the endpoint backs
// off further; a successful read forgets them.
func (p *nativeProvider) scanFailure(lane *nativeLane, key nativeScanKey) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.now()
	// A metrics API that is not served says nothing about one namespace in
	// particular: while that is remembered, no namespace is read.
	if failure, remembered := lane.unavailable[key.resource]; remembered && now.Before(failure.until) {
		return failure.err
	}
	if key.name != "" {
		endpoint := key
		endpoint.name = ""
		// A server failure is the same for every selector in the namespace.
		if failure, remembered := lane.failures[endpoint]; remembered && now.Before(failure.until) && nativeServerFailure(failure.err) {
			return failure.err
		}
	}
	if failure, remembered := lane.failures[key]; remembered && now.Before(failure.until) {
		return failure.err
	}
	return nil
}

// nativeFailureCooldown is the initial window in which one failed scan
// suppresses new reads of its endpoint. A missing or unavailable API or a
// refused caller stays that way until cluster configuration changes, so it
// holds for the long window. Everything else, such as a transport error, a
// truncated body or a server error, often clears by itself and holds only
// briefly.
func nativeFailureCooldown(err error) time.Duration {
	if apierrors.IsForbidden(err) || apierrors.IsUnauthorized(err) || nativeAPIUnavailable(err) {
		return nativePersistentFailureTTL
	}
	return nativeTransientFailureTTL
}

// nativeServerFailure reports whether err is the API server failing rather than
// declining one request, so that every selector in the namespace would meet it.
func nativeServerFailure(err error) bool {
	var status apierrors.APIStatus
	return errors.As(err, &status) && (status.Status().Code >= http.StatusInternalServerError || apierrors.IsTooManyRequests(err))
}

// nativeNextFailure returns the entry that records err for an endpoint, given
// what was remembered about it before. Each consecutive failure doubles the
// window up to nativeMaxFailureTTL. A failure after a quiet period longer than
// that ceiling starts over.
func nativeNextFailure(previous nativeScanFailure, known bool, err error, now time.Time) nativeScanFailure {
	strikes := 1
	if known && now.Sub(previous.until) <= nativeMaxFailureTTL {
		strikes = previous.strikes + 1
	}
	window := nativeFailureCooldown(err)
	for step := 1; step < strikes && window < nativeMaxFailureTTL; step++ {
		window *= 2
	}
	return nativeScanFailure{err: err, until: now.Add(min(window, nativeMaxFailureTTL)), strikes: strikes}
}

// A window is fixed when a scan fails; reading an entry never extends it. A
// failure of an endpoint whose window is still open was met by a scan that began
// before that window did, and changes nothing. At capacity, expired entries are
// removed first. If every remaining entry is still live, the one expiring
// earliest gives way, so the newest failure is always cached and the cache stays
// bounded. An endpoint that is not cached is read again; no status is ever
// inferred for it.
func (p *nativeProvider) recordScanFailure(lane *nativeLane, key nativeScanKey, err error) {
	if err == nil || errors.Is(err, errNativeBudget) || lane.ctx.Err() != nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.now()
	if nativeAPIUnavailable(err) {
		// Whichever namespace noticed, the metrics API is missing for the
		// whole resource.
		previous, known := lane.unavailable[key.resource]
		if known && now.Before(previous.until) {
			return
		}
		if lane.unavailable == nil {
			lane.unavailable = make(map[string]nativeScanFailure)
		}
		lane.unavailable[key.resource] = nativeNextFailure(previous, known, err, now)
		return
	}
	if nativeServerFailure(err) {
		key.name = ""
	}
	previous, known := lane.failures[key]
	if known && now.Before(previous.until) {
		return
	}
	if lane.failures == nil {
		lane.failures = make(map[nativeScanKey]nativeScanFailure)
	}
	if !known && len(lane.failures) >= nativeMaxFailures {
		var earliest nativeScanKey
		var earliestFailure nativeScanFailure
		found := false
		for existing, failure := range lane.failures {
			if !now.Before(failure.until) {
				delete(lane.failures, existing)
				continue
			}
			if !found || failure.expiresBefore(earliestFailure) {
				earliest, earliestFailure, found = existing, failure, true
			}
		}
		if found && len(lane.failures) >= nativeMaxFailures {
			delete(lane.failures, earliest)
		}
	}
	failure := nativeNextFailure(previous, known, err, now)
	lane.failureOrder++
	failure.order = lane.failureOrder
	lane.failures[key] = failure
}

// clearScanFailure forgets the failures of an endpoint that has just been read
// successfully. Reaching the metrics API at all also ends its remembered
// absence for every namespace.
func (p *nativeProvider) clearScanFailure(lane *nativeLane, key nativeScanKey) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(lane.unavailable, key.resource)
	delete(lane.failures, key)
	key.name = ""
	if failure, remembered := lane.failures[key]; remembered && nativeServerFailure(failure.err) {
		delete(lane.failures, key)
	}
}

func newNativeProvider() *nativeProvider {
	diag.DeclareNativeScan()
	return &nativeProvider{cache: NewClientCache(ClientCacheOpts{}), lanes: make(map[string]*nativeLane), now: time.Now}
}

func (p *nativeProvider) retireConnection(connectionID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if lane := p.lanes[connectionID]; lane != nil {
		lane.cancel()
		p.cache.Evict(lane.key)
		delete(p.lanes, connectionID)
	}
}

func nativeContext(pc *types.PluginContext) error {
	if pc == nil || pc.Context == nil || pc.Connection == nil || pc.Connection.ID == "" {
		return resourcev2.NewError("INVALID_REQUEST", "Native metrics require a caller context and an explicit source connection")
	}
	return pc.Context.Err()
}

func nativeSource(pc *types.PluginContext) sdkmetric.MetricSourceRef {
	return sdkmetric.MetricSourceRef{PluginID: "kubernetes", ConnectionID: pc.Connection.ID, Native: true}
}

func (p *nativeProvider) catalog(pc *types.PluginContext, request sdkmetric.ResourceMetricsCatalogRequest) (*sdkmetric.ResourceMetricsCatalog, error) {
	resourceKey := request.ResourceKey
	if err := nativeContext(pc); err != nil {
		return nil, err
	}
	if request.Source != nativeSource(pc) {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Native catalog source does not match the selected connection")
	}
	catalog := &sdkmetric.ResourceMetricsCatalog{Source: nativeSource(pc), MaxTargets: nativeMaxTargets, MaxSampleAge: 2 * time.Minute}
	if resourceKey == "k8s:/nodes" {
		catalog.Metrics = []sdkmetric.FiniteMetricDescriptor{
			{ID: nativeNodeCPU, Name: "CPU usage", ResourceKey: resourceKey, Unit: "cores", Shapes: []string{"current"}, Description: "Node CPU usage from metrics-server with actual source timestamp and window."},
			{ID: nativeNodeMemory, Name: "Memory working set", ResourceKey: resourceKey, Unit: "bytes", Shapes: []string{"current"}, Description: "Node memory working set from metrics-server with actual source timestamp and window."},
		}
		return catalog, nil
	}
	if resourceKey != "k8s:/pods" {
		return catalog, nil
	}
	catalog.Metrics = []sdkmetric.FiniteMetricDescriptor{
		{ID: nativeCPU, Name: "CPU usage", ResourceKey: "k8s:/pods", Unit: "cores", Shapes: []string{"current"}, Description: "Sum of container CPU usage, in cores averaged over the metrics-server measurement window. Actual source timestamp and window; no historical retention."},
		{ID: nativeMemory, Name: "Memory working set", ResourceKey: "k8s:/pods", Unit: "bytes", Shapes: []string{"current"}, Description: "Sum of container memory working sets in bytes, from metrics-server. Actual source timestamp and window; missing measurements are not zero."},
	}
	return catalog, nil
}

// observeNativeAbandon counts a query that ended without delivering results
// because its caller canceled, a deadline expired or its source generation was
// retired. Only the lane can tell caller cancellation from retirement; the error
// alone cannot. Other failures are counted by scan outcome, not here.
func observeNativeAbandon(lane *nativeLane, err error) {
	switch resourcev2.ErrorCode(err) {
	case "CANCELLED":
		if lane.ctx.Err() != nil {
			diag.ScanAbandoned(diag.AbandonRetired)
		} else {
			diag.ScanAbandoned(diag.AbandonCaller)
		}
	case "TIMEOUT":
		diag.ScanAbandoned(diag.AbandonDeadline)
	case "RESET_REQUIRED":
		diag.ScanAbandoned(diag.AbandonRetired)
	}
}

// query executes one bounded namespace scan per namespace, following continuation
// only when the API actually returns it. Server-side limit support is not assumed.
// Namespace inventory, not admitted target count, determines scan cost. An unseen
// target is missing only after its entire namespace scan completes successfully.
func (p *nativeProvider) query(pc *types.PluginContext, query sdkmetric.ResourceMetricsQuery) (published *sdkmetric.ResourceMetricsResponse, finalErr error) {
	if err := nativeContext(pc); err != nil {
		return nil, err
	}
	_, span := diag.Tracer().Start(pc.Context, "kubernetes.metric.query", trace.WithAttributes(
		attribute.String("source", "native"),
		attribute.Bool("cache.hit", false),
		attribute.Int("targets", len(query.Targets)),
		attribute.Int("metrics", len(query.MetricIDs)),
	))
	defer func() {
		class := diag.EndSpan(span, finalErr, false)
		promLog().Debugw(pc.Context, "native metric query finished",
			append([]any{"targets", len(query.Targets), "metrics", len(query.MetricIDs)}, class.LogFields()...)...)
		// Client build and scan errors can carry remote text.
		finalErr = remoteerr.Sanitize("native metric query", finalErr)
	}()
	if err := sdkmetric.ValidateResourceMetricsQuery(query); err != nil {
		return nil, err
	}
	if query.Source != nativeSource(pc) {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Native metrics source does not match the selected connection")
	}
	if len(query.Targets) == 0 || len(query.Targets) > nativeMaxTargets || len(query.MetricIDs) == 0 || len(query.MetricIDs) > 2 {
		return nil, resourcev2.NewError("RESOURCE_LIMIT", "Native metrics require 1..256 targets and 1..2 metric IDs")
	}
	metrics := make(map[string]bool, len(query.MetricIDs))
	for _, id := range query.MetricIDs {
		if id == "" || metrics[id] {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Native metric IDs must be nonempty and unique")
		}
		metrics[id] = true
	}
	tokens := make(map[string]bool, len(query.Targets))
	groups := make(map[string]map[string]int)
	response := &sdkmetric.ResourceMetricsResponse{Complete: true, Results: make([]sdkmetric.ResourceMetricResult, 0, len(query.Targets)*len(query.MetricIDs))}
	resourceKey := query.Targets[0].Reference.Address.Type
	if resourceKey != "k8s:/pods" && resourceKey != "k8s:/nodes" {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Unsupported native resource type")
	}
	isNode := resourceKey == "k8s:/nodes"
	cpuID, memoryID := nativeCPU, nativeMemory
	if isNode {
		cpuID, memoryID = nativeNodeCPU, nativeNodeMemory
	}
	for index, target := range query.Targets {
		if len(target.Token) == 0 || len(target.Token) > 256 || tokens[target.Token] {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Native target tokens must be unique and contain 1..256 bytes")
		}
		tokens[target.Token] = true
		name, namespace, err := utils.NativeResourceTarget(pc, nil, &target.Reference, &target.Route, resourceKey, !isNode)
		if err != nil {
			return nil, err
		}
		if (!isNode && len(validation.IsDNS1123Label(namespace)) != 0) || len(validation.IsDNS1123Subdomain(name)) != 0 {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Native Pod name or namespace is invalid")
		}
		if groups[namespace] == nil {
			groups[namespace] = make(map[string]int)
		}
		if _, duplicate := groups[namespace][name]; duplicate {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Duplicate native Pod identity")
		}
		groups[namespace][name] = index
		for _, id := range query.MetricIDs {
			result := sdkmetric.ResourceMetricResult{ResourceToken: target.Token, MetricID: id, Status: "failed", Message: "Namespace scan did not complete"}
			if query.Shape != "current" || id != cpuID && id != memoryID {
				result.Status, result.Message = "unsupported", "Native metrics support current CPU usage and memory working set only"
			}
			response.Results = append(response.Results, result)
		}
	}
	if query.Shape != "current" || !metrics[cpuID] && !metrics[memoryID] {
		return response, nil
	}
	p.mu.Lock()
	lane := p.lanes[pc.Connection.ID]
	if lane == nil {
		if len(p.lanes) >= nativeMaxConnections {
			p.mu.Unlock()
			return nil, resourcev2.NewError("RESOURCE_LIMIT", "Native metric source connection limit reached")
		}
		p.next++
		lifetime, cancel := context.WithCancel(context.Background())
		lane = &nativeLane{key: strconv.FormatUint(p.next, 10), ctx: lifetime, cancel: cancel}
		p.lanes[pc.Connection.ID] = lane
	}
	namespaceTurn := lane.namespaceTurn
	if !isNode {
		lane.namespaceTurn++
	}
	p.mu.Unlock()
	ctx, cancel := context.WithTimeout(pc.Context, nativeTimeout)
	defer cancel()
	stop := context.AfterFunc(lane.ctx, cancel)
	defer stop()
	defer func() { observeNativeAbandon(lane, finalErr) }()
	if lane.ctx.Err() != nil {
		return nil, resourcev2.NewError("RESET_REQUIRED", "Native metric source generation was retired")
	}
	clients, err := p.cache.Get(ctx, lane.key, pc.Connection)
	if err != nil {
		return nil, err
	}
	if clients == nil || clients.Clientset == nil {
		return nil, resourcev2.NewError("UNAVAILABLE", "Native metric client is unavailable")
	}
	budget := nativeScanBudget{bytes: nativeMaxBytes, objects: nativeMaxObjects, pages: nativeMaxPages}
	namespaces := make([]string, 0, len(groups))
	for namespace := range groups {
		namespaces = append(namespaces, namespace)
	}
	sort.Strings(namespaces)
	start := int(namespaceTurn % uint64(len(namespaces)))
	for offset := range namespaces {
		namespace := namespaces[(start+offset)%len(namespaces)]
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		indices := groups[namespace]
		seen := make(map[string]bool, len(indices))
		duplicates := make(map[string]bool)
		visit := func(item *metricsv1beta1.PodMetrics) {
			index, wanted := indices[item.Name]
			if !wanted || item.Namespace != namespace {
				return
			}
			start := index * len(query.MetricIDs)
			if seen[item.Name] {
				duplicates[item.Name] = true
			}
			seen[item.Name] = true
			for offset := range query.MetricIDs {
				result := &response.Results[start+offset]
				if result.Status == "unsupported" {
					continue
				}
				if duplicates[item.Name] {
					*result = sdkmetric.ResourceMetricResult{ResourceToken: result.ResourceToken, MetricID: result.MetricID, Status: "ambiguous", Message: "Metrics source returned duplicate Pod identities"}
					continue
				}
				fillNativeResult(result, item, query.Targets[index].Reference.Incarnation)
			}
		}
		// A singleton narrows its list to one metadata.name without adding a
		// request. Access is judged per selector, so the effective selector is
		// fixed here, before the failure cache is read, and is part of its key.
		selected := ""
		if !isNode && len(indices) == 1 {
			for targetName := range indices {
				selected = targetName
			}
		}
		scanKey := nativeScanKey{resource: resourceKey, namespace: namespace, name: selected}
		err := p.scanFailure(lane, scanKey)
		scanned := err == nil
		if err == nil && isNode {
			err = scanNativeNodes(ctx, clients.Clientset.CoreV1().RESTClient(), &budget, func(item *metricsv1beta1.NodeMetrics) {
				index, wanted := indices[item.Name]
				if !wanted || item.Namespace != "" {
					return
				}
				if seen[item.Name] {
					duplicates[item.Name] = true
				}
				seen[item.Name] = true
				for offset := range query.MetricIDs {
					result := &response.Results[index*len(query.MetricIDs)+offset]
					if result.Status == "unsupported" {
						continue
					}
					if duplicates[item.Name] {
						*result = sdkmetric.ResourceMetricResult{ResourceToken: result.ResourceToken, MetricID: result.MetricID, Status: "ambiguous", Message: "Metrics source returned duplicate Node identities"}
						continue
					}
					fillNativeNodeResult(result, item, query.Targets[index].Reference.Incarnation)
				}
			}, func(item *metricsv1beta1.NodeMetrics) bool {
				_, wanted := indices[item.Name]
				return wanted && item.Namespace == ""
			})
		} else if err == nil {
			// Keep filtering, pagination and all scan budgets even when an
			// aggregated metrics API ignores the selector.
			err = scanNativeNamespace(ctx, clients.Clientset.CoreV1().RESTClient(), namespace, selected, &budget, visit, func(item *metricsv1beta1.PodMetrics) bool {
				_, wanted := indices[item.Name]
				return wanted && item.Namespace == namespace
			})
		}
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			if scanned {
				p.recordScanFailure(lane, scanKey, err)
			}
			response.Complete = false
			status, message := "failed", "Native metrics namespace scan failed"
			if apierrors.IsForbidden(err) || apierrors.IsUnauthorized(err) {
				status, message = "denied", "Native metrics namespace access was denied"
			}
			if err == errNativeBudget {
				message = "Native metrics scan budget exhausted; unseen targets are not proven missing"
			}
			response.Warnings = append(response.Warnings, message)
			if !scanned {
				span.SetAttributes(attribute.Bool("cache.hit", true))
			}
			span.AddEvent("native.scan_failed", trace.WithAttributes(
				attribute.String("status", status),
				attribute.Bool("cache.hit", !scanned),
				attribute.Bool("budget_exhausted", err == errNativeBudget),
			))
			if level, logged := p.scanFailureLevel(lane, namespace, err, scanned); logged {
				fields := append([]any{"resource_namespace", namespace, "status", status, "cached_failure", !scanned,
					"budget_exhausted", err == errNativeBudget}, diag.ClassifyError(err, false).LogFields()...)
				if level == logging.LevelWarn {
					promLog().Warnw(ctx, "native metrics namespace scan failed", fields...)
				} else {
					promLog().Debugw(ctx, "native metrics namespace scan failed", fields...)
				}
			}
			for _, index := range indices {
				for offset := range query.MetricIDs {
					result := &response.Results[index*len(query.MetricIDs)+offset]
					// Only fully validated pages commit samples. Budget truncation
					// may retain target samples from earlier completed pages.
					if result.Status != "unsupported" && (err != errNativeBudget || result.Status == "failed") {
						*result = sdkmetric.ResourceMetricResult{ResourceToken: result.ResourceToken, MetricID: result.MetricID, Status: status, Message: message}
					}
				}
			}
		} else {
			if scanned {
				p.clearScanFailure(lane, scanKey)
			}
			for name, index := range indices {
				if seen[name] {
					continue
				}
				for offset := range query.MetricIDs {
					result := &response.Results[index*len(query.MetricIDs)+offset]
					if result.Status == "failed" {
						result.Status, result.Message = "missing", "Pod has no measurement in the completed namespace scan"
					}
				}
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if lane.ctx.Err() != nil || !p.cache.isCurrent(lane.key, clients) {
		return nil, resourcev2.NewError("RESET_REQUIRED", "Native metric source generation was retired")
	}
	return response, nil
}

func fillNativeResult(result *sdkmetric.ResourceMetricResult, item *metricsv1beta1.PodMetrics, incarnation *string) {
	result.Value, result.ObservedAt, result.Dimensions = nil, nil, nil
	result.Window = 0
	result.IdentityScope = ""
	if incarnation != nil && item.UID != "" && string(item.UID) != *incarnation {
		result.Status, result.Message = "invalid_context", "Metrics source Pod incarnation does not match the admitted reference"
		return
	}
	if item.Timestamp.IsZero() || item.Window.Duration <= 0 || len(item.Containers) == 0 {
		result.Status, result.Message = "missing", "Metrics source omitted measurement time, window or containers"
		return
	}
	resourceName := corev1.ResourceCPU
	if result.MetricID == nativeMemory || result.MetricID == nativeNodeMemory {
		resourceName = corev1.ResourceMemory
	}
	var value float64
	containerNames := make(map[string]bool, len(item.Containers))
	for _, container := range item.Containers {
		if container.Name == "" || containerNames[container.Name] {
			result.Status, result.Message = "ambiguous", "Metrics source returned empty or duplicate container identities"
			return
		}
		containerNames[container.Name] = true
		quantity, present := container.Usage[resourceName]
		if !present {
			result.Status, result.Message = "missing", "Metrics source omitted a container measurement"
			return
		}
		part := quantity.AsApproximateFloat64()
		if part < 0 || math.IsNaN(part) || math.IsInf(part, 0) {
			result.Status, result.Message = "failed", "Metrics source returned an invalid measurement"
			return
		}
		value += part
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		result.Status, result.Message = "failed", "Metrics source measurement sum overflowed"
		return
	}
	observed := item.Timestamp.Time
	result.Status, result.Message, result.Value, result.ObservedAt, result.Window = "ok", "", &value, &observed, item.Window.Duration
	result.Dimensions = map[string]string{"namespace": item.Namespace, "pod": item.Name}
	result.IdentityScope = "name"
	if incarnation != nil && item.UID != "" && string(item.UID) == *incarnation {
		result.IdentityScope = "incarnation"
	}
}

var errNativeBudget = fmt.Errorf("native metrics scan budget exceeded")

func fillNativeNodeResult(result *sdkmetric.ResourceMetricResult, item *metricsv1beta1.NodeMetrics, incarnation *string) {
	result.Value, result.ObservedAt, result.Dimensions = nil, nil, nil
	result.Window = 0
	result.IdentityScope = ""
	if incarnation != nil && item.UID != "" && string(item.UID) != *incarnation {
		result.Status, result.Message = "invalid_context", "Metrics source Node incarnation does not match the admitted reference"
		return
	}
	if item.Timestamp.IsZero() || item.Window.Duration <= 0 {
		result.Status, result.Message = "missing", "Metrics source omitted measurement time or window"
		return
	}
	resourceName := corev1.ResourceCPU
	if result.MetricID == nativeNodeMemory {
		resourceName = corev1.ResourceMemory
	}
	quantity, present := item.Usage[resourceName]
	if !present {
		result.Status, result.Message = "missing", "Metrics source omitted Node measurement"
		return
	}
	value := quantity.AsApproximateFloat64()
	if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		result.Status, result.Message = "failed", "Metrics source returned an invalid measurement"
		return
	}
	observed := item.Timestamp.Time
	result.Status, result.Message, result.Value, result.ObservedAt, result.Window = "ok", "", &value, &observed, item.Window.Duration
	result.Dimensions = map[string]string{"node": item.Name}
	result.IdentityScope = "name"
	if incarnation != nil && item.UID != "" && string(item.UID) == *incarnation {
		result.IdentityScope = "incarnation"
	}
}
