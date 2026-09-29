package server

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/jackc/pgx/v5"
	"github.com/robfig/cron/v3"
)

type BotSchedule struct {
	RequestedRun *time.Time `json:"requested_run"`
	ID           int64      `json:"id"`
	BotID        int64      `json:"bot_id"`
	Title        string     `json:"title"`
	Prompt       string     `json:"prompt"`
	Mode         string     `json:"mode"`
	ComputerID   *int64     `json:"computer_id"`
	Kind         string     `json:"kind"`
	Cron         string     `json:"cron"`
	Timezone     string     `json:"timezone"`
	RunAt        *time.Time `json:"run_at"`
	NextRun      *time.Time `json:"next_run"`
	Enabled      bool       `json:"enabled"`
}
type ScheduleRun struct {
	ID         int64      `json:"id"`
	ScheduleID int64      `json:"schedule_id"`
	Title      string     `json:"title"`
	TurnID     string     `json:"turn_id"`
	Status     string     `json:"status"`
	Error      string     `json:"error"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
}

const scheduleColumns = `id,bot_id,title,prompt,mode,computer_id,kind,cron,timezone,run_at,next_run,enabled,requested_run`

func scanSchedule(row pgx.Row) (BotSchedule, error) {
	var s BotSchedule
	err := row.Scan(&s.ID, &s.BotID, &s.Title, &s.Prompt, &s.Mode, &s.ComputerID, &s.Kind, &s.Cron, &s.Timezone, &s.RunAt, &s.NextRun, &s.Enabled, &s.RequestedRun)
	return s, err
}
func nextSchedule(in BotSchedule, after time.Time) (time.Time, error) {
	if _, err := time.LoadLocation(in.Timezone); err != nil || strings.ContainsAny(in.Timezone, " \t\n") {
		return time.Time{}, errors.New("choose a valid IANA timezone, such as Asia/Kolkata")
	}
	if in.Kind == "once" {
		if in.RunAt == nil || !in.RunAt.After(after) {
			return time.Time{}, errors.New("choose a future date and time")
		}
		return *in.RunAt, nil
	}
	if in.Kind != "cron" || len(in.Cron) > 150 || len(strings.Fields(in.Cron)) != 5 {
		return time.Time{}, errors.New("use five cron fields: minute hour day month weekday")
	}
	rule, err := cron.ParseStandard("CRON_TZ=" + in.Timezone + " " + in.Cron)
	if err != nil {
		return time.Time{}, errors.New("invalid cron expression; use standard numbers, ranges, lists and steps")
	}
	next := rule.Next(after)
	if next.IsZero() {
		return next, errors.New("this cron expression has no upcoming date")
	}
	return next, nil
}
func (s *Server) listSchedules(w http.ResponseWriter, r *http.Request) {
	b, ok := s.ownedBot(w, r)
	if !ok {
		return
	}
	rows, err := s.pool.Query(r.Context(), `SELECT `+scheduleColumns+` FROM bot_schedules WHERE bot_id=$1 AND deleted_at IS NULL ORDER BY id DESC`, b.ID)
	if err != nil {
		s.internalError(w, "list schedules", err)
		return
	}
	defer rows.Close()
	schedules := []BotSchedule{}
	for rows.Next() {
		item, err := scanSchedule(rows)
		if err != nil {
			s.internalError(w, "read schedule", err)
			return
		}
		schedules = append(schedules, item)
	}
	if rows.Err() != nil {
		s.internalError(w, "read schedules", rows.Err())
		return
	}
	rows.Close()
	runs := []ScheduleRun{}
	rows, err = s.pool.Query(r.Context(), `SELECT id,schedule_id,title,turn_id,status,error,started_at,finished_at FROM schedule_runs WHERE bot_id=$1 ORDER BY id DESC LIMIT 30`, b.ID)
	if err != nil {
		s.internalError(w, "list runs", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var run ScheduleRun
		if err = rows.Scan(&run.ID, &run.ScheduleID, &run.Title, &run.TurnID, &run.Status, &run.Error, &run.StartedAt, &run.FinishedAt); err != nil {
			s.internalError(w, "read run", err)
			return
		}
		runs = append(runs, run)
	}
	if rows.Err() != nil {
		s.internalError(w, "read runs", rows.Err())
		return
	}
	writeJSON(w, 200, map[string]any{"schedules": schedules, "runs": runs, "worker_configured": len(os.Getenv("SCHEDULER_SECRET")) >= 32})
}
func (s *Server) previewSchedule(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.ownedBot(w, r); !ok {
		return
	}
	var in BotSchedule
	if decodeJSON(w, r, &in) != nil {
		writeError(w, 400, "invalid schedule")
		return
	}
	dates := []time.Time{}
	after := time.Now()
	for i := 0; i < 3; i++ {
		next, err := nextSchedule(in, after)
		if err != nil {
			writeError(w, 400, err.Error())
			return
		}
		dates = append(dates, next)
		after = next
		if in.Kind == "once" {
			break
		}
	}
	writeJSON(w, 200, dates)
}
func (s *Server) saveSchedule(w http.ResponseWriter, r *http.Request) {
	b, ok := s.ownedBot(w, r)
	if !ok {
		return
	}
	var in struct {
		BotSchedule
		ApproveCommand bool `json:"approve_command"`
	}
	if decodeJSON(w, r, &in) != nil {
		writeError(w, 400, "invalid schedule")
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" || len(in.Title) > 160 || strings.TrimSpace(in.Prompt) == "" || len(in.Prompt) > 16000 || strings.ContainsRune(in.Title+in.Prompt, 0) || (in.Mode != "ai" && in.Mode != "command") {
		writeError(w, 400, "add a title and instructions up to 16 KB")
		return
	}
	if in.Mode == "command" && (!in.ApproveCommand || in.ComputerID == nil) {
		writeError(w, 400, "approve the exact command and choose your Linux computer")
		return
	}
	next, err := nextSchedule(in.BotSchedule, time.Now())
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	if in.Mode == "command" {
		var owned bool
		err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM computers WHERE id=$1 AND user_id=$2)`, in.ComputerID, userFrom(r.Context()).ID).Scan(&owned)
		if err != nil {
			s.internalError(w, "check schedule computer", err)
			return
		}
		if !owned {
			writeError(w, 404, "computer not found")
			return
		}
	} else {
		in.ComputerID = nil
	}
	var item BotSchedule
	if r.Method == "POST" {
		item, err = scanSchedule(tx.QueryRow(r.Context(), `INSERT INTO bot_schedules(bot_id,title,prompt,mode,computer_id,kind,cron,timezone,run_at,next_run,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) RETURNING `+scheduleColumns, b.ID, in.Title, in.Prompt, in.Mode, in.ComputerID, in.Kind, in.Cron, in.Timezone, in.RunAt, next))
	} else {
		id, _ := strconv.ParseInt(r.PathValue("schedule"), 10, 64)
		item, err = scanSchedule(tx.QueryRow(r.Context(), `UPDATE bot_schedules SET title=$1,prompt=$2,mode=$3,computer_id=$4,kind=$5,cron=$6,timezone=$7,run_at=$8,next_run=$9 WHERE id=$10 AND bot_id=$11 AND deleted_at IS NULL RETURNING `+scheduleColumns, in.Title, in.Prompt, in.Mode, in.ComputerID, in.Kind, in.Cron, in.Timezone, in.RunAt, next, id, b.ID))
	}
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 404, "schedule not found")
		return
	}
	if err != nil {
		s.internalError(w, "save schedule", err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "save schedule", err)
		return
	}
	writeJSON(w, 200, item)
}
func (s *Server) controlSchedule(w http.ResponseWriter, r *http.Request) {
	b, ok := s.ownedBot(w, r)
	if !ok {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("schedule"), 10, 64)
	var in struct {
		Action string `json:"action"`
	}
	if decodeJSON(w, r, &in) != nil || (in.Action != "pause" && in.Action != "resume" && in.Action != "delete" && in.Action != "run") {
		writeError(w, 400, "choose pause, resume, run or delete")
		return
	}
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	item, err := scanSchedule(tx.QueryRow(r.Context(), `SELECT `+scheduleColumns+` FROM bot_schedules WHERE id=$1 AND bot_id=$2 AND deleted_at IS NULL FOR UPDATE`, id, b.ID))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 404, "schedule not found")
		return
	}
	if err != nil {
		s.internalError(w, "read schedule", err)
		return
	}
	if in.Action == "pause" || in.Action == "delete" {
		_, err = tx.Exec(r.Context(), `UPDATE bot_schedules SET enabled=false,requested_run=NULL,deleted_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1`, id, in.Action == "delete")
		if err == nil {
			_, err = tx.Exec(r.Context(), `UPDATE computer_tasks SET status='cancelled' WHERE schedule_run_id IN(SELECT id FROM schedule_runs WHERE schedule_id=$1 AND status='running') AND status IN('approved','running')`, id)
		}
		if err == nil {
			_, err = tx.Exec(r.Context(), `UPDATE bot_turns SET status='failed',error='Schedule paused or removed.' WHERE bot_id=$1 AND id IN(SELECT turn_id FROM schedule_runs WHERE schedule_id=$2 AND status='running') AND status='pending'`, b.ID, id)
		}
		if err == nil {
			_, err = tx.Exec(r.Context(), `UPDATE schedule_runs SET status='cancelled',finished_at=now(),error='Schedule paused or removed.' WHERE schedule_id=$1 AND status='running'`, id)
		}
	} else {
		next := time.Now()
		if in.Action == "resume" {
			next, err = nextSchedule(item, next)
		}
		if err != nil {
			writeError(w, 400, err.Error())
			return
		}
		if in.Action == "run" {
			_, err = tx.Exec(r.Context(), `UPDATE bot_schedules SET requested_run=now() WHERE id=$1`, id)
		} else {
			_, err = tx.Exec(r.Context(), `UPDATE bot_schedules SET enabled=true,next_run=$2 WHERE id=$1`, id, next)
		}
	}
	if err != nil {
		s.internalError(w, "control schedule", err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "control schedule", err)
		return
	}
	w.WriteHeader(204)
}
func (s *Server) schedulerAuth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		secret := os.Getenv("SCHEDULER_SECRET")
		if len(secret) < 32 || subtle.ConstantTimeCompare([]byte(secret), []byte(r.Header.Get("X-Scheduler-Key"))) != 1 {
			writeError(w, 401, "scheduler authentication required")
			return
		}
		h(w, r)
	}
}
