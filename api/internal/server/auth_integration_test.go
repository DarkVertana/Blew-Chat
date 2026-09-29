package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"blew/api/internal/auth"
	"blew/api/internal/db"
	"blew/api/migrations"
)

const testPassword = "Cedar!River7832"
const changedPassword = "Maple!Cloud9843"

// Each test owns a disposable schema; application tables are never touched.
func authTestServer(t *testing.T) (*Server, *pgxpool.Pool, string) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run isolated PostgreSQL auth regressions")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("auth_test_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, err := admin.Exec(context.Background(), "DROP SCHEMA "+quoted+" CASCADE")
		if err != nil {
			t.Error(err)
		}
		admin.Close()
	})
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 20
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	cfg.ConnConfig.RuntimeParams["application_name"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := db.Migrate(ctx, pool, migrations.FS); err != nil {
		t.Fatal(err)
	}
	dummy, err := auth.HashPassword("placeholder-password-never-matches")
	if err != nil {
		t.Fatal(err)
	}
	return &Server{pool: pool, dummyHash: dummy}, admin, schema
}

func authRequest(h http.HandlerFunc, body, token, ip string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	r = r.WithContext(context.WithValue(ctx, ipKey{}, netip.MustParseAddr(ip)))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h(w, r)
	return w
}

func registerTestUser(t *testing.T, s *Server, email string) sessionResponse {
	t.Helper()
	w := authRequest(s.register, fmt.Sprintf(`{"email":%q,"password":%q}`, email, testPassword), "", "192.0.2.1")
	if w.Code != http.StatusCreated {
		t.Fatalf("register: %d %s", w.Code, w.Body.String())
	}
	var session sessionResponse
	if err := json.Unmarshal(w.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	return session
}

func waitForAuthLock(t *testing.T, admin *pgxpool.Pool, schema string, done <-chan *httptest.ResponseRecorder) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case w := <-done:
			t.Fatalf("request completed before account lock released: %d %s", w.Code, w.Body.String())
		default:
		}
		var waiting bool
		err := admin.QueryRow(context.Background(), `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock')`, schema).Scan(&waiting)
		if err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("request never reached database lock")
}

func TestAuthLoginCannotOutlivePasswordChange(t *testing.T) {
	s, admin, schema := authTestServer(t)
	sess := registerTestUser(t, s, "race@example.com")
	ctx := context.Background()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT id FROM users WHERE id=$1 FOR UPDATE`, sess.User.ID); err != nil {
		t.Fatal(err)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- authRequest(s.login, fmt.Sprintf(`{"email":"race@example.com","password":%q}`, testPassword), "", "192.0.2.2")
	}()
	waitForAuthLock(t, admin, schema, done)
	hash, _ := auth.HashPassword(changedPassword)
	if _, err := tx.Exec(ctx, `UPDATE users SET password_hash=$1 WHERE id=$2`, hash, sess.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id=$1`, sess.User.ID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if w := <-done; w.Code != http.StatusUnauthorized {
		t.Fatalf("old-password race: %d %s", w.Code, w.Body.String())
	}
	w := authRequest(s.login, fmt.Sprintf(`{"email":"race@example.com","password":%q}`, changedPassword), "", "192.0.2.2")
	if w.Code != http.StatusOK {
		t.Fatalf("new password login: %d %s", w.Code, w.Body.String())
	}
}

