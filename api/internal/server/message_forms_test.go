package server

import (
	"encoding/json"
	"testing"
)

func TestMessageFormsPersistAnswerAndRejectDuplicates(t *testing.T) {
	s, _, _ := authTestServer(t)
	a := registerTestUser(t, s, "forms@example.com")
	w := botRequest(s, s.saveBot, "POST", a.Token, 0, 0, map[string]string{"name": "Form bot", "designation": "Assistant"})
	requireStatus(t, w, 200)
	var bot Bot
	json.Unmarshal(w.Body.Bytes(), &bot)
	_, err := s.pool.Exec(t.Context(), `INSERT INTO bot_turns(id,bot_id,user_text,assistant_text,status,attempt,provider,model) VALUES('form-parent-123456',$1,'Choose','Form displayed','complete','test','test','test')`, bot.ID)
	if err != nil {
		t.Fatal(err)
	}
	answer := map[string]any{"id": "form-answer-123456", "text": "Size: Medium\nResponse: Agree", "provider": "test", "model": "test", "reply_to": "form-parent-123456"}
	requireStatus(t, botRequest(s, s.beginBotTurn, "POST", a.Token, bot.ID, 0, answer), 200)
	w = botRequest(s, s.botConversation, "GET", a.Token, bot.ID, 0, nil)
	requireStatus(t, w, 200)
	var conversation struct{ Turns []BotTurn }
	json.Unmarshal(w.Body.Bytes(), &conversation)
	if len(conversation.Turns) != 2 || conversation.Turns[1].ReplyTo != "form-parent-123456" {
		t.Fatalf("form answer not persisted: %s", w.Body.String())
	}
	answer["id"] = "duplicate-answer-123"
	requireStatus(t, botRequest(s, s.beginBotTurn, "POST", a.Token, bot.ID, 0, answer), 409)
	answer["reply_to"] = "unknown-parent-123"
	requireStatus(t, botRequest(s, s.beginBotTurn, "POST", a.Token, bot.ID, 0, answer), 409)
}
