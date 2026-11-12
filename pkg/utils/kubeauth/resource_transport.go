package kubeauth

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"github.com/omniview/kubernetes/pkg/diag"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

const ResourceResponseLimit = 32 * 1024 * 1024

// LoadResourceKubeClients opts finite native resource responses into a decoded
// HTTP body budget. It must not be used for logs, exec, or metrics clients.
// Native JSON watch streams instead receive a per-frame decoded byte budget.
// Like LoadKubeClients, each build records a span, a client.builds count and a
// duration log line.
func LoadResourceKubeClients(ctx context.Context, path, kubeContext string) (*KubeClientBundle, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	ctx, span := diag.Tracer().Start(ctx, "kubernetes.client.build")
	span.SetAttributes(attribute.String("connection", kubeContext))
	started := time.Now()
	logger := authLogger()
	progress := resourceBuildProgress{operation: "detect", strategy: "unknown", span: span}
	var bundle *KubeClientBundle
	var err error
	diag.Do(ctx, diag.PhaseClientBuild, kubeContext, func(ctx context.Context) {
		bundle, err = buildResourceKubeClients(ctx, path, kubeContext, &progress)
	})
	span.SetAttributes(attribute.String("operation", progress.operation))
	c := diag.EndSpan(span, err, false)
	diag.ClientBuild(progress.operation, c.Outcome)
	fields := append([]any{"connection", kubeContext, "operation", progress.operation, "auth_strategy", progress.strategy,
		"duration_ms", time.Since(started).Milliseconds()}, c.LogFields()...)
	if err != nil {
		logger.Warnw(ctx, "kubernetes client build failed", fields...)
		return nil, err
	}
	logger.Debugw(ctx, "kubernetes clients built", fields...)
	return bundle, nil
}

// resourceBuildProgress tracks the build stage so a failure is attributed to
// the step that failed, using the same operation vocabulary as LoadKubeClients.
type resourceBuildProgress struct {
	operation string
	strategy  string
	span      trace.Span
}

func (p *resourceBuildProgress) step(operation string) {
	p.operation = operation
}

func (p *resourceBuildProgress) done(event string) {
	p.span.AddEvent(event)
}

func buildResourceKubeClients(ctx context.Context, path, kubeContext string, progress *resourceBuildProgress) (*KubeClientBundle, error) {
	strategy, err := DetectAuthStrategy(path, kubeContext)
	if err != nil {
		return nil, err
	}
	progress.strategy = authStrategyName(strategy)
	progress.span.SetAttributes(attribute.String("auth.strategy", progress.strategy))
	progress.done("strategy_detected")
	progress.step("rest_config")
	config, err := strategy.BuildRestConfig(ctx, path, kubeContext)
	if err != nil {
		return nil, err
	}
	progress.done("rest_config")
	config = rest.CopyConfig(config)
	config.QPS, config.Burst = 50, 100
	config.AcceptContentTypes = "application/json"
	config.ContentType = "application/json"
	var client *http.Client
	if eks, ok := strategy.(*EKSAuthStrategy); ok && !eks.useDefault {
		// EKS builds its authenticated client before client-go constructors run.
		// Preserve that exact transport, including TLS and token acquisition.
		copy := *eks.httpClient
		client = &copy
	} else {
		client, err = rest.HTTPClientFor(config)
		if err != nil {
			return nil, err
		}
		copy := *client
		client = &copy
	}
	client.Transport = diag.Transport(client.Transport)
	// Construct once from the exact configured/authenticated transport, before
	// installing resource-only response budgets.
	progress.step("clientset")
	streamingHTTP := *client
	streamingClientset, err := kubernetes.NewForConfigAndClient(config, &streamingHTTP)
	if err != nil {
		return nil, err
	}
	client.Transport = &resourceResponseTransport{base: client.Transport, lifetime: ctx}
	clientset, err := kubernetes.NewForConfigAndClient(config, client)
	if err != nil {
		return nil, err
	}
	progress.done("clientset")
	progress.step("dynamic")
	dyn, err := dynamic.NewForConfigAndClient(config, client)
	if err != nil {
		return nil, err
	}
	progress.done("dynamic")
	progress.step("discovery")
	disco, err := discovery.NewDiscoveryClientForConfigAndClient(config, client)
	if err != nil {
		return nil, err
	}
	progress.done("discovery")
	progress.step("complete")
	return &KubeClientBundle{Clientset: clientset, Dynamic: dyn, Discovery: disco,
		RestConfig: config, HTTPClient: client,
		StreamingClientset: streamingClientset, StreamingHTTPClient: &streamingHTTP}, nil
}

type resourceResponseTransport struct {
	base     http.RoundTripper
	lifetime context.Context
}

