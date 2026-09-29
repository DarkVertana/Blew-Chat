package server

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"blew/api/internal/auth"
	webpush "github.com/SherClockHolmes/webpush-go"
)

func testPushSubscription(t *testing.T, endpoint string) webpush.Subscription {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	secret := make([]byte, 16)
	if _, err = rand.Read(secret); err != nil {
		t.Fatal(err)
	}
	return webpush.Subscription{Endpoint: endpoint, Keys: webpush.Keys{P256dh: base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()), Auth: base64.RawURLEncoding.EncodeToString(secret)}}
}

func TestPushSubscriptionValidation(t *testing.T) {
	sub := testPushSubscription(t, "https://fcm.googleapis.com/fcm/send/example")
	for _, endpoint := range []string{
		"https://fcm.googleapis.com/fcm/send/example", "https://jmt17.google.com/fcm/send/example", "https://updates.push.services.mozilla.com/wpush/v2/example", "https://web.push.apple.com/example", "https://wns2-par02p.notify.windows.com/w/?token=test",
	} {
		sub.Endpoint = endpoint
		if !validPushSubscription(sub) {
			t.Errorf("supported endpoint rejected: %s", endpoint)
		}
	}
	for _, endpoint := range []string{"http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://169.254.169.254/latest/meta-data/", "https://fcm.googleapis.com.evil.test/x", "https://user@fcm.googleapis.com/x", "https://fcm.googleapis.com:8080/x", "https://fcm.googleapis.com/x#fragment"} {
		sub.Endpoint = endpoint
		if validPushSubscription(sub) {
			t.Errorf("unsafe endpoint accepted: %s", endpoint)
		}
	}
	sub.Endpoint = "https://fcm.googleapis.com/x"
	sub.Keys.Auth = "bad-key"
	if validPushSubscription(sub) {
		t.Fatal("invalid encryption key accepted")
	}
}

type fakePushClient struct {
	calls  int
	status int
	body   []byte
	t      *testing.T
}

func (c *fakePushClient) Do(r *http.Request) (*http.Response, error) {
	c.calls++
	if r.URL.Scheme != "https" || r.Header.Get("Authorization") == "" || r.Header.Get("Content-Encoding") != "aes128gcm" {
		c.t.Fatal("push request missing encryption/authentication")
	}
	c.body, _ = io.ReadAll(r.Body)
	return &http.Response{StatusCode: c.status, Body: io.NopCloser(strings.NewReader(""))}, nil
}

