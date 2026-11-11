package resource

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/plugin/resource/clients"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/rest"
)

// nativeSchemaDocument keeps corrected native bytes and unambiguous GVK roots.
// The host remains the sole dialect normalizer and validator.
type nativeSchemaDocument struct {
	Document json.RawMessage
	roots    map[schema.GroupVersionKind]string
	Revision string
}

func (d nativeSchemaDocument) serves(gv schema.GroupVersion) bool {
	for key, root := range d.roots {
		if root != "" && key.GroupVersion() == gv {
			return true
		}
	}
	return false
}

const maxNativeSchemaBytes = 16 << 20
const maxNativeRetainedSchemaBytes = 32 << 20

// nativeSchemaBudget bounds provider-wide retained bytes and simultaneous
// demanded reads/decodes. It never holds its mutex during network I/O.
type nativeSchemaBudget struct {
	// Accounting never holds mu during network reads or decoding.
	mu        sync.Mutex
	staging   chan struct{}
	limit     int
	used      int
	documents map[string]*nativeRetainedSchema
}

type nativeRetainedSchema struct {
	data       json.RawMessage
	roots      map[schema.GroupVersionKind]string
	references int
}

// nativeSchemaLease belongs to one demanded group/version entry.
// Release it on failed publication, replacement, or generation retirement.
type nativeSchemaLease struct {
	budget   *nativeSchemaBudget
	revision string
}

func (l *nativeSchemaLease) Release() {
	if l == nil {
		return
	}
	l.budget.mu.Lock()
	defer l.budget.mu.Unlock()
	if l.revision != "" {
		document := l.budget.documents[l.revision]
		document.references--
		if document.references == 0 {
			l.budget.used -= len(document.data)
			delete(l.budget.documents, l.revision)
		}
		l.revision = ""
	}
}

// Corrected content and its immutable root index share one retained owner.
func (b *nativeSchemaBudget) retain(value nativeSchemaDocument, lease *nativeSchemaLease) (nativeSchemaDocument, error) {
	data, revision := value.Document, value.Revision
	b.mu.Lock()
	defer b.mu.Unlock()
	document := b.documents[revision]
	if document == nil {
		limit := b.limit
		if limit == 0 {
			limit = maxNativeRetainedSchemaBytes
		}
		if len(data) > limit-b.used {
			return nativeSchemaDocument{}, fmt.Errorf("%w (%d bytes)", errNativeSchemaRetention, limit)
		}
		if cap(data) != len(data) {
			exact := make([]byte, len(data))
			copy(exact, data)
			data = exact
		}
		document = &nativeRetainedSchema{data: data, roots: value.roots}
		if b.documents == nil {
			b.documents = make(map[string]*nativeRetainedSchema)
		}
		b.documents[revision] = document
		b.used += len(data)
	}
	lease.revision = revision
	document.references++
	return nativeSchemaDocument{Document: document.data, roots: document.roots, Revision: revision}, nil
}

func (b *nativeSchemaBudget) reuse(revision string) (nativeSchemaDocument, *nativeSchemaLease) {
	b.mu.Lock()
	defer b.mu.Unlock()
	document := b.documents[revision]
	if document == nil {
		return nativeSchemaDocument{}, nil
	}
	document.references++
	return nativeSchemaDocument{Document: document.data, roots: document.roots, Revision: revision},
		&nativeSchemaLease{budget: b, revision: revision}
}

const nativeSchemaRefreshInterval = 30 * time.Second
const maxNativeSchemaEntries = 256

// All mutable schema state uses the provider mutex. A generation owns entries;
// entries own successful raw-byte leases and one waiter-counted acquisition.
type nativeSchemaState struct {
	ctx     context.Context
	cancel  context.CancelFunc
	entries map[schema.GroupVersion]*nativeSchemaEntry
}

type nativeSchemaEntry struct {
	document    nativeSchemaDocument
	lease       *nativeSchemaLease
	nextRefresh time.Time
	reason      string
	fetch       *nativeSchemaFetch
}

type nativeSchemaFetch struct {
	done    chan struct{}
	cancel  context.CancelFunc
	waiters int
	err     error
}

func newNativeSchemaState(ctx context.Context) *nativeSchemaState {
	ctx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	return &nativeSchemaState{ctx: ctx, cancel: cancel, entries: make(map[schema.GroupVersion]*nativeSchemaEntry)}
}

func (p *kubernetesProvider) retireNativeSchemas(state *nativeSchemaState) {
	if state == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	state.cancel()
	for _, entry := range state.entries {
		if entry.fetch != nil {
			entry.fetch.cancel()
		}
		entry.lease.Release()
		entry.document = nativeSchemaDocument{}
		entry.lease = nil
	}
	state.entries = nil
}

