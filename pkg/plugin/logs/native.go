package logs

import (
	"context"
	"errors"
	"io"
	"sync"

	"github.com/omniview/kubernetes/pkg/diag"
	"github.com/omniview/kubernetes/pkg/utils/kubeauth"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"k8s.io/client-go/kubernetes"
)

// ClientBorrower holds the selected native client until its callback returns.
type ClientBorrower func(context.Context, resourcev2.AccessRoute, func(context.Context, *kubernetes.Clientset) error) error

func logRoute(ctx *types.PluginContext, route *resourcev2.AccessRoute) resourcev2.AccessRoute {
	if route != nil {
		return *route
	}
	if ctx.Connection != nil {
		return resourcev2.AccessRoute{Connection: ctx.Connection.ID}
	}
	return resourcev2.AccessRoute{}
}

// safeLogError logs a classified Warn for err and returns a sanitized error
// that never carries Kubernetes error text. The raw error text is never logged.
func safeLogError(ctx context.Context, log logging.Logger, operation string, err error) error {
	if err == nil {
		return nil
	}
	if log == nil {
		log = logging.Default()
	}
	class := diag.ClassifyError(err, false)
	if class.Outcome == "canceled" {
		log.Debugw(ctx, "native log operation canceled", append([]any{"operation", operation}, class.LogFields()...)...)
	} else {
		log.Warnw(ctx, "native log operation failed", append([]any{"operation", operation}, class.LogFields()...)...)
	}
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return resourcev2.NewError("INTERNAL", "native log operation failed")
}

type borrowedReader struct {
	reader io.Reader
	body   io.ReadCloser
	stop   chan struct{}
	done   chan struct{}
	once   sync.Once
	err    error
	ctx    context.Context
	log    logging.Logger
}

func (r *borrowedReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if err != nil {
		_ = r.Close()
		if err != io.EOF {
			err = safeLogError(r.ctx, r.log, "read", err)
		}
	}
	return n, err
}

func (r *borrowedReader) Close() error {
	r.once.Do(func() {
		r.err = r.body.Close()
		close(r.stop)
	})
	<-r.done
	return safeLogError(r.ctx, r.log, "close", r.err)
}

func nativeHandler(borrow ClientBorrower) sdklogs.LogHandlerFunc {
	return func(ctx *types.PluginContext, req sdklogs.LogStreamRequest) (io.ReadCloser, error) {
		type opened struct {
			reader io.ReadCloser
			err    error
		}
		log := logsLogger(ctx)
		baseCtx := logsBaseContext(ctx)
		_, span := diag.Tracer().Start(baseCtx, "kubernetes.logs.stream.open", trace.WithAttributes(
			attribute.Bool("follow", req.Follow),
			attribute.Bool("include_previous", req.IncludePrevious),
			attribute.Int64("tail_lines", req.TailLines),
			attribute.Int64("limit_bytes", req.LimitBytes),
			attribute.String("resource.namespace", req.Labels["namespace"]),
			attribute.String("resource.id", req.Labels["pod"]),
		))
		ready := make(chan opened, 1)
		done := make(chan struct{})
		go func() {
			defer close(done)
			sent := false
			err := borrow(ctx.Context, logRoute(ctx, req.Route), func(nativeCtx context.Context, client *kubernetes.Clientset) error {
				local := *ctx
				local.Context = nativeCtx
				body, err := PodLogHandler(&kubeauth.KubeClientBundle{Clientset: client}, &local, req)
				if err != nil {
					return err
				}
				r := &borrowedReader{reader: body, body: body, stop: make(chan struct{}), done: done, ctx: baseCtx, log: log}
				if !req.Follow {
					limit := int64(1 << 20)
					if req.LimitBytes > 0 && req.LimitBytes < limit {
						limit = req.LimitBytes
					}
					r.reader = io.LimitReader(body, limit)
				}
				ready <- opened{reader: r}
				sent = true
				select {
				case <-r.stop:
				case <-nativeCtx.Done():
					r.once.Do(func() { r.err = body.Close(); close(r.stop) })
				}
				return nil
			})
			if !sent {
				ready <- opened{err: safeLogError(baseCtx, log, "open", err)}
			}
		}()
		result := <-ready
		class := diag.EndSpan(span, result.err, false)
		if result.err == nil {
			log.Debugw(baseCtx, "native log stream opened", "follow", req.Follow, "include_previous", req.IncludePrevious)
		} else {
			log.Debugw(baseCtx, "native log stream open failed", class.LogFields()...)
		}
		return result.reader, result.err
	}
}

type nativeResolverFunc func(*kubeauth.KubeClientBundle, *types.PluginContext, *resourcev2.Value, sdklogs.SourceResolverOptions) (*sdklogs.SourceResolverResult, error)

func nativeResolver(borrow ClientBorrower, resolve nativeResolverFunc) sdklogs.SourceResolver {
	return func(ctx *types.PluginContext, data *resourcev2.Value, opts sdklogs.SourceResolverOptions) (*sdklogs.SourceResolverResult, error) {
		type resolved struct {
			result *sdklogs.SourceResolverResult
			err    error
		}
		log := logsLogger(ctx)
		baseCtx := logsBaseContext(ctx)
		ready := make(chan resolved, 1)
		go func() {
			sent := false
			err := borrow(ctx.Context, logRoute(ctx, opts.Route), func(nativeCtx context.Context, client *kubernetes.Clientset) error {
				local := *ctx
				local.Context = nativeCtx
				result, err := resolve(&kubeauth.KubeClientBundle{Clientset: client}, &local, data, opts)
				if err != nil {
					return err
				}
				events := result.Events
				if events == nil {
					ready <- resolved{result: result}
					sent = true
					return nil
				}
				forward := make(chan sdklogs.SourceEvent, 16)
				result.Events = forward
				ready <- resolved{result: result}
				sent = true
				defer close(forward)
				// Drain through producer shutdown before releasing the native lease.
				for event := range events {
					select {
					case forward <- event:
					case <-nativeCtx.Done():
					}
				}
				return nil
			})
			if !sent {
				ready <- resolved{err: safeLogError(baseCtx, log, "resolve_sources", err)}
			}
		}()
		result := <-ready
		return result.result, result.err
	}
}
