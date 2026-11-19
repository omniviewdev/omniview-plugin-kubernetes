package resource

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"maps"
	"sort"
	"strings"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel/attribute"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

const (
	nativeReadMaxPageSize            = resourcev2.MaxPageRecords
	nativeReadMaxCursorBytes         = 64 * 1024
	nativeLabelSelectorLanguage      = "kubernetes-label-selector.v1"
	nativeModelRepresentationVersion = "kubernetes.model.v1"
)

// NativeGet reads directly from the API server. The caller resolves the opaque
// resource type to a discovered GVR and supplies its catalog representation.
func NativeGet(ctx context.Context, client dynamic.Interface, gvr schema.GroupVersionResource, namespaced bool, request resourcev2.GetRequest, representation resourcev2.Representation) (result resourcev2.Record, retErr error) {
	ctx, crud := startNativeCRUD(ctx, "get", request.Reference.Address.Type, nativeScopeNamespace(request.Reference.Address.Scope), request.Reference.Address.ID)
	defer func() { crud.end(retErr) }()
	if err := ctx.Err(); err != nil {
		return resourcev2.Record{}, err
	}
	if request.Representation != representation.ID {
		return resourcev2.Record{}, resourcev2.NewError("INVALID_REQUEST", "The requested representation does not match the discovered resource representation")
	}
	namespace, err := nativeIdentityNamespace(request.Reference.Address.Scope, namespaced)
	if err != nil {
		return resourcev2.Record{}, err
	}
	if request.Reference.Address.ID == "" {
		return resourcev2.Record{}, resourcev2.NewError("INVALID_REQUEST", "A Kubernetes resource name is required")
	}
	if request.Reference.Incarnation != nil && *request.Reference.Incarnation == "" {
		return resourcev2.Record{}, resourcev2.NewError("INVALID_REQUEST", "An incarnation must be absent or nonempty")
	}
	object, err := nativeResourceClient(client, gvr, namespaced, namespace).Get(ctx, request.Reference.Address.ID, metav1.GetOptions{})
	if err != nil {
		return resourcev2.Record{}, err
	}
	if err := ctx.Err(); err != nil {
		return resourcev2.Record{}, err
	}
	if object.GetName() != request.Reference.Address.ID {
		return resourcev2.Record{}, resourcev2.NewError("INVALID_REQUEST", "The API server returned a different resource name")
	}
	if request.Reference.Incarnation != nil && *request.Reference.Incarnation != string(object.GetUID()) {
		return resourcev2.Record{}, resourcev2.NewError("RESET_REQUIRED", "The Kubernetes resource incarnation has changed")
	}
	record, err := nativeRecord(object, request.Reference.Address, namespaced, namespace, representation)
	if err != nil {
		return resourcev2.Record{}, err
	}
	if err := resourcev2.ValidateRecord(record); err != nil {
		return resourcev2.Record{}, err
	}
	if err := ctx.Err(); err != nil {
		return resourcev2.Record{}, err
	}
	return record, nil
}

// NativeEnumerate assembles a bounded source page from native Lists, each sized
// to the room left in the page. Its private cursor resumes source acquisition
// only; it is never a host query cursor.
// Separate namespace lists do not establish a shared point-in-time snapshot.
func NativeEnumerate(ctx context.Context, client dynamic.Interface, gvr schema.GroupVersionResource, namespaced bool, request resourcev2.EnumerateRequest, representation resourcev2.Representation) (resourcev2.SourcePage, error) {
	return nativeEnumerate(ctx, client, gvr, namespaced, request, representation, "")
}

// NativeQuery executes Kubernetes label selection without adding a second query
// engine. Selection remains inside the admitted namespace and representation.
func NativeQuery(ctx context.Context, client dynamic.Interface, gvr schema.GroupVersionResource, namespaced bool, request resourcev2.NativeQueryRequest, representation resourcev2.Representation) (resourcev2.SourcePage, error) {
	if request.Language != nativeLabelSelectorLanguage {
		return resourcev2.SourcePage{}, resourcev2.NewError("UNSUPPORTED", "The native query language is not supported")
	}
	if request.Query.Kind != "map" || len(request.Query.Map) != 1 {
		return resourcev2.SourcePage{}, resourcev2.NewError("INVALID_REQUEST", "A Kubernetes label query requires only labelSelector")
	}
	value, ok := request.Query.Map["labelSelector"]
	if !ok || value.Kind != "string" {
		return resourcev2.SourcePage{}, resourcev2.NewError("INVALID_REQUEST", "Kubernetes labelSelector must be a string")
	}
	selector, err := labels.Parse(value.String)
	if err != nil {
		return resourcev2.SourcePage{}, resourcev2.NewError("INVALID_REQUEST", "Kubernetes labelSelector is invalid")
	}
	return nativeEnumerate(ctx, client, gvr, namespaced, resourcev2.EnumerateRequest{
		Target: request.Target, PageSize: request.PageSize, Cursor: request.Cursor,
	}, representation, selector.String())
}

