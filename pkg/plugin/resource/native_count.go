package resource

import (
	"context"
	"math"
	"strconv"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// The count of a page says how many objects the selection of the read has: the namespaces and names it covers, not the page. The wire's Count has three kinds, and each is said only as precisely as
// what the plugin knows lets it:
//
//   - exact: the page ends the read (it holds every object of the selection, whatever selector the read had), the selection selects nothing, or a live source holds every object of it and the count is
//     the source's, as of now.
//   - estimate: the first page of an unfiltered List of one namespace, or of every namespace, that has more to give. The API server says how many objects remain after the page
//     (remainingItemCount), and the count is those and the page's. Its own documentation calls that an estimate: a server may count a moment apart from the List, and may not count at all.
//   - unknown: anything else. A page that follows another does not know what the others held; the API server does not count what remains under a label or a field selector; several namespaces are
//     read one after another and the page ends in the first; a server that does not say how many remain is not read to the end to find out; a number that cannot be added up is not said. It is never a guess.
//
// The wire has no "as of" beside a count but the page's own SourceRevision, the resourceVersion of the List the page was read from, and its consistency, best effort. A count says nothing more of when.
//
// A read of one object (a page of one, no cursor) is how a list of kinds asks how many each has: it costs one List with limit 1, which decodes one object, however large the kind is. Such reads are
// the connection's CountReads: a few at a time, an answer kept for clients.CountStaleness, identical reads at once made once.

// nativeCount is a count of a kind and a value.
func nativeCount(kind string, value int64) resourcev2.Count {
	text := strconv.FormatInt(value, 10)
	return resourcev2.Count{Kind: kind, Value: &text}
}

// nativePageCount is what the Lists that made a page say of the count of its selection. remaining is the remainingItemCount of the last List the page took, and countable says that List was the
// whole of an unfiltered read: one slot, no selector of any kind, the first page.
func nativePageCount(page resourcev2.SourcePage, continued, countable bool, remaining *int64) resourcev2.Count {
	records := int64(len(page.Records))
	switch {
	case continued:
		return resourcev2.Count{Kind: "unknown"}
	case page.NextCursor == nil:
		return nativeCount("exact", records)
	// A server that reports more than a count can hold (an aggregated API) says nothing that can be added to the page.
	case countable && remaining != nil && *remaining >= 0 && *remaining <= math.MaxInt64-records:
		return nativeCount("estimate", records+*remaining)
	default:
		return resourcev2.Count{Kind: "unknown"}
	}
}

// nativeEnumerateCounted is the Enumerate of a native kind: a page of the API server's Lists, with its count, and for a count read the connection's, and, when the plugin already holds the kind
// open, the source's count in place of the server's.
//
// source is the resource the kind's live source follows, which is the one the sources are kept by; served is the version the page is read from.
func nativeEnumerateCounted(ctx context.Context, client *clients.ClientSet, source schema.GroupVersionResource, served nativeServedType, representation resourcev2.Representation, request resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
	read := func(ctx context.Context) (resourcev2.SourcePage, error) {
		return NativeEnumerate(ctx, client.DynamicClient, served.GVR, served.API.Namespaced, request, representation)
	}
	var page resourcev2.SourcePage
	var err error
	if request.PageSize == 1 {
		_, key, keyErr := resourcev2.CanonicalReadTarget(request.Target)
		if keyErr != nil {
			return resourcev2.SourcePage{}, keyErr
		}
		if request.Cursor == nil {
			page, err = client.CountReads().Read(ctx, key, read)
		} else {
			page, err = read(ctx)
			// A continuation that no longer holds ends the first page the kept answer gave it: the next read of that page asks again, and is not given the same cursor.
			if err != nil && resourcev2.ErrorCode(err) == "RESET_REQUIRED" {
				client.CountReads().Forget(key)
			}
		}
	} else {
		page, err = read(ctx)
	}
	if err != nil {
		return page, err
	}
	return nativeLiveCount(client, source, served.API.Namespaced, request, page), nil
}

// nativeLiveCount gives the page the count of the live source that holds the whole selection, when there is one. The source may be a moment behind the server, so it is not believed when it has fewer
// objects than the page holds, which the wire rejects: the page keeps the count the server gave it.
func nativeLiveCount(client *clients.ClientSet, source schema.GroupVersionResource, namespaced bool, request resourcev2.EnumerateRequest, page resourcev2.SourcePage) resourcev2.SourcePage {
	selection, err := nativeQuerySelection(request.Target.Scope, namespaced)
	if err != nil || selection.names != nil {
		return page
	}
	held, ok := client.LiveCount(source, selection.namespaces)
	if !ok || held < len(page.Records) {
		return page
	}
	page.Count = nativeCount("exact", int64(held))
	return page
}
