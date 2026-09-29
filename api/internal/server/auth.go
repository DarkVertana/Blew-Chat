package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"net/mail"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"blew/api/internal/audit"
	"blew/api/internal/auth"
)

const (
	sessionTTL = 7 * 24 * time.Hour

	// Failed sign-in lockout. Tracked in Postgres so it survives restarts and
	// applies across API instances.
	lockoutWindow       = 15 * time.Minute
	maxFailuresPerEmail = 5
	maxFailuresPerIP    = 20

	// sessions.last_seen_at is refreshed at most this often per session.
	lastSeenRefresh = 5 * time.Minute
)

type User struct {
	Name         string    `json:"name"`
	ImageVersion *string   `json:"image_version"`
	ID           int64     `json:"id"         db:"id"`
	Email        string    `json:"email"      db:"email"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
}

type sessionResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	User      User      `json:"user"`
}

type sessionInfo struct {
	ID         int64     `json:"id"           db:"id"`
	IP         *string   `json:"ip"           db:"ip"`
	UserAgent  *string   `json:"user_agent"   db:"user_agent"`
	CreatedAt  time.Time `json:"created_at"   db:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at" db:"last_seen_at"`
	Current    bool      `json:"current"      db:"current"`
}

type activityEntry struct {
	OccurredAt time.Time `json:"occurred_at" db:"occurred_at"`
	Action     string    `json:"action"      db:"action"`
	Method     string    `json:"method"      db:"method"`
	Path       string    `json:"path"        db:"path"`
	Status     int       `json:"status"      db:"status"`
	IP         *string   `json:"ip"          db:"ip"`
	UserAgent  *string   `json:"user_agent"  db:"user_agent"`
}

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// --- handlers ---------------------------------------------------------------

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	info := audit.FromContext(ctx)

	var in credentials
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	email, ok := normalizeEmail(in.Email)
	if !ok {
		writeError(w, http.StatusBadRequest, "enter a valid email address")
		return
	}
	info.Set("email", email)

	if err := auth.ValidatePassword(in.Password, email); err != nil {
		var perr *auth.PasswordError
		if errors.As(err, &perr) {
			info.SetAction("register.weak_password")
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error":    "password does not meet the requirements",
				"problems": perr.Problems,
			})
			return
		}
		s.internalError(w, "validate password", err)
		return
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		s.internalError(w, "hash password", err)
		return
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		s.internalError(w, "begin registration", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var user User
	err = tx.QueryRow(ctx,
		`INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at`,
		email, hash,
	).Scan(&user.ID, &user.Email, &user.CreatedAt)
	if isUniqueViolation(err) {
		info.SetAction("register.conflict")
		writeError(w, http.StatusConflict, "an account with that email already exists")
		return
	}
	if err != nil {
		s.internalError(w, "create user", err)
		return
	}
	sess, err := s.createSession(r, tx, user)
	if err != nil {
		s.internalError(w, "create session", err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		s.internalError(w, "commit registration", err)
		return
	}
	info.SetUser(user.ID)
	info.SetAction("register")
	writeJSON(w, http.StatusCreated, sess)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	info := audit.FromContext(ctx)
	ip := ipFrom(ctx)

	var in credentials
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	email, ok := normalizeEmail(in.Email)
	if !ok || in.Password == "" {
		info.SetAction("login.failed")
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	info.Set("email", email)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		s.internalError(w, "begin login", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// All login paths take these locks in the same order. Checking the budget
	// and recording the outcome must be one operation across API instances.
	for _, key := range []string{"login:ip:" + ip.String(), "login:email:" + email} {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, key); err != nil {
			s.internalError(w, "lock login attempts", err)
			return
		}
	}
	retry, locked, err := s.loginLocked(ctx, tx, email, ip)
	if err != nil {
		s.internalError(w, "check lockout", err)
		return
	}
	if locked {
		info.SetAction("login.locked")
		w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(retry.Seconds()))))
		writeError(w, http.StatusTooManyRequests,
			"too many failed sign-in attempts, try again in "+humanDuration(retry))
		return
	}

	fail := func() {
		if err := s.recordLoginAttempt(ctx, tx, email, ip, false); err != nil {
			s.internalError(w, "record failed login", err)
			return
		}
		if err := tx.Commit(ctx); err != nil {
			s.internalError(w, "commit failed login", err)
			return
		}
		info.SetAction("login.failed")
		writeError(w, http.StatusUnauthorized, "invalid email or password")
	}

	var (
		user User
		hash string
	)
	err = tx.QueryRow(ctx,
		`SELECT id, email, password_hash, created_at FROM users WHERE email = $1 FOR UPDATE`, email,
	).Scan(&user.ID, &user.Email, &hash, &user.CreatedAt)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// Spend the same time as a real comparison so response timing does not
		// reveal whether the email exists.
		auth.CheckPassword(s.dummyHash, in.Password)
		fail()
		return
	case err != nil:
		s.internalError(w, "look up user", err)
		return
	}
	if !auth.CheckPassword(hash, in.Password) {
		fail()
		return
	}

	if err := s.recordLoginAttempt(ctx, tx, email, ip, true); err != nil {
		s.internalError(w, "record successful login", err)
		return
	}
	sess, err := s.createSession(r, tx, user)
	if err != nil {
		s.internalError(w, "create session", err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		s.internalError(w, "commit login", err)
		return
	}
	info.SetUser(user.ID)
	info.SetAction("login.success")
	s.housekeeping(ctx)
	writeJSON(w, http.StatusOK, sess)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	token, _ := bearerToken(r) // requireAuth already validated it
	if _, err := tx.Exec(r.Context(),
		`DELETE FROM sessions WHERE token_hash = $1`, auth.HashToken(token)); err != nil {
		s.internalError(w, "delete session", err)
		return
	}
	audit.FromContext(r.Context()).SetAction("logout")
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit session revocation", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// logoutAll revokes every session of the user, including the current one.
func (s *Server) logoutAll(w http.ResponseWriter, r *http.Request) {
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	user := userFrom(r.Context())
	tag, err := tx.Exec(r.Context(), `DELETE FROM sessions WHERE user_id = $1`, user.ID)
	if err != nil {
		s.internalError(w, "delete sessions", err)
		return
	}
	info := audit.FromContext(r.Context())
	info.SetAction("logout.all")
	info.Set("revoked", tag.RowsAffected())
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit session revocation", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r.Context())
	err := s.pool.QueryRow(r.Context(), `SELECT name, image_version FROM user_profiles WHERE user_id=$1`, user.ID).Scan(&user.Name, &user.ImageVersion)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.internalError(w, "get user profile", err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r.Context())
	token, _ := bearerToken(r)
	rows, err := s.pool.Query(r.Context(), `
		SELECT id, host(ip) AS ip, user_agent, created_at, last_seen_at,
		       (token_hash = $2) AS current
		  FROM sessions
		 WHERE user_id = $1 AND expires_at > now()
		 ORDER BY last_seen_at DESC`, user.ID, auth.HashToken(token))
	if err != nil {
		s.internalError(w, "list sessions", err)
		return
	}
	sessions, err := pgx.CollectRows(rows, pgx.RowToStructByName[sessionInfo])
	if err != nil {
		s.internalError(w, "list sessions", err)
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (s *Server) revokeSession(w http.ResponseWriter, r *http.Request) {
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	user := userFrom(r.Context())
	tag, err := tx.Exec(r.Context(),
		`DELETE FROM sessions WHERE id = $1 AND user_id = $2`, id, user.ID)
	if err != nil {
		s.internalError(w, "revoke session", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	info := audit.FromContext(r.Context())
	info.SetAction("session.revoked")
	info.Set("session_id", id)
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit session revocation", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// changePassword re-checks the current password, applies the policy to the
// new one, and signs out every other session.
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	info := audit.FromContext(ctx)
	user := userFrom(ctx)

	var in struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var hash string
	if err := tx.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, user.ID).Scan(&hash); err != nil {
		s.internalError(w, "look up user", err)
		return
	}
	token, _ := bearerToken(r)
	if !auth.CheckPassword(hash, in.Current) {
		info.SetAction("password.change_failed")
		writeError(w, http.StatusUnauthorized, "current password is incorrect")
		return
	}

	if err := auth.ValidatePassword(in.New, user.Email); err != nil {
		var perr *auth.PasswordError
		if errors.As(err, &perr) {
			info.SetAction("password.change_rejected")
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error":    "new password does not meet the requirements",
				"problems": perr.Problems,
			})
			return
		}
		s.internalError(w, "validate password", err)
		return
	}
	newHash, err := auth.HashPassword(in.New)
	if err != nil {
		s.internalError(w, "hash password", err)
		return
	}

	if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $1 WHERE id = $2`, newHash, user.ID); err != nil {
		s.internalError(w, "update password", err)
		return
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, user.ID, auth.HashToken(token)); err != nil {
		s.internalError(w, "revoke other sessions", err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		s.internalError(w, "commit", err)
		return
	}
	info.SetAction("password.changed")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) activity(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r.Context())
	rows, err := s.pool.Query(r.Context(), `
		SELECT occurred_at, action, method, path, status, host(ip) AS ip, user_agent
		  FROM audit_log
		 WHERE user_id = $1
		 ORDER BY occurred_at DESC
		 LIMIT 50`, user.ID)
	if err != nil {
		s.internalError(w, "list activity", err)
		return
	}
	entries, err := pgx.CollectRows(rows, pgx.RowToStructByName[activityEntry])
	if err != nil {
		s.internalError(w, "list activity", err)
		return
	}
	writeJSON(w, http.StatusOK, entries)
}

// --- middleware -------------------------------------------------------------

type userKey struct{}

// userFrom returns the authenticated user placed in ctx by requireAuth.
func userFrom(ctx context.Context) User {
	u, _ := ctx.Value(userKey{}).(User)
	return u
}

// requireAuth resolves the Bearer token to a live session or answers 401.
func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := bearerToken(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		hash := auth.HashToken(token)

		var (
			user     User
			lastSeen time.Time
		)
		err := s.pool.QueryRow(r.Context(),
			`SELECT u.id, u.email, u.created_at, s.last_seen_at
			   FROM sessions s JOIN users u ON u.id = s.user_id
			  WHERE s.token_hash = $1 AND s.expires_at > now()`, hash,
		).Scan(&user.ID, &user.Email, &user.CreatedAt, &lastSeen)
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "invalid or expired session")
			return
		}
		if err != nil {
			s.internalError(w, "look up session", err)
			return
		}
		if time.Since(lastSeen) > lastSeenRefresh {
			if _, err := s.pool.Exec(r.Context(),
				`UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1`, hash); err != nil {
				slog.Warn("refresh last_seen_at", "err", err)
			}
		}

		audit.FromContext(r.Context()).SetUser(user.ID)
		next(w, r.WithContext(context.WithValue(r.Context(), userKey{}, user)))
	}
}

// sessionMutation serializes credential/session changes with login. A request
// may have passed requireAuth before waiting, so revalidate after taking the
// account lock rather than trusting the earlier authentication snapshot.
func (s *Server) sessionMutation(w http.ResponseWriter, r *http.Request) (pgx.Tx, bool) {
	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		s.internalError(w, "begin session mutation", err)
		return nil, false
	}
	ok := false
	defer func() {
		if !ok {
			_ = tx.Rollback(ctx)
		}
	}()
	user := userFrom(ctx)
	var id int64
	err = tx.QueryRow(ctx, `SELECT id FROM users WHERE id = $1 FOR UPDATE`, user.ID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "invalid or expired session")
		return nil, false
	}
	if err != nil {
		s.internalError(w, "lock account", err)
		return nil, false
	}
	token, _ := bearerToken(r)
	var active bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM sessions WHERE user_id = $1 AND token_hash = $2 AND expires_at > clock_timestamp()
	)`, user.ID, auth.HashToken(token)).Scan(&active); err != nil {
		s.internalError(w, "recheck session", err)
		return nil, false
	}
	if !active {
		writeError(w, http.StatusUnauthorized, "invalid or expired session")
		return nil, false
	}
	ok = true
	return tx, true
}

// --- helpers ----------------------------------------------------------------

func (s *Server) createSession(r *http.Request, tx pgx.Tx, user User) (sessionResponse, error) {
	token, hash, err := auth.NewToken()
	if err != nil {
		return sessionResponse{}, err
	}
	expires := time.Now().Add(sessionTTL)
	if _, err := tx.Exec(r.Context(),
		`INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)`,
		hash, user.ID, expires, ipArg(ipFrom(r.Context())), nullIfEmpty(truncate(r.UserAgent(), 512)),
	); err != nil {
		return sessionResponse{}, err
	}
	return sessionResponse{Token: token, ExpiresAt: expires, User: user}, nil
}

// loginLocked reports whether sign-in for email or from ip is currently
// blocked by recent failures, and for how long.
func (s *Server) loginLocked(ctx context.Context, tx pgx.Tx, email string, ip netip.Addr) (time.Duration, bool, error) {
	var (
		byEmail, byIP int64
		oldest        *time.Time
	)
	err := tx.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE email = $1 AND created_at > COALESCE(
		           (SELECT max(created_at) FROM login_attempts WHERE email = $1 AND success),
		           '-infinity'::timestamptz)),
		       count(*) FILTER (WHERE ip = $2),
		       min(created_at)
		  FROM login_attempts
		 WHERE NOT success
		   AND created_at > clock_timestamp() - make_interval(secs => $3)
		   AND (email = $1 OR ip = $2)`,
		email, ipArg(ip), lockoutWindow.Seconds(),
	).Scan(&byEmail, &byIP, &oldest)
	if err != nil {
		return 0, false, err
	}
	if byEmail < maxFailuresPerEmail && byIP < maxFailuresPerIP {
		return 0, false, nil
	}
	retry := lockoutWindow
	if oldest != nil {
		retry = lockoutWindow - time.Since(*oldest)
	}
	if retry < time.Second {
		retry = time.Second
	}
	return retry, true, nil
}

// recordLoginAttempt stores the outcome; a success clears the account's
// failure streak without erasing failures from the IP budget.
func (s *Server) recordLoginAttempt(ctx context.Context, tx pgx.Tx, email string, ip netip.Addr, success bool) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO login_attempts (email, ip, success, created_at) VALUES ($1, $2, $3, clock_timestamp())`,
		email, ipArg(ip), success)
	return err
}