// Called under p.mu only after complete discovery proves served-GV removal.
func pruneNativeSchemas(snapshot *nativeCatalogSnapshot) {
	if snapshot.schemas == nil {
		return
	}
	supported := make(map[schema.GroupVersion]bool)
	for _, binding := range snapshot.bindings {
		if len(binding.Served) == 0 {
			supported[binding.GVR.GroupVersion()] = true
		}
		for _, served := range binding.Served {
			supported[served.GVR.GroupVersion()] = true
		}
	}
	for gv, entry := range snapshot.schemas.entries {
		if supported[gv] {
			continue
		}
		if entry.fetch != nil {
			entry.fetch.cancel()
			entry.fetch = nil
		}
		entry.lease.Release()
		entry.lease = nil
		entry.document = nativeSchemaDocument{}
		delete(snapshot.schemas.entries, gv)
	}
}

func (p *kubernetesProvider) resolveNativeSchema(ctx context.Context, request resourcev2.SchemaRequest, served nativeServedType, state *nativeSchemaState) (resourcev2.SchemaBinding, error) {
	gv := served.GVR.GroupVersion()
	p.mu.Lock()
	snapshot := p.catalogs[request.Route.Connection]
	if snapshot == nil || snapshot.schemas != state || state == nil || state.ctx.Err() != nil {
		p.mu.Unlock()
		return resourcev2.SchemaBinding{}, resourcev2.NewError("RESET_REQUIRED", "Native schema generation was retired")
	}
	entry := state.entries[gv]
	if entry == nil {
		if len(state.entries) >= maxNativeSchemaEntries {
			p.mu.Unlock()
			return resourcev2.SchemaBinding{}, resourcev2.NewError("RESOURCE_LIMIT", "Native demanded schema entry budget is exhausted")
		}
		entry = &nativeSchemaEntry{}
		state.entries[gv] = entry
	}
	if entry.fetch == nil && time.Now().Before(entry.nextRefresh) {
		binding := nativeSchemaBinding(gv, served.API.Kind, entry)
		p.mu.Unlock()
		return binding, nil
	}
	fetch := entry.fetch
	if fetch == nil {
		work, cancel := context.WithCancel(state.ctx)
		fetch = &nativeSchemaFetch{done: make(chan struct{}), cancel: cancel}
		entry.fetch = fetch
		go p.acquireDemandedSchema(work, request.Route, gv, state, entry, fetch)
	}
	fetch.waiters++
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		fetch.waiters--
		if fetch.waiters == 0 && entry.fetch == fetch {
			entry.fetch = nil
			fetch.cancel()
			if entry.lease == nil {
				delete(state.entries, gv)
			}
		}
		p.mu.Unlock()
	}()
	select {
	case <-ctx.Done():
		return resourcev2.SchemaBinding{}, ctx.Err()
	case <-fetch.done:
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return resourcev2.SchemaBinding{}, err
	}
	snapshot = p.catalogs[request.Route.Connection]
	if snapshot == nil || snapshot.schemas != state || state.ctx.Err() != nil {
		return resourcev2.SchemaBinding{}, resourcev2.NewError("RESET_REQUIRED", "Native schema generation was retired")
	}
	if fetch.err != nil {
		return resourcev2.SchemaBinding{}, fetch.err
	}
	return nativeSchemaBinding(gv, served.API.Kind, entry), nil
}

func nativeSchemaBinding(gv schema.GroupVersion, kind string, entry *nativeSchemaEntry) resourcev2.SchemaBinding {
	root := entry.document.roots[gv.WithKind(kind)]
	if root == "" {
		reason := entry.reason
		if reason == "" {
			reason = "UNAVAILABLE"
		}
		return resourcev2.SchemaBinding{State: "unavailable", UnavailableReason: &reason}
	}
	revision := entry.document.Revision
	ref := resourcev2.SchemaDocumentReference{ID: "kubernetes.openapi.v3/" + gv.String(), Revision: revision}
	return resourcev2.SchemaBinding{State: "available", Revision: &revision, Dialect: resourcev2.DialectOpenAPI30, Root: root, DocumentRef: &ref}
}

