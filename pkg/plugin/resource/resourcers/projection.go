package resourcers

import (
	"maps"
	"slices"

	"k8s.io/apimachinery/pkg/runtime/schema"
)

// A projection is what every read of a kind sends in place of its objects, for a kind whose objects hold what no read may send. It is applied where a record's body is made from an object (the finite
// reads, the results of a mutation and the live source), so that no operation can send what another leaves out, and the record says what it leaves out in its coverage.
//
// The Secret is the one kind that has one. Its record holds its metadata, its type, whether it is immutable, and for each key of `data` its name and its size in bytes: never what a key holds. A list
// needs no more than that, and a page that is shown holds no value to keep in the page's memory, in the runtime's caches or in anything that copies them.
type projection struct {
	// paths are the subtrees of the record's body that the projection limits, as RFC 6901 pointers: the record's coverage names them.
	paths  []string
	reason string
	apply  func(object map[string]any) map[string]any
}

// lastAppliedConfiguration is the annotation `kubectl apply` keeps the manifest it applied in. A manifest that wrote its values as `stringData` leaves them in it, in the clear.
const lastAppliedConfiguration = "kubectl.kubernetes.io/last-applied-configuration"

var secretProjection = projection{
	paths:  []string{"/data", "/stringData", "/metadata/annotations/kubectl.kubernetes.io~1last-applied-configuration"},
	reason: "Secret values are not sent: data and stringData hold the size in bytes of each key, and the last-applied-configuration annotation is omitted",
	apply:  projectSecret,
}

// projectionOf is the projection of the kind a resource is of, nil for a kind whose objects are sent whole. A Secret is the core API's, whatever its version: a kind of another group that is called
// secrets is another kind.
func projectionOf(gvr schema.GroupVersionResource) *projection {
	if gvr.Group == "" && gvr.Resource == "secrets" {
		return &secretProjection
	}
	return nil
}

// ProjectObject is the object a record's body is made from: the object itself for a kind that is sent whole, else its projection. It never writes to object, which an informer's cache shares with every
// session that reads it. What it returns shares only what holds no value with it (labels, owner references, managed fields), and nothing that does.
func ProjectObject(gvr schema.GroupVersionResource, object map[string]any) map[string]any {
	if p := projectionOf(gvr); p != nil {
		return p.apply(object)
	}
	return object
}

// ProjectionLimits names the subtrees of a record's body that the projection of the kind limits (RFC 6901 pointers), and says why in words: none for a kind that is sent whole. The caller owns the paths.
func ProjectionLimits(gvr schema.GroupVersionResource) (paths []string, reason string) {
	if p := projectionOf(gvr); p != nil {
		return slices.Clone(p.paths), p.reason
	}
	return nil, ""
}

// projectSecret keeps what a Secret has that holds no value. A Secret has no member beside these, so a member that is not one of them is not sent: what is not known to hold no value is left out.
func projectSecret(object map[string]any) map[string]any {
	projected := make(map[string]any, 7)
	for _, member := range [...]string{"apiVersion", "kind", "type", "immutable"} {
		if value, present := object[member]; present {
			projected[member] = value
		}
	}
	if metadata, ok := object["metadata"].(map[string]any); ok {
		projected["metadata"] = withoutLastApplied(metadata)
	}
	if data, ok := object["data"].(map[string]any); ok {
		projected["data"] = entrySizes(data, decodedSize)
	}
	if stringData, ok := object["stringData"].(map[string]any); ok {
		projected["stringData"] = entrySizes(stringData, textSize)
	}
	return projected
}

// withoutLastApplied is metadata without the annotation that holds the manifest, values and all. The annotations that are left are the ones tools left to be read, and an object with none has no
// `annotations`, as the API server sends it.
func withoutLastApplied(metadata map[string]any) map[string]any {
	projected := maps.Clone(metadata)
	annotations, ok := metadata["annotations"].(map[string]any)
	if !ok {
		return projected
	}
	if _, present := annotations[lastAppliedConfiguration]; !present {
		return projected
	}
	kept := maps.Clone(annotations)
	delete(kept, lastAppliedConfiguration)
	if len(kept) == 0 {
		delete(projected, "annotations")
		return projected
	}
	projected["annotations"] = kept
	return projected
}

// entrySizes is each key of a map of values, with the size in bytes of the value it holds in place of the value. The value is measured and never copied.
func entrySizes(entries map[string]any, size func(any) int64) map[string]any {
	sizes := make(map[string]any, len(entries))
	for name, value := range entries {
		sizes[name] = map[string]any{"size": size(value)}
	}
	return sizes
}

// decodedSize is the length in bytes of the value a `data` entry holds: its base64 text decoded. The API server stores bytes and writes them as padded base64, so the length follows from the text's length
// and its padding without decoding it. An entry that is no padded base64 is not what the server writes: it is measured as the text it is. A null, and anything else that is not text, holds no bytes.
func decodedSize(value any) int64 {
	text, ok := value.(string)
	if !ok || text == "" {
		return 0
	}
	length := len(text)
	if length%4 != 0 {
		return int64(length)
	}
	padding := 0
	if text[length-1] == '=' {
		padding++
		if text[length-2] == '=' {
			padding++
		}
	}
	return int64(length/4*3 - padding)
}

// textSize is the length in bytes of a `stringData` entry: the UTF-8 text it holds.
func textSize(value any) int64 {
	text, ok := value.(string)
	if !ok {
		return 0
	}
	return int64(len(text))
}
