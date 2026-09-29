package server

import (
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"blew/api/internal/audit"
	"blew/api/internal/auth"
	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/jackc/pgx/v5"
)

type NotificationPreferences struct {
	Messages bool `json:"messages"`
	Previews bool `json:"previews"`
	Sounds   bool `json:"sounds"`
	Groups   bool `json:"groups"`
	Status   bool `json:"status"`
}

func (s *Server) notificationPreferences(ctx context.Context, userID int64) (NotificationPreferences, error) {
	p := NotificationPreferences{true, true, true, true, true}
	err := s.pool.QueryRow(ctx, `SELECT messages,previews,sounds,groups,status FROM notification_preferences WHERE user_id=$1`, userID).
		Scan(&p.Messages, &p.Previews, &p.Sounds, &p.Groups, &p.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		err = nil
	}
	return p, err
}

func (s *Server) pushKeys(ctx context.Context) (public, private string, err error) {
	err = s.pool.QueryRow(ctx, `SELECT public_key,private_key FROM web_push_keys WHERE singleton`).Scan(&public, &private)
	if !errors.Is(err, pgx.ErrNoRows) {
		return
	}
	private, public, err = webpush.GenerateVAPIDKeys()
	if err != nil {
		return
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO web_push_keys(public_key,private_key) VALUES($1,$2) ON CONFLICT DO NOTHING`, public, private)
	if err != nil {
		return
	}
	err = s.pool.QueryRow(ctx, `SELECT public_key,private_key FROM web_push_keys WHERE singleton`).Scan(&public, &private)
	return
}

func (s *Server) getNotifications(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, err := s.notificationPreferences(r.Context(), u.ID)
	if err != nil {
		s.internalError(w, "notification preferences", err)
		return
	}
	public, _, err := s.pushKeys(r.Context())
	if err != nil {
		s.internalError(w, "push keys", err)
		return
	}
	token, _ := bearerToken(r)
	var subscribed bool
	if err = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM push_subscriptions WHERE session_hash=$1 AND user_id=$2)`, auth.HashToken(token), u.ID).Scan(&subscribed); err != nil {
		s.internalError(w, "get subscription", err)
		return
	}
	writeJSON(w, 200, map[string]any{"settings": p, "public_key": public, "subscribed": subscribed, "user_id": u.ID})
}

func (s *Server) updateNotifications(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Messages *bool `json:"messages"`
		Previews *bool `json:"previews"`
		Sounds   *bool `json:"sounds"`
		Groups   *bool `json:"groups"`
		Status   *bool `json:"status"`
	}
	if err := decodeJSON(w, r, &in); err != nil || in.Messages == nil || in.Previews == nil || in.Sounds == nil || in.Groups == nil || in.Status == nil {
		writeError(w, 400, "provide all five notification preferences")
		return
	}
	_, err := s.pool.Exec(r.Context(), `INSERT INTO notification_preferences(user_id,messages,previews,sounds,groups,status) VALUES($1,$2,$3,$4,$5,$6)
		ON CONFLICT(user_id) DO UPDATE SET messages=EXCLUDED.messages,previews=EXCLUDED.previews,sounds=EXCLUDED.sounds,groups=EXCLUDED.groups,status=EXCLUDED.status`,
		userFrom(r.Context()).ID, *in.Messages, *in.Previews, *in.Sounds, *in.Groups, *in.Status)
	if err != nil {
		s.internalError(w, "save notification preferences", err)
		return
	}
	audit.FromContext(r.Context()).SetAction("notifications.preferences.updated")
	w.WriteHeader(204)
}

func validPushSubscription(sub webpush.Subscription) bool {
	u, err := url.Parse(sub.Endpoint)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Fragment != "" || (u.Port() != "" && u.Port() != "443") || len(sub.Endpoint) > 4096 {
		return false
	}
	host := strings.ToLower(u.Hostname())
	// Never let an authenticated endpoint submission become an arbitrary
	// server-side HTTP request. Redirects are also disabled on the push client.
	// Chromium development/embedded builds can use Google's staging endpoint.
	// Keep the exception exact, not an unrestricted *.google.com allowlist.
	googleStaging := host == "jmt17.google.com" && strings.HasPrefix(u.Path, "/fcm/send/")
	allowed := host == "fcm.googleapis.com" || googleStaging || host == "updates.push.services.mozilla.com" || host == "web.push.apple.com" || strings.HasSuffix(host, ".notify.windows.com")
	if !allowed {
		return false
	}
	key, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(sub.Keys.P256dh, "="))
	if err != nil {
		return false
	}
	if _, err = ecdh.P256().NewPublicKey(key); err != nil {
		return false
	}
	secret, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(sub.Keys.Auth, "="))
	return err == nil && len(secret) == 16
}