func (p *kubernetesProvider) acquireDemandedSchema(ctx context.Context, route resourcev2.AccessRoute, gv schema.GroupVersion, state *nativeSchemaState, entry *nativeSchemaEntry, fetch *nativeSchemaFetch) {
	defer fetch.cancel()
	ctx, span := diag.Tracer().Start(ctx, "kubernetes.schema.fetch", trace.WithAttributes(attribute.String("api_version", gv.String())))
	var document nativeSchemaDocument
	var lease *nativeSchemaLease
	err := p.WithClient(ctx, route, func(ctx context.Context, client *clients.ClientSet) error {
		timeout, err := resourcev2.ConnectionAcquisitionTimeout(ctx)
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		if client == nil || client.DiscoveryClient == nil {
			return resourcev2.NewError("UNAVAILABLE", "Native schema client is unavailable")
		}
		document, lease, err = fetchNativeSchema(ctx, client.DiscoveryClient.RESTClient(), gv, &p.schemaBudget)
		return err
	})
	diag.EndSpan(span, err, false)
	if err != nil {
		p.logNativeSchemaFailures(map[string]error{gv.String(): err})
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	current := p.catalogs[route.Connection]
	if current == nil || current.schemas != state || state.ctx.Err() != nil || ctx.Err() != nil || entry.fetch != fetch {
		lease.Release()
		fetch.err = resourcev2.NewError("RESET_REQUIRED", "Native schema acquisition was retired")
	} else if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		lease.Release()
		fetch.err = err
		entry.fetch = nil
	} else if errors.Is(err, errNativeSchemaRetention) {
		lease.Release()
		entry.lease.Release()
		entry.document, entry.lease, entry.fetch = nativeSchemaDocument{}, nil, nil
		delete(state.entries, gv)
		fetch.err = resourcev2.NewError("RESOURCE_LIMIT", "Native retained schema capacity is temporarily exhausted")
	} else {
		entry.lease.Release()
		entry.document, entry.lease = document, lease
		entry.reason = ""
		entry.nextRefresh = time.Now().Add(nativeSchemaRefreshInterval)
		if err != nil {
			if classified := classifyResourceError(err); classified != nil {
				entry.reason = resourcev2.ErrorCode(classified)
			} else {
				entry.reason = resourcev2.ErrorCode(err)
			}
			if entry.reason == "" {
				entry.reason = "UNAVAILABLE"
			}
		}
		entry.fetch = nil
	}
	close(fetch.done)
}

var errNativeSchemaRetention = &nativeBudgetError{reason: "schema_retained_budget", text: "native OpenAPI retained schema budget exhausted"}

