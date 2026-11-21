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
// vocabulary (stale, unavailable, timeout, too_large, failed), safe for logs and
// for the connection fact that names the group.
type nativeUnavailable struct {
	GroupVersion string `json:"groupVersion"`
	Reason       string `json:"reason"`
}

// discoverNativeTypes retains snapshot-only and create-only APIs. Discovery
// verbs describe native operations, not an authorization grant for a principal.
//
// A group version that does not answer does not fail discovery: kubectl and
// client-go carry on without it, and so does this. Its kinds are no support the
// connection can use, so they are left out and the group version is returned in
// unavailable. The catalog stays complete: the host refuses a connection whose
// catalog is not (Connection admission requires complete discovered support),
// and one broken aggregated API must not keep a user out of a working cluster.
// Nothing is lost by it: an answer that was never read grants no support, and a
// later discovery that reads it adds its kinds.
func discoverNativeTypes(ctx context.Context, client discovery.DiscoveryInterface) (map[string]nativeType, []nativeUnavailable, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	groups, lists, discoveryErr := discoverNativeResources(ctx, client)
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	var unavailable []nativeUnavailable
	if discoveryErr != nil {
		var failed *discovery.ErrGroupDiscoveryFailed
		if errors.As(discoveryErr, &failed) {
			for _, cause := range failed.Groups {
				if k8serrors.IsForbidden(cause) || k8serrors.IsUnauthorized(cause) {
					return nil, nil, cause
				}
			}
		}
		if k8serrors.IsForbidden(discoveryErr) || k8serrors.IsUnauthorized(discoveryErr) {
			return nil, nil, discoveryErr
		}
		if failed == nil || len(lists) == 0 {
			return nil, nil, discoveryErr
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
			return nil, nil, fmt.Errorf("invalid discovered Kubernetes group/version: %w", err)
		}
		for _, api := range list.APIResources {
			if err := ctx.Err(); err != nil {
				return nil, nil, err
			}
			// Logs, exec and other subresources keep their own native services.
			if strings.Contains(api.Name, "/") {
				continue
			}
			if api.Name == "" || api.Kind == "" {
				return nil, nil, fmt.Errorf("discovery returned an unnamed Kubernetes resource")
			}
			gvr := gv.WithResource(api.Name)
			token := "k8s:" + gv.Group + "/" + api.Name
			served := map[string]nativeServedType{gv.String(): {GVR: gvr, API: api}}
			if prior, exists := result[token]; exists {
				if _, duplicate := prior.Served[gv.String()]; duplicate {
					return nil, nil, fmt.Errorf("duplicate discovered Kubernetes resource %q", token)
				}
				if prior.API.Namespaced != api.Namespaced {
					return nil, nil, fmt.Errorf("inconsistent native identity dimensions for %q", token)
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
	return result, unavailable, nil
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
		names = append(names, group.GroupVersion)
	}
	return strings.Join(names, ", ")
}

// nativeSupportCovers reports whether next keeps every kind of previous, and
// every version of it that previous served. A discovery that could not read some
// group version is no proof that the kinds missing from it are gone, so it may
// add support to an installed catalog and never take any away.
func nativeSupportCovers(next, previous map[string]nativeType) bool {
	for token, old := range previous {
		kept, ok := next[token]
		if !ok {
			return false
		}
		for version := range old.Served {
			if _, ok := kept.Served[version]; !ok {
				return false
			}
		}
	}
	return true
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
