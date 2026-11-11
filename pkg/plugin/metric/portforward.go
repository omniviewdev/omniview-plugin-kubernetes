package metric

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/omniview/kubernetes/pkg/diag"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"
)

const (
	DefaultPortForwardTTL = 10 * time.Minute
	DefaultPFReapInterval = time.Minute
)

// Each entry is both a startup fence and the owner of its native SPDY lifetime.
// It never represents resource identity or a second connection registry.
type pfSession struct {
	url                string
	namespace, service string
	port               int
	lastAccess         time.Time
	ctx                context.Context
	cancel             context.CancelFunc
	stopCh             chan struct{}
	stopOnce           sync.Once
	ready, done        chan struct{}
	readyClosed        bool
	err                error
}

func (s *pfSession) stop() {
	s.stopOnce.Do(func() { s.cancel(); close(s.stopCh) })
}

func (s *pfSession) readyLocked() {
	if !s.readyClosed {
		s.readyClosed = true
		close(s.ready)
	}
}

// PortForwardManager shares one configured Prometheus tunnel per connection.
// Changing the selected service retires the previous binding before replacement.
type PortForwardManager struct {
	mu       sync.Mutex
	sessions map[string]*pfSession
	ttl      time.Duration
	stopCh   chan struct{}
	nowFunc  func() time.Time
	stopped  bool
}

type PortForwardOpts struct {
	TTL     time.Duration
	NowFunc func() time.Time
}

func NewPortForwardManager(opts PortForwardOpts) *PortForwardManager {
	ttl := opts.TTL
	if ttl == 0 {
		ttl = DefaultPortForwardTTL
	}
	now := opts.NowFunc
	if now == nil {
		now = time.Now
	}
	m := &PortForwardManager{sessions: make(map[string]*pfSession), ttl: ttl, stopCh: make(chan struct{}), nowFunc: now}
	go m.reapLoop()
	return m
}

func (m *PortForwardManager) GetOrCreate(ctx context.Context, connectionID string, config *rest.Config, client *kubernetes.Clientset, namespace, service string, port int) (string, error) {
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		m.mu.Lock()
		if m.stopped {
			m.mu.Unlock()
			return "", resourcev2.NewError("UNAVAILABLE", "Metric tunnel manager is closed")
		}
		if existing := m.sessions[connectionID]; existing != nil {
			if existing.namespace != namespace || existing.service != service || existing.port != port {
				delete(m.sessions, connectionID)
				m.mu.Unlock()
				promLog().Debugw(ctx, "metric tunnel target changed; replacing", "connection", connectionID)
				existing.stop()
				<-existing.done
				continue
			}
			m.mu.Unlock()
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-existing.ready:
			}
			m.mu.Lock()
			if existing.err != nil {
				err := existing.err
				m.mu.Unlock()
				return "", err
			}
			if m.sessions[connectionID] != existing {
				m.mu.Unlock()
				return "", resourcev2.NewError("RESET_REQUIRED", "Metric tunnel generation was retired")
			}
			existing.lastAccess = m.nowFunc()
			url := existing.url
			m.mu.Unlock()
			return url, nil
		}
		// Startup follows the request cancellation. Once ready, the canonical
		// connection lifecycle and idle reaper own this shared native tunnel.
		sourceCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
		session := &pfSession{namespace: namespace, service: service, port: port, lastAccess: m.nowFunc(), ctx: sourceCtx, cancel: cancel, stopCh: make(chan struct{}), ready: make(chan struct{}), done: make(chan struct{})}
		m.sessions[connectionID] = session
		m.mu.Unlock()
		return m.start(ctx, connectionID, config, client, session)
	}
}

// SPDY's Dialer has no context argument. Wrap its existing auth-aware transport
// rather than replacing authentication/TLS or leaving the upgrade uncancellable.
type metricTunnelTransport struct {
	base http.RoundTripper
	ctx  context.Context
}

func (t metricTunnelTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return t.base.RoundTrip(request.WithContext(t.ctx))
}

