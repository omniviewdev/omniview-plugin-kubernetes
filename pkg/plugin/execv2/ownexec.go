package execv2

// Spike experiment for the K-proof, not part of the provider: an executor that speaks the WebSocket v5 channel protocol
// itself, so that it can read the status channel that client-go folds into a nil error. Selected by KPROOF_EXECUTOR=own.
// It answers the tag-gate question "can a Kubernetes provider tell a Success status from an empty status channel".

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	gwebsocket "github.com/gorilla/websocket"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/remotecommand"
	clientremotecommand "k8s.io/client-go/tools/remotecommand"
	"k8s.io/client-go/transport/websocket"
	utilexec "k8s.io/client-go/util/exec"

	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// errSuccess is what the own executor returns for a Success status on the error channel: a nil return is kept for a channel
// that closed empty, which is what client-go cannot tell it from.
var errSuccess = errors.New("the error channel reported Success")

func init() {
	if os.Getenv("KPROOF_EXECUTOR") != "own" {
		return
	}
	newExecutors = func(p *exec.Proc) (clientremotecommand.Executor, clientremotecommand.Executor, error) {
		config, u, err := execRequest(p)
		if err != nil {
			return nil, nil, err
		}
		spdy, err := clientremotecommand.NewSPDYExecutor(config, "POST", u)
		if err != nil {
			return nil, nil, err
		}
		rt, holder, err := websocket.RoundTripperFor(config)
		return &statusExecutor{rt: rt, holder: holder, url: u.String()}, spdy, err
	}
}

// The channels of the v5 protocol, the heartbeat client-go keeps, and the close signal.
const (
	channelStdin, channelStdout, channelStderr, channelError, channelResize = 0, 1, 2, 3, 4
	heartbeat                                                               = 5 * time.Second
	readDeadline                                                            = 12*heartbeat + time.Second
)

type statusExecutor struct {
	rt     http.RoundTripper
	holder websocket.ConnectionHolder
	url    string
}

func (e *statusExecutor) Stream(opts clientremotecommand.StreamOptions) error {
	return e.StreamWithContext(context.Background(), opts)
}

func (e *statusExecutor) StreamWithContext(ctx context.Context, opts clientremotecommand.StreamOptions) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, e.url, nil)
	if err != nil {
		return err
	}
	conn, err := websocket.Negotiate(e.rt, e.holder, req, remotecommand.StreamProtocolV5Name)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	done := make(chan struct{})
	defer close(done)
	var writing sync.Mutex
	write := func(message []byte) error {
		writing.Lock()
		defer writing.Unlock()
		return conn.WriteMessage(gwebsocket.BinaryMessage, message)
	}
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-done:
		}
	}()
	_ = conn.SetReadDeadline(time.Now().Add(readDeadline))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(readDeadline)) })
	go func() {
		ticker := time.NewTicker(heartbeat)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				_ = conn.WriteControl(gwebsocket.PingMessage, nil, time.Now().Add(readDeadline))
			case <-done:
				return
			}
		}
	}()
	if opts.Stdin != nil {
		go func() {
			buf := make([]byte, 32*1024+1)
			buf[0] = channelStdin
			for {
				n, err := opts.Stdin.Read(buf[1:])
				if n > 0 && write(buf[:1+n]) != nil {
					return
				}
				if err != nil {
					_ = write([]byte{remotecommand.StreamClose, channelStdin}) // stdin EOF
					return
				}
			}
		}()
	}
	if opts.TerminalSizeQueue != nil {
		go func() {
			for size := opts.TerminalSizeQueue.Next(); size != nil; size = opts.TerminalSizeQueue.Next() {
				data, _ := json.Marshal(size)
				if write(append([]byte{channelResize}, data...)) != nil {
					return
				}
			}
		}()
	}

	var status []byte
	for {
		kind, message, err := conn.ReadMessage()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			var closed *gwebsocket.CloseError
			normal := errors.As(err, &closed) && closed.Code == gwebsocket.CloseNormalClosure
			traceLine(map[string]any{"event": "status-channel", "status": string(status), "read_err": err.Error(), "normal_close": normal})
			switch {
			case len(status) > 0:
				return decodeStatus(status)
			case normal:
				return nil
			}
			return fmt.Errorf("next reader: %w", err)
		}
		if kind != gwebsocket.BinaryMessage || len(message) == 0 {
			continue
		}
		data := message[1:]
		switch message[0] {
		case channelStdout:
			if opts.Stdout != nil && len(data) > 0 {
				_, _ = opts.Stdout.Write(data)
			}
		case channelStderr:
			if opts.Stderr != nil && len(data) > 0 {
				_, _ = opts.Stderr.Write(data)
			}
		case channelError:
			status = append(status, data...)
		}
	}
}

// decodeStatus reads the status of the error channel the way client-go does, and keeps a Success apart from a nil.
func decodeStatus(raw []byte) error {
	var status metav1.Status
	if err := json.Unmarshal(raw, &status); err != nil {
		return fmt.Errorf("error stream protocol error: %v in %q", err, raw)
	}
	switch {
	case status.Status == metav1.StatusSuccess:
		return errSuccess
	case status.Status == metav1.StatusFailure && status.Reason == remotecommand.NonZeroExitCodeReason && status.Details != nil:
		for _, cause := range status.Details.Causes {
			if cause.Type != remotecommand.ExitCodeCauseType {
				continue
			}
			code, err := strconv.ParseUint(cause.Message, 10, 8)
			if err != nil {
				return fmt.Errorf("error stream protocol error: invalid exit code value %q", cause.Message)
			}
			return utilexec.CodeExitError{Err: fmt.Errorf("command terminated with exit code %d", code), Code: int(code)}
		}
	}
	return errors.New(status.Message)
}
