package clients

import (
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/cache"
)

// LiveCount counts the objects of a resource that the sources open on it hold, in the namespaces of a read: the empty namespace is every namespace of a namespaced resource, and the objects of one the
// cluster owns. It answers only when each namespace is held whole by a source that has synced and follows every object of it (not one object, which a source can be narrowed to), because a part of a
// collection is not its count. What it counts follows the cluster as the source does, so asking again later is the only way to keep it current, and polling the API server is not.
//
// Several namespaces that one source of every namespace holds are counted from one snapshot of its keys, so that an object that moves between two of them while this runs is not counted twice.
func (cs *ClientSet) LiveCount(gvr schema.GroupVersionResource, namespaces []string) (int, bool) {
	cs.informersMu.Lock()
	held := make(map[string]cache.SharedIndexInformer, len(cs.informers))
	for key, source := range cs.informers {
		if key.resource == gvr && key.name == "" && !source.retiring {
			held[key.namespace] = source.informer
		}
	}
	cs.informersMu.Unlock()
	everywhere := held[""]
	synced := everywhere != nil && everywhere.HasSynced()
	total := 0
	var shared map[string]struct{}
	for _, namespace := range namespaces {
		switch {
		case synced && namespace == "":
			total += len(everywhere.GetStore().ListKeys())
		case synced:
			if shared == nil {
				shared = make(map[string]struct{}, len(namespaces))
			}
			shared[namespace] = struct{}{}
		case namespace != "" && held[namespace] != nil && held[namespace].HasSynced():
			total += len(held[namespace].GetStore().ListKeys())
		default:
			return 0, false
		}
	}
	switch len(shared) {
	case 0:
	case 1:
		for namespace := range shared {
			keys, err := everywhere.GetIndexer().IndexKeys(cache.NamespaceIndex, namespace)
			if err != nil {
				return 0, false
			}
			total += len(keys)
		}
	default:
		for _, key := range everywhere.GetStore().ListKeys() {
			if namespace, _, err := cache.SplitMetaNamespaceKey(key); err == nil {
				if _, selected := shared[namespace]; selected {
					total++
				}
			}
		}
	}
	return total, true
}
