package server

import (
	"blew/api/internal/auth"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Computer struct {
	ID       int64      `json:"id"`
	Name     string     `json:"name"`
	Platform string     `json:"platform"`
	LastSeen *time.Time `json:"last_seen"`
}
type ComputerTask struct {
	Attachments []ChatAttachment `json:"attachments"`
	ID          int64            `json:"id"`
	BotID       int64            `json:"bot_id"`
	TurnID      string           `json:"turn_id"`
	ComputerID  *int64           `json:"computer_id"`
	Title       string           `json:"title"`
	Command     string           `json:"command"`
	Status      string           `json:"status"`
	Output      string           `json:"output"`
	ExitCode    *int             `json:"exit_code"`
	CreatedAt   time.Time        `json:"created_at"`
}

func (s *Server) listComputers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `SELECT id,name,platform,last_seen FROM computers WHERE user_id=$1 ORDER BY last_seen DESC NULLS LAST`, userFrom(r.Context()).ID)
	if err != nil {
		s.internalError(w, "list computers", err)
		return
	}
	defer rows.Close()
	out := []Computer{}
	for rows.Next() {
		var c Computer
		if err := rows.Scan(&c.ID, &c.Name, &c.Platform, &c.LastSeen); err != nil {
			s.internalError(w, "read computer", err)
			return
		}
		out = append(out, c)
	}
	if rows.Err() != nil {
		s.internalError(w, "read computers", rows.Err())
		return
	}
	writeJSON(w, 200, out)
}
func (s *Server) createPairing(w http.ResponseWriter, r *http.Request) {
	code, hash, err := auth.NewToken()
	if err != nil {
		s.internalError(w, "create pairing", err)
		return
	}
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), `DELETE FROM computer_pairings WHERE user_id=$1 OR expires_at<now()`, userFrom(r.Context()).ID); err != nil {
		s.internalError(w, "clear pairing", err)
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO computer_pairings(code_hash,user_id,expires_at) VALUES($1,$2,now()+interval '5 minutes')`, hash, userFrom(r.Context()).ID); err != nil {
		s.internalError(w, "create pairing", err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "create pairing", err)
		return
	}
	writeJSON(w, 200, map[string]string{"code": code})
}
func (s *Server) pairComputer(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code     string `json:"code"`
		Name     string `json:"name"`
		Platform string `json:"platform"`
	}
	if decodeJSON(w, r, &in) != nil || len(in.Code) > 256 || in.Name == "" || len(in.Name) > 150 || in.Platform != "linux" || strings.ContainsRune(in.Name, 0) {
		writeError(w, 400, "invalid Linux pairing request")
		return
	}
	token, hash, err := auth.NewToken()
	if err != nil {
		s.internalError(w, "computer token", err)
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "pair computer", err)
		return
	}
	defer tx.Rollback(r.Context())
	var owner int64
	err = tx.QueryRow(r.Context(), `DELETE FROM computer_pairings WHERE code_hash=$1 AND expires_at>now() RETURNING user_id`, auth.HashToken(in.Code)).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 401, "pairing code is invalid or expired")
		return
	}
	if err != nil {
		s.internalError(w, "claim pairing", err)
		return
	}
	var id int64
	if err = tx.QueryRow(r.Context(), `INSERT INTO computers(user_id,token_hash,name,last_seen) VALUES($1,$2,$3,now()) RETURNING id`, owner, hash, in.Name).Scan(&id); err != nil {
		s.internalError(w, "save computer", err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "pair computer", err)
		return
	}
	writeJSON(w, 200, map[string]any{"id": id, "token": token})
}
func (s *Server) revokeComputer(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	_, err := tx.Exec(r.Context(), `UPDATE computer_tasks SET status='cancelled' WHERE computer_id IN(SELECT id FROM computers WHERE id=$1 AND user_id=$2) AND status IN('approved','running')`, id, userFrom(r.Context()).ID)
	if err != nil {
		s.internalError(w, "cancel tasks", err)
		return
	}
	tag, err := tx.Exec(r.Context(), `DELETE FROM computers WHERE id=$1 AND user_id=$2`, id, userFrom(r.Context()).ID)
	if err != nil {
		s.internalError(w, "revoke computer", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, 404, "computer not found")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "revoke computer", err)
		return
	}
	w.WriteHeader(204)
}
func (s *Server) companionID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	token, ok := bearerToken(r)
	if !ok {
		writeError(w, 401, "computer authentication required")
		return 0, false
	}
	var id int64
	err := s.pool.QueryRow(r.Context(), `UPDATE computers SET last_seen=now() WHERE token_hash=$1 RETURNING id`, auth.HashToken(token)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 401, "computer disconnected")
		return 0, false
	}
	if err != nil {
		s.internalError(w, "authenticate computer", err)
		return 0, false
	}
	return id, true
}
func (s *Server) nextComputerTask(w http.ResponseWriter, r *http.Request) {
	id, ok := s.companionID(w, r)
	if !ok {
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "claim task", err)
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), `SELECT id FROM computers WHERE id=$1 FOR UPDATE`, id); err != nil {
		s.internalError(w, "lock computer", err)
		return
	}
	if _, err = tx.Exec(r.Context(), `UPDATE computer_tasks SET status='failed',output='The Linux companion stopped reporting this task. It was not automatically rerun.' WHERE computer_id=$1 AND status='running' AND started_at<now()-interval '3 minutes'`, id); err != nil {
		s.internalError(w, "expire task", err)
		return
	}
	var taskID int64
	var command string
	err = tx.QueryRow(r.Context(), `UPDATE computer_tasks SET status='running',started_at=now() WHERE id=(SELECT t.id FROM computer_tasks t JOIN bots b ON b.id=t.bot_id JOIN computers c ON c.id=t.computer_id WHERE c.id=$1 AND c.user_id=b.user_id AND t.status='approved' AND NOT EXISTS(SELECT 1 FROM computer_tasks WHERE computer_id=$1 AND status='running') ORDER BY t.id FOR UPDATE OF t SKIP LOCKED LIMIT 1) RETURNING id,command`, id).Scan(&taskID, &command)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.internalError(w, "claim task", err)
		return
	}
	if err2 := tx.Commit(r.Context()); err2 != nil {
		s.internalError(w, "claim task", err2)
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, 200, map[string]any{"task": nil})
		return
	}
	var files []ChatAttachment
	rows, fileErr := s.pool.Query(r.Context(), `SELECT a.id,a.name,a.media_type,octet_length(a.data) FROM bot_attachments a JOIN computer_tasks t ON t.bot_id=a.bot_id WHERE t.id=$1 AND a.turn_id IS NOT NULL AND position('BLEW_FILE_'||a.id in t.command)>0 ORDER BY a.created_at`, taskID)
	if fileErr != nil {
		s.internalError(w, "list task files", fileErr)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var file ChatAttachment
		if err := rows.Scan(&file.ID, &file.Name, &file.MediaType, &file.Size); err != nil {
			s.internalError(w, "read task file", err)
			return
		}
		files = append(files, file)
	}
	if rows.Err() != nil {
		s.internalError(w, "read task files", rows.Err())
		return
	}
	writeJSON(w, 200, map[string]any{"task": map[string]any{"id": taskID, "command": command, "attachments": files}})
}
func (s *Server) computerTaskStatus(w http.ResponseWriter, r *http.Request) {
	id, ok := s.companionID(w, r)
	if !ok {
		return
	}
	task, _ := strconv.ParseInt(r.PathValue("task"), 10, 64)
	var status string
	err := s.pool.QueryRow(r.Context(), `SELECT status FROM computer_tasks WHERE id=$1 AND computer_id=$2`, task, id).Scan(&status)
	if err != nil {
		writeError(w, 404, "task not found")
		return
	}
	writeJSON(w, 200, map[string]string{"status": status})
}
func (s *Server) completeComputerTask(w http.ResponseWriter, r *http.Request) {
	id, ok := s.companionID(w, r)
	if !ok {
		return
	}
	task, _ := strconv.ParseInt(r.PathValue("task"), 10, 64)
	var in struct {
		Output   string `json:"output"`
		ExitCode int    `json:"exit_code"`
	}
	if decodeJSON(w, r, &in) != nil || len(in.Output) > 100000 {
		writeError(w, 400, "invalid task output")
		return
	}
	in.Output = strings.ReplaceAll(in.Output, "\x00", "")
	status := "complete"
	if in.ExitCode != 0 {
		status = "failed"
	}
	tag, err := s.pool.Exec(r.Context(), `UPDATE computer_tasks SET output=$1,exit_code=$2,status=$3 WHERE id=$4 AND computer_id=$5 AND status='running'`, in.Output, in.ExitCode, status, task, id)
	if err != nil {
		s.internalError(w, "save task output", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, 409, "task is no longer active")
		return
	}
	w.WriteHeader(204)
}
func (s *Server) listComputerTasks(w http.ResponseWriter, r *http.Request) {
	b, ok := s.ownedBot(w, r)
	if !ok {
		return
	}
	rows, err := s.pool.Query(r.Context(), `SELECT id,bot_id,turn_id,computer_id,title,command,status,output,exit_code,created_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'media_type',a.media_type,'size',octet_length(a.data))) FROM bot_attachments a WHERE a.bot_id=computer_tasks.bot_id AND a.turn_id IS NOT NULL AND position('BLEW_FILE_'||a.id in computer_tasks.command)>0),'[]'::jsonb) FROM computer_tasks WHERE bot_id=$1 ORDER BY id DESC LIMIT 50`, b.ID)
	if err != nil {
		s.internalError(w, "list tasks", err)
		return
	}
	defer rows.Close()
	out := []ComputerTask{}
	for rows.Next() {
		var t ComputerTask
		if err := rows.Scan(&t.ID, &t.BotID, &t.TurnID, &t.ComputerID, &t.Title, &t.Command, &t.Status, &t.Output, &t.ExitCode, &t.CreatedAt, &t.Attachments); err != nil {
			s.internalError(w, "read task", err)
			return
		}
		out = append(out, t)
	}
	if rows.Err() != nil {
		s.internalError(w, "read tasks", rows.Err())
		return
	}
	writeJSON(w, 200, out)
}
func (s *Server) decideComputerTask(w http.ResponseWriter, r *http.Request) {
	b, ok := s.ownedBot(w, r)
	if !ok {
		return
	}
	task, _ := strconv.ParseInt(r.PathValue("task"), 10, 64)
	var in struct {
		Decision   string `json:"decision"`
		ComputerID int64  `json:"computer_id"`
	}
	if decodeJSON(w, r, &in) != nil || (in.Decision != "approve" && in.Decision != "cancel") {
		writeError(w, 400, "choose approve or cancel")
		return
	}
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	var tagRows int64
	if in.Decision == "approve" {
		var owned bool
		err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM computers WHERE id=$1 AND user_id=$2 AND last_seen>now()-interval '30 seconds')`, in.ComputerID, userFrom(r.Context()).ID).Scan(&owned)
		if err != nil {
			s.internalError(w, "check computer", err)
			return
		}
		if !owned {
			writeError(w, 409, "connect an online Linux computer belonging to this account")
			return
		}
		tag, err := tx.Exec(r.Context(), `UPDATE computer_tasks SET status='approved',computer_id=$1 WHERE id=$2 AND bot_id=$3 AND status='proposed'`, in.ComputerID, task, b.ID)
		if err != nil {
			s.internalError(w, "approve task", err)
			return
		}
		tagRows = tag.RowsAffected()
	} else {
		tag, err := tx.Exec(r.Context(), `UPDATE computer_tasks SET status='cancelled' WHERE id=$1 AND bot_id=$2 AND status IN('proposed','approved','running')`, task, b.ID)
		if err != nil {
			s.internalError(w, "cancel task", err)
			return
		}
		tagRows = tag.RowsAffected()
	}
	if tagRows == 0 {
		writeError(w, 409, "task no longer accepts this decision")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "save decision", err)
		return
	}
	w.WriteHeader(204)
}

// Task plans are saved in the same transaction as their assistant reply.
func validTaskPlan(raw json.RawMessage) (string, string, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", "", true
	}
	var p struct {
		Title   string `json:"title"`
		Command string `json:"command"`
	}
	if json.Unmarshal(raw, &p) != nil || strings.TrimSpace(p.Title) == "" || len(p.Title) > 160 || strings.TrimSpace(p.Command) == "" || len(p.Command) > 16000 || strings.ContainsRune(p.Command+p.Title, 0) {
		return "", "", false
	}
	return p.Title, p.Command, true
}
