package resource

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"

	"github.com/omniview/kubernetes/pkg/diag"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/kubernetes"
)

// nativeType is an adapter-owned dispatch binding. The public type token is
// looked up verbatim; callers never parse it to reconstruct a Kubernetes GVR.
type nativeType struct {
	GVR          schema.GroupVersionResource
	API          metav1.APIResource
	Descriptor   resourcev2.ResourceType
	Served       map[string]nativeServedType
	Actions      []resourcev2.ActionDescriptor
	Subresources map[string]metav1.APIResource
}

type nativeServedType struct {
	GVR schema.GroupVersionResource
	API metav1.APIResource
}

// nativeUnavailable is an API group version that discovery could not read: an
// aggregated API whose backing service is down is the usual one. Its kinds are
// not in the catalog until a later discovery reads it, which the provider tries
// again while the connection is open (native_catalog_heal.go). Reason is a closed
// vocabulary (stale, unavailable, timeout, too_large, invalid, absent, failed), safe for logs and
// for the connection fact that names the group.
type nativeUnavailable struct {
	GroupVersion string `json:"groupVersion"`
	Reason       string `json:"reason"`
}

// nativeDiscovery is what one discovery read, before it is turned into kinds: the
// group index and the resource list of every group version that answered. A
// catalog keeps it so that a later discovery can be merged into it
// (mergeNativeDiscovery).
type nativeDiscovery struct {
	groups []*metav1.APIGroup
	lists  []*metav1.APIResourceList
}

// listsKinds reports whether the discovery lists any resource of its own (a
// subresource belongs to its resource).
func (d nativeDiscovery) listsKinds() bool {
	for _, list := range d.lists {
		if list == nil {
			continue
		}
		for _, api := range list.APIResources {
			if !strings.Contains(api.Name, "/") {
				return true
			}
		}
	}
	return false
}

// nativeSupport is what a discovery gives a catalog: the kinds it serves, the
// group versions it could not read, and what it read (to merge into next time).
type nativeSupport struct {
	bindings    map[string]nativeType
	unavailable []nativeUnavailable
	discovery   nativeDiscovery
}

// nativeBuiltinGroups are the API groups kube-apiserver serves in process: the
// Kubernetes API (client-go's scheme), the aggregator's own group and the CRD API.
// Two rules rest on the list. A group version of one of them that does not answer
// is the API server not being readable, not an extension that is down (the kinds
// the plugin's own tables name, Pods, workloads, nodes, what relationships bind,
// live there), so the start fails. And a refresh never takes a kind of one of them
// away: a successful answer that lacks a built-in kind is not a deletion.
// A CRD group is served by the API server too, but it is an extension: it comes
// and goes. A group a newer server adds and this list lacks is read as an
// extension; native_builtin_groups_test.go compares the list with client-go's
// scheme and with the kinds the plugin and its UI name, so that it cannot fall
// behind unnoticed.
var nativeBuiltinGroups = map[string]struct{}{
	"": {}, "admissionregistration.k8s.io": {}, "apiextensions.k8s.io": {}, "apiregistration.k8s.io": {}, "apps": {},
	"authentication.k8s.io": {}, "authorization.k8s.io": {}, "autoscaling": {}, "batch": {}, "certificates.k8s.io": {},
	"coordination.k8s.io": {}, "discovery.k8s.io": {}, "events.k8s.io": {}, "flowcontrol.apiserver.k8s.io": {},
	"internal.apiserver.k8s.io": {}, "lifecycle.k8s.io": {}, "networking.k8s.io": {}, "node.k8s.io": {}, "policy": {},
	"rbac.authorization.k8s.io": {}, "resource.k8s.io": {}, "scheduling.k8s.io": {}, "storage.k8s.io": {},
	"storagemigration.k8s.io": {},
}

// nativeBuiltinGroup reports whether the group is one the API server serves in process.
func nativeBuiltinGroup(group string) bool {
	_, builtin := nativeBuiltinGroups[group]
	return builtin
}

