package main

// The tap: an HTTP proxy in front of the kind API server. The plugin's kubeconfig points at it (plain http://127.0.0.1:PORT,
// no credentials); it adds the admin client certificate toward the API server. WebSocket exec/attach requests take a
// frame-aware path (gorilla/websocket on both legs): every message (channel byte, length, the status JSON of channel 3),
// every control frame (ping, pong, close with code and text) and every connection close or error is logged with a
// timestamp, which makes the tap the independent oracle of what the API server really put on the status channel.
// Everything else (SPDY upgrades, plain API calls) passes through httputil.ReverseProxy and is logged as request and
// response.
//
// Faults act on every TCP connection the tap holds, on both legs, whatever the protocol:
//
//	fin        CloseWrite (a clean TCP FIN), the sockets are closed 3 s later
//	rst        SetLinger(0) + Close (an RST)
//	blackhole  the sockets stay open and are still read, but nothing is written to either leg any more
//
// Built on the earlier proxy harness (sdk3-k8s-proof-out hack/zz-proof/harness/proxy.go).

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// ---------------------------------------------------------------------------------------------------------------
// the log
// ---------------------------------------------------------------------------------------------------------------

type tapEvent struct {
	T    time.Time
	Kind string
	F    map[string]any
}

type tapLog struct {
	mu     sync.Mutex
	f      *os.File
	w      *bufio.Writer
	start  time.Time
	events []tapEvent
	done   chan struct{}
}

func newTapLog(path string) (*tapLog, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	f, err := os.Create(path)
	if err != nil {
		return nil, err
	}
	l := &tapLog{f: f, w: bufio.NewWriterSize(f, 1<<20), start: time.Now(), done: make(chan struct{})}
	go func() {
		t := time.NewTicker(500 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				l.mu.Lock()
				_ = l.w.Flush()
				l.mu.Unlock()
			case <-l.done:
				return
			}
		}
	}()
	return l, nil
}

func (l *tapLog) emit(kind string, f map[string]any) {
	now := time.Now()
	var b strings.Builder
	b.WriteString(`{"t":"` + now.Format(time.RFC3339Nano) + `","t_ms":`)
	tms, _ := json.Marshal(round3(ms(now.Sub(l.start))))
	b.Write(tms)
	kb, _ := json.Marshal(kind)
	b.WriteString(`,"kind":` + string(kb))
	keys := make([]string, 0, len(f))
	for k := range f {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		kj, _ := json.Marshal(k)
		vj, err := json.Marshal(f[k])
		if err != nil {
			vj, _ = json.Marshal(fmt.Sprint(f[k]))
		}
		b.WriteString(",")
		b.Write(kj)
		b.WriteString(":")
		b.Write(vj)
	}
	b.WriteString("}\n")
	l.mu.Lock()
	_, _ = l.w.WriteString(b.String())
	l.events = append(l.events, tapEvent{T: now, Kind: kind, F: f})
	l.mu.Unlock()
}

func (l *tapLog) close() {
	close(l.done)
	l.mu.Lock()
	defer l.mu.Unlock()
	_ = l.w.Flush()
	_ = l.f.Close()
}

// ---------------------------------------------------------------------------------------------------------------
// tracked connections
// ---------------------------------------------------------------------------------------------------------------

type tconn struct {
	net.Conn
	id        int64
	side      string // "down": plugin to tap; "up": tap to API server
	tp        *tap
	opened    time.Time
	rd, wr    atomic.Int64
	dropped   atomic.Int64
	closedBy  atomic.Value // string
	closeOnce sync.Once
}

func (c *tconn) Write(p []byte) (int, error) {
	if c.tp.blackhole.Load() {
		c.dropped.Add(int64(len(p)))
		return len(p), nil
	}
	n, err := c.Conn.Write(p)
	c.wr.Add(int64(n))
	return n, err
}

func (c *tconn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	c.rd.Add(int64(n))
	return n, err
}