// nativeEnumerate fills one source page from native Lists.
//
// Each List is sized to the room the page has left, so every item it returns
// joins the page and its continue token, which resumes after that List's last
// item, is the exact cursor. A List is never truncated: when its items cannot
// all join, because the wire budget ends the page or the transport refuses the
// response as too large, the same position is requested again with fewer items.
func nativeEnumerate(ctx context.Context, client dynamic.Interface, gvr schema.GroupVersionResource, namespaced bool, request resourcev2.EnumerateRequest, representation resourcev2.Representation, selector string) (result resourcev2.SourcePage, retErr error) {
	ctx, crud := startNativeCRUD(ctx, "list", request.Target.Type, "", "")
	defer func() {
		crud.end(retErr, attribute.Int("items", len(result.Records)), attribute.Bool("selector", selector != ""), attribute.Bool("continued", request.Cursor != nil))
	}()
	if err := ctx.Err(); err != nil {
		return resourcev2.SourcePage{}, err
	}
	if request.Target.Representation != representation.ID {
		return resourcev2.SourcePage{}, resourcev2.NewError("INVALID_REQUEST", "The requested representation does not match the discovered resource representation")
	}
	if request.PageSize == 0 || request.PageSize > nativeReadMaxPageSize {
		return resourcev2.SourcePage{}, resourcev2.NewError("INVALID_REQUEST", "The native source page size must be between 1 and 256")
	}
	selection, err := nativeQuerySelection(request.Target.Scope, namespaced)
	if err != nil {
		return resourcev2.SourcePage{}, err
	}
	slots := selection.slots()
	crud.span.SetAttributes(attribute.Int("namespaces", len(selection.namespaces)), attribute.Int("names", len(selection.names)))
	binding, err := nativeCursorBinding(request, gvr, namespaced, selection, selector)
	if err != nil {
		return resourcev2.SourcePage{}, err
	}
	cursor, err := decodeNativeCursor(request.Cursor, binding, len(slots))
	if err != nil {
		return resourcev2.SourcePage{}, err
	}
	revision, pinned := resourcev2.CatalogRevisionForRouteFromContext(ctx, request.Target.Provider, request.Target.Route)
	generation := ""
	if pinned {
		generation, err = resourcev2.CatalogBindingEpoch(revision)
		if err != nil {
			return resourcev2.SourcePage{}, err
		}
	}
	if request.Cursor != nil && cursor.Generation != generation {
		return resourcev2.SourcePage{}, resourcev2.NewError("RESET_REQUIRED", "The native source connection generation changed")
	}
	cursor.Generation = generation
	page := resourcev2.SourcePage{
		Records:     []resourcev2.Record{},
		Count:       resourcev2.Count{Kind: "unknown"},
		Coverage:    nativeRepresentationCoverage(representation),
		Consistency: resourcev2.ConsistencyBestEffort,
	}
	if len(slots) == 0 {
		return page, nil
	}
	address := resourcev2.ResourceAddress{
		Provider: request.Target.Provider, Authority: request.Target.Authority, Type: request.Target.Type,
	}
	recordBytes, recordNodes, recordFields, bodyBytes := 0, 0, 0, 0
	// ceiling caps the items one List asks for. It starts at the page size and
	// only falls when a response could not be used whole.
	ceiling := int(request.PageSize)
	// budgetFull marks a page that the wire budget, not the page size, has ended.
	budgetFull := false
acquire:
	for calls := 0; cursor.Slot < len(slots) && len(page.Records) < int(request.PageSize) && calls < int(request.PageSize)+len(slots); {
		slot := slots[cursor.Slot]
		namespace := slot.namespace
		remaining := int(request.PageSize) - len(page.Records)
		// A continue token names the snapshot and the next key, never the limit,
		// and resumes after the last item of the List that returned it. Sizing
		// each List to the room left in the page lets every returned item join
		// the page, so the token is always an exact cursor.
		limit := min(remaining, ceiling)
		list, err := nativeResourceClient(client, gvr, namespaced, namespace).List(ctx, metav1.ListOptions{
			Limit: int64(limit), Continue: cursor.Continue, LabelSelector: selector, FieldSelector: slot.fieldSelector(),
		})
		if err != nil {
			if apierrors.IsResourceExpired(err) || apierrors.IsGone(err) {
				return resourcev2.SourcePage{}, resourcev2.NewError("RESET_REQUIRED", "The native source continuation has expired")
			}
			if resourcev2.ErrorCode(err) == "RESOURCE_LIMIT" {
				if limit > 1 {
					// The response outgrew the transport's decoded-body budget before
					// any of it was used: ask for the same position in smaller pieces.
					ceiling = limit / 2
					continue
				}
				if len(page.Records) > 0 {
					break
				}
			}
			return resourcev2.SourcePage{}, err
		}
		if err := ctx.Err(); err != nil {
			return resourcev2.SourcePage{}, err
		}
		continuation := list.GetContinue()
		// A server that honors limits never returns more items than it was asked
		// for together with a continue token; one that ignores them can only
		// answer with the complete list.
		honored := len(list.Items) <= limit
		if !honored && (continuation != "" || cursor.Continue != "") {
			return resourcev2.SourcePage{}, resourcev2.NewError("RESOURCE_LIMIT", "The API server returned an unbounded continued source page")
		}
		if len(list.Items) > remaining {
			if len(page.Records) > 0 {
				break
			}
			return resourcev2.SourcePage{}, resourcev2.NewError("RESOURCE_LIMIT", "The complete native source page exceeds the requested page size")
		}
		if continuation != "" && continuation == cursor.Continue {
			return resourcev2.SourcePage{}, resourcev2.NewError("RESET_REQUIRED", "The API server did not advance the native source continuation")
		}
		candidate := page
		if len(slots) == 1 {
			observed := nativeOptionalToken(list.GetResourceVersion())
			if candidate.SourceRevision != nil && observed != nil && *candidate.SourceRevision != *observed {
				return resourcev2.SourcePage{}, resourcev2.NewError("RESET_REQUIRED", "The native source snapshot revision changed")
			}
			candidate.SourceRevision = observed
		}
		next := cursor
		if continuation != "" {
			next.Continue = continuation
		} else {
			next.Slot++
			next.Continue = ""
		}
		candidate.NextCursor = nil
		if next.Slot < len(slots) {
			token, err := encodeNativeCursor(next)
			if err != nil {
				return resourcev2.SourcePage{}, err
			}
			candidate.NextCursor = &token
		}
		envelope := candidate
		envelope.Records = nil
		baseBytes, baseNodes, baseFields, err := resourcev2.SourcePageWireCost(envelope)
		if err != nil {
			return resourcev2.SourcePage{}, err
		}
		staged := make([]resourcev2.Record, 0, len(list.Items))
		addedBytes, addedNodes, addedFields, addedBodyBytes := 0, 0, 0, 0
		// unfit holds why the item after the staged ones cannot join the page.
		var unfit error
	stage:
		for i := range list.Items {
			if err := ctx.Err(); err != nil {
				return resourcev2.SourcePage{}, err
			}
			if slot.name != "" && list.Items[i].GetName() != slot.name {
				return resourcev2.SourcePage{}, resourcev2.NewError("INVALID_REQUEST", "The API server returned a resource outside the requested name selection")
			}
			record, err := nativeRecord(&list.Items[i], address, namespaced, namespace, representation)
			if err != nil {
				if resourcev2.ErrorCode(err) != "RESOURCE_LIMIT" {
					return resourcev2.SourcePage{}, err
				}
				unfit = err
				break stage
			}
			size, err := resourcev2.ValueWireSize(record.Body)
			bytes, nodes, fields := 0, 0, 0
			if err == nil {
				bytes, nodes, fields, err = resourcev2.SourceRecordWireCost(record)
			}
			if err != nil {
				if resourcev2.ErrorCode(err) != "RESOURCE_LIMIT" {
					return resourcev2.SourcePage{}, err
				}
				unfit = err
				break stage
			}
			addedBodyBytes += size
			addedBytes += bytes
			addedNodes += nodes
			addedFields += fields
			if addedBodyBytes > resourcev2.MaxPageBodyBytes-bodyBytes ||
				resourcev2.SourcePageResponseWireSize(baseBytes+recordBytes+addedBytes) > resourcev2.MaxMessageBytes ||
				baseNodes+recordNodes+addedNodes > resourcev2.MaxValueNodes ||
				baseFields+recordFields+addedFields > resourcev2.MaxWireFields {
				unfit = resourcev2.NewError("RESOURCE_LIMIT", "The complete native source page exceeds the resource wire budget")
				break stage
			}
			staged = append(staged, record)
		}
		if unfit != nil {
			switch {
			case len(staged) > 0 && honored:
				// The continue token resumes after the last item of this List, so the
				// items that do not fit cannot be handed back. Ask for this position
				// again with only the items that do; the page ends with them.
				ceiling, budgetFull = len(staged), true
				continue
			case len(page.Records) > 0:
				break acquire
			}
			return resourcev2.SourcePage{}, unfit
		}
		if resourcev2.SourcePageResponseWireSize(baseBytes+recordBytes) > resourcev2.MaxMessageBytes ||
			baseNodes+recordNodes > resourcev2.MaxValueNodes || baseFields+recordFields > resourcev2.MaxWireFields {
			if len(page.Records) > 0 {
				break
			}
			return resourcev2.SourcePage{}, resourcev2.NewError("RESOURCE_LIMIT", "The native source page exceeds the resource wire budget")
		}
		candidate.Records = append(page.Records, staged...)
		bodyBytes += addedBodyBytes
		recordBytes += addedBytes
		recordNodes += addedNodes
		recordFields += addedFields
		page = candidate
		cursor = next
		calls++
		if budgetFull {
			break
		}
	}
	if err := resourcev2.ValidateSourcePage(page); err != nil {
		return resourcev2.SourcePage{}, err
	}
	if err := ctx.Err(); err != nil {
		return resourcev2.SourcePage{}, err
	}
	return page, nil
}

