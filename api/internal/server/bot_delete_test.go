package server

import (
	"encoding/json"
	"testing"
)

func TestDeleteBotOwnedAndCascades(t *testing.T) {
	s, _, _ := authTestServer(t)
	owner := registerTestUser(t, s, "delete-owner@example.com")
	other := registerTestUser(t, s, "delete-other@example.com")
	w := botRequest(s, s.saveBot, "POST", owner.Token, 0, 0, map[string]string{"name": "Disposable bot", "designation": "Assistant"})
	requireStatus(t, w, 200)
	var bot Bot
	json.Unmarshal(w.Body.Bytes(), &bot)
	_, err := s.pool.Exec(t.Context(), `INSERT INTO bot_turns(id,bot_id,user_text,assistant_text,status,attempt,provider,model) VALUES('delete-turn-123456',$1,'Remember me','Remembered','complete','test','test','test')`, bot.ID)
	if err != nil {
		t.Fatal(err)
	}
	requireStatus(t, botRequest(s, s.deleteBot, "DELETE", other.Token, bot.ID, 0, nil), 404)
	requireStatus(t, botRequest(s, s.botConversation, "GET", owner.Token, bot.ID, 0, nil), 200)
	requireStatus(t, botRequest(s, s.deleteBot, "DELETE", owner.Token, bot.ID, 0, nil), 204)
	requireStatus(t, botRequest(s, s.botConversation, "GET", owner.Token, bot.ID, 0, nil), 404)
	for _, table := range []string{"bot_turns", "bot_memories", "bot_memory_notes", "bot_attachments", "computer_tasks", "bot_schedules", "schedule_runs"} {
		var count int
		if err := s.pool.QueryRow(t.Context(), "SELECT count(*) FROM "+table+" WHERE bot_id=$1", bot.ID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s retained bot data", table)
		}
	}
	requireStatus(t, botRequest(s, s.deleteBot, "DELETE", owner.Token, bot.ID, 0, nil), 404)
}