func fetchNativeSchema(ctx context.Context, client rest.Interface, gv schema.GroupVersion, budget *nativeSchemaBudget) (nativeSchemaDocument, *nativeSchemaLease, error) {
	budget.mu.Lock()
	if budget.staging == nil {
		budget.staging = make(chan struct{}, nativeCatalogRequestConcurrency)
	}
	staging := budget.staging
	budget.mu.Unlock()
	select {
	case staging <- struct{}{}:
		defer func() { <-staging }()
	case <-ctx.Done():
		return nativeSchemaDocument{}, nil, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return nativeSchemaDocument{}, nil, err
	}
	path := "/openapi/v3/apis/" + gv.Group + "/" + gv.Version
	if gv.Group == "" {
		path = "/openapi/v3/api/" + gv.Version
	}
	data, err := readNativeSchema(ctx, client, path)
	if err != nil {
		return nativeSchemaDocument{}, nil, err
	}
	if err := resourcev2.ValidateJSON(data); err != nil {
		return nativeSchemaDocument{}, nil, err
	}
	data, err = correctNativeTimeSchemas(data)
	if err != nil {
		return nativeSchemaDocument{}, nil, err
	}
	if err := ctx.Err(); err != nil {
		return nativeSchemaDocument{}, nil, err
	}
	digest := sha256.Sum256(data)
	revision := hex.EncodeToString(digest[:])
	if held, lease := budget.reuse(revision); lease != nil {
		if held.serves(gv) {
			return held, lease, nil
		}
		lease.Release()
		return nativeSchemaDocument{}, nil, fmt.Errorf("native OpenAPI root unavailable or ambiguous for %q", gv)
	}
	var document struct {
		Components struct {
			Schemas map[string]json.RawMessage `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(data, &document); err != nil {
		return nativeSchemaDocument{}, nil, fmt.Errorf("invalid native OpenAPI document: %w", err)
	}
	roots := make(map[schema.GroupVersionKind]string)
	skippedComponents := 0
	for name, body := range document.Components.Schemas {
		var descriptor struct {
			Kinds []schema.GroupVersionKind `json:"x-kubernetes-group-version-kind"`
		}
		if err := json.Unmarshal(body, &descriptor); err != nil {
			skippedComponents++
			continue
		}
		root := "#/components/schemas/" + escapeJSONPointer(name)
		for _, key := range descriptor.Kinds {
			if prior, exists := roots[key]; exists && prior != root {
				roots[key] = ""
			} else if !exists {
				roots[key] = root
			}
		}
	}
	if skippedComponents > 0 {
		zap.S().Named("catalog").Debugw("native schema components skipped", "reason", "invalid_component", "components", skippedComponents, "api_version", gv.String())
	}
	value := nativeSchemaDocument{Document: data, roots: roots, Revision: revision}
	if !value.serves(gv) {
		return nativeSchemaDocument{}, nil, fmt.Errorf("native OpenAPI root unavailable or ambiguous for %q", gv)
	}
	if err := ctx.Err(); err != nil {
		return nativeSchemaDocument{}, nil, err
	}
	lease := &nativeSchemaLease{budget: budget}
	retained, err := budget.retain(value, lease)
	if err != nil {
		lease.Release()
		return nativeSchemaDocument{}, nil, err
	}
	return retained, lease, nil
}

// correctNativeTimeSchemas changes only the two Kubernetes time components.
// The input remains untouched, and unchanged documents retain their exact bytes.
func correctNativeTimeSchemas(data []byte) ([]byte, error) {
	type replacement struct {
		start, end int
		body       []byte
	}
	var replacements []replacement
	// The document was validated before this scan. Locate values without
	// decoding or copying unrelated, potentially large, document sections.
	skipSpace := func(i int) int {
		for i < len(data) && (data[i] == ' ' || data[i] == '\n' || data[i] == '\r' || data[i] == '\t') {
			i++
		}
		return i
	}
	skipString := func(i int) int {
		i++
		for i < len(data) {
			if data[i] == '\\' {
				i += 2
			} else if data[i] == '"' {
				return i + 1
			} else {
				i++
			}
		}
		return i
	}
	skipValue := func(i int) int {
		depth := 0
		for i < len(data) {
			switch data[i] {
			case '"':
				i = skipString(i)
				continue
			case '{', '[':
				depth++
			case '}', ']':
				if depth == 0 {
					return i
				}
				depth--
				if depth == 0 {
					return i + 1
				}
			case ',', ' ', '\n', '\r', '\t':
				if depth == 0 {
					return i
				}
			}
			i++
		}
		return i
	}
	var walk func(int, int) error
	walk = func(start, level int) error {
		if start >= len(data) || data[start] != '{' {
			return fmt.Errorf("native OpenAPI time component location is invalid")
		}
		i := skipSpace(start + 1)
		for data[i] != '}' {
			end := skipString(i)
			var name string
			_ = json.Unmarshal(data[i:end], &name) // Already validated.
			i = skipSpace(end)
			i = skipSpace(i + 1) // Colon.
			end = skipValue(i)
			if (level == 0 && name == "components") || (level == 1 && name == "schemas") {
				if err := walk(i, level+1); err != nil {
					return err
				}
			} else if level == 2 && (name == "io.k8s.apimachinery.pkg.apis.meta.v1.Time" || name == "io.k8s.apimachinery.pkg.apis.meta.v1.MicroTime") {
				var fields map[string]json.RawMessage
				if err := json.Unmarshal(data[i:end], &fields); err != nil || fields == nil {
					return fmt.Errorf("invalid native OpenAPI component %q: expected object", name)
				}
				if !bytes.Equal(bytes.TrimSpace(fields["nullable"]), []byte("true")) {
					fields["nullable"] = json.RawMessage("true")
					corrected, err := json.Marshal(fields)
					if err != nil {
						return fmt.Errorf("invalid native OpenAPI component %q: %w", name, err)
					}
					replacements = append(replacements, replacement{start: i, end: end, body: corrected})
				}
			}
			i = skipSpace(end)
			if data[i] == ',' {
				i = skipSpace(i + 1)
			}
		}
		return nil
	}
	if err := walk(skipSpace(0), 0); err != nil {
		return nil, err
	}
	if len(replacements) == 0 {
		return data, nil
	}
	size := len(data)
	for _, r := range replacements {
		size += len(r.body) - (r.end - r.start)
	}
	if size > maxNativeSchemaBytes {
		return nil, &nativeBudgetError{reason: "schema_document_size", text: fmt.Sprintf("native OpenAPI document exceeds %d bytes", maxNativeSchemaBytes)}
	}
	result := make([]byte, 0, size)
	last := 0
	for _, r := range replacements {
		result = append(result, data[last:r.start]...)
		result = append(result, r.body...)
		last = r.end
	}
	result = append(result, data[last:]...)
	return result, nil
}

func readNativeSchema(ctx context.Context, client rest.Interface, path string) ([]byte, error) {
	stream, err := client.Get().AbsPath(path).Stream(ctx)
	if err != nil {
		return nil, err
	}
	defer stream.Close()
	limit := maxNativeSchemaBytes
	data, err := io.ReadAll(io.LimitReader(stream, int64(limit)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > limit {
		return nil, &nativeBudgetError{reason: "schema_document_size", text: fmt.Sprintf("native OpenAPI document exceeds %d bytes", maxNativeSchemaBytes)}
	}
	return data, ctx.Err()
}

func escapeJSONPointer(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(value, "~", "~0"), "/", "~1")
}
