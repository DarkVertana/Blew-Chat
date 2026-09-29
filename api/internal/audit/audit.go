// Package audit records every API request to the audit_log table.
package audit

import (
	"context"
	"log/slog"
	"net/netip"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Entry is one audit_log row.
type Entry struct {
	OccurredAt time.Time
	UserID     *int64
	Action     string
	Method     string
	Path       string
	Status     int
	DurationMS int64
	IP         netip.Addr // zero value when unknown
	UserAgent  string
	Metadata   map[string]any
}

// Recorder buffers entries and writes them from a background goroutine so
// request latency never depends on the audit insert.
type Recorder struct {
	pool *pgxpool.Pool
	ch   chan Entry
	wg   sync.WaitGroup
}

func NewRecorder(pool *pgxpool.Pool) *Recorder {
	r := &Recorder{pool: pool, ch: make(chan Entry, 4096)}
	r.wg.Add(1)
	go r.run()
	return r
}

// Record queues e. It never blocks: if the buffer is full (database down or
// very slow) the entry is dropped and a warning logged.
func (r *Recorder) Record(e Entry) {
	select {
	case r.ch <- e:
	default:
		slog.Warn("audit: buffer full, entry dropped", "action", e.Action, "path", e.Path)
	}
}

// Close flushes queued entries, waiting at most timeout.
func (r *Recorder) Close(timeout time.Duration) {
	close(r.ch)
	done := make(chan struct{})
	go func() {
		r.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(timeout):
		slog.Warn("audit: shutdown timed out with entries unwritten")
	}
}

func (r *Recorder) run() {
	defer r.wg.Done()
	for e := range r.ch {
		r.insert(e)
	}
}

func (r *Recorder) insert(e Entry) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var ip any
	if e.IP.IsValid() {
		ip = e.IP
	}
	var ua any
	if e.UserAgent != "" {
		ua = e.UserAgent
	}
	meta := e.Metadata
	if meta == nil {
		meta = map[string]any{}
	}

	_, err := r.pool.Exec(ctx, `
		INSERT INTO audit_log
		    (occurred_at, user_id, action, method, path, status, duration_ms, ip, user_agent, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		e.OccurredAt, e.UserID, e.Action, e.Method, e.Path, e.Status, e.DurationMS, ip, ua, meta)
	if err != nil {
		slog.Error("audit: insert failed", "err", err, "action", e.Action)
	}
}

// --- per-request annotations -------------------------------------------------

type ctxKey struct{}

// Info travels in the request context. The middleware creates it; handlers
// fill in the action name, the acting user, and any metadata as they go.
// All methods are nil-safe so handlers also work without the middleware.
type Info struct {
	mu     sync.Mutex
	action string
	userID *int64
	meta   map[string]any
}

func WithInfo(ctx context.Context) (context.Context, *Info) {
	info := &Info{}
	return context.WithValue(ctx, ctxKey{}, info), info
}

func FromContext(ctx context.Context) *Info {
	info, _ := ctx.Value(ctxKey{}).(*Info)
	return info
}

func (i *Info) SetAction(action string) {
	if i == nil {
		return
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	i.action = action
}

func (i *Info) SetUser(id int64) {
	if i == nil {
		return
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	i.userID = &id
}

func (i *Info) Set(key string, value any) {
	if i == nil {
		return
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.meta == nil {
		i.meta = map[string]any{}
	}
	i.meta[key] = value
}

// Entry returns a partially filled Entry; the middleware adds request facts.
func (i *Info) Entry() Entry {
	if i == nil {
		return Entry{}
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	return Entry{Action: i.action, UserID: i.userID, Metadata: i.meta}
}
