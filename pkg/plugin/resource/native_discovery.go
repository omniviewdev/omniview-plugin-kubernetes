package resource

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"sync"

	apidiscoveryv2 "k8s.io/api/apidiscovery/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/rest"
)

const (
	nativeCatalogRequestConcurrency = 4
	maxNativeDiscoveryVersions      = 256
	maxNativeDiscoveryBytes         = 16 << 20
	maxNativeDiscoveryDocumentBytes = 4 << 20

	// nativeAggregatedDiscoveryAccept asks /api and /apis for aggregated
	// discovery (every group, version and resource in one response) and accepts
	// the legacy lists from servers that do not serve it, as client-go does.
	nativeAggregatedDiscoveryAccept = discovery.AcceptV2 + "," + discovery.AcceptV1
)

// nativeBudgetError marks a local discovery or schema budget limit. reason is a
// closed enum safe for logs and span attributes; text is unchanged from the
// previous plain error.
type nativeBudgetError struct {
	reason string
	text   string
}

func (e *nativeBudgetError) Error() string { return e.text }

func errNativeDiscoveryBytes() error {
	return &nativeBudgetError{reason: "discovery_bytes", text: "Kubernetes discovery exceeds the byte budget"}
}

// nativeBudgetReason returns the budget reason for err, or "" when err is not a local budget error.
func nativeBudgetReason(err error) string {
	var budget *nativeBudgetError
	if errors.As(err, &budget) {
		return budget.reason
	}
	return ""
}

// Native discovery uses the existing client's transport with the acquisition
// context. client-go's ServerGroupsAndResources has no context parameter.
func discoverNativeResources(ctx context.Context, client discovery.DiscoveryInterface) ([]*metav1.APIGroup, []*metav1.APIResourceList, error) {
	restClient := client.RESTClient()
	if _, native := client.(*discovery.DiscoveryClient); !native || restClient == nil {
		// Injected discovery implementations supply their own response.
		return client.ServerGroupsAndResources()
	}
	budget := &nativeDiscoveryBudget{remaining: maxNativeDiscoveryBytes + 1}
	budget.changed = sync.NewCond(&budget.mu)
	stop := context.AfterFunc(ctx, func() {
		budget.mu.Lock()
		budget.changed.Broadcast()
		budget.mu.Unlock()
	})
	defer stop()
	// Servers with aggregated discovery answer /api and /apis with every group,
	// version and resource, so no per-version request is needed. Others answer
	// with the legacy lists and each version is read below. The two responses
	// are merged independently, so a mixed pair still resolves.
	listed := make(map[schema.GroupVersion]*metav1.APIResourceList)
	stale := make(map[schema.GroupVersion]error)
	core, err := readNativeDiscoveryIndex(ctx, restClient, "/api", budget)
	if err != nil {
		return nil, nil, err
	}
	coreVersions := core.Versions
	if core.aggregated() {
		coreVersions = nil
		for _, group := range core.aggregatedGroups(listed, stale) {
			if group.Name != "" {
				return nil, nil, fmt.Errorf("invalid Kubernetes discovery group version")
			}
			for _, version := range group.Versions {
				coreVersions = append(coreVersions, version.Version)
			}
		}
	}
	advertised, err := readNativeDiscoveryIndex(ctx, restClient, "/apis", budget)
	if err != nil {
		return nil, nil, err
	}
	advertisedGroups := advertised.Groups
	if advertised.aggregated() {
		advertisedGroups = advertised.aggregatedGroups(listed, stale)
	}
	groups := make([]*metav1.APIGroup, 0, len(advertisedGroups))
	versions := make([]schema.GroupVersion, 0, len(coreVersions))
	for _, version := range coreVersions {
		versions = append(versions, schema.GroupVersion{Version: version})
	}
	for index := range advertisedGroups {
		group := &advertisedGroups[index]
		groups = append(groups, group)
		for _, version := range group.Versions {
			gv, err := schema.ParseGroupVersion(version.GroupVersion)
			if err != nil || gv.Group != group.Name || gv.Version != version.Version {
				return nil, nil, fmt.Errorf("invalid Kubernetes discovery group version")
			}
			versions = append(versions, gv)
		}
	}
	if len(versions) > maxNativeDiscoveryVersions {
		return nil, nil, &nativeBudgetError{reason: "discovery_versions", text: "Kubernetes discovery exceeds the served-version budget"}
	}
	seen := make(map[schema.GroupVersion]bool, len(versions))
	for _, gv := range versions {
		if seen[gv] || gv.Version == "" {
			return nil, nil, fmt.Errorf("invalid or duplicate Kubernetes discovery group version")
		}
		seen[gv] = true
	}
	type result struct {
		list metav1.APIResourceList
		err  error
	}
	results := make([]result, len(versions))
	workCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var workers sync.WaitGroup
	var nextMu sync.Mutex
	next := 0
	for range min(nativeCatalogRequestConcurrency, len(versions)) {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for {
				nextMu.Lock()
				if next == len(versions) || workCtx.Err() != nil {
					nextMu.Unlock()
					return
				}
				index := next
				next++
				nextMu.Unlock()
				gv := versions[index]
				if listed[gv] != nil {
					continue
				}
				path := "/apis/" + gv.String()
				if gv.Group == "" {
					path = "/api/" + gv.Version
				}
				entry := &results[index]
				entry.err = readNativeDiscovery(workCtx, restClient, path, "", &entry.list, budget)
				if entry.err == nil && entry.list.GroupVersion != gv.String() {
					entry.err = fmt.Errorf("Kubernetes discovery returned a different group version")
					cancel()
				}
			}
		}()
	}
	workers.Wait()
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	// A mismatched response is a hard failure, not partial discovery.
	if workCtx.Err() != nil {
		return nil, nil, fmt.Errorf("Kubernetes discovery returned a different group version")
	}
	lists := make([]*metav1.APIResourceList, 0, len(versions))
	failed := make(map[schema.GroupVersion]error)
	for index, gv := range versions {
		if list := listed[gv]; list != nil {
			lists = append(lists, list)
			continue
		}
		entry := &results[index]
		if entry.err != nil {
			failed[gv] = entry.err
		} else {
			lists = append(lists, &entry.list)
		}
	}
	maps.Copy(failed, stale)
	if len(failed) != 0 {
		return groups, lists, &discovery.ErrGroupDiscoveryFailed{Groups: failed}
	}
	return groups, lists, nil
}