func (t *resourceResponseTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	var release func()
	if t.lifetime != nil {
		if err := t.lifetime.Err(); err != nil {
			return nil, err
		}
		ctx, cancel := context.WithCancel(req.Context())
		stop := context.AfterFunc(t.lifetime, cancel)
		release = func() { stop(); cancel() }
		req = req.WithContext(ctx)
	}
	defer func() {
		if release != nil {
			release()
		}
	}()
	base := t.base
	if base == nil {
		base = http.DefaultTransport
	}
	response, err := base.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	watch := req.URL.Query().Get("watch")
	stream := (watch == "true" || watch == "1") && response.StatusCode >= 200 && response.StatusCode < 300
	bodySource := response.Body
	var reader io.Reader = bodySource
	var decoded *gzip.Reader
	if strings.EqualFold(response.Header.Get("Content-Encoding"), "gzip") {
		decoded, err = gzip.NewReader(bodySource)
		if err != nil {
			bodySource.Close()
			return nil, err
		}
		reader = decoded
		response.Header.Del("Content-Encoding")
		response.Uncompressed = true
	} else if encoding := response.Header.Get("Content-Encoding"); encoding != "" && !strings.EqualFold(encoding, "identity") {
		bodySource.Close()
		return nil, resourcev2.NewError("UNSUPPORTED", "Unsupported native resource HTTP content encoding")
	}
	if stream {
		mediaType, _, parseErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
		if parseErr != nil || mediaType != "application/json" {
			if decoded != nil {
				decoded.Close()
			}
			bodySource.Close()
			return nil, resourcev2.NewError("UNSUPPORTED", "Native resource watches require JSON object framing")
		}
		response.Body = &resourceWatchReader{reader: reader, source: bodySource, decoded: decoded, ctx: req.Context(), release: release}
		release = nil
		response.ContentLength = -1
		response.Header.Del("Content-Length")
		return response, nil
	}
	defer bodySource.Close()
	if decoded != nil {
		defer decoded.Close()
	}
	body, err := io.ReadAll(io.LimitReader(reader, ResourceResponseLimit+1))
	if err != nil {
		return nil, err
	}
	if err := req.Context().Err(); err != nil {
		return nil, err
	}
	if len(body) > ResourceResponseLimit {
		return nil, resourcev2.NewError("RESOURCE_LIMIT", "The decoded native resource HTTP response exceeded 32 MiB")
	}
	response.Body = io.NopCloser(bytes.NewReader(body))
	response.ContentLength = int64(len(body))
	response.Header.Del("Content-Length")
	return response, nil
}

// Kubernetes v0.35 JSON Framer writes self-framing objects directly and reads
// them with json.Decoder (pkg/runtime/serializer/json and pkg/util/framer).
// Count structural JSON object frames before that decoder can allocate RawMessage.
// This scanner never buffers frames and also budgets inter-frame whitespace.
// The downstream Kubernetes decoder remains responsible for full JSON validity.
type resourceWatchReader struct {
	reader   io.Reader
	source   io.Closer
	decoded  *gzip.Reader
	ctx      context.Context
	size     int
	depth    int
	inString bool
	escaped  bool
	terminal error
	release  func()
}

func (r *resourceWatchReader) Read(p []byte) (int, error) {
	if r.terminal != nil {
		return 0, r.terminal
	}
	if err := r.ctx.Err(); err != nil {
		return r.fail(err)
	}
	n, err := r.reader.Read(p)
	for _, b := range p[:n] {
		r.size++
		if r.size > ResourceResponseLimit {
			return r.fail(resourcev2.NewError("RESOURCE_LIMIT", "The decoded native watch frame exceeded 32 MiB"))
		}
		if r.inString {
			if r.escaped {
				r.escaped = false
			} else if b == '\\' {
				r.escaped = true
			} else if b == '"' {
				r.inString = false
			}
			continue
		}
		if r.depth == 0 {
			switch b {
			case ' ', '\n', '\r', '\t':
				continue
			case '{':
				r.depth = 1
				continue
			default:
				return r.fail(errors.New("native watch frame must be a JSON object"))
			}
		}
		switch b {
		case '"':
			r.inString = true
		case '{', '[':
			r.depth++
		case '}', ']':
			r.depth--
			if r.depth == 0 {
				r.size = 0
			}
		}
	}
	if contextErr := r.ctx.Err(); contextErr != nil {
		return r.fail(contextErr)
	}
	if err != nil {
		if errors.Is(err, io.EOF) && r.depth != 0 {
			err = io.ErrUnexpectedEOF
		}
		r.terminal = err
		r.Close()
	}
	return n, err
}

func (r *resourceWatchReader) fail(err error) (int, error) {
	r.terminal = err
	r.Close()
	return 0, err
}

func (r *resourceWatchReader) Close() error {
	if r.release != nil {
		r.release()
	}
	if r.decoded != nil {
		return errors.Join(r.decoded.Close(), r.source.Close())
	}
	return r.source.Close()
}