// discoverNativeTypes is the first discovery of a connection: the kinds, and the
// group versions that did not answer.
func discoverNativeTypes(ctx context.Context, client discovery.DiscoveryInterface) (map[string]nativeType, []nativeUnavailable, error) {
	support, err := discoverNativeSupport(ctx, client, nil)
	return support.bindings, support.unavailable, err
}

// discoverNativeSupport reads discovery and turns it into what a catalog declares.
// It retains snapshot-only and create-only APIs. Discovery verbs describe native
// operations, not an authorization grant for a principal.
//
// WHAT THE CATALOG PROMISES: it is complete for every API group that answered
// discovery; groups that did not are listed in the connection fact
// kubernetes.unavailable_api_groups (their count and the first 32). The host
// refuses a connection whose catalog is not complete (Connection admission
// requires complete discovered support), and one broken aggregated API must not
// keep a user out of a working cluster.
//
// INTERIM. The owner's ruling is that a producer-side signal like this belongs in
// the SDK. The intended end state is an SDK coverage that can say "complete except
// these named groups", which the host admits; the plugin then reports its coverage
// honestly again (partial, the groups named) and the string fact goes.
//
// THE LINE between "a group is unavailable" and "the cluster cannot be read". The
// start fails, and nothing is published, when: the discovery index (/api, /apis)
// cannot be read; discovery lists no API resource at all; a group version answers
// 401 or 403 (credentials or permissions are refused, never "unavailable"); a
// group version answers as another one; a built-in group version
// (nativeBuiltinGroups) does not answer; or the index or a built-in group version
// has not answered when the acquisition deadline ends (they have no bound of their
// own). A group version of an extension group whose document fails after the index
// was read for any other reason (an error answer, a body that is not a discovery
// document, a version the aggregator marks stale) is unavailable: kubectl and
// client-go carry on without it, and so does this. So is one whose document parses
// and is wrong (a resource without a name or a kind, a resource twice, versions that
// disagree on whether one is namespaced: reason invalid; the same document of a
// built-in group fails the start) and one whose document has not answered within
// nativeGroupReadBound (reason timeout): a read that hangs, as an aggregated API's
// does when a network policy black-holes its backend or the node it runs on died,
// must not keep a user out of a working cluster, and however many hang together they
// cost one bound. The kinds of a group version that was never read are left out of
// the catalog until a discovery reads it; one the catalog knew keeps what it knew
// (below).
//
// LIMITS of the bound, measured and not fixed here. The connection's rate limiter (50
// requests a second, burst 100) refuses at once a read that would have to queue
// longer than the bound, and the group version is named failed, not timeout: on
// legacy discovery with more than 100 group versions and a short acquisition
// deadline healthy groups are named (29 of 150 at 1 s, 54 of 250 at 4 s, none at the
// 10 s default), and every heal attempt repeats it. The bound is half of what is left
// after the index: a slow index (8.8 s of 10 s) leaves a short bound and names slow
// but healthy extension groups timeout until a later attempt finds the index fast.
// Reading every extension group at once is a burst of about 7 goroutines per hung
// read and about 70 HTTP/1.1 connections for at most one bound (465 goroutines for
// 150 healthy groups, 1055 for 150 hung ones).
//
// WHAT A REFRESH KEEPS. previous is the catalog a refresh replaces. When it, or
// this discovery, has a group version that does not answer, the discovery is
// merged into what the catalog was built from (mergeNativeDiscovery): the kinds of
// a built-in group and of a group version that is listed and does not answer stay,
// and everything else follows the server, but only a healthy index removes a kind:
// one that lists none of the extension groups the catalog knew removes nothing, and
// they are named absent (withAbsentNativeExtensions). A discovery that never
// involved an unavailable group replaces the catalog, as it always did.
func discoverNativeSupport(ctx context.Context, client discovery.DiscoveryInterface, previous *nativeCatalogSnapshot) (nativeSupport, error) {
	read, unavailable, err := acquireNativeDiscovery(ctx, client)
	if err != nil {
		return nativeSupport{}, err
	}
	if !read.listsKinds() {
		// A server that lists nothing is a server that cannot be read, not a cluster without kinds; and a refresh that took it for one would drop every kind.
		return nativeSupport{}, resourcev2.NewError("UNAVAILABLE", "Kubernetes discovery listed no API resources.")
	}
	used := read
	if previous != nil && (len(previous.unavailable) != 0 || len(unavailable) != 0) {
		unavailable = withAbsentNativeExtensions(previous, read, unavailable)
		used = mergeNativeDiscovery(previous.discovery, read, unavailable)
	}
	bindings, err := buildNativeTypes(ctx, used)
	if err != nil {
		return nativeSupport{}, err
	}
	return nativeSupport{bindings: bindings, unavailable: unavailable, discovery: used}, nil
}

