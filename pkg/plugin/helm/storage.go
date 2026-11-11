package helm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/release"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func supportsBoundedReleaseEnumeration() bool {
	switch os.Getenv("HELM_DRIVER") {
	case "", "secret", "secrets", "configmap", "configmaps":
		return true
	default:
		return false
	}
}

// releaseMetadata uses Kubernetes native continuation without loading release payloads.
func releaseMetadata(ctx context.Context, c *clients.ClientSet, namespace string, size int, cursor *string) (metav1.PartialObjectMetadataList, error) {
	return namedReleaseMetadata(ctx, c, namespace, size, cursor, "")
}

// namedReleaseMetadata fetches one page of Helm storage metadata inside a
// kubernetes.helm.release.list span. Only counts and sizes are recorded.
func namedReleaseMetadata(ctx context.Context, c *clients.ClientSet, namespace string, size int, cursor *string, name string) (metav1.PartialObjectMetadataList, error) {
	ctx, span := diag.Tracer().Start(ctx, "kubernetes.helm.release.list", trace.WithAttributes(
		attribute.String("resource.namespace", namespace),
		attribute.Int("pages", 1),
		attribute.Int("page_size", size),
		attribute.Bool("named", name != ""),
		attribute.Bool("continued", cursor != nil),
	))
	start := time.Now()
	bytesRead := 0
	page, err := fetchReleaseMetadata(ctx, c, namespace, size, cursor, name, &bytesRead)
	span.SetAttributes(attribute.Int("items", len(page.Items)), attribute.Int("bytes", bytesRead))
	cls := diag.EndSpan(span, err, false)
	logging.Default().Named("helm").Debugw(ctx, "Helm release metadata page fetched", append([]any{
		"namespace", namespace, "items", len(page.Items), "bytes", bytesRead,
		"duration_ms", time.Since(start).Milliseconds(),
	}, cls.LogFields()...)...)
	return page, err
}

func fetchReleaseMetadata(ctx context.Context, c *clients.ClientSet, namespace string, size int, cursor *string, name string, bytesRead *int) (metav1.PartialObjectMetadataList, error) {
	var page metav1.PartialObjectMetadataList
	storage := os.Getenv("HELM_DRIVER")
	if !supportsBoundedReleaseEnumeration() {
		return page, resource.NewError("UNSUPPORTED", "bounded release enumeration is unavailable for this Helm storage driver")
	}
	if c == nil || c.RESTConfig == nil || c.HTTPClient == nil || c.HTTPClient.Transport == nil {
		return page, resource.NewError("UNAVAILABLE", "Helm metadata requires the existing auth-aware bounded Kubernetes HTTP client")
	}
	if storage == "configmap" || storage == "configmaps" {
		storage = "configmaps"
	} else {
		storage = "secrets"
	}
	u, err := url.Parse(c.RESTConfig.Host)
	if err != nil {
		return page, err
	}
	u.Path = strings.TrimSuffix(u.Path, "/") + "/api/v1"
	if namespace != "" {
		u.Path += "/namespaces/" + url.PathEscape(namespace)
	}
	u.Path += "/" + storage
	q := u.Query()
	selector := "owner=helm"
	if name != "" {
		selector += ",name=" + name
	}
	q.Set("labelSelector", selector)
	q.Set("limit", strconv.Itoa(size))
	if cursor != nil {
		q.Set("continue", *cursor)
	}
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return page, err
	}
	req.Header.Set("Accept", "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1")
	response, err := c.HTTPClient.Do(req)
	if err != nil {
		return page, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return page, apierrors.NewGenericServerResponse(response.StatusCode, http.MethodGet, schema.GroupResource{Resource: storage}, "", "Helm storage metadata request failed", 0, false)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (32<<20)+1))
	*bytesRead = len(data)
	if err != nil {
		return page, err
	}
	if len(data) > 32<<20 {
		return page, fmt.Errorf("Helm storage metadata exceeds 32 MiB")
	}
	if err = resource.ValidateJSON(data); err != nil {
		return page, err
	}
	if err = json.Unmarshal(data, &page); err != nil {
		return page, err
	}
	if len(page.Items) > size {
		return page, fmt.Errorf("Helm storage ignored page limit")
	}
	return page, nil
}

