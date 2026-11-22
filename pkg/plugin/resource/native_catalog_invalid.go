package resource

import (
	"errors"
	"fmt"
	"sort"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// errNativeDocumentInvalid marks the document of a group version that parses and is wrong: a resource without a name or a kind, the same resource twice, versions of a group
// that disagree on whether a resource is namespaced. buildNativeTypes refuses all three, which for an extension group would refuse the whole connection for one API that serves a
// bad document; for an extension group the group version is unavailable instead (reason invalid), and for a built-in group, which the API server itself serves, the start still fails.
var errNativeDocumentInvalid = errors.New("kubernetes discovery document is invalid")

// nativeExtensionGroup is the group of a group version when it is an extension group's.
func nativeExtensionGroup(groupVersion string) (string, bool) {
	gv, err := schema.ParseGroupVersion(groupVersion)
	return gv.Group, err == nil && !nativeBuiltinGroup(gv.Group)
}

// invalidNativeExtensionVersions names the group versions of extension groups whose documents buildNativeTypes would refuse, each with why. A resource is a name that is not a
// subresource; the checks are those of buildNativeTypes, so that a document that passes them never makes it fail.
func invalidNativeExtensionVersions(lists []*metav1.APIResourceList) map[string]error {
	invalid := map[string]error{}
	namespaced := map[string]map[string]map[bool][]string{} // group -> resource -> namespaced -> the group versions of valid documents that say so
	for _, list := range lists {
		if list == nil {
			continue
		}
		group, extension := nativeExtensionGroup(list.GroupVersion)
		if !extension {
			continue
		}
		says := map[string]bool{}
		for _, api := range list.APIResources {
			if strings.Contains(api.Name, "/") {
				continue
			}
			if _, twice := says[api.Name]; twice {
				invalid[list.GroupVersion] = fmt.Errorf("%w: %s lists %s twice", errNativeDocumentInvalid, list.GroupVersion, api.Name)
				break
			}
			if api.Name == "" || api.Kind == "" {
				invalid[list.GroupVersion] = fmt.Errorf("%w: %s lists a resource without a name or a kind", errNativeDocumentInvalid, list.GroupVersion)
				break
			}
			says[api.Name] = api.Namespaced
		}
		if _, bad := invalid[list.GroupVersion]; bad {
			continue
		}
		for name, isNamespaced := range says {
			if namespaced[group] == nil {
				namespaced[group] = map[string]map[bool][]string{}
			}
			if namespaced[group][name] == nil {
				namespaced[group][name] = map[bool][]string{}
			}
			namespaced[group][name][isNamespaced] = append(namespaced[group][name][isNamespaced], list.GroupVersion)
		}
	}
	for group, resources := range namespaced {
		for name, versions := range resources {
			if len(versions[true]) == 0 || len(versions[false]) == 0 {
				continue
			}
			for _, version := range append(append([]string(nil), versions[true]...), versions[false]...) {
				invalid[version] = fmt.Errorf("%w: the versions of %s disagree on whether %s is namespaced", errNativeDocumentInvalid, group, name)
			}
		}
	}
	return invalid
}

// withoutInvalidNativeVersions is the lists without the documents that are invalid, which are added to failed under the group version they came from.
func withoutInvalidNativeVersions(lists []*metav1.APIResourceList, failed map[schema.GroupVersion]error) []*metav1.APIResourceList {
	invalid := invalidNativeExtensionVersions(lists)
	if len(invalid) == 0 {
		return lists
	}
	kept := make([]*metav1.APIResourceList, 0, len(lists))
	for _, list := range lists {
		if err, bad := invalid[list.GroupVersion]; bad {
			gv, _ := schema.ParseGroupVersion(list.GroupVersion)
			failed[gv] = err
			continue
		}
		kept = append(kept, list)
	}
	return kept
}

// withAbsentNativeExtensions is the group versions that did not answer, with those the catalog has kinds of in extension groups that the index no longer lists added, with the reason
// absent, when the index cannot be believed about them. A heal attempt removes a kind only when an index that is healthy no longer lists it. The index is healthy when the catalog has
// no extension kind to lose, or when it still lists at least one of the extension groups the catalog knew, with kinds or not (a group the aggregator flags stale is listed). An index
// that lists none of them is a stale replica, a filtering gateway, an aggregator that restarted without its cache, or every one of them deleted, and discovery cannot say which; so
// nothing is removed, the groups whose kinds stay are named, and the heal goes on: a kind that has gone stale is cheaper than one that vanished with the loop that would have brought it
// back. The limit: when every extension group the catalog has kinds of is deleted at once, those kinds stay until a reconnect, and the heal keeps reading every 5 minutes. A catalog
// whose only extension groups are down (the usual one: metrics-server) has no kind to lose, so deleting them ends the heal. The rule is for a catalog that is partial or becomes partial
// (the caller's condition, that of the merge): a refresh of a catalog that lacks no group, whose discovery leaves none out, follows the server as it always did.
func withAbsentNativeExtensions(previous *nativeCatalogSnapshot, now nativeDiscovery, unavailable []nativeUnavailable) []nativeUnavailable {
	kept := map[string]struct{}{} // the extension group versions the catalog has kinds of
	knownGroups := map[string]struct{}{}
	for _, list := range previous.discovery.lists {
		if list == nil {
			continue
		}
		if group, extension := nativeExtensionGroup(list.GroupVersion); extension {
			kept[list.GroupVersion] = struct{}{}
			knownGroups[group] = struct{}{}
		}
	}
	if len(kept) == 0 {
		return unavailable
	}
	for _, group := range previous.unavailable {
		if name, extension := nativeExtensionGroup(group.GroupVersion); extension {
			knownGroups[name] = struct{}{}
		}
	}
	for _, group := range previous.discovery.groups {
		if group != nil && !nativeBuiltinGroup(group.Name) {
			knownGroups[group.Name] = struct{}{}
		}
	}
	listed := map[string]struct{}{}
	for _, group := range now.groups {
		if group != nil {
			listed[group.Name] = struct{}{}
		}
	}
	for _, list := range now.lists {
		if list == nil {
			continue
		}
		if group, extension := nativeExtensionGroup(list.GroupVersion); extension {
			listed[group] = struct{}{}
		}
	}
	named := map[string]struct{}{}
	for _, group := range unavailable {
		named[group.GroupVersion] = struct{}{}
		if name, extension := nativeExtensionGroup(group.GroupVersion); extension {
			listed[name] = struct{}{}
		}
	}
	for group := range knownGroups {
		if _, ok := listed[group]; ok {
			return unavailable // the index lists a group the catalog knew: it is believed
		}
	}
	absent := append([]nativeUnavailable(nil), unavailable...)
	for groupVersion := range kept {
		if _, ok := named[groupVersion]; !ok {
			absent = append(absent, nativeUnavailable{GroupVersion: groupVersion, Reason: "absent"})
		}
	}
	sort.Slice(absent, func(i, j int) bool { return absent[i].GroupVersion < absent[j].GroupVersion })
	return absent
}