// acquireNativeDiscovery reads discovery and says which group versions did not
// answer, or fails when the cluster cannot be read (see the line above).
func acquireNativeDiscovery(ctx context.Context, client discovery.DiscoveryInterface) (nativeDiscovery, []nativeUnavailable, error) {
	if err := ctx.Err(); err != nil {
		return nativeDiscovery{}, nil, err
	}
	groups, lists, discoveryErr := discoverNativeResources(ctx, client)
	if err := ctx.Err(); err != nil {
		return nativeDiscovery{}, nil, err
	}
	var unavailable []nativeUnavailable
	if discoveryErr != nil {
		var failed *discovery.ErrGroupDiscoveryFailed
		if errors.As(discoveryErr, &failed) {
			for _, cause := range failed.Groups {
				if k8serrors.IsForbidden(cause) || k8serrors.IsUnauthorized(cause) {
					return nativeDiscovery{}, nil, cause
				}
			}
		}
		if k8serrors.IsForbidden(discoveryErr) || k8serrors.IsUnauthorized(discoveryErr) {
			return nativeDiscovery{}, nil, discoveryErr
		}
		if failed == nil || len(lists) == 0 {
			return nativeDiscovery{}, nil, discoveryErr
		}
		if err := nativeBuiltinFailure(failed); err != nil {
			return nativeDiscovery{}, nil, err
		}
		unavailable = nativeUnavailableGroups(failed)
		budgetReason := nativeBudgetReason(discoveryErr)
		for _, cause := range failed.Groups {
			if r := nativeBudgetReason(cause); r != "" {
				budgetReason = r
			}
		}
		trace.SpanFromContext(ctx).AddEvent("discovery.partial", trace.WithAttributes(attribute.Int("failed_groups", len(unavailable)), attribute.Int("discovered_lists", len(lists)), attribute.String("budget_reason", budgetReason)))
		zap.S().Named("catalog").Warnw("native discovery partial", "failed_groups", len(unavailable), "groups", nativeUnavailableNames(unavailable), "discovered_lists", len(lists), "budget_reason", budgetReason, "error_class", diag.ClassifyError(discoveryErr, false).Class)
	}
	return nativeDiscovery{groups: groups, lists: lists}, unavailable, nil
}