func (c *tconn) Close() error {
	var err error
	c.closeOnce.Do(func() {
		err = c.Conn.Close()
		by, _ := c.closedBy.Load().(string)
		if by == "" {
			by = "local-close"
		}
		c.tp.log.emit("conn_close", map[string]any{"conn": c.id, "side": c.side, "closed_by": by, "bytes_read": c.rd.Load(),
			"bytes_written": c.wr.Load(), "bytes_dropped_by_blackhole": c.dropped.Load(), "lifetime_ms": ms(time.Since(c.opened))})
	})
	return err
}

func (c *tconn) tcp() *net.TCPConn {
	t, _ := c.Conn.(*net.TCPConn)
	return t
}

func (c *tconn) rst() {
	c.closedBy.Store("tap-rst")
	if t := c.tcp(); t != nil {
		_ = t.SetLinger(0)
	}
	_ = c.Close()
}

func (c *tconn) fin() {
	c.closedBy.Store("tap-fin")
	if t := c.tcp(); t != nil {
		_ = t.CloseWrite()
	}
	time.AfterFunc(3*time.Second, func() { _ = c.Close() })
}

type trackListener struct {
	net.Listener
	tp *tap
}

func (l *trackListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return l.tp.track(c, "down"), nil
}

// ---------------------------------------------------------------------------------------------------------------
// the tap
// ---------------------------------------------------------------------------------------------------------------

type statusMsg struct {
	TMs      float64 `json:"t_ms"`
	Raw      string  `json:"raw"`
	Status   string  `json:"status"`
	Reason   string  `json:"reason,omitempty"`
	Message  string  `json:"message,omitempty"`
	ExitCode *int    `json:"exit_code,omitempty"`
}

type closeFrame struct {
	Code int     `json:"code"`
	Text string  `json:"text"`
	TMs  float64 `json:"t_ms"`
}

// wsRec is what the tap saw of one WebSocket exec/attach connection.
type wsRec struct {
	ID       int64
	Path     string
	Query    string
	Offered  []string
	Selected string
	Start    time.Time

	mu          sync.Mutex
	End         time.Time
	Status      []statusMsg
	ClientClose *closeFrame // a Close frame the plugin sent
	ServerClose *closeFrame // a Close frame the API server sent
	EndedBy     string
	Errs        []string
	C2SMsgs     int
	S2CMsgs     int
	C2SBytes    int64
	S2CBytes    int64
	ChMsgs      map[string]int // "s2c:1": n
	ChBytes     map[string]int64
	Pings       map[string]int // "c2s", "s2c"
	Pongs       map[string]int
	UpConn      int64
	DownConn    int64
	DialStatus  int
	DialBody    string
	endOnce     sync.Once
	finished    chan struct{}
}

// StatusView is the tap's reading of the status channel: what the API server really put there.
func (w *wsRec) StatusView() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.Status) == 0 {
		return "nothing on the status channel"
	}
	var parts []string
	for _, s := range w.Status {
		switch {
		case s.Status == "Success":
			parts = append(parts, "Success")
		case s.ExitCode != nil:
			parts = append(parts, fmt.Sprintf("Failure, exit code %d (%s)", *s.ExitCode, s.Reason))
		default:
			parts = append(parts, fmt.Sprintf("Failure: %q (reason %s)", s.Message, s.Reason))
		}
	}
	return strings.Join(parts, "; ")
}

// CloseView is the tap's reading of how the API-server leg ended.
func (w *wsRec) CloseView() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	var parts []string
	if w.ServerClose != nil {
		parts = append(parts, fmt.Sprintf("API server sent Close frame code=%d text=%q", w.ServerClose.Code, w.ServerClose.Text))
	}
	if w.ClientClose != nil {
		parts = append(parts, fmt.Sprintf("plugin sent Close frame code=%d text=%q", w.ClientClose.Code, w.ClientClose.Text))
	}
	parts = append(parts, "ended by: "+w.EndedBy)
	return strings.Join(parts, "; ")
}

type tap struct {
	URL      string
	Port     int
	log      *tapLog
	upstream *url.URL

	tlsCfg    *tls.Config
	transport *http.Transport
	dialer    *websocket.Dialer
	server    *http.Server
	rp        *httputil.ReverseProxy

	blackhole atomic.Bool
	// sampleData logs only the first 8 and then every 64th message of channels 1 and 2 (the data); control messages are
	// always logged. A flood logs 2,000+ messages per run; the sample keeps the logging cost out of a throughput number.
	sampleData atomic.Bool

	mu       sync.Mutex
	conns    map[int64]*tconn
	nextConn int64
	nextWS   int64
	nextReq  int64
	ws       []*wsRec
}