func nativeResourceClient(client dynamic.Interface, gvr schema.GroupVersionResource, namespaced bool, namespace string) dynamic.ResourceInterface {
	resource := client.Resource(gvr)
	if namespaced {
		return resource.Namespace(namespace)
	}
	return resource
}

func nativeIdentityNamespace(scope []resourcev2.ScopeEntry, namespaced bool) (string, error) {
	if !namespaced {
		if len(scope) != 0 {
			return "", resourcev2.NewError("INVALID_REQUEST", "Cluster-scoped Kubernetes identity must not have scope dimensions")
		}
		return "", nil
	}
	if len(scope) != 1 || scope[0].Dimension != "namespace" || scope[0].Value == "" {
		return "", resourcev2.NewError("INVALID_REQUEST", "Namespaced Kubernetes identity requires exactly one nonempty namespace dimension")
	}
	return scope[0].Value, nil
}

// nativeSelection is what the scope of a finite read selects. namespaces always has an entry: the empty one is every namespace, or the cluster of a cluster-scoped kind.
// names is nil for every object, else the names of a oneOf, sorted and unique, possibly none: a valid empty selection matches nothing and is never widened.
type nativeSelection struct {
	namespaces []string
	names      []string
}

// nativeSlot is one native List: the objects of one namespace, narrowed to one name when it has one.
type nativeSlot struct {
	namespace string
	name      string
}

