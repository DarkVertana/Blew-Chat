package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestMemoryArchivesAllHistoryAndSeparatesAccountsAndBots(t *testing.T) {
	s, _, _ := authTestServer(t)
	a := registerTestUser(t, s, "memory-a@example.com")
	b := registerTestUser(t, s, "memory-b@example.com")
	create := func(token string) Bot {
		w := botRequest(s, s.saveBot, "POST", token, 0, 0, map[string]string{"name": "Memory test", "designation": "Assistant"})
		requireStatus(t, w, 200)
		var bot Bot
		json.Unmarshal(w.Body.Bytes(), &bot)
		return bot
	}
	bot := create(a.Token)
	other := create(a.Token)
	foreign := create(b.Token)
	for _, target := range []Bot{bot, other, foreign} {
		for i := 0; i < 65; i++ {
			text := "routine filler conversation"
			if i == 0 {
				text = fmt.Sprintf("My project codeword is marigold%d", target.ID)
			}
			_, err := s.pool.Exec(t.Context(), `INSERT INTO bot_turns(id,bot_id,user_text,assistant_text,status,attempt,provider,model,started_at) VALUES($1,$2,$3,'Acknowledged','complete','test','test','test',now()+$4*interval '1 second')`, fmt.Sprintf("memory-turn-%016d", i), target.ID, text, i)
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	call := func(token string, id int64, query string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/?q="+url.QueryEscape(query), nil)
		r.SetPathValue("id", fmt.Sprint(id))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		s.requireAuth(s.searchMemory)(w, r)
		return w
	}
	requireStatus(t, call(b.Token, bot.ID, "marigold"), 404)
	w := call(a.Token, bot.ID, fmt.Sprintf("marigold%d", bot.ID))
	requireStatus(t, w, 200)
	var result Recall
	json.Unmarshal(w.Body.Bytes(), &result)
	found := false
	for _, m := range result.Memories {
		if strings.Contains(m.Body, fmt.Sprintf("marigold%d", bot.ID)) {
			found = true
		}
		if strings.Contains(m.Body, fmt.Sprintf("marigold%d", other.ID)) || strings.Contains(m.Body, fmt.Sprintf("marigold%d", foreign.ID)) {
			t.Fatal("cross-bot recall")
		}
	}
	if !found || result.Total != 130 {
		t.Fatalf("old history missing: %s", w.Body.String())
	}
	requireStatus(t, botRequest(s, s.saveMemory, "POST", a.Token, bot.ID, 0, map[string]string{"text": "Always remember my explicit preference for jasmine tea"}), 204)
	w = call(a.Token, bot.ID, "jasmine")
	requireStatus(t, w, 200)
	json.Unmarshal(w.Body.Bytes(), &result)
	var noteID int64
	for _, m := range result.Memories {
		if m.Kind == "note" {
			noteID = m.ID
		}
	}
	if noteID == 0 {
		t.Fatal("saved note missing")
	}
	forget := func(token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("DELETE", "/", nil)
		r.SetPathValue("id", fmt.Sprint(bot.ID))
		r.SetPathValue("memory", fmt.Sprint(noteID))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		s.requireAuth(s.forgetMemory)(w, r)
		return w
	}
	requireStatus(t, forget(b.Token), 404)
	requireStatus(t, forget(a.Token), 204)
	w = call(a.Token, bot.ID, "jasmine")
	if strings.Contains(w.Body.String(), "jasmine") {
		t.Fatal("excluded memory returned")
	}
	// The vector index cannot smuggle another bot's records or stale/hidden records.
	var foreignID, revision int64
	s.pool.QueryRow(t.Context(), `SELECT id,revision FROM bot_memories WHERE bot_id=$1 LIMIT 1`, foreign.ID).Scan(&foreignID, &revision)
	vector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"hits": []map[string]any{{"id": foreignID, "revision": revision}, {"id": noteID, "revision": 1}}})
	}))
	defer vector.Close()
	t.Setenv("MEMORY_URL", vector.URL)
	t.Setenv("MEMORY_SECRET", strings.Repeat("m", 32))
	w = call(a.Token, bot.ID, "jasmine")
	requireStatus(t, w, 200)
	if strings.Contains(w.Body.String(), "jasmine") || strings.Contains(w.Body.String(), fmt.Sprintf("marigold%d", foreign.ID)) {
		t.Fatal("vector index bypassed live authorization")
	}
}
func TestMemoryIndexesEntireTextFilesAndLinuxOutputs(t *testing.T) {
	s, _, _ := authTestServer(t)
	a := registerTestUser(t, s, "memory-files@example.com")
	w := botRequest(s, s.saveBot, "POST", a.Token, 0, 0, map[string]string{"name": "Files", "designation": "Assistant"})
	var bot Bot
	json.Unmarshal(w.Body.Bytes(), &bot)
	_, err := s.pool.Exec(t.Context(), `INSERT INTO bot_turns(id,bot_id,user_text,status,attempt,provider,model) VALUES('memory-file-turn123',$1,'Read file','pending','test','test','test')`, bot.ID)
	if err != nil {
		t.Fatal(err)
	}
	contents := strings.Repeat("ordinary material ", 4000) + "finalsectionneedle attachment fact"
	_, err = s.pool.Exec(t.Context(), `INSERT INTO bot_attachments(id,bot_id,turn_id,name,media_type,data) VALUES($1,$2,'memory-file-turn123','long.txt','text/plain',$3)`, strings.Repeat("a", 48), bot.ID, []byte(contents))
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.recall(t.Context(), bot.ID, a.User.ID, "finalsectionneedle", "")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, m := range result.Memories {
		if m.Kind == "file" && strings.Contains(m.Body, "finalsectionneedle") && m.AttachmentID != nil {
			found = true
		}
	}
	if !found {
		t.Fatal("file content beyond context cap was lost")
	}
	_, err = s.pool.Exec(t.Context(), `INSERT INTO computer_tasks(bot_id,turn_id,title,command,status,output) VALUES($1,'memory-file-turn123','Inspect PDF','pdftotext','complete','Document evidence: quartzneedle deadline is Friday')`, bot.ID)
	if err != nil {
		t.Fatal(err)
	}
	result, err = s.recall(t.Context(), bot.ID, a.User.ID, "quartzneedle", "")
	if err != nil {
		t.Fatal(err)
	}
	found = false
	for _, m := range result.Memories {
		if m.Kind == "task" && strings.Contains(m.Body, "quartzneedle") {
			found = true
		}
	}
	if !found {
		t.Fatal("Linux extracted content not remembered")
	}
}