func startTap(upstreamKubeconfig, logPath string) (*tap, error) {
	cfg, err := clientcmd.BuildConfigFromFlags("", upstreamKubeconfig)
	if err != nil {
		return nil, err
	}
	tlsCfg, err := rest.TLSConfigFor(cfg)
	if err != nil {
		return nil, err
	}
	if tlsCfg == nil {
		return nil, errors.New("upstream kubeconfig has no TLS configuration")
	}
	tlsCfg = tlsCfg.Clone()
	tlsCfg.NextProtos = []string{"http/1.1"}
	upstream, err := url.Parse(cfg.Host)
	if err != nil {
		return nil, err
	}
	lg, err := newTapLog(logPath)
	if err != nil {
		return nil, err
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	t := &tap{log: lg, upstream: upstream, tlsCfg: tlsCfg, conns: map[int64]*tconn{}}
	t.Port = l.Addr().(*net.TCPAddr).Port
	t.URL = "http://" + net.JoinHostPort("127.0.0.1", strconv.Itoa(t.Port))
	t.transport = &http.Transport{
		DialContext:        t.dial,
		TLSClientConfig:    tlsCfg,
		ForceAttemptHTTP2:  false,
		TLSNextProto:       map[string]func(string, *tls.Conn) http.RoundTripper{}, // no HTTP/2 toward the API server
		DisableCompression: true,
		MaxIdleConns:       32,
		IdleConnTimeout:    60 * time.Second,
	}
	t.dialer = &websocket.Dialer{NetDialContext: t.dial, TLSClientConfig: tlsCfg, HandshakeTimeout: 30 * time.Second,
		ReadBufferSize: 64 << 10, WriteBufferSize: 64 << 10}
	t.rp = &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(upstream)
			r.Out.Header.Del("Authorization")
		},
		Transport:     t.transport,
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			t.log.emit("http_proxy_error", map[string]any{"method": r.Method, "path": r.URL.Path, "error": err.Error()})
			w.WriteHeader(http.StatusBadGateway)
		},
	}
	t.server = &http.Server{Handler: http.HandlerFunc(t.handle)}
	go func() { _ = t.server.Serve(&trackListener{Listener: l, tp: t}) }()
	t.log.emit("tap_start", map[string]any{"url": t.URL, "upstream": cfg.Host})
	return t, nil
}

func (t *tap) track(c net.Conn, side string) *tconn {
	t.mu.Lock()
	t.nextConn++
	tc := &tconn{Conn: c, id: t.nextConn, side: side, tp: t, opened: time.Now()}
	t.conns[tc.id] = tc
	t.mu.Unlock()
	t.log.emit("conn_open", map[string]any{"conn": tc.id, "side": side, "remote": c.RemoteAddr().String()})
	return tc
}

func (t *tap) dial(ctx context.Context, network, addr string) (net.Conn, error) {
	d := net.Dialer{Timeout: 10 * time.Second}
	c, err := d.DialContext(ctx, network, addr)
	if err != nil {
		t.log.emit("dial_error", map[string]any{"addr": addr, "error": err.Error()})
		return nil, err
	}
	return t.track(c, "up"), nil
}

// writeKubeconfig writes a kubeconfig with one context named contextName that points at the tap.
func (t *tap) writeKubeconfig(path, contextName string) error {
	return os.WriteFile(path, []byte(fmt.Sprintf(`apiVersion: v1
kind: Config
clusters:
- name: %[1]s
  cluster: {server: %[2]s}
users:
- name: %[1]s
  user: {token: unused}
contexts:
- name: %[1]s
  context: {cluster: %[1]s, user: %[1]s}
current-context: %[1]s
`, contextName, t.URL)), 0o600)
}

func (t *tap) liveConns() []*tconn {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]*tconn, 0, len(t.conns))
	for _, c := range t.conns {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].id < out[j].id })
	return out
}

