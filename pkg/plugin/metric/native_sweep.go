package metric

import (
	"context"
	"errors"
	"io"
	"sync"

	"github.com/omniview/kubernetes/pkg/diag"
)

// nativeParallelism is how many namespace lists one query keeps in flight.
const nativeParallelism = 4

// nativeNamespaceScan is one namespace's share of a query: the targets to join,
// and what became of reading it.
type nativeNamespaceScan struct {
	namespace  string
	indices    map[string]int // Target index by Pod name.
	key        nativeScanKey
	seen       map[string]bool
	duplicates map[string]bool

	// Written by the sweep, read once it has returned.
	reached bool  // The sweep got to it before the deadline.
	scanned bool  // It was read, rather than answered from the failure cache.
	err     error // Why it has no complete answer, if it has none.
}

// sweep reads each scan's namespace in order, keeping up to p.parallel in
// flight. read lists the namespace and joins what it finds to the query's
// targets; reads of different namespaces run at the same time, so it must touch
// nothing but that namespace's targets. A namespace the failure cache answers is
// not read. sweep returns how many scans it did not reach because ctx ended, and
// has stopped every read by then.
//
// A read reserves its first page before the next one is dispatched, so a page
// budget too small for every namespace is spent in the order of the sweep, which
// rotates from query to query.
//
// With probing set, the first namespace that needs a request is read alone: a
// missing API is then found out by one request, not by every request in flight,
// and the failure it records stops the rest.
func (p *nativeProvider) sweep(ctx context.Context, lane *nativeLane, scans []*nativeNamespaceScan, probing bool, fetch nativeFetch,
	read func(context.Context, *nativeNamespaceScan, nativeFetch) error, timedOut func() bool) (unreached int) {
	var running sync.WaitGroup
	// A panic in a read belongs to the caller of the query, whose handler is
	// protected from it; a goroutine of its own would take the process down.
	var crash crashed
	defer crash.rethrow()
	defer running.Wait()
	slots := make(chan struct{}, max(p.parallel, 1))
	for offset, scan := range scans {
		if ctx.Err() != nil {
			return len(scans) - offset
		}
		acquired := false
		select {
		case slots <- struct{}{}:
			acquired = true
		case <-ctx.Done():
		}
		// A slot that came free because the deadline cancelled the reads holding
		// it is not an invitation to start another.
		if ctx.Err() != nil {
			if acquired {
				<-slots
			}
			return len(scans) - offset
		}
		scan.reached = true
		// Asked with a slot in hand, so that a failure found while waiting for
		// one is honored.
		if scan.err = p.scanFailure(lane, scan.key); scan.err != nil {
			<-slots
			continue
		}
		scan.scanned = true
		reserved, finished := make(chan struct{}), make(chan struct{})
		var reserve sync.Once
		reserveNow := func() { reserve.Do(func() { close(reserved) }) }
		running.Add(1)
		go func() {
			defer running.Done()
			defer func() { <-slots }()
			defer close(finished)
			defer reserveNow()
			defer crash.catch()
			err := read(ctx, scan, func(ctx context.Context, operation diag.ScanOperation, path, selector, continuation string) (io.ReadCloser, error) {
				// Taking the first page comes before the first request.
				reserveNow()
				return fetch(ctx, operation, path, selector, continuation)
			})
			switch {
			case err == nil:
				p.clearScanFailure(lane, scan.key)
			case ctx.Err() != nil && !timedOut():
				// The caller left or the source was retired: the query returns
				// the error, and the namespace did nothing wrong.
			default:
				if ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) {
					// Whatever the interrupted request reported, only the timeout matters.
					err = context.DeadlineExceeded
				}
				p.recordScanFailure(lane, scan.key, err)
			}
			scan.err = err
		}()
		select {
		case <-reserved:
		case <-ctx.Done():
		}
		if probing {
			select {
			case <-finished:
			case <-ctx.Done():
			}
			probing = false
		}
	}
	return 0
}

// crashed holds the first panic of a set of goroutines, for their parent to raise.
type crashed struct {
	mu    sync.Mutex
	value any
}

// catch is deferred by each goroutine to keep its panic from ending the process.
func (c *crashed) catch() {
	if value := recover(); value != nil {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.value == nil {
			c.value = value
		}
	}
}

// rethrow raises the panic, if there was one, in the calling goroutine.
func (c *crashed) rethrow() {
	c.mu.Lock()
	value := c.value
	c.mu.Unlock()
	if value != nil {
		panic(value)
	}
}