// fieldSelector asks the API server for the slot's one object. The name was admitted by nativeQuerySelection, so it has a selector.
func (s nativeSlot) fieldSelector() string {
	if s.name == "" {
		return ""
	}
	selector, _ := clients.NameSelector(s.name)
	return selector
}

// slots are the Lists that read the selection, namespace by namespace and in each the names in order. There are none when either dimension selects nothing.
func (s nativeSelection) slots() []nativeSlot {
	names := s.names
	if names == nil {
		names = []string{""}
	}
	slots := make([]nativeSlot, 0, len(s.namespaces)*len(names))
	for _, namespace := range s.namespaces {
		for _, name := range names {
			slots = append(slots, nativeSlot{namespace: namespace, name: name})
		}
	}
	return slots
}

// nativeQuerySelection reads the namespace and name constraints of a scope. An omitted dimension, and any, select every value; a cluster-scoped kind has no namespace.
// A name must be one an object can have (clients.NameSelector). Nothing else is a dimension of a Kubernetes kind.
func nativeQuerySelection(scope resourcev2.QueryScope, namespaced bool) (nativeSelection, error) {
	selection := nativeSelection{namespaces: []string{metav1.NamespaceAll}}
	seen := make(map[string]bool, len(scope))
	for _, constraint := range scope {
		if seen[constraint.Dimension] {
			return nativeSelection{}, resourcev2.NewError("INVALID_REQUEST", "A Kubernetes query scope must not repeat a dimension")
		}
		seen[constraint.Dimension] = true
		switch constraint.Dimension {
		case "namespace":
			if !namespaced {
				return nativeSelection{}, resourcev2.NewError("INVALID_REQUEST", "Cluster-scoped Kubernetes queries must not have a namespace dimension")
			}
			namespaces, err := nativeScopeValues(constraint, "namespace", nil)
			if err != nil {
				return nativeSelection{}, err
			}
			if namespaces != nil {
				selection.namespaces = namespaces
			}
		case "name":
			names, err := nativeScopeValues(constraint, "name", func(name string) error {
				_, err := clients.NameSelector(name)
				return err
			})
			if err != nil {
				return nativeSelection{}, err
			}
			selection.names = names
		default:
			return nativeSelection{}, resourcev2.NewError("INVALID_REQUEST", "Kubernetes queries take only namespace and name constraints")
		}
	}
	return selection, nil
}

