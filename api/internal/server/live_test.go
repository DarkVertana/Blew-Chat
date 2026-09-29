package server

import (
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLiveChatOwnershipChangesAndRevocation(t *testing.T) {
	s, _, _ := authTestServer(t)
	origin := "http://localhost:3001"
	t.Setenv("CORS_ORIGIN", origin)
	a := registerTestUser(t, s, "live-a@example.com")
	b := registerTestUser(t, s, "live-b@example.com")
	w := botRequest(s, s.saveBot, "POST", a.Token, 0, 0, map[string]string{"name": "Live test", "designation": "Tester"})
	requireStatus(t, w, 200)
	var bot Bot
	json.Unmarshal(w.Body.Bytes(), &bot)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/live/bots/{id}", s.chatSocket)
	server := httptest.NewServer(mux)
	defer server.Close()
	defer func() {
		if s.live != nil {
			s.live.cancel()
		}
	}()
	url := "ws" + strings.TrimPrefix(server.URL, "http") + fmt.Sprintf("/api/live/bots/%d", bot.ID)
	dial := func(token, origin string) (*websocket.Conn, *http.Response, error) {
		return websocket.DefaultDialer.Dial(url, http.Header{"Origin": []string{origin}, "Cookie": []string{"blew_session=" + token}})
	}
	for _, c := range []struct {
		token, origin string
		status        int
	}{{a.Token, "https://evil.example", 403}, {b.Token, origin, 404}, {"invalid", origin, 401}} {
		conn, response, err := dial(c.token, c.origin)
		if conn != nil {
			conn.Close()
		}
		if err == nil || response.StatusCode != c.status {
			t.Fatalf("bad websocket authorization: %v", err)
		}
	}
	conn, _, err := dial(a.Token, origin)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, _, err = conn.ReadMessage(); err != nil {
		t.Fatal(err)
	}
	// Listen acknowledgement is delivered as a change, avoiding a startup event gap.
	time.Sleep(100 * time.Millisecond)
	requireStatus(t, botRequest(s, s.beginBotTurn, "POST", a.Token, bot.ID, 0, map[string]string{"id": "live-request-123456", "text": "Immediate message", "provider": "test", "model": "test"}), 200)
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, payload, err := conn.ReadMessage()
	if err != nil || !strings.Contains(string(payload), "changed") {
		t.Fatalf("no live update: %v", err)
	}
	s.pool.Exec(t.Context(), `DELETE FROM sessions WHERE user_id=(SELECT user_id FROM bots WHERE id=$1)`, bot.ID)
	// Drain any already queued non-content invalidations, then ensure closure.
	s.broadcastChat(bot.ID)
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for i := 0; i < 4; i++ {
		if _, _, err = conn.ReadMessage(); err != nil {
			return
		}
	}
	t.Fatal("revoked session socket remained active")
}