// fault applies "fin" or "rst" to every connection the tap holds, or turns the blackhole on or off ("blackhole",
// "passthrough"). It returns the connection ids it touched.
func (t *tap) fault(kind string) []int64 {
	var ids []int64
	switch kind {
	case "blackhole":
		t.blackhole.Store(true)
		for _, c := range t.liveConns() {
			ids = append(ids, c.id)
		}
	case "passthrough":
		t.blackhole.Store(false)
	case "fin", "rst":
		for _, c := range t.liveConns() {
			if kind == "fin" {
				c.fin()
			} else {
				c.rst()
			}
			ids = append(ids, c.id)
		}
	}
	t.log.emit("fault", map[string]any{"fault": kind, "conns": ids})
	return ids
}

func (t *tap) wsSince(mark int) []*wsRec {
	t.mu.Lock()
	defer t.mu.Unlock()
	if mark > len(t.ws) {
		mark = len(t.ws)
	}
	return append([]*wsRec(nil), t.ws[mark:]...)
}

func (t *tap) wsMark() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.ws)
}

func (t *tap) close() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = t.server.Shutdown(ctx)
	_ = t.server.Close()
	for _, c := range t.liveConns() {
		_ = c.Close()
	}
	t.log.emit("tap_stop", nil)
	t.log.close()
}

// ---------------------------------------------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------------------------------------------

func isExecWS(r *http.Request) bool {
	return websocket.IsWebSocketUpgrade(r) && (strings.HasSuffix(r.URL.Path, "/exec") || strings.HasSuffix(r.URL.Path, "/attach"))
}

