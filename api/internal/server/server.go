// Package server wires HTTP routes and middleware.
package server

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/time/rate"

	"blew/api/internal/audit"
	"blew/api/internal/auth"
	"blew/api/internal/config"
	"blew/api/internal/ratelimit"
)

type Server struct {
	liveOnce sync.Once
	live     *liveHub
	pool     *pgxpool.Pool
	// dummyHash is compared against on login for unknown emails so that the
	// response time matches a real password check.
	dummyHash string
}

// New returns the fully assembled HTTP handler.
func New(pool *pgxpool.Pool, cfg config.Config, rec *audit.Recorder) (http.Handler, error) {
	dummyHash, err := auth.HashPassword("placeholder-password-never-matches")
	if err != nil {
		return nil, fmt.Errorf("prepare dummy hash: %w", err)
	}
	s := &Server{pool: pool, dummyHash: dummyHash}

	// Per client IP. The general limit only stops runaway clients; the
	// credential endpoints get a much tighter budget on top of the
	// database-backed lockout in auth.go.
	general := ratelimit.New(rate.Limit(20), 40)              // 40 burst, then 20/s
	credential := ratelimit.New(rate.Every(6*time.Second), 5) // 5 burst, then 10/min
	guard := func(h http.HandlerFunc) http.Handler { return rateLimit(credential, h) }

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /api/live/bots/{id}", s.chatSocket)

	mux.Handle("POST /api/auth/register", guard(s.register))
	mux.Handle("POST /api/auth/login", guard(s.login))
	mux.Handle("POST /api/auth/password", guard(s.requireAuth(s.changePassword)))
	mux.HandleFunc("POST /api/auth/logout", s.requireAuth(s.logout))
	mux.HandleFunc("POST /api/auth/logout-all", s.requireAuth(s.logoutAll))
	mux.HandleFunc("GET /api/auth/me", s.requireAuth(s.me))
	mux.HandleFunc("GET /api/notifications", s.requireAuth(s.getNotifications))
	mux.HandleFunc("PUT /api/notifications", s.requireAuth(s.updateNotifications))
	mux.HandleFunc("PUT /api/notifications/subscription", s.requireAuth(s.subscribeNotifications))
	mux.HandleFunc("DELETE /api/notifications/subscription", s.requireAuth(s.unsubscribeNotifications))
	mux.Handle("POST /api/notifications/test", guard(s.requireAuth(s.testNotification)))
	mux.HandleFunc("GET /api/profile", s.requireAuth(s.getProfile))
	mux.HandleFunc("PUT /api/profile", s.requireAuth(s.updateProfile))
	mux.HandleFunc("GET /api/profile/image", s.requireAuth(s.getProfileImage))
	mux.HandleFunc("PUT /api/profile/image", s.requireAuth(s.uploadProfileImage))
	mux.HandleFunc("DELETE /api/profile/image", s.requireAuth(s.deleteProfileImage))
	mux.HandleFunc("GET /api/auth/sessions", s.requireAuth(s.listSessions))
	mux.HandleFunc("DELETE /api/auth/sessions/{id}", s.requireAuth(s.revokeSession))
	mux.HandleFunc("GET /api/auth/activity", s.requireAuth(s.activity))

	mux.HandleFunc("GET /api/computers", s.requireAuth(s.listComputers))
	mux.Handle("POST /api/computers/pairing", guard(s.requireAuth(s.createPairing)))
	mux.HandleFunc("DELETE /api/computers/{id}", s.requireAuth(s.revokeComputer))
	mux.Handle("POST /api/companion/pair", guard(s.pairComputer))
	mux.HandleFunc("POST /api/companion/next", s.nextComputerTask)
	mux.HandleFunc("GET /api/companion/tasks/{task}/attachments/{attachment}", s.companionAttachment)
	mux.HandleFunc("GET /api/companion/tasks/{task}", s.computerTaskStatus)
	mux.HandleFunc("POST /api/companion/tasks/{task}", s.completeComputerTask)
	mux.HandleFunc("POST /api/bots/{id}/attachments", s.requireAuth(s.uploadAttachment))
	mux.HandleFunc("GET /api/bots/{id}/attachments/{attachment}", s.requireAuth(s.attachment))
	mux.HandleFunc("DELETE /api/bots/{id}/attachments/{attachment}", s.requireAuth(s.attachment))
	mux.HandleFunc("GET /api/bots/{id}/memory", s.requireAuth(s.searchMemory))
	mux.HandleFunc("POST /api/bots/{id}/memory", s.requireAuth(s.saveMemory))
	mux.HandleFunc("DELETE /api/bots/{id}/memory/{memory}", s.requireAuth(s.forgetMemory))
	mux.HandleFunc("POST /internal/scheduler/memory", s.schedulerAuth(s.scheduledMemory))
	mux.HandleFunc("GET /api/bots/{id}/tasks", s.requireAuth(s.listComputerTasks))
	mux.HandleFunc("POST /api/bots/{id}/tasks/{task}", s.requireAuth(s.decideComputerTask))
	mux.HandleFunc("GET /api/bots/{id}/schedules", s.requireAuth(s.listSchedules))
	mux.HandleFunc("POST /api/bots/{id}/schedules", s.requireAuth(s.saveSchedule))
	mux.HandleFunc("POST /api/bots/{id}/schedules/preview", s.requireAuth(s.previewSchedule))
	mux.HandleFunc("PUT /api/bots/{id}/schedules/{schedule}", s.requireAuth(s.saveSchedule))
	mux.HandleFunc("POST /api/bots/{id}/schedules/{schedule}/control", s.requireAuth(s.controlSchedule))
	mux.HandleFunc("POST /internal/scheduler/claim", s.schedulerAuth(s.claimSchedule))
	mux.HandleFunc("POST /internal/scheduler/active", s.schedulerAuth(s.activeSchedule))
	mux.HandleFunc("POST /internal/scheduler/finish", s.schedulerAuth(s.finishSchedule))
	mux.HandleFunc("GET /api/bots", s.requireAuth(s.listBots))
	mux.HandleFunc("POST /api/bots", s.requireAuth(s.saveBot))
	mux.HandleFunc("DELETE /api/bots/{id}", s.requireAuth(s.deleteBot))
	mux.HandleFunc("PUT /api/bots/{id}", s.requireAuth(s.saveBot))
	mux.HandleFunc("GET /api/bots/{id}", s.requireAuth(s.botConversation))
	mux.HandleFunc("POST /api/bots/{id}/turns", s.requireAuth(s.beginBotTurn))
	mux.HandleFunc("POST /api/bots/{id}/finish", s.requireAuth(s.finishBotTurn))
	mux.HandleFunc("GET /api/bots/{id}/image", s.requireAuth(s.botImage))
	mux.HandleFunc("PUT /api/bots/{id}/image", s.requireAuth(s.botImage))
	mux.HandleFunc("DELETE /api/bots/{id}/image", s.requireAuth(s.botImage))
	mux.HandleFunc("GET /api/notes", s.requireAuth(s.listNotes))
	mux.HandleFunc("POST /api/notes", s.requireAuth(s.createNote))

	var h http.Handler = mux
	h = cors(cfg.CORSOrigin, h)
	h = rateLimit(general, h)
	h = recoverPanic(h)
	h = auditRequests(rec, h) // sees the final status, including 429s and 500s
	h = securityHeaders(h)
	h = withClientIP(cfg.TrustedProxies, h)
	return h, nil
}
