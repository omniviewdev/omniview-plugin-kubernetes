package helm

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"time"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

func namespaceOf(ref resource.ResourceReference) string {
	for _, s := range ref.Address.Scope {
		if s.Dimension == "namespace" {
			return s.Value
		}
	}
	return ""
}
func nativeObject(value resource.Value) (map[string]interface{}, error) {
	native, err := resource.NativeFromValue(value)
	if err != nil {
		return nil, err
	}
	if native == nil {
		return nil, nil
	}
	object, ok := native.(map[string]interface{})
	if !ok {
		return nil, resource.NewError("INVALID_REQUEST", "Helm action input must be an object or null")
	}
	return object, nil
}
func actionParams(request resource.ActionRequest) (map[string]interface{}, error) {
	return nativeObject(request.Input)
}

func releaseActionSourceRevision(request resource.ActionRequest) (*string, error) {
	params, err := actionParams(request)
	if err != nil {
		return nil, err
	}
	value, present := params["expectedSourceRevision"]
	if !present && request.Action == "get-values" {
		return nil, nil
	}
	revision, ok := value.(string)
	if !ok || revision == "" {
		return nil, resource.NewError("INVALID_REQUEST", "An observed installed Helm release source revision is required")
	}
	return &revision, nil
}

func actionNamespace(request resource.ActionRequest) (string, error) {
	if request.TypeTarget == nil {
		return namespaceOf(request.Reference), nil
	}
	target := request.TypeTarget
	if err := resource.ValidateScope(target.Scope); err != nil {
		return "", err
	}
	dimension := "domain"
	if target.Type == ReleaseType {
		dimension = "namespace"
	}
	if len(target.Scope) != 1 {
		return "", resource.NewError("INVALID_REQUEST", "Helm type action requires exactly one scope dimension")
	}
	constraint := target.Scope[0]
	if constraint.Dimension != dimension || constraint.Match != resource.ScopeOneOf || constraint.Values == nil || len(*constraint.Values) != 1 || (*constraint.Values)[0] == "" {
		return "", resource.NewError("INVALID_REQUEST", "Helm type action requires one exact native scope")
	}
	value := (*constraint.Values)[0]
	if dimension == "domain" && value != helmLocalDomain {
		return "", resource.NewError("INVALID_REQUEST", "Helm client domain required")
	}
	if request.Input.Kind == "map" {
		if observed, present := request.Input.Map[dimension]; present && (observed.Kind != "string" || observed.String != value) {
			return "", resource.NewError("INVALID_REQUEST", "Helm input scope does not match its exact type target")
		}
	}
	if dimension == "namespace" {
		return value, nil
	}
	return "", nil
}
func validateReference(ref resource.ResourceReference) error {
	a := ref.Address
	if len(a.Scope) != 1 {
		return fmt.Errorf("Helm identity requires exactly one native scope dimension")
	}
	if a.Type == ReleaseType {
		if a.Scope[0].Dimension != "namespace" || a.Scope[0].Value == "" {
			return fmt.Errorf("release namespace required")
		}
	} else if a.Scope[0].Dimension != "domain" || a.Scope[0].Value != helmLocalDomain {
		return fmt.Errorf("Helm client domain required")
	}
	return nil
}
func helmRecord(ref resource.ResourceReference, body map[string]interface{}) (resource.Record, error) {
	v, e := resource.ValueFromNative(body)
	if e != nil {
		return resource.Record{}, e
	}
	record := resource.Record{Reference: ref, Body: v, Representation: helmRepresentationDescriptor(), Coverage: resource.Coverage{Kind: "complete"}}
	return record, nil
}

func helmReleaseRecord(ref resource.ResourceReference, snapshot namedReleaseSnapshot) (resource.Record, error) {
	record, err := helmRecord(ref, releaseToMap(snapshot.release))
	if err != nil {
		return resource.Record{}, err
	}
	record.SourceRevision = snapshot.sourceRevision()
	return record, nil
}

