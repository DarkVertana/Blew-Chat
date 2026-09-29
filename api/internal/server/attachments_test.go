package server

import (
	"blew/api/internal/auth"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAttachmentsAccountIsolationAndTurnBinding(t *testing.T) {
	s, _, _ := authTestServer(t)
	a := registerTestUser(t, s, "files-a@example.com")
	b := registerTestUser(t, s, "files-b@example.com")
	w := botRequest(s, s.saveBot, "POST", a.Token, 0, 0, map[string]string{"name": "Files", "designation": "Assistant"})
	requireStatus(t, w, 200)
	var bot Bot
	json.Unmarshal(w.Body.Bytes(), &bot)
	request := func(method, token, id, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/", strings.NewReader(body))
		r.SetPathValue("id", fmt.Sprint(bot.ID))
		r.SetPathValue("attachment", id)
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("X-File-Name", "notes.txt")
		w := httptest.NewRecorder()
		var h http.HandlerFunc = s.attachment
		if method == "POST" {
			h = s.uploadAttachment
		}
		s.requireAuth(h)(w, r)
		return w
	}
	requireStatus(t, request("POST", b.Token, "", "private"), 404)
	w = request("POST", a.Token, "", "private text")
	requireStatus(t, w, 201)
	var file ChatAttachment
	json.Unmarshal(w.Body.Bytes(), &file)
	requireStatus(t, request("GET", b.Token, file.ID, ""), 404)
	requireStatus(t, request("DELETE", b.Token, file.ID, ""), 404)
	w = request("GET", a.Token, file.ID, "")
	requireStatus(t, w, 200)
	if w.Body.String() != "private text" || !strings.HasPrefix(w.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatal("download did not preserve safe attachment bytes")
	}
	turn := map[string]any{"id": "attachment-turn-1234", "text": "Read my file", "provider": "test", "model": "test", "attachments": []string{file.ID, "missing-file"}}
	requireStatus(t, botRequest(s, s.beginBotTurn, "POST", a.Token, bot.ID, 0, turn), 400)
	turn["attachments"] = []string{file.ID}
	requireStatus(t, botRequest(s, s.beginBotTurn, "POST", a.Token, bot.ID, 0, turn), 200)
	w = botRequest(s, s.botConversation, "GET", a.Token, bot.ID, 0, nil)
	requireStatus(t, w, 200)
	var conversation struct{ Turns []BotTurn }
	if err := json.Unmarshal(w.Body.Bytes(), &conversation); err != nil || len(conversation.Turns) != 1 || len(conversation.Turns[0].Attachments) != 1 {
		t.Fatalf("attachment not persisted: %s", w.Body.String())
	}
	var attempt string
	s.pool.QueryRow(t.Context(), `SELECT attempt FROM bot_turns WHERE bot_id=$1 AND id=$2`, bot.ID, turn["id"]).Scan(&attempt)
	command := "file \"$BLEW_FILE_" + file.ID + "\""
	requireStatus(t, botRequest(s, s.finishBotTurn, "POST", a.Token, bot.ID, 0, map[string]any{"id": turn["id"], "attempt": attempt, "text": "Please approve inspection", "task": map[string]string{"title": "Inspect file", "command": command}}), 204)
	var taskID, computerID, otherID int64
	s.pool.QueryRow(t.Context(), `SELECT id FROM computer_tasks WHERE bot_id=$1`, bot.ID).Scan(&taskID)
	s.pool.QueryRow(t.Context(), `INSERT INTO computers(user_id,token_hash,name,last_seen) SELECT user_id,$1,'Test Linux',now() FROM bots WHERE id=$2 RETURNING id`, auth.HashToken("computer-file-test"), bot.ID).Scan(&computerID)
	s.pool.QueryRow(t.Context(), `INSERT INTO computers(user_id,token_hash,name,last_seen) SELECT user_id,$1,'Other Linux',now() FROM bots WHERE id=$2 RETURNING id`, auth.HashToken("other-file-test"), bot.ID).Scan(&otherID)
	fileRequest := func(token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/", nil)
		r.SetPathValue("task", fmt.Sprint(taskID))
		r.SetPathValue("attachment", file.ID)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		s.companionAttachment(w, r)
		return w
	}
	requireStatus(t, fileRequest("computer-file-test"), 404)
	requireStatus(t, botRequest(s, s.decideComputerTask, "POST", a.Token, bot.ID, taskID, map[string]any{"decision": "approve", "computer_id": computerID}), 204)
	requireStatus(t, fileRequest("computer-file-test"), 404)
	w = authRequest(s.nextComputerTask, "{}", "computer-file-test", "192.0.2.1")
	requireStatus(t, w, 200)
	if !strings.Contains(w.Body.String(), file.ID) {
		t.Fatal("claimed task omitted authorized file")
	}
	requireStatus(t, fileRequest("other-file-test"), 404)
	requireStatus(t, fileRequest("computer-file-test"), 200)
	requireStatus(t, botRequest(s, s.decideComputerTask, "POST", a.Token, bot.ID, taskID, map[string]any{"decision": "cancel"}), 204)
	requireStatus(t, fileRequest("computer-file-test"), 404)
	requireStatus(t, request("DELETE", a.Token, file.ID, ""), 404)
	w = request("POST", a.Token, "", "draft")
	requireStatus(t, w, 201)
	json.Unmarshal(w.Body.Bytes(), &file)
	requireStatus(t, request("DELETE", a.Token, file.ID, ""), 204)
	requireStatus(t, request("GET", a.Token, file.ID, ""), 404)
	requireStatus(t, request("POST", a.Token, "", strings.Repeat("x", (10<<20)+1)), 400)
}
