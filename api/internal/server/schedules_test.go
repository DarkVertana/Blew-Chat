package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func scheduleRequest(s *Server, h http.HandlerFunc, token, method string, botID, scheduleID int64, body any) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	r := httptest.NewRequest(method, "/", strings.NewReader(string(data)))
	r.SetPathValue("id", fmt.Sprint(botID))
	r.SetPathValue("schedule", fmt.Sprint(scheduleID))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	s.requireAuth(h)(w, r)
	return w
}
func workerRequest(s *Server, h http.HandlerFunc, body any, key string) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	r := httptest.NewRequest("POST", "/", strings.NewReader(string(data)))
	r.Header.Set("X-Scheduler-Key", key)
	w := httptest.NewRecorder()
	s.schedulerAuth(h)(w, r)
	return w
}

const schedulerTestKey = "private-test-scheduler-key-1234567890"

func TestScheduleCalendarValidation(t *testing.T) {
	now := time.Date(2026, 9, 29, 0, 0, 0, 0, time.UTC)
	next, err := nextSchedule(BotSchedule{Kind: "cron", Cron: "0 9 * * 1-5", Timezone: "Asia/Kolkata"}, now)
	if err != nil || !next.Equal(time.Date(2026, 9, 29, 3, 30, 0, 0, time.UTC)) {
		t.Fatalf("timezone calculation: %v %v", next, err)
	}
	next, err = nextSchedule(BotSchedule{Kind: "cron", Cron: "0 9 31 * *", Timezone: "UTC"}, now)
	if err != nil || next.Month() != time.October || next.Day() != 31 {
		t.Fatalf("invalid calendar day not skipped: %v %v", next, err)
	}
	for _, job := range []BotSchedule{{Kind: "cron", Cron: "* * * * * *", Timezone: "UTC"}, {Kind: "cron", Cron: "0 9 * * *", Timezone: "Not/AZone"}, {Kind: "cron", Cron: "0 9 31 2 *", Timezone: "UTC"}, {Kind: "once", RunAt: &now, Timezone: "UTC"}} {
		if _, err = nextSchedule(job, now); err == nil {
			t.Fatalf("accepted invalid schedule %+v", job)
		}
	}
}
func TestSchedulesOwnershipClaimsPauseAndRecovery(t *testing.T) {
	t.Setenv("SCHEDULER_SECRET", schedulerTestKey)
	s, _, _ := authTestServer(t)
	a := registerTestUser(t, s, "schedule-a@example.com")
	b := registerTestUser(t, s, "schedule-b@example.com")
	w := botRequest(s, s.saveBot, "POST", a.Token, 0, 0, map[string]string{"name": "Routine bot", "designation": "Assistant"})
	requireStatus(t, w, 200)
	var bot Bot
	json.Unmarshal(w.Body.Bytes(), &bot)
	details := map[string]any{"title": "Daily review", "prompt": "Review my tasks", "mode": "ai", "kind": "cron", "cron": "0 9 * * *", "timezone": "Asia/Kolkata"}
	requireStatus(t, scheduleRequest(s, s.saveSchedule, b.Token, "POST", bot.ID, 0, details), 404)
	requireStatus(t, scheduleRequest(s, s.listSchedules, b.Token, "GET", bot.ID, 0, nil), 404)
	w = scheduleRequest(s, s.saveSchedule, a.Token, "POST", bot.ID, 0, details)
	requireStatus(t, w, 200)
	var job BotSchedule
	json.Unmarshal(w.Body.Bytes(), &job)
	requireStatus(t, workerRequest(s, s.claimSchedule, nil, ""), 401)
	requireStatus(t, workerRequest(s, s.claimSchedule, nil, a.Token), 401)
	requireStatus(t, scheduleRequest(s, s.controlSchedule, b.Token, "POST", bot.ID, job.ID, map[string]string{"action": "run"}), 404)
	requireStatus(t, scheduleRequest(s, s.controlSchedule, a.Token, "POST", bot.ID, job.ID, map[string]string{"action": "pause"}), 204)
	requireStatus(t, scheduleRequest(s, s.controlSchedule, a.Token, "POST", bot.ID, job.ID, map[string]string{"action": "run"}), 204)
	type claimed struct {
		Run *struct {
			ID     int64  `json:"id"`
			Lease  string `json:"lease"`
			UserID int64  `json:"user_id"`
			Bot    Bot    `json:"bot"`
		}
	}
	var wg sync.WaitGroup
	outputs := make(chan *httptest.ResponseRecorder, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); outputs <- workerRequest(s, s.claimSchedule, nil, schedulerTestKey) }()
	}
	wg.Wait()
	close(outputs)
	var claim claimed
	count := 0
	for out := range outputs {
		requireStatus(t, out, 200)
		var c claimed
		json.Unmarshal(out.Body.Bytes(), &c)
		if c.Run != nil {
			claim = c
			count++
		}
	}
	if count != 1 || claim.Run.Bot.ID != bot.ID {
		t.Fatalf("claim count %d", count)
	}
	var enabled bool
	s.pool.QueryRow(t.Context(), `SELECT enabled FROM bot_schedules WHERE id=$1`, job.ID).Scan(&enabled)
	if enabled {
		t.Fatal("manual run unexpectedly resumed paused recurrence")
	}
	finish := map[string]any{"id": claim.Run.ID, "lease": strings.Repeat("x", 64), "text": "Done"}
	requireStatus(t, workerRequest(s, s.finishSchedule, finish, schedulerTestKey), 409)
	finish["lease"] = claim.Run.Lease
	requireStatus(t, workerRequest(s, s.finishSchedule, finish, schedulerTestKey), 204)
	requireStatus(t, workerRequest(s, s.finishSchedule, finish, schedulerTestKey), 409)
	// A restart sees persisted completion and cannot dispatch it twice.
	restarted := &Server{pool: s.pool, dummyHash: s.dummyHash}
	w = workerRequest(restarted, restarted.claimSchedule, nil, schedulerTestKey)
	requireStatus(t, w, 200)
	if !strings.Contains(w.Body.String(), `"run":null`) {
		t.Fatal("completed run replayed")
	}
	requireStatus(t, scheduleRequest(s, s.controlSchedule, a.Token, "POST", bot.ID, job.ID, map[string]string{"action": "run"}), 204)
	w = workerRequest(s, s.claimSchedule, nil, schedulerTestKey)
	requireStatus(t, w, 200)
	json.Unmarshal(w.Body.Bytes(), &claim)
	requireStatus(t, scheduleRequest(s, s.controlSchedule, a.Token, "POST", bot.ID, job.ID, map[string]string{"action": "pause"}), 204)
	finish["id"] = claim.Run.ID
	finish["lease"] = claim.Run.Lease
	requireStatus(t, workerRequest(s, s.finishSchedule, finish, schedulerTestKey), 409)
	requireStatus(t, scheduleRequest(s, s.controlSchedule, a.Token, "POST", bot.ID, job.ID, map[string]string{"action": "run"}), 204)
	w = workerRequest(s, s.claimSchedule, nil, schedulerTestKey)
	requireStatus(t, w, 200)
	json.Unmarshal(w.Body.Bytes(), &claim)
	if _, err := s.pool.Exec(t.Context(), `UPDATE schedule_runs SET started_at=now()-interval '6 minutes' WHERE id=$1`, claim.Run.ID); err != nil {
		t.Fatal(err)
	}
	requireStatus(t, workerRequest(s, s.claimSchedule, nil, schedulerTestKey), 200)
	var status string
	s.pool.QueryRow(t.Context(), `SELECT status FROM schedule_runs WHERE id=$1`, claim.Run.ID).Scan(&status)
	if status != "failed" {
		t.Fatal("interrupted run not failed")
	}
	w = scheduleRequest(s, s.listSchedules, a.Token, "GET", bot.ID, 0, nil)
	requireStatus(t, w, 200)
	if strings.Contains(w.Body.String(), claim.Run.Lease) {
		t.Fatal("private execution lease leaked")
	}
}
func TestScheduledLinuxRequiresApprovalAndNeverCrossesAccounts(t *testing.T) {
	t.Setenv("SCHEDULER_SECRET", schedulerTestKey)
	s, _, _ := authTestServer(t)
	a := registerTestUser(t, s, "cron-linux-a@example.com")
	b := registerTestUser(t, s, "cron-linux-b@example.com")
	w := botRequest(s, s.saveBot, "POST", a.Token, 0, 0, map[string]string{"name": "Linux bot", "designation": "Engineer"})
	var bot Bot
	json.Unmarshal(w.Body.Bytes(), &bot)
	pair := func(token string) int64 {
		w := botRequest(s, s.createPairing, "POST", token, 0, 0, nil)
		var code map[string]string
		json.Unmarshal(w.Body.Bytes(), &code)
		w = authRequest(s.pairComputer, fmt.Sprintf(`{"code":%q,"name":"Linux test","platform":"linux"}`, code["code"]), "", "192.0.2.1")
		requireStatus(t, w, 200)
		var c Computer
		json.Unmarshal(w.Body.Bytes(), &c)
		return c.ID
	}
	ca, cb := pair(a.Token), pair(b.Token)
	future := time.Now().Add(time.Hour).Format(time.RFC3339)
	input := map[string]any{"title": "Inspect Linux", "prompt": "uname -s", "mode": "command", "kind": "once", "run_at": future, "timezone": "UTC", "computer_id": ca}
	requireStatus(t, scheduleRequest(s, s.saveSchedule, a.Token, "POST", bot.ID, 0, input), 400)
	input["approve_command"] = true
	input["computer_id"] = cb
	requireStatus(t, scheduleRequest(s, s.saveSchedule, a.Token, "POST", bot.ID, 0, input), 404)
	input["computer_id"] = ca
	w = scheduleRequest(s, s.saveSchedule, a.Token, "POST", bot.ID, 0, input)
	requireStatus(t, w, 200)
	var job BotSchedule
	json.Unmarshal(w.Body.Bytes(), &job)
	s.pool.Exec(t.Context(), `UPDATE bot_schedules SET next_run=now()-interval '1 second' WHERE id=$1`, job.ID)
	requireStatus(t, workerRequest(s, s.claimSchedule, nil, schedulerTestKey), 200)
	var task ComputerTask
	s.pool.QueryRow(t.Context(), `SELECT computer_id,command,status FROM computer_tasks WHERE bot_id=$1`, bot.ID).Scan(&task.ComputerID, &task.Command, &task.Status)
	if task.ComputerID == nil || *task.ComputerID != ca || task.Command != "uname -s" || task.Status != "approved" {
		t.Fatalf("incorrect command dispatch %+v", task)
	}
	requireStatus(t, scheduleRequest(s, s.controlSchedule, a.Token, "POST", bot.ID, job.ID, map[string]string{"action": "pause"}), 204)
	s.pool.QueryRow(t.Context(), `SELECT status FROM computer_tasks WHERE bot_id=$1`, bot.ID).Scan(&task.Status)
	if task.Status != "cancelled" {
		t.Fatal("pause left command queued")
	}
}