func (s *Server) subscribeNotifications(w http.ResponseWriter, r *http.Request) {
	var sub webpush.Subscription
	if err := decodeJSON(w, r, &sub); err != nil || !validPushSubscription(sub) {
		writeError(w, 400, "invalid or unsupported browser push subscription")
		return
	}
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	token, _ := bearerToken(r)
	hash := auth.HashToken(token)
	if _, err := tx.Exec(r.Context(), `DELETE FROM push_subscriptions WHERE session_hash=$1`, hash); err != nil {
		s.internalError(w, "replace subscription", err)
		return
	}
	_, err := tx.Exec(r.Context(), `INSERT INTO push_subscriptions(session_hash,user_id,endpoint,p256dh,auth) VALUES($1,$2,$3,$4,$5)
		ON CONFLICT(endpoint) DO UPDATE SET session_hash=EXCLUDED.session_hash,user_id=EXCLUDED.user_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth`, hash, userFrom(r.Context()).ID, sub.Endpoint, sub.Keys.P256dh, sub.Keys.Auth)
	if err != nil {
		s.internalError(w, "save subscription", err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit subscription", err)
		return
	}
	audit.FromContext(r.Context()).SetAction("notifications.browser.enabled")
	w.WriteHeader(204)
}

func (s *Server) unsubscribeNotifications(w http.ResponseWriter, r *http.Request) {
	token, _ := bearerToken(r)
	_, err := s.pool.Exec(r.Context(), `DELETE FROM push_subscriptions WHERE session_hash=$1 AND user_id=$2`, auth.HashToken(token), userFrom(r.Context()).ID)
	if err != nil {
		s.internalError(w, "remove subscription", err)
		return
	}
	audit.FromContext(r.Context()).SetAction("notifications.browser.disabled")
	w.WriteHeader(204)
}

type pushNotice struct {
	UserID int64  `json:"user_id"`
	Kind   string `json:"kind"`
	Title  string `json:"title"`
	Body   string `json:"body"`
}

func notificationEnabled(p NotificationPreferences, kind string) bool {
	switch kind {
	case "message":
		return p.Messages
	case "group":
		return p.Groups
	case "status":
		return p.Status
	case "test":
		return true
	default:
		return false
	}
}

// sendPush is the delivery boundary for future persisted message/status events.
// The current UI uses mock chats; only the explicit test endpoint invokes it yet.
func (s *Server) sendPush(ctx context.Context, userID int64, sessionHash []byte, notice pushNotice, client webpush.HTTPClient) (int, error) {
	p, err := s.notificationPreferences(ctx, userID)
	if err != nil {
		return 0, err
	}
	if !notificationEnabled(p, notice.Kind) {
		return 0, nil
	}
	if !p.Previews {
		notice.Title = "Blew Chats"
		notice.Body = "You have a new notification."
	}
	notice.UserID = userID
	payload, err := json.Marshal(notice)
	if err != nil {
		return 0, err
	}
	public, private, err := s.pushKeys(ctx)
	if err != nil {
		return 0, err
	}
	rows, err := s.pool.Query(ctx, `SELECT p.endpoint,p.p256dh,p.auth FROM push_subscriptions p JOIN sessions s ON s.token_hash=p.session_hash
		WHERE p.user_id=$1 AND s.expires_at>now() AND ($2::bytea IS NULL OR p.session_hash=$2)`, userID, sessionHash)
	if err != nil {
		return 0, err
	}
	var subscriptions []webpush.Subscription
	for rows.Next() {
		var sub webpush.Subscription
		if err = rows.Scan(&sub.Endpoint, &sub.Keys.P256dh, &sub.Keys.Auth); err != nil {
			rows.Close()
			return 0, err
		}
		subscriptions = append(subscriptions, sub)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	subject := os.Getenv("WEB_PUSH_SUBJECT")
	if subject == "" {
		subject = "https://localhost"
	}
	sent := 0
	for _, sub := range subscriptions {
		if !validPushSubscription(sub) {
			continue
		}
		resp, err := webpush.SendNotificationWithContext(ctx, payload, &sub, &webpush.Options{HTTPClient: client, Subscriber: subject, VAPIDPublicKey: public, VAPIDPrivateKey: private, TTL: 60})
		if err != nil {
			return sent, err
		}
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		if resp.StatusCode == 404 || resp.StatusCode == 410 {
			if _, err = s.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2`, sub.Endpoint, userID); err != nil {
				return sent, err
			}
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return sent, fmt.Errorf("push service returned %d", resp.StatusCode)
		}
		sent++
	}
	return sent, nil
}

func (s *Server) testNotification(w http.ResponseWriter, r *http.Request) {
	token, _ := bearerToken(r)
	sent, err := s.sendPush(r.Context(), userFrom(r.Context()).ID, auth.HashToken(token), pushNotice{Kind: "test", Title: "Blew Chats", Body: "Browser notifications are working."}, nil)
	if err != nil {
		s.internalError(w, "send test notification", err)
		return
	}
	if sent == 0 {
		writeError(w, 409, "Enable notifications in this browser first. An expired subscription may need to be enabled again.")
		return
	}
	audit.FromContext(r.Context()).SetAction("notifications.test")
	writeJSON(w, 200, map[string]int{"sent": sent})
}
