package resource

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/util/flowcontrol"
)

const (
	neighborCalls         = 8 // includes the initial and final root GET
	neighborRulesPath     = "/apis/authorization.k8s.io/v1/selfsubjectrulesreviews"
	neighborPageSize      = 64
	neighborBytes         = 2 << 20 // decoded HTTP bodies across the entire demand
	metadataMediaType     = "application/json;as=PartialObjectMetadata;g=meta.k8s.io;v=v1"
	metadataListMediaType = "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1"
)

var (
	errNeighborBudget   = resourcev2.NewError("RESOURCE_LIMIT", "Service neighbor acquisition limit reached")
	errNeighborResponse = resourcev2.NewError("UNAVAILABLE", "Kubernetes could not supply Service neighbor evidence")
)

// The ordinary finite transport buffers up to 32 MiB before returning a body.
// Use the same generation's authenticated transport *before* that buffer, with
// a smaller cumulative decoded-byte limit and no redirects, retries or cache.
// The SDK holds the connection generation for the duration of this callback.
type neighborAPI struct {
	server    *url.URL
	transport http.RoundTripper
	limiter   flowcontrol.RateLimiter
	calls     int
	bytes     int
}

func newNeighborAPI(client *clients.ClientSet) (*neighborAPI, error) {
	if client == nil || client.RESTConfig == nil || client.StreamingHTTPClient == nil || client.StreamingHTTPClient.Transport == nil {
		return nil, errNeighborResponse
	}
	server, err := url.Parse(client.RESTConfig.Host)
	if err != nil || server.Host == "" || (server.Scheme != "https" && server.Scheme != "http") || server.RawQuery != "" || server.Fragment != "" {
		return nil, errNeighborResponse
	}
	return &neighborAPI{server: server, transport: client.StreamingHTTPClient.Transport, limiter: client.RESTConfig.RateLimiter, calls: neighborCalls, bytes: neighborBytes}, nil
}

func (a *neighborAPI) get(ctx context.Context, path, accept string, query url.Values, out any) error {
	return a.request(ctx, http.MethodGet, path, accept, query, nil, out)
}

// namespaceRules requests an ephemeral review of this credential's own
// namespace permissions. It creates no stored object. Use the result only to
// narrow acquisition and classify coverage, never to authorize a disclosure.
func (a *neighborAPI) namespaceRules(ctx context.Context, namespace string) ([]authorizationv1.ResourceRule, error) {
	var review struct {
		metav1.TypeMeta
		Status struct {
			Incomplete      *bool
			EvaluationError string
			ResourceRules   []authorizationv1.ResourceRule
		}
	}
	// The root namespace has already passed Kubernetes DNS-label validation.
	body := strings.NewReader(`{"apiVersion":"authorization.k8s.io/v1","kind":"SelfSubjectRulesReview","spec":{"namespace":"` + namespace + `"}}`)
	if err := a.request(ctx, http.MethodPost, neighborRulesPath, "application/json", nil, body, &review); err != nil {
		return nil, err
	}
	if review.APIVersion != "authorization.k8s.io/v1" || review.Kind != "SelfSubjectRulesReview" || review.Status.Incomplete == nil ||
		*review.Status.Incomplete || review.Status.EvaluationError != "" {
		return nil, errNeighborResponse
	}
	return review.Status.ResourceRules, nil
}

