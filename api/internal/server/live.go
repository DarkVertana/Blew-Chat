package server

import (
	"blew/api/internal/auth"
	"context"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

type liveHub struct {
	mu          sync.Mutex
	subscribers map[int64]map[chan struct{}]bool
	cancel      context.CancelFunc
}

func (s *Server) subscribeChat(botID int64) (<-chan struct{}, func()) {
	s.liveOnce.Do(func() {
		ctx, cancel := context.WithCancel(context.Background())
		s.live = &liveHub{subscribers: map[int64]map[chan struct{}]bool{}, cancel: cancel}
		go s.listenChats(ctx)
	})
	ch := make(chan struct{}, 1)
	h := s.live
	h.mu.Lock()
	if h.subscribers[botID] == nil {
		h.subscribers[botID] = map[chan struct{}]bool{}
	}
	h.subscribers[botID][ch] = true
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subscribers[botID], ch)
		if len(h.subscribers[botID]) == 0 {
			delete(h.subscribers, botID)
		}
		h.mu.Unlock()
	}
}
func (s *Server) broadcastChat(botID int64) {
	h := s.live
	h.mu.Lock()
	defer h.mu.Unlock()
	for id, channels := range h.subscribers {
		if botID != 0 && id != botID {
			continue
		}
		for ch := range channels {
			select {
			case ch <- struct{}{}:
			default:
			}
		}
	}
}
func (s *Server) listenChats(ctx context.Context) {
	for ctx.Err() == nil {
		conn, err := pgx.ConnectConfig(ctx, s.pool.Config().ConnConfig.Copy())
		if err == nil {
			_, err = conn.Exec(ctx, "LISTEN blew_chat")
			if err == nil {
				s.broadcastChat(0)
			}
			for err == nil {
				var notification *pgconn.Notification
				notification, err = conn.WaitForNotification(ctx)
				if err == nil {
					if id, e := strconv.ParseInt(notification.Payload, 10, 64); e == nil {
						s.broadcastChat(id)
					}
				}
			}
			conn.Close(context.Background())
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
	}
}
func (s *Server) chatSocket(w http.ResponseWriter, r *http.Request) {
	origin := os.Getenv("CORS_ORIGIN")
	if origin == "" {
		origin = "http://localhost:3000"
	}
	if r.Header.Get("Origin") != origin {
		writeError(w, 403, "Invalid WebSocket origin")
		return
	}
	cookie, err := r.Cookie("blew_session")
	if err != nil {
		writeError(w, 401, "Please sign in")
		return
	}
	// HttpOnly session is forwarded only by the same-origin upgrade proxy.
	r.Header.Set("Authorization", "Bearer "+cookie.Value)
	s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		bot, ok := s.ownedBot(w, r)
		if !ok {
			return
		}
		up := websocket.Upgrader{HandshakeTimeout: 5 * time.Second, CheckOrigin: func(request *http.Request) bool { return request.Header.Get("Origin") == origin }}
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		changed, unsubscribe := s.subscribeChat(bot.ID)
		defer unsubscribe()
		conn.SetReadLimit(1024)
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(60 * time.Second)) })
		closed := make(chan struct{})
		go func() {
			defer close(closed)
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					return
				}
			}
		}()
		valid := func() bool {
			var live bool
			err := s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sessions s JOIN bots b ON b.user_id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND b.id=$2)`, auth.HashToken(cookie.Value), bot.ID).Scan(&live)
			return err == nil && live
		}
		write := func() error {
			conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			return conn.WriteJSON(map[string]string{"type": "changed"})
		}
		if err = write(); err != nil {
			return
		}
		heartbeat := time.NewTicker(20 * time.Second)
		defer heartbeat.Stop()
		for {
			select {
			case <-closed:
				return
			case <-r.Context().Done():
				return
			case <-changed:
				if !valid() {
					return
				}
				if err = write(); err != nil {
					return
				}
			case <-heartbeat.C:
				if !valid() {
					return
				}
				if err = conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
					return
				}
			}
		}
	})(w, r)
}