func (t *tap) handle(w http.ResponseWriter, r *http.Request) {
	if isExecWS(r) {
		t.handleWS(w, r)
		return
	}
	t.handlePlain(w, r)
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (t *tap) handlePlain(w http.ResponseWriter, r *http.Request) {
	t.mu.Lock()
	t.nextReq++
	id := t.nextReq
	t.mu.Unlock()
	start := time.Now()
	upgrade := r.Header.Get("Upgrade")
	t.log.emit("http_req", map[string]any{"req": id, "method": r.Method, "path": r.URL.Path, "query": r.URL.RawQuery, "upgrade": upgrade,
		"subprotocols": r.Header.Values("X-Stream-Protocol-Version")})
	sw := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
	t.rp.ServeHTTP(sw, r)
	t.log.emit("http_done", map[string]any{"req": id, "method": r.Method, "path": r.URL.Path, "status": sw.status, "upgrade": upgrade, "duration_ms": ms(time.Since(start))})
}

var hopByHop = map[string]bool{"Connection": true, "Upgrade": true, "Sec-Websocket-Key": true, "Sec-Websocket-Version": true,
	"Sec-Websocket-Extensions": true, "Sec-Websocket-Protocol": true, "Sec-Websocket-Accept": true, "Host": true, "Authorization": true,
	"Keep-Alive": true, "Proxy-Connection": true, "Te": true, "Trailer": true, "Transfer-Encoding": true}

func forwardHeaders(r *http.Request) http.Header {
	h := http.Header{}
	for k, vs := range r.Header {
		if hopByHop[http.CanonicalHeaderKey(k)] {
			continue
		}
		for _, v := range vs {
			h.Add(k, v)
		}
	}
	return h
}

func (t *tap) handleWS(w http.ResponseWriter, r *http.Request) {
	t.mu.Lock()
	t.nextWS++
	rec := &wsRec{ID: t.nextWS, Path: r.URL.Path, Query: r.URL.RawQuery, Offered: websocket.Subprotocols(r), Start: time.Now(),
		ChMsgs: map[string]int{}, ChBytes: map[string]int64{}, Pings: map[string]int{}, Pongs: map[string]int{}, finished: make(chan struct{})}
	t.ws = append(t.ws, rec)
	t.mu.Unlock()
	t.log.emit("ws_request", map[string]any{"ws": rec.ID, "path": rec.Path, "query": rec.Query, "offered": rec.Offered})

	u := *t.upstream
	u.Scheme = "wss"
	u.Path, u.RawQuery = r.URL.Path, r.URL.RawQuery
	d := *t.dialer
	d.Subprotocols = rec.Offered
	up, resp, err := d.DialContext(r.Context(), u.String(), forwardHeaders(r))
	if err != nil {
		f := map[string]any{"ws": rec.ID, "error": err.Error()}
		if resp != nil {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
			_ = resp.Body.Close()
			rec.DialStatus, rec.DialBody = resp.StatusCode, string(body)
			f["status"], f["body"] = resp.StatusCode, string(body)
			t.log.emit("ws_dial_failed", f)
			rec.finish(t, "upstream refused the upgrade: "+resp.Status)
			for k, vs := range resp.Header {
				if hopByHop[http.CanonicalHeaderKey(k)] {
					continue
				}
				for _, v := range vs {
					w.Header().Add(k, v)
				}
			}
			w.WriteHeader(resp.StatusCode)
			_, _ = w.Write(body)
			return
		}
		t.log.emit("ws_dial_failed", f)
		rec.finish(t, "upstream dial failed: "+err.Error())
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if tc, ok := up.UnderlyingConn().(*tconn); ok {
		rec.UpConn = tc.id
	} else if tlsc, ok := up.UnderlyingConn().(*tls.Conn); ok {
		if tc, ok := tlsc.NetConn().(*tconn); ok {
			rec.UpConn = tc.id
		}
	}
	rec.Selected = up.Subprotocol()
	var sub []string
	if rec.Selected != "" {
		sub = []string{rec.Selected}
	}
	upg := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }, Subprotocols: sub, ReadBufferSize: 64 << 10, WriteBufferSize: 64 << 10}
	cc, err := upg.Upgrade(w, r, nil)
	if err != nil {
		t.log.emit("ws_client_upgrade_failed", map[string]any{"ws": rec.ID, "error": err.Error()})
		_ = up.UnderlyingConn().Close()
		rec.finish(t, "client upgrade failed: "+err.Error())
		return
	}
	if tc, ok := cc.UnderlyingConn().(*tconn); ok {
		rec.DownConn = tc.id
	}
	t.log.emit("ws_open", map[string]any{"ws": rec.ID, "subprotocol": rec.Selected, "up_conn": rec.UpConn, "down_conn": rec.DownConn, "upstream_status": resp.StatusCode})

	deadline := func() time.Time { return time.Now().Add(5 * time.Second) }
	closeHandler := func(dir string, dst *websocket.Conn) func(int, string) error {
		return func(code int, text string) error {
			cf := &closeFrame{Code: code, Text: text, TMs: ms(time.Since(rec.Start))}
			rec.mu.Lock()
			if dir == "s2c" {
				rec.ServerClose = cf
			} else {
				rec.ClientClose = cf
			}
			rec.mu.Unlock()
			t.log.emit("ws_close_frame", map[string]any{"ws": rec.ID, "dir": dir, "code": code, "text": text, "from": map[string]string{"s2c": "API server", "c2s": "plugin"}[dir]})
			_ = dst.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(code, text), deadline())
			return nil
		}
	}
	pingHandler := func(dir string, dst *websocket.Conn) func(string) error {
		return func(app string) error {
			rec.mu.Lock()
			rec.Pings[dir]++
			n := rec.Pings[dir]
			rec.mu.Unlock()
			if n <= 3 || n%20 == 0 {
				t.log.emit("ws_ping", map[string]any{"ws": rec.ID, "dir": dir, "n": n, "len": len(app)})
			}
			_ = dst.WriteControl(websocket.PingMessage, []byte(app), deadline())
			return nil
		}
	}
	pongHandler := func(dir string, dst *websocket.Conn) func(string) error {
		return func(app string) error {
			rec.mu.Lock()
			rec.Pongs[dir]++
			n := rec.Pongs[dir]
			rec.mu.Unlock()
			if n <= 3 || n%20 == 0 {
				t.log.emit("ws_pong", map[string]any{"ws": rec.ID, "dir": dir, "n": n, "len": len(app)})
			}
			_ = dst.WriteControl(websocket.PongMessage, []byte(app), deadline())
			return nil
		}
	}
	cc.SetCloseHandler(closeHandler("c2s", up))
	up.SetCloseHandler(closeHandler("s2c", cc))
	cc.SetPingHandler(pingHandler("c2s", up))
	up.SetPingHandler(pingHandler("s2c", cc))
	cc.SetPongHandler(pongHandler("c2s", up))
	up.SetPongHandler(pongHandler("s2c", cc))

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); t.pump(rec, cc, up, "c2s") }()
	go func() { defer wg.Done(); t.pump(rec, up, cc, "s2c") }()
	wg.Wait()
	_ = cc.UnderlyingConn().Close()
	_ = up.UnderlyingConn().Close()
	rec.finish(t, "")
}