// housekeeping is best-effort cleanup on the login path.
func (s *Server) housekeeping(ctx context.Context) {
	for _, q := range []string{
		`DELETE FROM sessions WHERE expires_at <= now()`,
		`DELETE FROM login_attempts WHERE created_at < now() - interval '1 day'`,
	} {
		if _, err := s.pool.Exec(ctx, q); err != nil {
			slog.Warn("housekeeping", "err", err)
		}
	}
}

func bearerToken(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) <= len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return "", false
	}
	token := strings.TrimSpace(h[len(prefix):])
	return token, token != ""
}

func normalizeEmail(raw string) (string, bool) {
	email := strings.ToLower(strings.TrimSpace(raw))
	if email == "" || len(email) > 254 {
		return "", false
	}
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email {
		return "", false
	}
	return email, true
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// ipArg converts an address to a query argument, NULL when unknown.
func ipArg(ip netip.Addr) any {
	if ip.IsValid() {
		return ip
	}
	return nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func humanDuration(d time.Duration) string {
	if d < time.Minute {
		secs := int(math.Ceil(d.Seconds()))
		if secs == 1 {
			return "1 second"
		}
		return fmt.Sprintf("%d seconds", secs)
	}
	mins := int(math.Ceil(d.Minutes()))
	if mins == 1 {
		return "1 minute"
	}
	return fmt.Sprintf("%d minutes", mins)
}
