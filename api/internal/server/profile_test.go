package server

import (
	"bytes"
	"encoding/json"
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProfilePersistsLongAboutAndIsolatesUsers(t *testing.T) {
	s, _, _ := authTestServer(t)
	a := registerTestUser(t, s, "profile-a@example.com")
	b := registerTestUser(t, s, "profile-b@example.com")
	about := strings.Repeat("About me 🌱\n", 110000) + "  trailing whitespace\n"
	body, _ := json.Marshal(map[string]string{"name": "  Pratik  ", "about": about})
	w := authRequest(s.requireAuth(s.updateProfile), string(body), a.Token, "192.0.2.1")
	if w.Code != 204 {
		t.Fatalf("save long profile: %d %s", w.Code, w.Body.String())
	}
	w = authRequest(s.requireAuth(s.getProfile), "", a.Token, "192.0.2.1")
	var got Profile
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Name != "Pratik" || got.About != about {
		t.Fatal("profile was truncated or not persisted")
	}
	w = authRequest(s.requireAuth(s.getProfile), "", b.Token, "192.0.2.1")
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Name != "" || got.About != "" || got.ImageVersion != nil {
		t.Fatal("another user's profile leaked")
	}
	w = authRequest(s.requireAuth(s.updateProfile), `{"name":"Attacker","about":"x","user_id":1}`, b.Token, "192.0.2.1")
	if w.Code != 400 {
		t.Fatalf("unknown ownership field: %d", w.Code)
	}
	w = authRequest(s.requireAuth(s.updateProfile), `{"name":"Pratik","about":""}`, a.Token, "192.0.2.1")
	if w.Code != 204 {
		t.Fatal("could not clear About")
	}
	for _, h := range []http.HandlerFunc{s.getProfile, s.updateProfile, s.getProfileImage, s.uploadProfileImage, s.deleteProfileImage} {
		if w := authRequest(s.requireAuth(h), "", "", "192.0.2.1"); w.Code != 401 {
			t.Fatalf("unauthenticated profile access: %d", w.Code)
		}
	}
}

func profileImageRequest(s *Server, data []byte, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("PUT", "/api/profile/image", bytes.NewReader(data))
	r.Header.Set("Authorization", "Bearer "+token)
	// Spoofing the declared MIME type must never bypass content validation.
	r.Header.Set("Content-Type", "image/png")
	w := httptest.NewRecorder()
	s.requireAuth(s.uploadProfileImage)(w, r)
	return w
}

func TestProfileImagesValidatePersistAndRemainPrivate(t *testing.T) {
	s, _, _ := authTestServer(t)
	a := registerTestUser(t, s, "photo-a@example.com")
	b := registerTestUser(t, s, "photo-b@example.com")
	authRequest(s.requireAuth(s.updateProfile), `{"name":"Photo user","about":"Keep this text"}`, a.Token, "192.0.2.1")
	for _, format := range []string{"png", "jpeg"} {
		var buf bytes.Buffer
		img := image.NewRGBA(image.Rect(0, 0, 2, 2))
		if format == "png" {
			png.Encode(&buf, img)
		} else {
			jpeg.Encode(&buf, img, nil)
		}
		w := profileImageRequest(s, buf.Bytes(), a.Token)
		if w.Code != 200 {
			t.Fatalf("upload %s: %d %s", format, w.Code, w.Body.String())
		}
		w = authRequest(s.requireAuth(s.getProfileImage), "", a.Token, "192.0.2.1")
		if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), buf.Bytes()) || w.Header().Get("Content-Type") != "image/"+format {
			t.Fatal("image did not round-trip")
		}
		w = authRequest(s.requireAuth(s.getProfileImage), "", b.Token, "192.0.2.1")
		if w.Code != 404 {
			t.Fatal("another user's photo leaked")
		}
	}
	for _, bad := range [][]byte{[]byte(`<svg onload="alert(1)"></svg>`), []byte("not an image"), bytes.Repeat([]byte("x"), maxProfileImageBytes+1)} {
		w := profileImageRequest(s, bad, a.Token)
		if w.Code != 400 && w.Code != 413 {
			t.Fatalf("invalid image accepted: %d", w.Code)
		}
	}
	var oversized bytes.Buffer
	png.Encode(&oversized, image.NewRGBA(image.Rect(0, 0, 4097, 1)))
	if w := profileImageRequest(s, oversized.Bytes(), a.Token); w.Code != 400 {
		t.Fatal("oversized dimensions accepted")
	}
	w := authRequest(s.requireAuth(s.getProfile), "", a.Token, "192.0.2.1")
	var profile Profile
	json.Unmarshal(w.Body.Bytes(), &profile)
	if profile.Name != "Photo user" || profile.About != "Keep this text" || profile.ImageVersion == nil {
		t.Fatal("image update overwrote profile text")
	}
	authRequest(s.requireAuth(s.updateProfile), `{"name":"Updated","about":"New text"}`, a.Token, "192.0.2.1")
	if w := authRequest(s.requireAuth(s.getProfileImage), "", a.Token, "192.0.2.1"); w.Code != 200 {
		t.Fatal("text save removed image")
	}
	if w := authRequest(s.requireAuth(s.deleteProfileImage), "", a.Token, "192.0.2.1"); w.Code != 204 {
		t.Fatal("image deletion failed")
	}
	if w := authRequest(s.requireAuth(s.getProfileImage), "", a.Token, "192.0.2.1"); w.Code != 404 {
		t.Fatal("image deletion did not persist")
	}
}