func (w *wsRec) finish(t *tap, why string) {
	w.endOnce.Do(func() {
		w.mu.Lock()
		w.End = time.Now()
		if w.EndedBy == "" {
			w.EndedBy = why
		}
		f := map[string]any{"ws": w.ID, "ended_by": w.EndedBy, "duration_ms": ms(w.End.Sub(w.Start)), "status_view": "", "c2s_msgs": w.C2SMsgs, "s2c_msgs": w.S2CMsgs,
			"c2s_bytes": w.C2SBytes, "s2c_bytes": w.S2CBytes, "channel_msgs": w.ChMsgs, "channel_bytes": w.ChBytes, "pings": w.Pings, "pongs": w.Pongs,
			"errors": w.Errs}
		if w.ServerClose != nil {
			f["server_close"] = w.ServerClose
		}
		if w.ClientClose != nil {
			f["client_close"] = w.ClientClose
		}
		w.mu.Unlock()
		f["status_view"] = w.StatusView()
		t.log.emit("ws_end", f)
		close(w.finished)
	})
}

// pump copies messages from src to dst until src fails; how src failed decides how dst is told.
func (t *tap) pump(rec *wsRec, src, dst *websocket.Conn, dir string) {
	for {
		mt, data, err := src.ReadMessage()
		now := time.Now()
		if err != nil {
			t.pumpEnd(rec, src, dst, dir, err)
			return
		}
		t.logMessage(rec, dir, mt, data, now)
		if werr := dst.WriteMessage(mt, data); werr != nil {
			t.log.emit("ws_write_error", map[string]any{"ws": rec.ID, "dir": dir, "error": werr.Error()})
			rec.mu.Lock()
			rec.Errs = append(rec.Errs, dir+" write: "+werr.Error())
			rec.mu.Unlock()
			t.pumpEnd(rec, src, dst, dir, werr)
			return
		}
	}
}

func srcName(dir string) string {
	if dir == "s2c" {
		return "API server"
	}
	return "plugin"
}

// pumpEnd is what the tap does when the leg it reads from ended: a Close frame was already forwarded by the close
// handler, so the other leg is given a moment to echo it; anything else (EOF, reset, timeout) is passed on to the other
// leg the same way (RST for a reset, a bare close otherwise): the plugin sees what the API server did.
func (t *tap) pumpEnd(rec *wsRec, src, dst *websocket.Conn, dir string, err error) {
	var ce *websocket.CloseError
	f := map[string]any{"ws": rec.ID, "dir": dir, "from": srcName(dir), "error": err.Error(), "go_type": fmt.Sprintf("%T", err)}
	by := fmt.Sprintf("%s: %s", srcName(dir), err.Error())
	injected := ""
	for _, c := range []*websocket.Conn{src, dst} {
		if tc := asTconn(c.UnderlyingConn()); tc != nil && injected == "" {
			if cb, _ := tc.closedBy.Load().(string); cb != "" {
				injected = cb
			}
		}
	}
	if errors.Is(err, net.ErrClosed) && injected == "" {
		// this leg was closed by the tap itself after the other leg ended: not the cause of the end
		f["how"] = "leg closed locally by the tap as a consequence of the other leg ending"
		t.log.emit("ws_read_end", f)
		return
	}
	switch {
	case errors.As(err, &ce) && ce.Code != websocket.CloseAbnormalClosure:
		f["how"] = "close frame, forwarded"
		by = fmt.Sprintf("%s Close frame (code %d)", srcName(dir), ce.Code)
		// the echo comes back on the other pump; give it up to 3 s, then close both legs
		time.AfterFunc(3*time.Second, func() { _ = dst.UnderlyingConn().Close(); _ = src.UnderlyingConn().Close() })
	default:
		reset := errors.Is(err, syscall.ECONNRESET)
		switch {
		case injected != "":
			f["how"] = "connection closed by the tap's fault injection: " + injected
			by = "connection closed by the tap's fault injection (" + injected + ")"
		case reset:
			f["how"] = "connection reset, passed on as RST"
			by = srcName(dir) + " connection reset"
		default:
			f["how"] = "connection ended without a Close frame (" + err.Error() + "), passed on as a bare close"
			by = srcName(dir) + " connection ended without a Close frame: " + err.Error()
		}
		if tc := asTconn(dst.UnderlyingConn()); tc != nil && !t.blackhole.Load() && injected == "" {
			if reset {
				tc.rst()
			} else {
				_ = tc.Close()
			}
		} else {
			_ = dst.UnderlyingConn().Close()
		}
		_ = src.UnderlyingConn().Close()
	}
	t.log.emit("ws_read_end", f)
	rec.mu.Lock()
	if rec.EndedBy == "" {
		rec.EndedBy = by
	}
	rec.mu.Unlock()
}

