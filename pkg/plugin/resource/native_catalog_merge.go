package resource

import (
	"unicode/utf8"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// mergeNativeDiscovery is the discovery a refresh builds the catalog from when a group version did not answer, now or when the catalog was built: what the server says
// now, with what it could not say kept. previous is what the installed catalog was built from, now is what this discovery read, and unavailable the group versions of
// this discovery that did not answer.
//
//   - A group version that answered is taken as it answered: the kinds its document lists are added or updated, and the kinds it no longer lists are gone. A group version
//     of a built-in group (nativeBuiltinGroups) is the exception: its document may add kinds and never takes one away, because the API server serves those in process and a
//     document that lacks one is a degraded answer, not a deletion.
//   - A group version that is listed and did not answer (it is in unavailable) keeps every kind the catalog knew of it. An answer that was not read says nothing about
//     what the group serves; the group version is named in the connection fact until it answers.
//   - A group version the server no longer lists is gone, with its kinds (a CRD that was deleted, an APIService that was removed). A built-in group is never gone.
//
// So nothing is taken away on the strength of a group version that did not answer, and nothing is kept that the server says is gone. A group that is down and a CRD that
// was deleted can both be in the same discovery: one freezes nothing of the other.
func mergeNativeDiscovery(previous, now nativeDiscovery, unavailable []nativeUnavailable) nativeDiscovery {
	down := make(map[string]struct{}, len(unavailable))
	for _, group := range unavailable {
		down[group.GroupVersion] = struct{}{}
	}
	known := make(map[string]*metav1.APIResourceList, len(previous.lists))
	for _, list := range previous.lists {
		if list != nil {
			known[list.GroupVersion] = list
		}
	}

	merged := nativeDiscovery{
		groups: append([]*metav1.APIGroup(nil), now.groups...),
		lists:  make([]*metav1.APIResourceList, 0, len(now.lists)+len(previous.lists)),
	}
	answered := make(map[string]struct{}, len(now.lists))
	for _, list := range now.lists {
		if list == nil {
			continue
		}
		answered[list.GroupVersion] = struct{}{}
		if old := known[list.GroupVersion]; old != nil && nativeBuiltinVersion(list.GroupVersion) {
			list = unionNativeResources(list, old)
		}
		merged.lists = append(merged.lists, list)
	}
	for _, old := range previous.lists {
		if old == nil {
			continue
		}
		if _, answeredNow := answered[old.GroupVersion]; answeredNow {
			continue
		}
		if _, didNotAnswer := down[old.GroupVersion]; didNotAnswer || nativeBuiltinVersion(old.GroupVersion) {
			merged.lists = append(merged.lists, old)
		}
	}

	// The group index says which version of a group is preferred: a group whose list is kept but that the index no longer lists keeps its entry.
	indexed := make(map[string]struct{}, len(now.groups))
	for _, group := range now.groups {
		if group != nil {
			indexed[group.Name] = struct{}{}
		}
	}
	kept := make(map[string]struct{}, len(merged.lists))
	for _, list := range merged.lists {
		if gv, err := schema.ParseGroupVersion(list.GroupVersion); err == nil {
			kept[gv.Group] = struct{}{}
		}
	}
	for _, group := range previous.groups {
		if group == nil {
			continue
		}
		if _, listed := indexed[group.Name]; listed {
			continue
		}
		if _, has := kept[group.Name]; has {
			merged.groups = append(merged.groups, group)
		}
	}
	return merged
}

// nativeBuiltinVersion reports whether the group version belongs to a built-in group.
func nativeBuiltinVersion(groupVersion string) bool {
	gv, err := schema.ParseGroupVersion(groupVersion)
	return err == nil && nativeBuiltinGroup(gv.Group)
}

// unionNativeResources is the list as the server answered it, with the resources of the list it had before that the answer lacks. Neither list is changed.
func unionNativeResources(now, before *metav1.APIResourceList) *metav1.APIResourceList {
	have := make(map[string]struct{}, len(now.APIResources))
	for _, api := range now.APIResources {
		have[api.Name] = struct{}{}
	}
	union := *now
	union.APIResources = append([]metav1.APIResource(nil), now.APIResources...)
	for _, api := range before.APIResources {
		if _, ok := have[api.Name]; !ok {
			union.APIResources = append(union.APIResources, api)
		}
	}
	return &union
}

// nativeGroupVersionMaxBytes is the longest a group version can legally be: a group of 253 characters, a slash and a version of 63. Every character a legal name can hold is one
// that JSON writes as itself, so this is also the most its JSON can take.
const nativeGroupVersionMaxBytes = 253 + 1 + 63

// clipGroupVersion cuts a group version a server made up so that the JSON of what is left takes no more than the longest legal name does, without cutting a character in two;
// a legal name is returned as it is. A name nobody could have registered cannot then make a log line or a connection fact unbounded. The bound is on the JSON, not on the length:
// the SDK counts a metadata value by its JSON, a control character is six bytes of it, and 32 names of 249 of them, which pass a limit on length, are 48 KiB and take every
// fact of the connection down. A name that is not valid UTF-8, which the SDK refuses and JSON decoding never gives, is cut before its first invalid byte.
func clipGroupVersion(groupVersion string) string {
	size := 0
	for i := 0; i < len(groupVersion); {
		character, width := utf8.DecodeRuneInString(groupVersion[i:])
		if character == utf8.RuneError && width == 1 {
			return groupVersion[:i]
		}
		size += jsonStringBytes(character, width)
		if size > nativeGroupVersionMaxBytes {
			return groupVersion[:i]
		}
		i += width
	}
	return groupVersion
}

// jsonStringBytes is how many bytes a character of the given width in UTF-8 takes inside a JSON string, counted the way the SDK counts a metadata value (and encoding/json
// writes it): a quote, a backslash and the short control escapes take two, any other control character, <, >, & and the two line separators six, anything else its own bytes.
func jsonStringBytes(character rune, width int) int {
	switch {
	case character == '"', character == '\\', character == '\b', character == '\f', character == '\n', character == '\r', character == '\t':
		return 2
	case character < 0x20, character == '<', character == '>', character == '&', character == '\u2028', character == '\u2029':
		return 6
	}
	return width
}