// nativeScopeValues is the selection of one dimension: nil for any, else the values of a oneOf, sorted and unique (none is a non-nil empty list), which valid
// (when not nil) admits one by one.
func nativeScopeValues(constraint resourcev2.ScopeConstraint, dimension string, valid func(string) error) ([]string, error) {
	switch constraint.Match {
	case resourcev2.ScopeAny:
		if constraint.Values != nil {
			return nil, resourcev2.NewError("INVALID_REQUEST", "An any "+dimension+" constraint must not contain values")
		}
		return nil, nil
	case resourcev2.ScopeOneOf:
		if constraint.Values == nil {
			return nil, resourcev2.NewError("INVALID_REQUEST", "A oneOf "+dimension+" constraint requires a values array")
		}
		values := append([]string{}, (*constraint.Values)...)
		for _, value := range values {
			if value == "" {
				return nil, resourcev2.NewError("INVALID_REQUEST", "A selected Kubernetes "+dimension+" must be nonempty")
			}
			if valid != nil {
				if err := valid(value); err != nil {
					return nil, err
				}
			}
		}
		sort.Strings(values)
		unique := values[:0]
		for _, value := range values {
			if len(unique) == 0 || unique[len(unique)-1] != value {
				unique = append(unique, value)
			}
		}
		return unique, nil
	default:
		return nil, resourcev2.NewError("INVALID_REQUEST", "The "+dimension+" constraint must use any or oneOf")
	}
}

func nativeRecord(object *unstructured.Unstructured, address resourcev2.ResourceAddress, namespaced bool, namespace string, representation resourcev2.Representation) (resourcev2.Record, error) {
	if object.GetName() == "" {
		return resourcev2.Record{}, resourcev2.NewError("INVALID_REQUEST", "The API server returned a resource without metadata.name")
	}
	actualNamespace := object.GetNamespace()
	if (!namespaced && actualNamespace != "") || (namespaced && (actualNamespace == "" || (namespace != metav1.NamespaceAll && namespace != actualNamespace))) {
		return resourcev2.Record{}, resourcev2.NewError("INVALID_REQUEST", "The API server returned a resource outside the requested namespace scope")
	}
	address.ID = object.GetName()
	address.Scope = []resourcev2.ScopeEntry{}
	if namespaced {
		address.Scope = []resourcev2.ScopeEntry{{Dimension: "namespace", Value: actualNamespace}}
	}
	// Copy only the two maps changed by projection, never the resource body.
	bodyObject := object.Object
	if strings.HasPrefix(representation.ID, nativeModelRepresentationVersion+"/") {
		if metadata, ok := bodyObject["metadata"].(map[string]any); ok {
			if _, present := metadata["managedFields"]; present {
				bodyObject = maps.Clone(bodyObject)
				projectedMetadata := maps.Clone(metadata)
				delete(projectedMetadata, "managedFields")
				bodyObject["metadata"] = projectedMetadata
			}
		}
	}
	body, err := resourcev2.ValueFromNative(bodyObject)
	if err != nil {
		return resourcev2.Record{}, err
	}
	return resourcev2.Record{
		Reference:      resourcev2.ResourceReference{Address: address, Incarnation: nativeOptionalToken(string(object.GetUID()))},
		Body:           body,
		Representation: representation,
		Coverage:       nativeRepresentationCoverage(representation),
		SourceRevision: nativeOptionalToken(object.GetResourceVersion()),
	}, nil
}

