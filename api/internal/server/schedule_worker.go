package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
	"time"
)

// Claim and advance dates transactionally. Dispatch never depends on a browser session.
func (s *Server) claimSchedule(w http.ResponseWriter, r *http.Request) {
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "claim schedule", err)
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `UPDATE schedule_runs r SET status=CASE WHEN t.status='complete' THEN 'complete' WHEN t.status='cancelled' THEN 'cancelled' ELSE 'failed' END,error=CASE WHEN t.status='failed' THEN 'Linux command failed; see output in chat.' ELSE '' END,finished_at=now() FROM computer_tasks t WHERE t.schedule_run_id=r.id AND r.status='running' AND t.status IN('complete','failed','cancelled')`)
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE schedule_runs SET status='failed',error='Run interrupted or timed out; not automatically replayed.',finished_at=now() WHERE status='running' AND started_at<now()-interval '5 minutes'`)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE computer_tasks SET status='cancelled' WHERE status IN('approved','running') AND schedule_run_id IN(SELECT id FROM schedule_runs WHERE status!='running')`)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE bot_turns t SET status='failed',error=r.error,completed_at=now() FROM schedule_runs r WHERE r.bot_id=t.bot_id AND r.turn_id=t.id AND r.status IN('failed','cancelled') AND t.status='pending'`)
	}
	if err != nil {
		s.internalError(w, "reconcile schedule runs", err)
		return
	}
	var scheduleID int64
	err = tx.QueryRow(r.Context(), `SELECT j.id FROM bot_schedules j JOIN bots b ON b.id=j.bot_id WHERE j.deleted_at IS NULL AND ((j.enabled AND j.next_run<=now()) OR j.requested_run<=now()) AND NOT EXISTS(SELECT 1 FROM schedule_runs WHERE bot_id=b.id AND status='running') AND NOT EXISTS(SELECT 1 FROM bot_turns WHERE bot_id=b.id AND status='pending') ORDER BY LEAST(j.next_run,j.requested_run),j.id FOR UPDATE OF j,b SKIP LOCKED LIMIT 1`).Scan(&scheduleID)
	if errors.Is(err, pgx.ErrNoRows) {
		if err = tx.Commit(r.Context()); err != nil {
			s.internalError(w, "reconcile schedules", err)
			return
		}
		writeJSON(w, 200, map[string]any{"run": nil})
		return
	}
	if err != nil {
		s.internalError(w, "claim schedule", err)
		return
	}
	job, err := scanSchedule(tx.QueryRow(r.Context(), `SELECT `+scheduleColumns+` FROM bot_schedules WHERE id=$1`, scheduleID))
	if err != nil {
		s.internalError(w, "read scheduled job", err)
		return
	}
	due := job.NextRun
	if job.RequestedRun != nil {
		due = job.RequestedRun
	}
	var next *time.Time
	if job.Kind == "cron" {
		n, e := nextSchedule(job, time.Now())
		if e != nil {
			s.internalError(w, "calculate next schedule", e)
			return
		}
		next = &n
	}
	if job.RequestedRun != nil {
		_, err = tx.Exec(r.Context(), `UPDATE bot_schedules SET requested_run=NULL WHERE id=$1`, job.ID)
	} else {
		_, err = tx.Exec(r.Context(), `UPDATE bot_schedules SET next_run=$2,enabled=CASE WHEN kind='once' THEN false ELSE enabled END WHERE id=$1`, job.ID, next)
	}
	if err != nil {
		s.internalError(w, "advance schedule", err)
		return
	}
	nonce := make([]byte, 32)
	if _, err = rand.Read(nonce); err != nil {
		s.internalError(w, "schedule lease", err)
		return
	}
	lease := hex.EncodeToString(nonce)
	turnID := "scheduled-" + lease[:32]
	var runID int64
	if err = tx.QueryRow(r.Context(), `INSERT INTO schedule_runs(schedule_id,bot_id,turn_id,title,prompt,due_at,status,lease) VALUES($1,$2,$3,$4,$5,$6,'running',$7) RETURNING id`, job.ID, job.BotID, turnID, job.Title, job.Prompt, due, lease).Scan(&runID); err != nil {
		s.internalError(w, "create scheduled run", err)
		return
	}
	bot, err := scanBot(tx.QueryRow(r.Context(), `SELECT `+botColumns+` FROM bots b WHERE id=$1`, job.BotID))
	if err != nil {
		s.internalError(w, "scheduled bot", err)
		return
	}
	var owner int64
	var profile Profile
	if err = tx.QueryRow(r.Context(), `SELECT b.user_id,COALESCE(NULLIF(p.name,''),split_part(u.email,'@',1)),COALESCE(left(p.about,24000),'') FROM bots b JOIN users u ON u.id=b.user_id LEFT JOIN user_profiles p ON p.user_id=b.user_id WHERE b.id=$1`, bot.ID).Scan(&owner, &profile.Name, &profile.About); err != nil {
		s.internalError(w, "scheduled profile", err)
		return
	}
	status := "pending"
	reply := ""
	runError := ""
	if due.Before(time.Now().Add(-12 * time.Hour)) {
		status = "failed"
		runError = "Missed schedule: more than 12 hours late. Not run automatically."
	}
	if job.Mode == "command" && runError == "" {
		var online bool
		err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM computers WHERE id=$1 AND user_id=$2 AND last_seen>now()-interval '30 seconds')`, job.ComputerID, owner).Scan(&online)
		if err != nil {
			s.internalError(w, "scheduled computer", err)
			return
		}
		if !online {
			status = "failed"
			runError = "Scheduled Linux computer is offline or disconnected. Command was not run."
		} else {
			status = "complete"
			reply = "Scheduled command queued on your Linux computer. See the task below for its result."
			_, err = tx.Exec(r.Context(), `INSERT INTO computer_tasks(bot_id,turn_id,computer_id,title,command,status,schedule_run_id) VALUES($1,$2,$3,$4,$5,'approved',$6)`, bot.ID, turnID, job.ComputerID, job.Title, job.Prompt, runID)
			if err != nil {
				s.internalError(w, "queue scheduled command", err)
				return
			}
		}
	}
	if runError != "" {
		if _, err = tx.Exec(r.Context(), `UPDATE schedule_runs SET status='failed',error=$2,finished_at=now() WHERE id=$1`, runID, runError); err != nil {
			s.internalError(w, "record missed run", err)
			return
		}
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO bot_turns(id,bot_id,user_text,assistant_text,status,error,attempt,provider,model) VALUES($1,$2,$3,$4,$5,$6,$7,'scheduled','')`, turnID, bot.ID, "[Scheduled: "+job.Title+"]\n"+job.Prompt, reply, status, runError, lease)
	if err != nil {
		s.internalError(w, "scheduled chat turn", err)
		return
	}
	if _, err = tx.Exec(r.Context(), `UPDATE bots SET updated_at=now() WHERE id=$1`, bot.ID); err != nil {
		s.internalError(w, "update scheduled bot", err)
		return
	}
	history := []BotTurn{}
	rows, err := tx.Query(r.Context(), `SELECT id,user_text,assistant_text,status,error,started_at FROM bot_turns WHERE bot_id=$1 AND status='complete' ORDER BY sequence DESC LIMIT 50`, bot.ID)
	if err != nil {
		s.internalError(w, "scheduled history", err)
		return
	}
	for rows.Next() {
		var t BotTurn
		if err = rows.Scan(&t.ID, &t.UserText, &t.AssistantText, &t.Status, &t.Error, &t.StartedAt); err != nil {
			rows.Close()
			s.internalError(w, "scheduled history", err)
			return
		}
		history = append(history, t)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		s.internalError(w, "scheduled history", err)
		return
	}
	computers := []Computer{}
	rows, err = tx.Query(r.Context(), `SELECT id,name,platform,last_seen FROM computers WHERE user_id=$1 ORDER BY last_seen DESC NULLS LAST`, owner)
	if err != nil {
		s.internalError(w, "scheduled computers", err)
		return
	}
	for rows.Next() {
		var c Computer
		if err = rows.Scan(&c.ID, &c.Name, &c.Platform, &c.LastSeen); err != nil {
			rows.Close()
			s.internalError(w, "scheduled computers", err)
			return
		}
		computers = append(computers, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		s.internalError(w, "scheduled computers", err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "claim scheduled run", err)
		return
	}
	if status != "pending" {
		writeJSON(w, 200, map[string]any{"run": nil})
		return
	}
	writeJSON(w, 200, map[string]any{"run": map[string]any{"id": runID, "lease": lease, "user_id": owner, "bot": bot, "profile": profile, "history": history, "computers": computers, "prompt": job.Prompt, "title": job.Title}})
}
func (s *Server) finishSchedule(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID    int64           `json:"id"`
		Lease string          `json:"lease"`
		Text  string          `json:"text"`
		Error string          `json:"error"`
		Task  json.RawMessage `json:"task"`
	}
	if decodeJSON(w, r, &in) != nil || len(in.Lease) != 64 || len(in.Text) > 500000 || len(in.Error) > 500 || strings.ContainsRune(in.Text+in.Error, 0) {
		writeError(w, 400, "invalid scheduled reply")
		return
	}
	title, command, valid := validTaskPlan(in.Task)
	if !valid {
		writeError(w, 400, "invalid task")
		return
	}
	status := "complete"
	if in.Error != "" {
		status = "failed"
		in.Text = ""
	}
	if status == "complete" && strings.TrimSpace(in.Text) == "" {
		writeError(w, 400, "empty reply")
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "finish schedule", err)
		return
	}
	defer tx.Rollback(r.Context())
	var botID int64
	var turnID string
	err = tx.QueryRow(r.Context(), `UPDATE schedule_runs SET status=$1,error=$2,finished_at=now() WHERE id=$3 AND lease=$4 AND status='running' AND started_at>now()-interval '5 minutes' RETURNING bot_id,turn_id`, status, in.Error, in.ID, in.Lease).Scan(&botID, &turnID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 409, "run is no longer active")
		return
	}
	if err != nil {
		s.internalError(w, "finish run", err)
		return
	}
	tag, err := tx.Exec(r.Context(), `UPDATE bot_turns SET status=$1,assistant_text=$2,error=$3,completed_at=now() WHERE bot_id=$4 AND id=$5 AND status='pending' AND attempt=$6`, status, in.Text, in.Error, botID, turnID, in.Lease)
	if err != nil {
		s.internalError(w, "finish scheduled turn", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, 409, "turn no longer active")
		return
	}
	if status == "complete" && command != "" {
		_, err = tx.Exec(r.Context(), `INSERT INTO computer_tasks(bot_id,turn_id,title,command) VALUES($1,$2,$3,$4)`, botID, turnID, title, command)
		if err != nil {
			s.internalError(w, "scheduled task proposal", err)
			return
		}
	}
	if _, err = tx.Exec(r.Context(), `UPDATE bots SET updated_at=now() WHERE id=$1`, botID); err != nil {
		s.internalError(w, "update scheduled bot", err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "finish schedule", err)
		return
	}
	w.WriteHeader(204)
}

func (s *Server) activeSchedule(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID    int64  `json:"id"`
		Lease string `json:"lease"`
	}
	if decodeJSON(w, r, &in) != nil || len(in.Lease) != 64 {
		writeError(w, 400, "invalid run")
		return
	}
	var active bool
	err := s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM schedule_runs WHERE id=$1 AND lease=$2 AND status='running' AND started_at>now()-interval '5 minutes')`, in.ID, in.Lease).Scan(&active)
	if err != nil {
		s.internalError(w, "check scheduled run", err)
		return
	}
	if !active {
		writeError(w, 409, "run is no longer active")
		return
	}
	w.WriteHeader(204)
}