func (snapshot *namedReleaseSnapshot) sourceRevision() *string {
	if snapshot.revision != nil {
		return snapshot.revision
	}
	var deployed time.Time
	if snapshot.release.Info != nil {
		deployed = snapshot.release.Info.FirstDeployed.Time
	}
	snapshot.revision = helmReleaseSourceRevision(snapshot.release.Version, snapshot.identity.uid, deployed)
	return snapshot.revision
}

// Native storage UIDs distinguish Kubernetes storage replacements. Other Helm
// drivers expose FirstDeployed, including its serialized nanosecond precision.
// Missing generation evidence must not become a version-only revision.
func helmReleaseSourceRevision(version int, uid string, deployed time.Time) *string {
	if version < 1 || (uid == "" && deployed.IsZero()) {
		return nil
	}
	var buffer [128]byte
	data := strconv.AppendInt(buffer[:0], int64(version), 10)
	data = append(data, 0)
	if uid != "" {
		data = append(data, "uid:"...)
		data = append(data, uid...)
	} else {
		data = append(data, "first_deployed:"...)
		data = deployed.UTC().AppendFormat(data, time.RFC3339Nano)
	}
	digest := sha256.Sum256(data)
	revision := hex.EncodeToString(digest[:])
	return &revision
}
func pageBounds(request resource.EnumerateRequest) (int, int, error) {
	size := int(request.PageSize)
	if size == 0 {
		size = 256
	}
	if size > 256 {
		return 0, 0, fmt.Errorf("page size exceeds 256")
	}
	offset := 0
	if request.Cursor != nil {
		var err error
		offset, err = strconv.Atoi(*request.Cursor)
		if err != nil || offset < 0 || offset > int(^uint(0)>>1)-size {
			return 0, 0, fmt.Errorf("invalid Helm source cursor")
		}
	}
	return size, offset, nil
}
func targetReference(t resource.ReadTarget, id string, scope []resource.ScopeEntry) resource.ResourceReference {
	return resource.ResourceReference{Address: resource.ResourceAddress{Provider: t.Provider, Authority: t.Authority, Type: t.Type, ID: id, Scope: scope}}
}

// queryScope validates every constraint before returning native identity scope.
// A nil scope with no error denotes an empty selection, never an unscoped query.
func queryScope(t resource.ReadTarget) ([]resource.ScopeEntry, error) {
	if err := resource.ValidateScope(t.Scope); err != nil {
		return nil, err
	}
	dimension, value := "domain", helmLocalDomain
	if t.Type == ReleaseType {
		dimension, value = "namespace", ""
	}
	empty := false
	for _, constraint := range t.Scope {
		repository := t.Type == ChartType && constraint.Dimension == "repository"
		if constraint.Dimension != dimension && !repository {
			return nil, fmt.Errorf("unknown Helm query dimension")
		}
		if constraint.Match == resource.ScopeAny {
			continue
		}
		values := *constraint.Values
		if len(values) == 0 {
			empty = true
			continue
		}
		if repository {
			for _, name := range values {
				if name == "" {
					return nil, fmt.Errorf("repository query requires a native repository name")
				}
			}
			continue
		}
		if len(values) != 1 {
			return nil, fmt.Errorf("Helm enumeration requires any scope or one exact native scope")
		}
		if dimension == "namespace" && values[0] == "" || dimension == "domain" && values[0] != helmLocalDomain {
			return nil, fmt.Errorf("invalid Helm native scope")
		}
		value = values[0]
	}
	if empty {
		return nil, nil
	}
	return []resource.ScopeEntry{{Dimension: dimension, Value: value}}, nil
}
func finishPage(records []resource.Record, offset, size int, more bool) resource.SourcePage {
	p := resource.SourcePage{Records: records, Count: resource.Count{Kind: "unknown"}, Coverage: resource.Coverage{Kind: "complete"}, Consistency: resource.ConsistencyBestEffort}
	if more {
		c := strconv.Itoa(offset + size)
		p.NextCursor = &c
	}
	return p
}