func TestAuthRevokedRequestCannotChangePassword(t *testing.T) {
	s, admin, schema := authTestServer(t)
	sess := registerTestUser(t, s, "revoked@example.com")
	ctx := context.Background()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT id FROM users WHERE id=$1 FOR UPDATE`, sess.User.ID); err != nil {
		t.Fatal(err)
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- authRequest(s.requireAuth(s.changePassword), fmt.Sprintf(`{"current_password":%q,"new_password":%q}`, testPassword, changedPassword), sess.Token, "192.0.2.2")
	}()
	waitForAuthLock(t, admin, schema, done)
	if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id=$1`, sess.User.ID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if w := <-done; w.Code != http.StatusUnauthorized {
		t.Fatalf("revoked password change: %d %s", w.Code, w.Body.String())
	}
	var hash string
	if err := s.pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE id=$1`, sess.User.ID).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if !auth.CheckPassword(hash, testPassword) {
		t.Fatal("revoked request changed password")
	}
}

func TestAuthConcurrentPasswordChangesHaveOneWinner(t *testing.T) {
	s, _, _ := authTestServer(t)
	a := registerTestUser(t, s, "concurrent@example.com")
	w := authRequest(s.login, fmt.Sprintf(`{"email":"concurrent@example.com","password":%q}`, testPassword), "", "192.0.2.2")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var b sessionResponse
	if err := json.Unmarshal(w.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	codes := make([]int, 2)
	for i, token := range []string{a.Token, b.Token} {
		wg.Add(1)
		go func(i int, token string) {
			defer wg.Done()
			codes[i] = authRequest(s.requireAuth(s.changePassword), fmt.Sprintf(`{"current_password":%q,"new_password":%q}`, testPassword, changedPassword), token, "192.0.2.2").Code
		}(i, token)
	}
	wg.Wait()
	if !((codes[0] == 204 && codes[1] == 401) || (codes[0] == 401 && codes[1] == 204)) {
		t.Fatalf("password change outcomes: %v", codes)
	}
	for i, token := range []string{a.Token, b.Token} {
		want := 401
		if codes[i] == 204 {
			want = 200
		}
		if w := authRequest(s.requireAuth(s.me), "", token, "192.0.2.2"); w.Code != want {
			t.Fatalf("session %d: %d, want %d", i, w.Code, want)
		}
	}
}

func TestAuthConcurrentFailuresRespectAccountBudget(t *testing.T) {
	s, _, _ := authTestServer(t)
	registerTestUser(t, s, "budget@example.com")
	var wg sync.WaitGroup
	codes := make([]int, 8)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes[i] = authRequest(s.login, `{"email":"budget@example.com","password":"wrong"}`, "", fmt.Sprintf("192.0.2.%d", i+10)).Code
		}(i)
	}
	wg.Wait()
	failed, locked := 0, 0
	for _, code := range codes {
		switch code {
		case 401:
			failed++
		case 429:
			locked++
		default:
			t.Fatalf("unexpected outcome: %v", codes)
		}
	}
	if failed != 5 || locked != 3 {
		t.Fatalf("failed=%d locked=%d, want 5/3", failed, locked)
	}
}

func TestAuthSuccessfulLoginPreservesIPFailures(t *testing.T) {
	s, _, _ := authTestServer(t)
	registerTestUser(t, s, "history@example.com")
	for i := 0; i < 4; i++ {
		if w := authRequest(s.login, `{"email":"history@example.com","password":"wrong"}`, "", "192.0.2.5"); w.Code != 401 {
			t.Fatal(w.Code)
		}
	}
	if w := authRequest(s.login, fmt.Sprintf(`{"email":"history@example.com","password":%q}`, testPassword), "", "192.0.2.5"); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var failures int
	if err := s.pool.QueryRow(context.Background(), `SELECT count(*) FROM login_attempts WHERE NOT success AND ip='192.0.2.5'`).Scan(&failures); err != nil {
		t.Fatal(err)
	}
	if failures != 4 {
		t.Fatalf("successful login erased IP history: %d", failures)
	}
	// The account streak, unlike the IP history, has been reset.
	for i := 0; i < 5; i++ {
		if w := authRequest(s.login, `{"email":"history@example.com","password":"wrong"}`, "", "192.0.2.6"); w.Code != 401 {
			t.Fatalf("reset account attempt %d: %d %s", i, w.Code, w.Body.String())
		}
	}
}

func TestAuthRegistrationRollsBackWhenSessionFails(t *testing.T) {
	s, _, _ := authTestServer(t)
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `ALTER TABLE sessions ADD CONSTRAINT reject_test_session CHECK (user_agent IS DISTINCT FROM 'reject-test')`); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/", strings.NewReader(fmt.Sprintf(`{"email":"atomic@example.com","password":%q}`, testPassword)))
	r.Header.Set("User-Agent", "reject-test")
	w := httptest.NewRecorder()
	s.register(w, r)
	if w.Code != 500 {
		t.Fatalf("expected injected failure, got %d", w.Code)
	}
	var count int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE email='atomic@example.com'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("failed registration left an account behind")
	}
	registerTestUser(t, s, "atomic@example.com")
}

func TestAuthRevocationAndOwnership(t *testing.T) {
	s, _, _ := authTestServer(t)
	a := registerTestUser(t, s, "owner@example.com")
	b := registerTestUser(t, s, "other@example.com")
	var id int64
	if err := s.pool.QueryRow(context.Background(), `SELECT id FROM sessions WHERE user_id=$1`, b.User.ID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("DELETE", "/", nil)
	r.Header.Set("Authorization", "Bearer "+a.Token)
	r.SetPathValue("id", fmt.Sprint(id))
	w := httptest.NewRecorder()
	s.requireAuth(s.revokeSession)(w, r)
	if w.Code != 404 {
		t.Fatalf("cross-account revocation: %d", w.Code)
	}
	if w := authRequest(s.requireAuth(s.logoutAll), "", a.Token, "192.0.2.1"); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	if w := authRequest(s.requireAuth(s.me), "", a.Token, "192.0.2.1"); w.Code != 401 {
		t.Fatal("global logout retained token")
	}
	if w := authRequest(s.requireAuth(s.me), "", b.Token, "192.0.2.1"); w.Code != 200 {
		t.Fatal("global logout affected other account")
	}
	if w := authRequest(s.requireAuth(s.logout), "", b.Token, "192.0.2.1"); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	if w := authRequest(s.requireAuth(s.me), "", b.Token, "192.0.2.1"); w.Code != 401 {
		t.Fatal("logout retained token")
	}
}