func TestNotificationPreferencesAndSessionLifecycle(t *testing.T) {
	s, _, _ := authTestServer(t)
	a := registerTestUser(t, s, "notify-a@example.com")
	b := registerTestUser(t, s, "notify-b@example.com")
	w := authRequest(s.requireAuth(s.getNotifications), "", a.Token, "192.0.2.1")
	if w.Code != 200 || strings.Contains(w.Body.String(), "private_key") {
		t.Fatal("notification state exposes private key or failed")
	}
	var state struct {
		Settings   NotificationPreferences `json:"settings"`
		Public     string                  `json:"public_key"`
		Subscribed bool                    `json:"subscribed"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	if !state.Settings.Messages || !state.Settings.Groups || !state.Settings.Status || state.Subscribed {
		t.Fatal("incorrect defaults")
	}
	pub, _, err := s.pushKeys(context.Background())
	if err != nil || pub != state.Public {
		t.Fatal("VAPID key changed between requests")
	}
	settings := `{"messages":false,"previews":false,"sounds":false,"groups":true,"status":false}`
	if w := authRequest(s.requireAuth(s.updateNotifications), settings, a.Token, "192.0.2.1"); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	pa, _ := s.notificationPreferences(context.Background(), a.User.ID)
	pb, _ := s.notificationPreferences(context.Background(), b.User.ID)
	if pa.Messages || pa.Previews || pa.Sounds || !pa.Groups || pa.Status || !pb.Messages {
		t.Fatal("preferences did not persist independently")
	}
	if w := authRequest(s.requireAuth(s.updateNotifications), `{"messages":true}`, a.Token, "192.0.2.1"); w.Code != 400 {
		t.Fatal("partial invalid preferences accepted")
	}
	sub := testPushSubscription(t, "https://fcm.googleapis.com/fcm/send/test-owner")
	data, _ := json.Marshal(sub)
	if w := authRequest(s.requireAuth(s.subscribeNotifications), string(data), a.Token, "192.0.2.1"); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	client := &fakePushClient{t: t, status: 201}
	count, err := s.sendPush(context.Background(), a.User.ID, nil, pushNotice{Kind: "message", Body: "private text"}, client)
	if err != nil || count != 0 || client.calls != 0 {
		t.Fatal("disabled message preference was ignored")
	}
	count, err = s.sendPush(context.Background(), b.User.ID, nil, pushNotice{Kind: "test", Body: "private text"}, client)
	if err != nil || count != 0 || client.calls != 0 {
		t.Fatal("sent to another user's subscription")
	}
	count, err = s.sendPush(context.Background(), a.User.ID, auth.HashToken(a.Token), pushNotice{Kind: "group", Body: "private text"}, client)
	if err != nil || count != 1 || client.calls != 1 || bytes.Contains(client.body, []byte("private text")) {
		t.Fatalf("encrypted delivery: %d %v", count, err)
	}
	if w := authRequest(s.requireAuth(s.unsubscribeNotifications), "", b.Token, "192.0.2.1"); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	var remaining int
	s.pool.QueryRow(context.Background(), `SELECT count(*) FROM push_subscriptions WHERE user_id=$1`, a.User.ID).Scan(&remaining)
	if remaining != 1 {
		t.Fatal("another user removed subscription")
	}
	if w := authRequest(s.requireAuth(s.logoutAll), "", a.Token, "192.0.2.1"); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	s.pool.QueryRow(context.Background(), `SELECT count(*) FROM push_subscriptions WHERE user_id=$1`, a.User.ID).Scan(&remaining)
	if remaining != 0 {
		t.Fatal("revoked session retained subscription")
	}
	if w := authRequest(s.requireAuth(s.subscribeNotifications), string(data), a.Token, "192.0.2.1"); w.Code != 401 {
		t.Fatal("revoked token registered push")
	}
}

func TestExpiredPushEndpointIsRemoved(t *testing.T) {
	s, _, _ := authTestServer(t)
	a := registerTestUser(t, s, "notify-expired@example.com")
	sub := testPushSubscription(t, "https://web.push.apple.com/test-expired")
	data, _ := json.Marshal(sub)
	if w := authRequest(s.requireAuth(s.subscribeNotifications), string(data), a.Token, "192.0.2.1"); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	client := &fakePushClient{t: t, status: 410}
	count, err := s.sendPush(context.Background(), a.User.ID, nil, pushNotice{Kind: "test"}, client)
	if err != nil || count != 0 || client.calls != 1 {
		t.Fatalf("expired endpoint: %d %v", count, err)
	}
	var n int
	if err = s.pool.QueryRow(context.Background(), `SELECT count(*) FROM push_subscriptions`).Scan(&n); err != nil || n != 0 {
		t.Fatal("expired endpoint retained")
	}
	if w := authRequest(s.requireAuth(s.testNotification), "", a.Token, "192.0.2.1"); w.Code != 409 {
		t.Fatal("test falsely reported success without subscription")
	}
	for _, h := range []http.HandlerFunc{s.getNotifications, s.updateNotifications, s.subscribeNotifications, s.unsubscribeNotifications, s.testNotification} {
		if w := authRequest(s.requireAuth(h), "", "", "192.0.2.1"); w.Code != 401 {
			t.Fatal("unauthenticated notification access")
		}
	}
}