func (a *neighborAPI) request(ctx context.Context, method, path, accept string, query url.Values, body io.Reader, out any) (err error) {
	if err := ctx.Err(); err != nil {
		return err
	}
	if a.calls == 0 || a.bytes <= 0 {
		return errNeighborBudget
	}
	if a.limiter != nil {
		if err := a.limiter.Wait(ctx); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return errNeighborResponse
		}
	}
	u := a.server.JoinPath(path)
	u.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return errNeighborResponse
	}
	req.Header.Set("Accept", accept)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	// Do not let an unbounded decompressor sit in front of the demand's budget.
	req.Header.Set("Accept-Encoding", "identity")
	a.calls--
	res, err := a.transport.RoundTrip(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errNeighborResponse
	}
	defer func() {
		if closeErr := res.Body.Close(); closeErr != nil && err == nil {
			err = errNeighborResponse
		}
	}()
	switch res.StatusCode {
	case http.StatusOK:
	case http.StatusCreated:
		if method != http.MethodPost {
			return errNeighborResponse
		}
	case http.StatusForbidden, http.StatusUnauthorized:
		return resourcev2.NewError("PERMISSION_DENIED", "Kubernetes did not authorize this evidence")
	case http.StatusNotFound:
		return resourcev2.NewError("NOT_FOUND", "Kubernetes did not find the requested evidence")
	default:
		return errNeighborResponse // never copy a remote diagnostic or redirect
	}
	if encoding := res.Header.Get("Content-Encoding"); encoding != "" && !strings.EqualFold(encoding, "identity") {
		return errNeighborResponse
	}
	if res.ContentLength > int64(a.bytes) {
		return errNeighborBudget
	}
	limit := int64(a.bytes)
	reader := &io.LimitedReader{R: res.Body, N: limit}
	data, err := io.ReadAll(reader)
	a.bytes -= len(data)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		return errNeighborResponse
	}
	// Do not read even a probe byte beyond the cumulative cap. At the exact
	// boundary a chunked response cannot establish EOF; withhold that page.
	if reader.N == 0 && res.ContentLength != limit {
		return errNeighborBudget
	}
	if res.ContentLength >= 0 && int64(len(data)) != res.ContentLength || !utf8.Valid(data) || json.Unmarshal(data, out) != nil {
		return errNeighborResponse
	}
	return ctx.Err()
}

// Refuse a server that ignored limit before allocating the 65th object. Only
// fields used to prove an edge are decoded; unknown fields stay in the bounded
// HTTP body and never enter either a canonical citation or the returned row.
type neighborItems[T any] []T

func (items *neighborItems[T]) UnmarshalJSON(data []byte) error {
	d := json.NewDecoder(bytes.NewReader(data))
	if open, err := d.Token(); err != nil || open != json.Delim('[') {
		return errors.New("invalid Kubernetes list items")
	}
	*items = []T{}
	for d.More() {
		if len(*items) == neighborPageSize {
			return errNeighborBudget
		}
		var item T
		if err := d.Decode(&item); err != nil {
			return err
		}
		*items = append(*items, item)
	}
	_, err := d.Token()
	return err
}

type neighborPager struct {
	typeID, path, selector, next string
	done                         bool
	page                         func(context.Context, *neighborAPI, string, url.Values) (string, error)
}

func (p *neighborPager) read(ctx context.Context, a *neighborAPI) error {
	q := url.Values{"limit": {strconv.Itoa(neighborPageSize)}}
	if p.selector != "" {
		q.Set("labelSelector", p.selector)
	}
	if p.next != "" {
		q.Set("continue", p.next)
	}
	next, err := p.page(ctx, a, p.path, q)
	p.done, p.next = err != nil || next == "", next
	return err
}

func neighborList[T any](version, kind, accept string, visit func(*T)) func(context.Context, *neighborAPI, string, url.Values) (string, error) {
	return func(ctx context.Context, a *neighborAPI, path string, q url.Values) (string, error) {
		var page struct {
			metav1.TypeMeta
			Metadata struct{ Continue string } `json:"metadata"`
			Items    neighborItems[T]          `json:"items"`
		}
		if err := a.get(ctx, path, accept, q, &page); err != nil {
			return "", err
		}
		next := page.Metadata.Continue
		if page.APIVersion != version || page.Kind != kind+"List" || page.Items == nil || len(next) > 8<<10 || (next != "" && next == q.Get("continue")) {
			return "", errNeighborResponse
		}
		for i := range page.Items {
			if err := ctx.Err(); err != nil {
				return "", err
			}
			visit(&page.Items[i])
		}
		return next, nil
	}
}