// buildNativeTypes turns what discovery read into the kinds of a catalog.
func buildNativeTypes(ctx context.Context, read nativeDiscovery) (map[string]nativeType, error) {
	groups, lists := read.groups, read.lists
	preferred := map[string]string{"": "v1"}
	for _, group := range groups {
		if group != nil && group.PreferredVersion.Version != "" {
			preferred[group.Name] = group.PreferredVersion.Version
		}
	}
	result := make(map[string]nativeType)
	for _, list := range lists {
		if list == nil {
			continue
		}
		gv, err := schema.ParseGroupVersion(list.GroupVersion)
		if err != nil {
			return nil, fmt.Errorf("invalid discovered Kubernetes group/version: %w", err)
		}
		for _, api := range list.APIResources {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			// Logs, exec and other subresources keep their own native services.
			if strings.Contains(api.Name, "/") {
				continue
			}
			if api.Name == "" || api.Kind == "" {
				return nil, fmt.Errorf("discovery returned an unnamed Kubernetes resource")
			}
			gvr := gv.WithResource(api.Name)
			token := "k8s:" + gv.Group + "/" + api.Name
			served := map[string]nativeServedType{gv.String(): {GVR: gvr, API: api}}
			if prior, exists := result[token]; exists {
				if _, duplicate := prior.Served[gv.String()]; duplicate {
					return nil, fmt.Errorf("duplicate discovered Kubernetes resource %q", token)
				}
				if prior.API.Namespaced != api.Namespaced {
					return nil, fmt.Errorf("inconsistent native identity dimensions for %q", token)
				}
				served = prior.Served
				served[gv.String()] = nativeServedType{GVR: gvr, API: api}
				// Native preferred served version selects representation, not
				// logical identity. Partial discovery falls back deterministically
				// without claiming the chosen version is newer.
				if prior.GVR.Version == preferred[gv.Group] || (gv.Version != preferred[gv.Group] && prior.GVR.Version < gv.Version) {
					prior.Served = served
					result[token] = prior
					continue
				}
			}
			dimensions := []resourcev2.Dimension{}
			if api.Namespaced {
				dimensions = append(dimensions, resourcev2.Dimension{Name: "namespace", AllowEmpty: false})
			}
			// The name selects within the namespaces a read covers: a page can narrow its read to one object. It is a query dimension only: an object is its namespace and its id.
			queryDimensions := append(slices.Clone(dimensions), nativeNameDimension)
			scope := nativeServedScope(api.Namespaced, resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeAny}})
			capabilities := []resourcev2.Capability{}
			if verbSliceContains(api.Verbs, "get") {
				capabilities = append(capabilities, resourcev2.Capability{Operation: resourcev2.OperationGet, Scope: scope})
			}
			if verbSliceContains(api.Verbs, "list") {
				capabilities = append(capabilities, resourcev2.Capability{Operation: resourcev2.OperationEnumerate, Scope: scope})
				capabilities = append(capabilities, resourcev2.Capability{Operation: resourcev2.OperationNativeQuery, Scope: scope})
			}
			for _, mutation := range []struct {
				verb      string
				operation resourcev2.Operation
			}{{"create", resourcev2.OperationCreate}, {"update", resourcev2.OperationMutationUpdate}, {"delete", resourcev2.OperationDelete}} {
				if verbSliceContains(api.Verbs, mutation.verb) {
					capabilities = append(capabilities, resourcev2.Capability{Operation: mutation.operation, Scope: scope})
				}
			}
			result[token] = nativeType{
				GVR:    gvr,
				API:    api,
				Served: served,
				Descriptor: resourcev2.ResourceType{
					Type:               token,
					DisplayName:        api.Kind,
					IdentityDimensions: dimensions,
					QueryDimensions:    queryDimensions,
					Representations:    []resourcev2.Representation{},
					Capabilities:       capabilities,
				},
			}
			if verbSliceContains(api.Verbs, "list") {
				binding := result[token]
				binding.Descriptor.NativeQueries = []resourcev2.NativeQueryDescriptor{{
					Language:    nativeLabelSelectorLanguage,
					Description: "Select resources using native Kubernetes label selectors within the admitted scope; returns one bounded source page",
					InputSchema: resourcev2.Schema{
						Properties: map[string]resourcev2.SchemaProperty{"labelSelector": {
							Type: resourcev2.SchemaString, Description: "Kubernetes label selector; an empty string selects all labels within the admitted scope",
						}},
						Required: []string{"labelSelector"},
					},
				}}
				result[token] = binding
			}
		}
	}
	for token, binding := range result {
		binding.Subresources = make(map[string]metav1.APIResource)
		for _, list := range lists {
			if list == nil || list.GroupVersion != binding.GVR.GroupVersion().String() {
				continue
			}
			for _, api := range list.APIResources {
				if strings.HasPrefix(api.Name, binding.GVR.Resource+"/") {
					binding.Subresources[strings.TrimPrefix(api.Name, binding.GVR.Resource+"/")] = api
				}
			}
		}
		result[token] = binding
	}
	return result, nil
}

// nativeBuiltinFailure is the failure of the first (by name) built-in group
// version that did not answer, or nil when only extensions did not.
func nativeBuiltinFailure(failed *discovery.ErrGroupDiscoveryFailed) error {
	var first *schema.GroupVersion
	for gv := range failed.Groups {
		if nativeBuiltinGroup(gv.Group) && (first == nil || gv.String() < first.String()) {
			first = &gv
		}
	}
	if first == nil {
		return nil
	}
	return fmt.Errorf("API group %s is served by the API server and did not answer discovery: %w", first, failed.Groups[*first])
}

