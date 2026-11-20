package clients

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/cache"
)

func podIn(namespace, name string) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]any{"apiVersion": "v1", "kind": "Pod", "metadata": map[string]any{"name": name, "namespace": namespace}}}
}

func nodeNamed(name string) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]any{"apiVersion": "v1", "kind": "Node", "metadata": map[string]any{"name": name}}}
}

func makeObjects(t *testing.T, client *ClientSet, gvr schema.GroupVersionResource, objects ...*unstructured.Unstructured) {
	t.Helper()
	for _, object := range objects {
		resource := client.DynamicClient.Resource(gvr)
		if namespace := object.GetNamespace(); namespace != "" {
			_, err := resource.Namespace(namespace).Create(context.Background(), object, metav1.CreateOptions{})
			require.NoError(t, err)
			continue
		}
		_, err := resource.Create(context.Background(), object, metav1.CreateOptions{})
		require.NoError(t, err)
	}
}

func openLease(t *testing.T, client *ClientSet, namespace string, gvr schema.GroupVersionResource, options ...InformerOption) *InformerLease {
	t.Helper()
	lease, err := client.AcquireInformer(context.Background(), namespace, gvr, cache.ResourceEventHandlerFuncs{}, options...)
	require.NoError(t, err)
	t.Cleanup(func() { _ = lease.Close() })
	syncLease(t, lease)
	return lease
}

func TestLiveCountOfASourceOfEveryNamespaceCountsWhatItHoldsInAnyOfThem(t *testing.T) {
	client, started := nativeLeaseClient(t)
	makeObjects(t, client, podsGVR, podIn("shop", "a"), podIn("shop", "b"), podIn("billing", "c"))
	lease := openLease(t, client, "", podsGVR)
	watcher := receiveNativeWatch(t, started)

	for _, test := range []struct {
		namespaces []string
		count      int
	}{{[]string{""}, 3}, {[]string{"shop"}, 2}, {[]string{"billing"}, 1}, {[]string{"empty"}, 0}, {[]string{"billing", "shop"}, 3}} {
		count, ok := client.LiveCount(podsGVR, test.namespaces)
		require.True(t, ok, test.namespaces)
		assert.Equal(t, test.count, count, test.namespaces)
	}

	// it follows the source
	watcher.Add(podIn("shop", "d"))
	require.Eventually(t, func() bool { return len(lease.Informer.GetStore().List()) == 4 }, 5*time.Second, time.Millisecond)
	count, ok := client.LiveCount(podsGVR, []string{""})
	require.True(t, ok)
	assert.Equal(t, 4, count)
	watcher.Delete(podIn("billing", "c"))
	require.Eventually(t, func() bool { return len(lease.Informer.GetStore().List()) == 3 }, 5*time.Second, time.Millisecond)
	count, _ = client.LiveCount(podsGVR, []string{"billing"})
	assert.Equal(t, 0, count)

	// another resource is not this one
	_, ok = client.LiveCount(servicesGVR, []string{""})
	assert.False(t, ok)
}

func TestLiveCountOfASourceOfOneNamespaceIsOfThatNamespaceOnly(t *testing.T) {
	client, _ := nativeLeaseClient(t)
	makeObjects(t, client, podsGVR, podIn("shop", "a"), podIn("shop", "b"), podIn("billing", "c"))
	openLease(t, client, "shop", podsGVR)

	count, ok := client.LiveCount(podsGVR, []string{"shop"})
	require.True(t, ok)
	assert.Equal(t, 2, count)
	_, ok = client.LiveCount(podsGVR, []string{""})
	assert.False(t, ok, "every namespace is not what it holds")
	_, ok = client.LiveCount(podsGVR, []string{"billing"})
	assert.False(t, ok, "nor is another one")
	_, ok = client.LiveCount(podsGVR, []string{"billing", "shop"})
	assert.False(t, ok, "and a count of several is of all of them or of none")

	openLease(t, client, "billing", podsGVR)
	count, ok = client.LiveCount(podsGVR, []string{"billing", "shop"})
	require.True(t, ok)
	assert.Equal(t, 3, count)
	_, ok = client.LiveCount(podsGVR, []string{""})
	assert.False(t, ok, "two namespaces are not every namespace")
}

func TestLiveCountOfAClusterScopedResource(t *testing.T) {
	client, _ := nativeLeaseClient(t)
	makeObjects(t, client, nodesGVR, nodeNamed("one"), nodeNamed("two"))
	openLease(t, client, "", nodesGVR)
	count, ok := client.LiveCount(nodesGVR, []string{""})
	require.True(t, ok)
	assert.Equal(t, 2, count)
}

func TestLiveCountIsNotTheCountOfASourceThatHoldsPartOfTheCollection(t *testing.T) {
	client, _ := nativeLeaseClient(t)
	makeObjects(t, client, podsGVR, podIn("shop", "a"), podIn("shop", "b"))
	// a source narrowed to one object holds that object, not the namespace
	openLease(t, client, "shop", podsGVR, ObjectName("a"))
	_, ok := client.LiveCount(podsGVR, []string{"shop"})
	assert.False(t, ok)
	_, ok = client.LiveCount(podsGVR, []string{""})
	assert.False(t, ok)
}

func TestLiveCountEndsWithTheSource(t *testing.T) {
	client, _ := nativeLeaseClient(t)
	makeObjects(t, client, podsGVR, podIn("shop", "a"))
	lease := openLease(t, client, "", podsGVR)
	_, ok := client.LiveCount(podsGVR, []string{""})
	require.True(t, ok)
	require.NoError(t, lease.Close())
	_, ok = client.LiveCount(podsGVR, []string{""})
	assert.False(t, ok, "a source that is closed holds nothing")

	openLease(t, client, "", podsGVR)
	_, ok = client.LiveCount(podsGVR, []string{""})
	require.True(t, ok)
	client.ShutdownInformers()
	_, ok = client.LiveCount(podsGVR, []string{""})
	assert.False(t, ok, "nor one that was shut down")
}