func asTconn(c net.Conn) *tconn {
	switch v := c.(type) {
	case *tconn:
		return v
	case *tls.Conn:
		if tc, ok := v.NetConn().(*tconn); ok {
			return tc
		}
	}
	return nil
}

func (t *tap) logMessage(rec *wsRec, dir string, mt int, data []byte, now time.Time) {
	f := map[string]any{"ws": rec.ID, "dir": dir, "msg_type": mt, "len": len(data)}
	logIt := true
	rec.mu.Lock()
	if dir == "c2s" {
		rec.C2SMsgs++
		rec.C2SBytes += int64(len(data))
	} else {
		rec.S2CMsgs++
		rec.S2CBytes += int64(len(data))
	}
	if mt == websocket.BinaryMessage && len(data) > 0 {
		ch := data[0]
		key := fmt.Sprintf("%s:%d", dir, ch)
		rec.ChMsgs[key]++
		rec.ChBytes[key] += int64(len(data) - 1)
		n := rec.ChMsgs[key]
		f["channel"] = ch
		f["payload_len"] = len(data) - 1
		switch ch {
		case 1, 2:
			if t.sampleData.Load() && n > 8 && n%64 != 0 {
				logIt = false
			}
			f["head"] = head(data[1:], 48)
		case 0:
			f["head"] = head(data[1:], 48)
		case 3:
			txt := string(data[1:])
			if len(txt) > 8192 {
				txt = txt[:8192]
			}
			f["status_text"] = txt
			sm := parseStatus(txt)
			sm.TMs = ms(now.Sub(rec.Start))
			rec.Status = append(rec.Status, sm)
		case 4:
			f["resize_text"] = string(data[1:])
		case 255:
			f["close_signal_for_channel"] = fmt.Sprint([]byte(data[1:]))
		}
	}
	rec.mu.Unlock()
	if logIt {
		t.log.emit("ws_msg", f)
	}
}

func parseStatus(txt string) statusMsg {
	sm := statusMsg{Raw: txt, Status: "unparsed"}
	var st struct {
		Status  string `json:"status"`
		Reason  string `json:"reason"`
		Message string `json:"message"`
		Details struct {
			Causes []struct {
				Reason  string `json:"reason"`
				Message string `json:"message"`
			} `json:"causes"`
		} `json:"details"`
	}
	if err := json.Unmarshal([]byte(txt), &st); err != nil {
		return sm
	}
	sm.Status, sm.Reason, sm.Message = st.Status, st.Reason, st.Message
	for _, c := range st.Details.Causes {
		if c.Reason == "ExitCode" {
			var n int
			if _, err := fmt.Sscanf(c.Message, "%d", &n); err == nil {
				sm.ExitCode = &n
			}
		}
	}
	return sm
}