// nativeUnavailableGroups names the group versions that failed, in order, each
// with a closed reason.
func nativeUnavailableGroups(failed *discovery.ErrGroupDiscoveryFailed) []nativeUnavailable {
	groups := make([]nativeUnavailable, 0, len(failed.Groups))
	for gv, cause := range failed.Groups {
		groups = append(groups, nativeUnavailable{GroupVersion: gv.String(), Reason: nativeUnavailableReason(cause)})
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].GroupVersion < groups[j].GroupVersion })
	return groups
}

// nativeUnavailableReason says in one word why a group version was not read.
func nativeUnavailableReason(cause error) string {
	var stale discovery.StaleGroupVersionError
	switch transient := nativeTransientReason(cause); {
	case errors.Is(cause, errNativeDocumentInvalid):
		return "invalid"
	case errors.As(cause, &stale):
		return "stale"
	case nativeBudgetReason(cause) != "":
		return "too_large"
	case k8serrors.IsTimeout(cause) || k8serrors.IsServerTimeout(cause) || errors.Is(cause, context.DeadlineExceeded) || transient == "timeout":
		return "timeout"
	case k8serrors.IsServiceUnavailable(cause) || k8serrors.IsInternalError(cause) || k8serrors.IsTooManyRequests(cause) || transient != "":
		return "unavailable"
	}
	return "failed"
}

// nativeUnavailableNames lists the group versions for a log line, at most 16.
func nativeUnavailableNames(unavailable []nativeUnavailable) string {
	const most = 16
	names := make([]string, 0, min(len(unavailable), most+1))
	for i, group := range unavailable {
		if i == most {
			names = append(names, fmt.Sprintf("and %d more", len(unavailable)-most))
			break
		}
		names = append(names, clipGroupVersion(group.GroupVersion))
	}
	return strings.Join(names, ", ")
}

func sortedNativeTypes(bindings map[string]nativeType) []resourcev2.ResourceType {
	tokens := make([]string, 0, len(bindings))
	for token := range bindings {
		tokens = append(tokens, token)
	}
	sort.Strings(tokens)
	types := make([]resourcev2.ResourceType, 0, len(tokens))
	for _, token := range tokens {
		types = append(types, bindings[token].Descriptor)
	}
	return types
}

// nativeClusterIdentityScheme names the hint that nativeClusterIdentity gives: the UID of the kube-system Namespace. It is also the fact FactClusterUID (catalogFacts).
const nativeClusterIdentityScheme = "kubernetes.namespace-uid.v1"

// nativeClusterIdentity supplies a backing-identity hint, not a host authority.
// A route without permission to observe the native UID remains unknown: nil
// identity and no error. A transient failure to read it (a closed connection,
// a timeout, 429/5xx) is neither unknown nor a change: it is retried within ctx
// and then reported as UNAVAILABLE, so callers keep the identity they hold
// instead of treating the missing answer as a different cluster.
func nativeClusterIdentity(ctx context.Context, client kubernetes.Interface) (*string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var uid string
	err := retryNativeRequest(ctx, func() error {
		namespace, err := client.CoreV1().Namespaces().Get(ctx, "kube-system", metav1.GetOptions{})
		if err == nil {
			uid = string(namespace.UID)
		}
		return err
	})
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if nativeTransientReason(err) != "" {
		return nil, &resourcev2.ResourceOperationError{Err: err, Code: "UNAVAILABLE", Message: "Native Kubernetes backing identity could not be read; try again"}
	}
	if err != nil || uid == "" {
		reason := "uid_empty"
		if err != nil {
			reason = diag.ClassifyError(err, false).Class
		}
		zap.S().Named("catalog").Debugw("native cluster identity unavailable", "reason", reason)
		return nil, nil
	}
	identity := uid
	return &identity, nil
}

func verbSliceContains(verbs []string, target string) bool {
	for _, verb := range verbs {
		if verb == target {
			return true
		}
	}
	return false
}
