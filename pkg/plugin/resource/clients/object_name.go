package clients

import (
	"unicode/utf8"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"k8s.io/apimachinery/pkg/api/validation/path"
	"k8s.io/apimachinery/pkg/fields"
)

// objectNameField is the field a Kubernetes API server selects an object by its name with. Built-in kinds and custom resources answer it for LIST and for
// WATCH alike.
const objectNameField = "metadata.name"

// NameSelector is the field selector that makes the API server list and watch only the object of that name. The name is one escaped value of one term,
// so a name that holds the selector language's own characters (RBAC names may) cannot add a term to the selector. A name no object can have, because
// it could not be a segment of the object's own URL, is refused as INVALID_REQUEST before the API server is asked anything.
func NameSelector(name string) (string, error) {
	if name == "" {
		return "", resourcev2.NewError("INVALID_REQUEST", "A Kubernetes object name must not be empty")
	}
	if !utf8.ValidString(name) || len(path.IsValidPathSegmentName(name)) != 0 {
		return "", resourcev2.NewError("INVALID_REQUEST", "A Kubernetes object name must be valid text, not '.' or '..', and must not contain '/' or '%'")
	}
	return fields.OneTermEqualSelector(objectNameField, name).String(), nil
}