func nativeRepresentationCoverage(representation resourcev2.Representation) resourcev2.Coverage {
	if strings.HasPrefix(representation.ID, nativeModelRepresentationVersion+"/") {
		return resourcev2.Coverage{Kind: "partial", Paths: []string{"/metadata/managedFields"}, Reason: "Kubernetes model projection omits metadata.managedFields"}
	}
	return nativeCompleteCoverage()
}

func nativeCompleteCoverage() resourcev2.Coverage {
	return resourcev2.Coverage{Kind: "complete", Paths: []string{}}
}

func nativeOptionalToken(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

type nativeReadCursor struct {
	Version int    `json:"version"`
	Binding string `json:"binding"`
	// Slot is the index of the List the read resumes at: one per namespace, and in it one per selected name.
	Slot       int    `json:"slot"`
	Continue   string `json:"continue"`
	Generation string `json:"generation,omitempty"`
}

func nativeCursorBinding(request resourcev2.EnumerateRequest, gvr schema.GroupVersionResource, namespaced bool, selection nativeSelection, selector string) (string, error) {
	// Normalize only the adapter's own selections: the namespaces and the names of a oneOf are a set, so their order and repeats are not another source.
	// Type and ID are opaque; the caller's discovered GVR, not a parsed type, determines the API endpoint.
	target := request.Target
	target.Scope = append(resourcev2.QueryScope(nil), request.Target.Scope...)
	for i := range target.Scope {
		if target.Scope[i].Match != resourcev2.ScopeOneOf {
			continue
		}
		switch target.Scope[i].Dimension {
		case "namespace":
			namespaces := selection.namespaces
			target.Scope[i].Values = &namespaces
		case "name":
			names := selection.names
			target.Scope[i].Values = &names
		}
	}
	sort.Slice(target.Scope, func(i, j int) bool { return target.Scope[i].Dimension < target.Scope[j].Dimension })
	encoded, err := json.Marshal(struct {
		Target     resourcev2.ReadTarget       `json:"target"`
		GVR        schema.GroupVersionResource `json:"gvr"`
		Namespaced bool                        `json:"namespaced"`
		PageSize   uint32                      `json:"pageSize"`
		Selector   string                      `json:"labelSelector"`
	}{target, gvr, namespaced, request.PageSize, selector})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

func decodeNativeCursor(token *string, binding string, slotCount int) (nativeReadCursor, error) {
	if token == nil {
		return nativeReadCursor{Version: 3, Binding: binding}, nil
	}
	if len(*token) == 0 || len(*token) > nativeReadMaxCursorBytes {
		return nativeReadCursor{}, resourcev2.NewError("INVALID_REQUEST", "The native source cursor has an invalid length")
	}
	var cursor nativeReadCursor
	encoded, err := base64.RawURLEncoding.DecodeString(*token)
	if err != nil || json.Unmarshal(encoded, &cursor) != nil || cursor.Version != 3 || cursor.Binding != binding || cursor.Slot < 0 || cursor.Slot >= slotCount {
		return nativeReadCursor{}, resourcev2.NewError("INVALID_REQUEST", "The native source cursor does not match the requested source")
	}
	return cursor, nil
}

func encodeNativeCursor(cursor nativeReadCursor) (string, error) {
	encoded, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(encoded)
	if len(token) > nativeReadMaxCursorBytes {
		return "", resourcev2.NewError("RESOURCE_LIMIT", "The native source cursor exceeded the adapter limit")
	}
	return token, nil
}
