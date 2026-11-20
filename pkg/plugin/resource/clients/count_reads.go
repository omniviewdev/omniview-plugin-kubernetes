package clients

import (
	"context"
	"sync"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const (
	// CountStaleness is how old an answer a count read may repeat. A connection asks its API server about one kind in one scope at most once in this time; a sidebar that draws again does not ask again.
	// The count of a kind that a live source holds open is not read from an answer: it is the source's, as of now.
	CountStaleness = 30 * time.Second
	// CountConcurrency is how many count reads of a connection are asked of the API server at once. A sidebar asks about every kind it lists together, and they are asked a few at a time.
	CountConcurrency = 4
	// countKept is the most answers a connection keeps, and countKeptBytes the most record bytes of one. An answer holds one object; an object that is large is asked about again, not kept.
	// Reads that are being made are not answers: they never push an answer out.
	countKept      = 256
	countKeptBytes = 64 << 10
)

// CountReads makes the count reads of one connection: the reads of one object (a page of one) that tell how many objects a kind has in a scope, which a list of every kind asks for in one go.
// It runs at most CountConcurrency of them at a time, makes identical reads at the same time once, and keeps an answer for CountStaleness. A read that waits for its turn, or for the identical read in
// flight, stops waiting when its caller goes. An answer that failed is never kept. The pages it gives are the reader's own: the answers are kept as the wire holds them and made again for each reader.
type CountReads struct {
	now   func() time.Time
	slots chan struct{}

	mu    sync.Mutex
	reads map[string]*countRead
}

// countRead is the answer to one read, or the read that is making it. done closes when it is settled.
type countRead struct {
	done chan struct{}
	// restore makes a page of the answer. It is nil when the read failed or its answer is not kept.
	restore  func() (resourcev2.SourcePage, error)
	storedAt time.Time
}

func newCountReads(now func() time.Time) *CountReads {
	return &CountReads{now: now, slots: make(chan struct{}, CountConcurrency), reads: make(map[string]*countRead)}
}

// CountReads are the count reads of this connection. A connection whose clients are replaced or shut down (ShutdownInformers, and ResetInformerLifecycle once the clients are replaced) starts new ones:
// what the credentials it had were answered is never given to the credentials it has.
func (cs *ClientSet) CountReads() *CountReads {
	cs.informersMu.Lock()
	defer cs.informersMu.Unlock()
	if cs.counts == nil {
		cs.counts = newCountReads(time.Now)
	}
	return cs.counts
}

// Read gives the page of the count read named by key: the answer kept less than CountStaleness ago, else the answer of the identical read in flight, else the answer of read, which it runs when
// a turn is free. The key names the read, so that two reads with one key are one question.
func (c *CountReads) Read(ctx context.Context, key string, read func(context.Context) (resourcev2.SourcePage, error)) (resourcev2.SourcePage, error) {
	for {
		if err := ctx.Err(); err != nil {
			return resourcev2.SourcePage{}, err
		}
		c.mu.Lock()
		current := c.reads[key]
		if current == nil {
			current = &countRead{done: make(chan struct{})}
			c.reads[key] = current
			c.mu.Unlock()
			return c.ask(ctx, key, current, read)
		}
		select {
		case <-current.done:
			if current.restore != nil && c.now().Sub(current.storedAt) < CountStaleness {
				restore := current.restore
				c.mu.Unlock()
				if page, err := restore(); err == nil {
					return page, nil
				}
				c.mu.Lock()
			}
			if c.reads[key] == current {
				delete(c.reads, key)
			}
			c.mu.Unlock()
		default:
			c.mu.Unlock()
			select {
			case <-current.done:
			case <-ctx.Done():
				return resourcev2.SourcePage{}, ctx.Err()
			}
		}
	}
}

// Forget drops the answer kept for key, for a caller that has learned that the page it gave cannot be continued: the next read of the key asks again. A read that is being made is left to finish.
func (c *CountReads) Forget(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if current := c.reads[key]; current != nil && settled(current) {
		delete(c.reads, key)
	}
}

// ask runs a read for its caller, once a turn is free, and settles it.
func (c *CountReads) ask(ctx context.Context, key string, current *countRead, read func(context.Context) (resourcev2.SourcePage, error)) (page resourcev2.SourcePage, err error) {
	defer func() {
		c.mu.Lock()
		if err != nil || current.restore == nil {
			if c.reads[key] == current {
				delete(c.reads, key)
			}
		} else {
			current.storedAt = c.now()
		}
		// The answer is settled under the lock that trims, so the trim counts it with the answers it keeps.
		close(current.done)
		if err == nil && current.restore != nil {
			c.trimLocked()
		}
		c.mu.Unlock()
	}()
	select {
	case c.slots <- struct{}{}:
	case <-ctx.Done():
		return resourcev2.SourcePage{}, ctx.Err()
	}
	defer func() { <-c.slots }()
	page, err = read(ctx)
	if err != nil {
		return resourcev2.SourcePage{}, err
	}
	current.restore = keepCountedPage(page)
	return page, nil
}

// trimLocked keeps the answers within countKept: the stale first, then the oldest. Only settled answers count, and only they go: a read that is being made is never dropped, and never pushes an answer out.
func (c *CountReads) trimLocked() {
	kept := 0
	for _, current := range c.reads {
		if settled(current) {
			kept++
		}
	}
	if kept <= countKept {
		return
	}
	now := c.now()
	for key, current := range c.reads {
		if settled(current) && now.Sub(current.storedAt) >= CountStaleness {
			delete(c.reads, key)
			kept--
		}
	}
	for kept > countKept {
		oldest, found := "", false
		for key, current := range c.reads {
			if settled(current) && (!found || current.storedAt.Before(c.reads[oldest].storedAt)) {
				oldest, found = key, true
			}
		}
		if !found {
			return
		}
		delete(c.reads, oldest)
		kept--
	}
}

func settled(current *countRead) bool {
	select {
	case <-current.done:
		return true
	default:
		return false
	}
}

// keepCountedPage keeps a page as the wire holds it, so that each reader of it is given a page of its own. It keeps nothing of a page whose objects are large.
func keepCountedPage(page resourcev2.SourcePage) func() (resourcev2.SourcePage, error) {
	size := 0
	for _, record := range page.Records {
		bytes, _, _, err := resourcev2.SourceRecordWireCost(record)
		if err != nil {
			return nil
		}
		size += bytes
	}
	if size > countKeptBytes {
		return nil
	}
	message, err := resourcev2.ToProtoSourcePage(page)
	if err != nil {
		return nil
	}
	return func() (resourcev2.SourcePage, error) { return resourcev2.FromProtoSourcePage(message) }
}
