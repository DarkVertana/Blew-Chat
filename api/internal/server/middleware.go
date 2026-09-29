package server

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"math"
	"net"
	"net/http"
	"net/netip"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"blew/api/internal/audit"
	"blew/api/internal/ratelimit"
)

// --- client IP ----------------------------------------------------------------

type ipKey struct{}

// withClientIP resolves the real client address once and stores it in the
// context for the rate limiter, the audit log, and the handlers.
func withClientIP(trusted []netip.Prefix, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r, trusted)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ipKey{}, ip)))
	})
}

func ipFrom(ctx context.Context) netip.Addr {
	ip, _ := ctx.Value(ipKey{}).(netip.Addr)
	return ip
}

// clientIP returns the address of the real client. X-Forwarded-For is only
// honoured when the direct peer is a trusted proxy, and then the rightmost
// address that is not itself a trusted proxy wins, so a client cannot spoof
// its address by sending the header itself.
func clientIP(r *http.Request, trusted []netip.Prefix) netip.Addr {
	peer := parseAddr(remoteHost(r.RemoteAddr))
	if !peer.IsValid() || !isTrusted(peer, trusted) {
		return peer
	}

	hops := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		addr := parseAddr(strings.TrimSpace(hops[i]))
		if addr.IsValid() && !isTrusted(addr, trusted) {
			return addr
		}
	}
	// Every hop was a trusted proxy: the leftmost is the best guess.
	if first := parseAddr(strings.TrimSpace(hops[0])); first.IsValid() {
		return first
	}
	return peer
}

func remoteHost(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}

func parseAddr(s string) netip.Addr {
	addr, err := netip.ParseAddr(s)
	if err != nil {
		return netip.Addr{}
	}
	return addr.Unmap().WithZone("")
}

func isTrusted(addr netip.Addr, trusted []netip.Prefix) bool {
	for _, p := range trusted {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

// --- response hardening -------------------------------------------------------

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// recoverPanic turns a panicking handler into a 500 instead of a dropped
// connection, and logs the stack.
func recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				slog.Error("panic", "err", v, "path", r.URL.Path, "stack", string(debug.Stack()))
				writeError(w, http.StatusInternalServerError, "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// cors allows a single browser origin. The Next.js app talks to the API
// server-side (no CORS involved); this is for direct browser calls in dev.
func cors(origin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		h.Add("Vary", "Origin")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- rate limiting ------------------------------------------------------------

// rateLimit answers 429 with Retry-After when the client IP exceeds l.
func rateLimit(l *ratelimit.Limiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ok, retry := l.Allow(ipFrom(r.Context()).String())
		if !ok {
			secs := int(math.Ceil(retry.Seconds()))
			if secs < 1 {
				secs = 1
			}
			w.Header().Set("Retry-After", strconv.Itoa(secs))
			audit.FromContext(r.Context()).SetAction("rate_limited")
			writeError(w, http.StatusTooManyRequests,
				fmt.Sprintf("too many requests, try again in %d seconds", secs))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- audit + request log ------------------------------------------------------

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	r.status = http.StatusSwitchingProtocols
	return http.NewResponseController(r.ResponseWriter).Hijack()
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// auditRequests logs every request to stdout and queues an audit_log row.
// /health is skipped: container healthchecks would drown everything else.
func auditRequests(rec *audit.Recorder, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}

		start := time.Now()
		ctx, info := audit.WithInfo(r.Context())
		sr := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sr, r.WithContext(ctx))

		entry := info.Entry()
		entry.OccurredAt = start
		entry.Method = r.Method
		entry.Path = r.URL.Path
		entry.Status = sr.status
		entry.DurationMS = time.Since(start).Milliseconds()
		entry.IP = ipFrom(ctx)
		entry.UserAgent = truncate(r.UserAgent(), 512)
		if entry.Action == "" {
			entry.Action = r.Method + " " + r.URL.Path
		}

		slog.Info("request",
			"method", entry.Method,
			"path", entry.Path,
			"status", entry.Status,
			"duration_ms", entry.DurationMS,
			"ip", entry.IP.String(),
			"user_id", derefInt(entry.UserID),
			"action", entry.Action,
		)
		rec.Record(entry)
	})
}

func derefInt(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
