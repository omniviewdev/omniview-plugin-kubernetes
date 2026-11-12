package metric

import (
	"bytes"
	"context"
	"errors"
	"io"
	"sync"

	"github.com/omniview/kubernetes/pkg/diag"
	"k8s.io/client-go/rest"
)

var errNativeFlightPanicked = errors.New("list request did not return")

// nativeFlightKey names one list request: the same source generation asking for
// the same path, selector and continuation is asking for the same answer.
type nativeFlightKey struct {
	lane         string
	path         string
	selector     string
	continuation string
}

// nativeFlight is a list request in progress. Its fields are written by the
// request's leader before done closes and read by waiters after.
type nativeFlight struct {
	done chan struct{}
	page []byte
	err  error
	// abandoned means the leader's own context ended the request. That says
	// nothing about the cluster, so a waiter whose context is alive asks again.
	abandoned bool
}

// nativeFlights shares identical list requests that are in flight at the same
// time, whichever query made them. Only the request is shared: a response is
// forgotten as soon as it has been handed to the queries waiting on it, so
// nothing here is a metric cache.
type nativeFlights struct {
	mu    sync.Mutex
	calls map[nativeFlightKey]*nativeFlight
}

// do returns the response to the request named by key. The first caller makes
// the request with run, in its own goroutine and under its own context; callers
// that arrive while it is in flight wait for that answer instead, and stop
// waiting when their own context ends.
func (f *nativeFlights) do(ctx context.Context, key nativeFlightKey, run func(context.Context) ([]byte, error)) ([]byte, error) {
	for {
		f.mu.Lock()
		call, shared := f.calls[key]
		if !shared {
			call = &nativeFlight{done: make(chan struct{})}
			if f.calls == nil {
				f.calls = make(map[nativeFlightKey]*nativeFlight)
			}
			f.calls[key] = call
		}
		f.mu.Unlock()

		if !shared {
			return f.lead(ctx, key, call, run)
		}
		select {
		case <-call.done:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		if !call.abandoned || ctx.Err() != nil {
			return call.page, call.err
		}
	}
}

// lead makes the request for call and wakes the callers waiting on it. A request
// that panics still wakes them, so that they ask again, instead of leaving a call
// that nothing will ever finish for every later caller to join.
func (f *nativeFlights) lead(ctx context.Context, key nativeFlightKey, call *nativeFlight, run func(context.Context) ([]byte, error)) ([]byte, error) {
	returned := false
	defer func() {
		if !returned {
			call.err, call.abandoned = errNativeFlightPanicked, true
		}
		f.mu.Lock()
		delete(f.calls, key)
		f.mu.Unlock()
		close(call.done)
	}()
	call.page, call.err = run(ctx)
	call.abandoned = call.err != nil && ctx.Err() != nil
	returned = true
	return call.page, call.err
}

// fetcher lists through the lane's client. Identical requests in flight at the
// same time are made once and the response is shared by the queries waiting for
// it. A response is read in full, up to one byte more than the byte budget so
// that a reader can tell a body that fits from one that does not, and each query
// then decodes it against its own budget.
func (p *nativeProvider) fetcher(lane *nativeLane, client rest.Interface) nativeFetch {
	direct := restFetch(client)
	return func(ctx context.Context, operation diag.ScanOperation, path, selector, continuation string) (io.ReadCloser, error) {
		key := nativeFlightKey{lane: lane.key, path: path, selector: selector, continuation: continuation}
		page, err := p.flights.do(ctx, key, func(ctx context.Context) ([]byte, error) {
			body, err := direct(ctx, operation, path, selector, continuation)
			if err != nil {
				return nil, err
			}
			defer body.Close()
			return io.ReadAll(io.LimitReader(body, nativeMaxBytes+1))
		})
		if err != nil {
			return nil, err
		}
		return io.NopCloser(bytes.NewReader(page)), nil
	}
}
