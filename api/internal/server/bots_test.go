package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func botRequest(s *Server, h http.HandlerFunc, method, token string, id, task int64, body any) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	r := httptest.NewRequest(method, "/", strings.NewReader(string(data)))
	r.Header.Set("Authorization", "Bearer "+token)
	r.SetPathValue("id", fmt.Sprint(id))
	r.SetPathValue("task", fmt.Sprint(task))
	w := httptest.NewRecorder()
	s.requireAuth(h)(w, r)
	return w
}
func requireStatus(t *testing.T, w *httptest.ResponseRecorder, status int) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("expected %d, got %d: %s", status, w.Code, w.Body.String())
	}
}
func TestBotsOwnershipRetryAndComputerApproval(t *testing.T) {
	s, _, _ := authTestServer(t)
	a := registerTestUser(t, s, "bot-a@example.com")
	b := registerTestUser(t, s, "bot-b@example.com")
	w := botRequest(s, s.saveBot, "POST", a.Token, 0, 0, map[string]string{"name": "Alex", "designation": "Engineer", "instructions": "Private instructions"})
	requireStatus(t, w, 200)
	var bot Bot
	json.Unmarshal(w.Body.Bytes(), &bot)
	for _, h := range []http.HandlerFunc{s.botConversation, s.botImage, s.beginBotTurn, s.finishBotTurn, s.listComputerTasks, s.decideComputerTask} {
		requireStatus(t, botRequest(s, h, "GET", b.Token, bot.ID, 1, nil), 404)
	}
	w = botRequest(s, s.listBots, "GET", b.Token, 0, 0, nil)
	requireStatus(t, w, 200)
	if w.Body.String() != "[]\n" {
		t.Fatal("another account can see bot")
	}
	requireStatus(t, botRequest(s, s.saveBot, "PUT", b.Token, bot.ID, 0, map[string]string{"name": "Changed", "designation": "Engineer"}), 404)
	turn := map[string]string{"id": "request-1234567890", "text": "Inspect Linux", "provider": "codex", "model": "test"}
	w = botRequest(s, s.beginBotTurn, "POST", a.Token, bot.ID, 0, turn)
	requireStatus(t, w, 200)
	var first struct {
		Attempt string
		Started bool
	}
	json.Unmarshal(w.Body.Bytes(), &first)
	w = botRequest(s, s.beginBotTurn, "POST", a.Token, bot.ID, 0, turn)
	requireStatus(t, w, 200)
	if strings.Contains(w.Body.String(), `"started":true`) {
		t.Fatal("duplicate generation started")
	}
	finish := map[string]any{"id": turn["id"], "attempt": first.Attempt, "error": "retry me"}
	requireStatus(t, botRequest(s, s.finishBotTurn, "POST", a.Token, bot.ID, 0, finish), 204)
	w = botRequest(s, s.beginBotTurn, "POST", a.Token, bot.ID, 0, turn)
	requireStatus(t, w, 200)
	var second struct{ Attempt string }
	json.Unmarshal(w.Body.Bytes(), &second)
	requireStatus(t, botRequest(s, s.finishBotTurn, "POST", a.Token, bot.ID, 0, finish), 409)
	finish = map[string]any{"id": turn["id"], "attempt": second.Attempt, "text": "Review this task", "task": map[string]string{"title": "Inspect Linux", "command": "uname -s"}}
	requireStatus(t, botRequest(s, s.finishBotTurn, "POST", a.Token, bot.ID, 0, finish), 204)
	w = botRequest(s, s.listComputerTasks, "GET", a.Token, bot.ID, 0, nil)
	requireStatus(t, w, 200)
	var tasks []ComputerTask
	json.Unmarshal(w.Body.Bytes(), &tasks)
	if len(tasks) != 1 || tasks[0].Status != "proposed" {
		t.Fatal("task must begin unapproved")
	}
	taskID := tasks[0].ID
	pair := func(token string) (int64, string) {
		t.Helper()
		w := botRequest(s, s.createPairing, "POST", token, 0, 0, nil)
		requireStatus(t, w, 200)
		var code map[string]string
		json.Unmarshal(w.Body.Bytes(), &code)
		body := fmt.Sprintf(`{"code":%q,"name":"Test Linux","platform":"linux"}`, code["code"])
		w = authRequest(s.pairComputer, body, "", "192.0.2.1")
		requireStatus(t, w, 200)
		var result struct {
			ID    int64
			Token string
		}
		json.Unmarshal(w.Body.Bytes(), &result)
		requireStatus(t, authRequest(s.pairComputer, body, "", "192.0.2.1"), 401)
		return result.ID, result.Token
	}
	computerA, tokenA := pair(a.Token)
	computerB, tokenB := pair(b.Token)
	w = authRequest(s.nextComputerTask, "{}", tokenA, "192.0.2.1")
	requireStatus(t, w, 200)
	if !strings.Contains(w.Body.String(), `"task":null`) {
		t.Fatal("unapproved task dispatched")
	}
	requireStatus(t, botRequest(s, s.decideComputerTask, "POST", a.Token, bot.ID, taskID, map[string]any{"decision": "approve", "computer_id": computerB}), 409)
	requireStatus(t, botRequest(s, s.decideComputerTask, "POST", a.Token, bot.ID, taskID, map[string]any{"decision": "approve", "computer_id": computerA}), 204)
	w = authRequest(s.nextComputerTask, "{}", tokenB, "192.0.2.1")
	if strings.Contains(w.Body.String(), "uname") {
		t.Fatal("task crossed accounts")
	}
	w = authRequest(s.nextComputerTask, "{}", tokenA, "192.0.2.1")
	requireStatus(t, w, 200)
	if !strings.Contains(w.Body.String(), "uname -s") {
		t.Fatal("approved task not dispatched")
	}
	w = authRequest(s.nextComputerTask, "{}", tokenA, "192.0.2.1")
	if !strings.Contains(w.Body.String(), `"task":null`) {
		t.Fatal("task dispatched twice")
	}
	resultRequest := func(token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/", strings.NewReader(`{"output":"Linux","exit_code":0}`))
		r.Header.Set("Authorization", "Bearer "+token)
		r.SetPathValue("task", fmt.Sprint(taskID))
		w := httptest.NewRecorder()
		s.completeComputerTask(w, r)
		return w
	}
	requireStatus(t, resultRequest(tokenB), 409)
	requireStatus(t, resultRequest(tokenA), 204)
	requireStatus(t, resultRequest(tokenA), 409)
	requireStatus(t, botRequest(s, s.revokeComputer, "DELETE", b.Token, computerA, 0, nil), 404)
	requireStatus(t, botRequest(s, s.revokeComputer, "DELETE", a.Token, computerA, 0, nil), 204)
	requireStatus(t, authRequest(s.nextComputerTask, "{}", tokenA, "192.0.2.1"), 401)
	requireStatus(t, authRequest(s.nextComputerTask, "{}", a.Token, "192.0.2.1"), 401)
}