func (m *PortForwardManager) start(requestCtx context.Context, connectionID string, config *rest.Config, client *kubernetes.Clientset, session *pfSession) (url string, err error) {
	startedAt := time.Now()
	_, openSpan := diag.Tracer().Start(requestCtx, "kubernetes.metric.tunnel.open", trace.WithAttributes(
		attribute.String("connection", connectionID),
		attribute.String("resource.namespace", session.namespace),
		attribute.String("resource.id", session.service),
	))
	defer func() {
		class := diag.EndSpan(openSpan, err, false)
		if err != nil {
			promLog().Warnw(requestCtx, "metric tunnel open failed",
				append([]any{"connection", connectionID, "duration_ms", time.Since(startedAt).Milliseconds()}, class.LogFields()...)...)
		} else {
			promLog().Infow(requestCtx, "metric tunnel opened",
				"connection", connectionID, "resource_namespace", session.namespace, "resource_id", session.service,
				"duration_ms", time.Since(startedAt).Milliseconds())
		}
	}()
	stopRequestCancellation := context.AfterFunc(requestCtx, session.stop)
	started := false
	defer func() {
		stopRequestCancellation()
		if err == nil {
			return
		}
		session.stop()
		m.mu.Lock()
		if m.sessions[connectionID] == session {
			delete(m.sessions, connectionID)
		}
		session.err = err
		session.readyLocked()
		m.mu.Unlock()
		if started {
			<-session.done
		} else {
			close(session.done)
		}
	}()
	endpoints, err := client.CoreV1().Endpoints(session.namespace).Get(session.ctx, session.service, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to resolve endpoints for %s/%s: %w", session.namespace, session.service, err)
	}
	pod, namespace := "", ""
	for _, subset := range endpoints.Subsets {
		for _, address := range subset.Addresses {
			if ref := address.TargetRef; ref != nil && ref.Kind == "Pod" {
				pod, namespace = ref.Name, ref.Namespace
				break
			}
		}
		if pod != "" {
			break
		}
	}
	if pod == "" {
		return "", fmt.Errorf("no ready endpoints found for service %s/%s", session.namespace, session.service)
	}
	transport, upgrader, err := spdy.RoundTripperFor(config)
	if err != nil {
		return "", fmt.Errorf("failed to build metric tunnel transport: %w", err)
	}
	endpoint := client.CoreV1().RESTClient().Post().Namespace(namespace).Resource("pods").Name(pod).SubResource("portforward").URL()
	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: metricTunnelTransport{base: transport, ctx: session.ctx}}, http.MethodPost, endpoint)
	ready := make(chan struct{})
	forwarder, err := portforward.NewOnAddresses(dialer, []string{"127.0.0.1"}, []string{fmt.Sprintf("0:%d", session.port)}, session.stopCh, ready, io.Discard, io.Discard)
	if err != nil {
		return "", fmt.Errorf("failed to create metric tunnel: %w", err)
	}
	started = true
	go func() {
		forwardErr := forwarder.ForwardPorts()
		if forwardErr != nil && session.ctx.Err() == nil {
			promLog().Warnw(context.Background(), "metric tunnel ended with error",
				append([]any{"connection", connectionID, "resource_id", session.service}, diag.ClassifyError(forwardErr, false).LogFields()...)...)
		} else {
			promLog().Debugw(context.Background(), "metric tunnel ended", "connection", connectionID, "resource_id", session.service)
		}
		m.mu.Lock()
		if forwardErr != nil {
			session.err = forwardErr
		} else if session.err == nil {
			session.err = resourcev2.NewError("RESET_REQUIRED", "Metric tunnel was retired")
		}
		if m.sessions[connectionID] == session {
			delete(m.sessions, connectionID)
		}
		session.readyLocked()
		m.mu.Unlock()
		session.stop()
		close(session.done)
	}()
	select {
	case <-session.ctx.Done():
		m.mu.Lock()
		failure := session.err
		m.mu.Unlock()
		if failure != nil {
			return "", failure
		}
		if requestCtx.Err() != nil {
			return "", requestCtx.Err()
		}
		return "", resourcev2.NewError("RESET_REQUIRED", "Metric tunnel generation was retired")
	case <-session.done:
		m.mu.Lock()
		failure := session.err
		m.mu.Unlock()
		return "", failure
	case <-ready:
		ports, getErr := forwarder.GetPorts()
		if getErr != nil {
			return "", getErr
		}
		if len(ports) != 1 {
			return "", resourcev2.NewError("UNAVAILABLE", "Metric tunnel did not bind its local port")
		}
		if requestCtx.Err() != nil {
			return "", requestCtx.Err()
		}
		m.mu.Lock()
		if m.sessions[connectionID] != session || session.ctx.Err() != nil {
			m.mu.Unlock()
			return "", resourcev2.NewError("RESET_REQUIRED", "Metric tunnel generation was retired")
		}
		session.url = fmt.Sprintf("http://127.0.0.1:%d", ports[0].Local)
		session.lastAccess = m.nowFunc()
		session.readyLocked()
		url = session.url
		m.mu.Unlock()
		return url, nil
	}
}

func (m *PortForwardManager) Close(connectionID string) {
	m.mu.Lock()
	session := m.sessions[connectionID]
	delete(m.sessions, connectionID)
	m.mu.Unlock()
	if session != nil {
		session.stop()
		<-session.done
		promLog().Debugw(context.Background(), "metric tunnel closed", "connection", connectionID)
	}
}

func (m *PortForwardManager) CloseAll() {
	m.mu.Lock()
	if m.stopped {
		m.mu.Unlock()
		return
	}
	m.stopped = true
	close(m.stopCh)
	sessions := m.sessions
	m.sessions = nil
	m.mu.Unlock()
	for _, session := range sessions {
		session.stop()
	}
	for _, session := range sessions {
		<-session.done
	}
}

func (m *PortForwardManager) Len() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sessions)
}

func (m *PortForwardManager) reapLoop() {
	ticker := time.NewTicker(DefaultPFReapInterval)
	defer ticker.Stop()
	for {
		select {
		case <-m.stopCh:
			return
		case <-ticker.C:
			m.reap()
		}
	}
}

func (m *PortForwardManager) reap() {
	now := m.nowFunc()
	m.mu.Lock()
	var retired []*pfSession
	for id, session := range m.sessions {
		if now.Sub(session.lastAccess) > m.ttl {
			delete(m.sessions, id)
			retired = append(retired, session)
		}
	}
	m.mu.Unlock()
	for _, session := range retired {
		session.stop()
	}
	for _, session := range retired {
		<-session.done
	}
	if len(retired) > 0 {
		promLog().Debugw(context.Background(), "idle metric tunnels reaped", "count", len(retired))
	}
}