func (h *HelmAncillary) enumerateReleases(ctx context.Context, c *clients.ClientSet, r resource.EnumerateRequest) (resource.SourcePage, error) {
	scope, err := queryScope(r.Target)
	if err != nil {
		return resource.SourcePage{}, err
	}
	size := int(r.PageSize)
	if size == 0 {
		size = 256
	}
	if size > 256 {
		return resource.SourcePage{}, fmt.Errorf("page size exceeds 256")
	}
	metadata, err := releaseMetadata(ctx, c, scope[0].Value, size, r.Cursor)
	if err != nil {
		return resource.SourcePage{}, err
	}
	page := resource.SourcePage{Records: make([]resource.Record, 0, len(metadata.Items)), Count: resource.Count{Kind: "unknown"}, Coverage: resource.Coverage{Kind: "complete"}, Consistency: resource.ConsistencyBestEffort}
	if metadata.Continue != "" {
		page.NextCursor = &metadata.Continue
	}
	budget := 0
	for _, item := range metadata.Items {
		name := item.Labels["name"]
		if name == "" {
			return resource.SourcePage{}, fmt.Errorf("Helm storage entry lacks release name")
		}
		namespace := item.Namespace
		if namespace == "" {
			return resource.SourcePage{}, fmt.Errorf("Helm storage entry lacks namespace")
		}
		cfg, err := h.release.getConfig(ctx, c, namespace)
		if err != nil {
			return resource.SourcePage{}, err
		}
		snapshot, err := getNamedRelease(ctx, c, cfg, namespace, name, nil)
		if err != nil {
			return resource.SourcePage{}, err
		}
		if strconv.Itoa(snapshot.release.Version) != item.Labels["version"] || (item.UID != "" && string(item.UID) != snapshot.identity.uid) {
			continue
		}
		identityScope := []resource.ScopeEntry{{Dimension: "namespace", Value: namespace}}
		record, err := helmReleaseRecord(targetReference(r.Target, name, identityScope), snapshot)
		if err != nil {
			return resource.SourcePage{}, err
		}
		size, err := resource.RecordWireSize(record)
		if err != nil {
			return resource.SourcePage{}, err
		}
		if size > (32<<20)-budget {
			return resource.SourcePage{}, fmt.Errorf("Helm source page exceeds 32 MiB")
		}
		budget += size
		page.Records = append(page.Records, record)
	}
	return page, nil
}

type releaseStorageIdentity struct {
	version int
	uid     string
}

type namedReleaseSnapshot struct {
	release  *release.Release
	identity releaseStorageIdentity
	revision *string
}

// getNamedRelease shares one native lookup across reads and schema acquisition.
// Kubernetes drivers use bounded named metadata before a single versioned GET.
// Other drivers use Helm's named Last API, never a route-wide release listing.
func getNamedRelease(ctx context.Context, c *clients.ClientSet, cfg *action.Configuration, namespace, name string, expected *string) (namedReleaseSnapshot, error) {
	var snapshot namedReleaseSnapshot
	get := action.NewGet(cfg)
	if supportsBoundedReleaseEnumeration() {
		identity, err := latestReleaseIdentity(ctx, c, namespace, name)
		if err != nil {
			return snapshot, err
		}
		snapshot.identity = identity
		get.Version = identity.version
		if expected != nil && identity.uid != "" {
			snapshot.revision = helmReleaseSourceRevision(identity.version, identity.uid, time.Time{})
			if snapshot.revision == nil || *snapshot.revision != *expected {
				return snapshot, resource.NewError("RESET_REQUIRED", "The installed Helm release revision changed")
			}
		}
	}
	rel, err := get.Run(name)
	if err != nil {
		return snapshot, err
	}
	if rel.Name != name || rel.Namespace != namespace || (snapshot.identity.version != 0 && rel.Version != snapshot.identity.version) {
		return snapshot, resource.NewError("RESET_REQUIRED", "The installed Helm release target changed")
	}
	snapshot.release = rel
	if expected != nil {
		revision := snapshot.sourceRevision()
		if revision == nil || *revision != *expected {
			return snapshot, resource.NewError("RESET_REQUIRED", "The installed Helm release revision changed")
		}
	}
	return snapshot, nil
}

// verifyCurrent brackets the release body read with current named evidence.
func (snapshot namedReleaseSnapshot) verifyCurrent(ctx context.Context, c *clients.ClientSet, cfg *action.Configuration) error {
	rel := snapshot.release
	if snapshot.identity.version != 0 {
		current, err := latestReleaseIdentity(ctx, c, rel.Namespace, rel.Name)
		if err != nil {
			return err
		}
		if current != snapshot.identity {
			return resource.NewError("RESET_REQUIRED", "The installed Helm release revision changed")
		}
		return nil
	}
	current, err := cfg.Releases.Last(rel.Name)
	if err != nil {
		return err
	}
	latest := namedReleaseSnapshot{release: current}
	expected, revision := snapshot.sourceRevision(), latest.sourceRevision()
	if current.Name != rel.Name || current.Namespace != rel.Namespace || expected == nil || revision == nil || *expected != *revision {
		return resource.NewError("RESET_REQUIRED", "The installed Helm release revision changed")
	}
	return nil
}

// latestReleaseIdentity scans native metadata pages, never release bodies.
func latestReleaseIdentity(ctx context.Context, c *clients.ClientSet, namespace, name string) (releaseStorageIdentity, error) {
	var cursor *string
	var latest releaseStorageIdentity
	pages, items := 0, 0
	for {
		page, err := namedReleaseMetadata(ctx, c, namespace, 256, cursor, name)
		if err != nil {
			return releaseStorageIdentity{}, err
		}
		pages++
		items += len(page.Items)
		for _, entry := range page.Items {
			version, err := strconv.Atoi(entry.Labels["version"])
			if err != nil || version < 1 {
				return releaseStorageIdentity{}, fmt.Errorf("invalid native Helm revision")
			}
			if version > latest.version {
				latest = releaseStorageIdentity{version: version, uid: string(entry.UID)}
			}
		}
		if page.Continue == "" {
			break
		}
		cursor = &page.Continue
	}
	trace.SpanFromContext(ctx).AddEvent("helm.release.latest_version", trace.WithAttributes(
		attribute.Int("pages", pages), attribute.Int("items", items), attribute.Int("latest", latest.version),
	))
	if latest.version == 0 {
		return releaseStorageIdentity{}, fmt.Errorf("Helm release not found")
	}
	return latest, nil
}