// The budget reserves bytes before each read, then refunds unused allowance.
// Waiting readers share refunds without holding the lock across network I/O.
// This bounds discovery reads; the existing transport can buffer separately.
type nativeDiscoveryBudget struct {
	mu        sync.Mutex
	remaining int
	inFlight  int
	changed   *sync.Cond
}

type nativeDiscoveryReader struct {
	ctx    context.Context
	stream io.Reader
	budget *nativeDiscoveryBudget
}

func (r nativeDiscoveryReader) Read(p []byte) (int, error) {
	b := r.budget
	b.mu.Lock()
	for b.remaining == 0 && b.inFlight != 0 {
		if err := r.ctx.Err(); err != nil {
			b.mu.Unlock()
			return 0, err
		}
		b.changed.Wait()
	}
	if b.remaining == 0 {
		b.mu.Unlock()
		return 0, errNativeDiscoveryBytes()
	}
	limit := min(len(p), b.remaining, 32<<10)
	b.remaining -= limit
	b.inFlight++
	b.mu.Unlock()
	n, err := r.stream.Read(p[:limit])
	b.mu.Lock()
	b.remaining += limit - n
	b.inFlight--
	exceeded := b.remaining == 0 && b.inFlight == 0
	b.changed.Broadcast()
	b.mu.Unlock()
	if exceeded {
		return n, errNativeDiscoveryBytes()
	}
	return n, err
}

// nativeDiscoveryIndex is an /api or /apis response in either format: the
// legacy lists (versions, groups) or aggregated discovery (items).
type nativeDiscoveryIndex struct {
	metav1.TypeMeta
	Versions []string                           `json:"versions"`
	Groups   []metav1.APIGroup                  `json:"groups"`
	Items    []apidiscoveryv2.APIGroupDiscovery `json:"items"`
}

func (i *nativeDiscoveryIndex) aggregated() bool {
	return i.Kind == "APIGroupDiscoveryList" && i.APIVersion == apidiscoveryv2.SchemeGroupVersion.String()
}

// aggregatedGroups converts aggregated discovery to legacy groups. The resource
// lists it carries and the versions it marks stale are recorded in listed and
// stale; a stale version is absent from the returned groups.
func (i *nativeDiscoveryIndex) aggregatedGroups(listed map[schema.GroupVersion]*metav1.APIResourceList, stale map[schema.GroupVersion]error) []metav1.APIGroup {
	groups, lists, failed := discovery.SplitGroupsAndResources(apidiscoveryv2.APIGroupDiscoveryList{Items: i.Items})
	maps.Copy(listed, lists)
	maps.Copy(stale, failed)
	return groups.Groups
}

func readNativeDiscoveryIndex(ctx context.Context, client rest.Interface, path string, budget *nativeDiscoveryBudget) (nativeDiscoveryIndex, error) {
	var index nativeDiscoveryIndex
	err := readNativeDiscovery(ctx, client, path, nativeAggregatedDiscoveryAccept, &index, budget)
	return index, err
}

// readNativeDiscovery reads one discovery document, repeating the request while
// it fails with a transient transport or overload error. A non-empty accept
// replaces the client's Accept header.
func readNativeDiscovery(ctx context.Context, client rest.Interface, path, accept string, into any, budget *nativeDiscoveryBudget) error {
	return retryNativeRequest(ctx, func() error {
		return readNativeDiscoveryOnce(ctx, client, path, accept, into, budget)
	})
}

func readNativeDiscoveryOnce(ctx context.Context, client rest.Interface, path, accept string, into any, budget *nativeDiscoveryBudget) error {
	budget.mu.Lock()
	exhausted := budget.remaining == 0 && budget.inFlight == 0
	budget.mu.Unlock()
	if exhausted {
		return errNativeDiscoveryBytes()
	}
	request := client.Get().AbsPath(path)
	if accept != "" {
		request = request.SetHeader("Accept", accept)
	}
	stream, err := request.Stream(ctx)
	if err != nil {
		return err
	}
	defer stream.Close()
	reader := nativeDiscoveryReader{ctx: ctx, stream: stream, budget: budget}
	data, err := io.ReadAll(io.LimitReader(reader, maxNativeDiscoveryDocumentBytes+1))
	if err != nil {
		return err
	}
	if len(data) > maxNativeDiscoveryDocumentBytes {
		return errNativeDiscoveryBytes()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return json.Unmarshal(data, into)
}
