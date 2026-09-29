// Package ratelimit is an in-memory, per-key token bucket limiter.
//
// It is per process: with several API replicas each keeps its own counters,
// which is fine for abuse protection. The login lockout in the server package
// is database-backed and therefore global.
package ratelimit

import (
	"math"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type Limiter struct {
	rate  rate.Limit
	burst int

	mu   sync.Mutex
	keys map[string]*entry
}

type entry struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

// New allows `burst` immediate requests per key, then refills at r per second.
func New(r rate.Limit, burst int) *Limiter {
	l := &Limiter{rate: r, burst: burst, keys: map[string]*entry{}}
	go l.cleanup()
	return l
}

// Allow reports whether key may proceed now. When it may not, retryAfter is
// how long the caller should wait before trying again.
func (l *Limiter) Allow(key string) (ok bool, retryAfter time.Duration) {
	now := time.Now()

	l.mu.Lock()
	e, found := l.keys[key]
	if !found {
		e = &entry{lim: rate.NewLimiter(l.rate, l.burst)}
		l.keys[key] = e
	}
	e.lastSeen = now
	l.mu.Unlock()

	res := e.lim.ReserveN(now, 1)
	if !res.OK() {
		return false, time.Duration(math.MaxInt64)
	}
	if delay := res.DelayFrom(now); delay > 0 {
		res.CancelAt(now)
		return false, delay
	}
	return true, 0
}

// cleanup drops keys that have been idle for a while so the map cannot grow
// without bound.
func (l *Limiter) cleanup() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		cutoff := time.Now().Add(-10 * time.Minute)
		l.mu.Lock()
		for k, e := range l.keys {
			if e.lastSeen.Before(cutoff) {
				delete(l.keys, k)
			}
		}
		l.mu.Unlock()
	}
}
