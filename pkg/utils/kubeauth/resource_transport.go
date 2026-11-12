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

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

const ResourceResponseLimit = 32 * 1024 * 1024

// ResourceRequestTimeout bounds one finite native resource request, from send
// through the last body byte. Watches are exempt: they are long-lived by design.
const ResourceRequestTimeout = 60 * time.Second

// LoadResourceKubeClients opts finite native resource responses into a decoded
// HTTP body budget. It must not be used for logs, exec, or metrics clients.
// Native JSON watch streams instead receive a per-frame decoded byte budget.
func LoadResourceKubeClients(ctx context.Context, path, kubeContext string) (*KubeClientBundle, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	strategy, err := DetectAuthStrategy(path, kubeContext)
	if err != nil {
		return nil, err
	}
	config, err := strategy.BuildRestConfig(ctx, path, kubeContext)
	if err != nil {
		return nil, err
	}
	config = rest.CopyConfig(config)
	config.QPS, config.Burst = ConnectionQPS, ConnectionBurst
	config.RateLimiter = newConnectionRateLimiter()
	config.UserAgent = userAgent()
	config.AcceptContentTypes = "application/json"
	config.ContentType = "application/json"
	var client *http.Client
	if eks, ok := strategy.(*EKSAuthStrategy); ok && !eks.useDefault {
		// EKS builds its authenticated client before client-go constructors run.
		// Preserve that exact transport, including TLS and token acquisition.
		copy := *eks.httpClient
		client = &copy
		setEKSUserAgent(client)
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
	streamingHTTP := *client
	streamingClientset, err := kubernetes.NewForConfigAndClient(config, &streamingHTTP)
	if err != nil {
		return nil, err
	}
	client.Transport = &resourceResponseTransport{base: client.Transport, lifetime: ctx, finiteTimeout: ResourceRequestTimeout}
	clientset, err := kubernetes.NewForConfigAndClient(config, client)
	if err != nil {
		return nil, err
	}
	dyn, err := dynamic.NewForConfigAndClient(config, client)
	if err != nil {
		return nil, err
	}
	disco, err := discovery.NewDiscoveryClientForConfigAndClient(config, client)
	if err != nil {
		return nil, err
	}
	return &KubeClientBundle{Clientset: clientset, Dynamic: dyn, Discovery: disco,
		RestConfig: config, HTTPClient: client,
		StreamingClientset: streamingClientset, StreamingHTTPClient: &streamingHTTP}, nil
}

type resourceResponseTransport struct {
	base     http.RoundTripper
	lifetime context.Context
	// finiteTimeout, when positive, bounds every non-watch request.
	finiteTimeout time.Duration
}

// WrappedRoundTripper lets client-go utilities (for example
// utilnet.CloseIdleConnectionsFor) reach the underlying transport.
func (t *resourceResponseTransport) WrappedRoundTripper() http.RoundTripper {
	if t.base == nil {
		return http.DefaultTransport
	}
	return t.base
}

// CloseIdleConnections closes idle connections on the wrapped transport.
func (t *resourceResponseTransport) CloseIdleConnections() {
	if c, ok := t.WrappedRoundTripper().(interface{ CloseIdleConnections() }); ok {
		c.CloseIdleConnections()
	}
}

func (t *resourceResponseTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	watch := req.URL.Query().Get("watch")
	watchRequest := watch == "true" || watch == "1"
	var release func()
	if t.lifetime != nil || (t.finiteTimeout > 0 && !watchRequest) {
		if t.lifetime != nil {
			if err := t.lifetime.Err(); err != nil {
				return nil, err
			}
		}
		var ctx context.Context
		var cancel context.CancelFunc
		if t.finiteTimeout > 0 && !watchRequest {
			ctx, cancel = context.WithTimeout(req.Context(), t.finiteTimeout)
		} else {
			ctx, cancel = context.WithCancel(req.Context())
		}
		stop := func() bool { return true }
		if t.lifetime != nil {
			stop = context.AfterFunc(t.lifetime, cancel)
		}
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
	stream := watchRequest && response.StatusCode >= 200 && response.StatusCode < 300
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
