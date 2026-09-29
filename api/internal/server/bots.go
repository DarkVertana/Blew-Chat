package server

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

type Bot struct {
	ID           int64     `json:"id"`
	Name         string    `json:"name"`
	Designation  string    `json:"designation"`
	Instructions string    `json:"instructions"`
	ImageVersion *string   `json:"image_version"`
	UpdatedAt    time.Time `json:"updated_at"`
	Preview      string    `json:"preview"`
}
type BotTurn struct {
	ReplyTo       string           `json:"reply_to,omitempty"`
	Attachments   []ChatAttachment `json:"attachments"`
	ID            string           `json:"id"`
	UserText      string           `json:"user_text"`
	AssistantText string           `json:"assistant_text"`
	Status        string           `json:"status"`
	Error         string           `json:"error"`
	StartedAt     time.Time        `json:"started_at"`
}

const botColumns = `b.id,b.name,b.designation,b.instructions,b.image_version,b.updated_at,COALESCE((SELECT CASE WHEN t.status='complete' THEN t.assistant_text ELSE t.user_text END FROM bot_turns t WHERE t.bot_id=b.id ORDER BY t.sequence DESC LIMIT 1),'')`

func scanBot(row pgx.Row) (Bot, error) {
	var b Bot
	err := row.Scan(&b.ID, &b.Name, &b.Designation, &b.Instructions, &b.ImageVersion, &b.UpdatedAt, &b.Preview)
	return b, err
}
func (s *Server) ownedBot(w http.ResponseWriter, r *http.Request) (Bot, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeError(w, 404, "bot not found")
		return Bot{}, false
	}
	b, err := scanBot(s.pool.QueryRow(r.Context(), `SELECT `+botColumns+` FROM bots b WHERE b.id=$1 AND b.user_id=$2`, id, userFrom(r.Context()).ID))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 404, "bot not found")
		return b, false
	}
	if err != nil {
		s.internalError(w, "get bot", err)
		return b, false
	}
	return b, true
}
func (s *Server) listBots(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `SELECT `+botColumns+` FROM bots b WHERE user_id=$1 ORDER BY updated_at DESC,id DESC`, userFrom(r.Context()).ID)
	if err != nil {
		s.internalError(w, "list bots", err)
		return
	}
	defer rows.Close()
	bots := []Bot{}
	for rows.Next() {
		b, err := scanBot(rows)
		if err != nil {
			s.internalError(w, "read bot", err)
			return
		}
		bots = append(bots, b)
	}
	if rows.Err() != nil {
		s.internalError(w, "list bots", rows.Err())
		return
	}
	writeJSON(w, 200, bots)
}
func (s *Server) saveBot(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name         string `json:"name"`
		Designation  string `json:"designation"`
		Instructions string `json:"instructions"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&in); err != nil {
		writeError(w, 400, "invalid bot details")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Designation = strings.TrimSpace(in.Designation)
	if utf8.RuneCountInString(in.Name) < 1 || utf8.RuneCountInString(in.Name) > 100 || utf8.RuneCountInString(in.Designation) < 1 || utf8.RuneCountInString(in.Designation) > 150 || strings.ContainsRune(in.Name+in.Designation+in.Instructions, 0) {
		writeError(w, 400, "add a name (1–100 characters) and designation (1–150 characters)")
		return
	}
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	var id int64
	if r.Method == "POST" {
		err := tx.QueryRow(r.Context(), `INSERT INTO bots(user_id,name,designation,instructions) VALUES($1,$2,$3,$4) RETURNING id`, userFrom(r.Context()).ID, in.Name, in.Designation, in.Instructions).Scan(&id)
		if err != nil {
			s.internalError(w, "create bot", err)
			return
		}
	} else {
		id, _ = strconv.ParseInt(r.PathValue("id"), 10, 64)
		tag, err := tx.Exec(r.Context(), `UPDATE bots SET name=$1,designation=$2,instructions=$3,updated_at=now() WHERE id=$4 AND user_id=$5`, in.Name, in.Designation, in.Instructions, id, userFrom(r.Context()).ID)
		if err != nil {
			s.internalError(w, "update bot", err)
			return
		}
		if tag.RowsAffected() == 0 {
			writeError(w, 404, "bot not found")
			return
		}
	}
	b, err := scanBot(tx.QueryRow(r.Context(), `SELECT `+botColumns+` FROM bots b WHERE id=$1`, id))
	if err != nil {
		s.internalError(w, "read saved bot", err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "save bot", err)
		return
	}
	writeJSON(w, 200, b)
}
func (s *Server) botConversation(w http.ResponseWriter, r *http.Request) {
	b, ok := s.ownedBot(w, r)
	if !ok {
		return
	}
	// Interrupted server work becomes retryable without losing the user's message.
	_, err := s.pool.Exec(r.Context(), `UPDATE bot_turns SET status='failed',error='The reply was interrupted. Please retry.' WHERE bot_id=$1 AND status='pending' AND started_at<now()-interval '5 minutes'`, b.ID)
	if err != nil {
		s.internalError(w, "expire bot run", err)
		return
	}
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	rows, err := s.pool.Query(r.Context(), `SELECT id,user_text,assistant_text,status,error,started_at,sequence,reply_to,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'media_type',a.media_type,'size',octet_length(a.data)) ORDER BY a.created_at) FROM bot_attachments a WHERE a.bot_id=bot_turns.bot_id AND a.turn_id=bot_turns.id),'[]'::jsonb) FROM bot_turns WHERE bot_id=$1 AND ($2::bigint=0 OR sequence<$2) ORDER BY sequence DESC LIMIT 51`, b.ID, before)
	if err != nil {
		s.internalError(w, "read conversation", err)
		return
	}
	defer rows.Close()
	turns := []BotTurn{}
	sequences := []int64{}
	for rows.Next() {
		var t BotTurn
		var seq int64
		if err := rows.Scan(&t.ID, &t.UserText, &t.AssistantText, &t.Status, &t.Error, &t.StartedAt, &seq, &t.ReplyTo, &t.Attachments); err != nil {
			s.internalError(w, "read turn", err)
			return
		}
		turns = append(turns, t)
		sequences = append(sequences, seq)
	}
	if rows.Err() != nil {
		s.internalError(w, "read turns", rows.Err())
		return
	}
	var next *int64
	if len(turns) > 50 {
		turns = turns[:50]
		n := sequences[49]
		next = &n
	}
	for i, j := 0, len(turns)-1; i < j; i, j = i+1, j-1 {
		turns[i], turns[j] = turns[j], turns[i]
	}
	writeJSON(w, 200, map[string]any{"bot": b, "turns": turns, "before": next})
}

var turnIDPattern = regexp.MustCompile(`^[a-zA-Z0-9-]{16,80}$`)

func (s *Server) beginBotTurn(w http.ResponseWriter, r *http.Request) {
	b, ok := s.ownedBot(w, r)
	if !ok {
		return
	}
	var in struct {
		ReplyTo     string   `json:"reply_to"`
		ID          string   `json:"id"`
		Attachments []string `json:"attachments"`
		Text        string   `json:"text"`
		Provider    string   `json:"provider"`
		Model       string   `json:"model"`
	}
	if decodeJSON(w, r, &in) != nil || len(in.Attachments) > 4 || (in.ReplyTo != "" && !turnIDPattern.MatchString(in.ReplyTo)) || !turnIDPattern.MatchString(in.ID) || strings.TrimSpace(in.Text) == "" || len(in.Text) > 64000 || strings.ContainsRune(in.Text, 0) || len(in.Provider) > 40 || len(in.Model) > 256 {
		writeError(w, 400, "enter a message up to 64 KB")
		return
	}
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `SELECT id FROM bots WHERE id=$1 FOR UPDATE`, b.ID); err != nil {
		s.internalError(w, "lock bot", err)
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE bot_turns SET status='failed',error='The reply was interrupted. Please retry.' WHERE bot_id=$1 AND status='pending' AND started_at<now()-interval '5 minutes'`, b.ID); err != nil {
		s.internalError(w, "expire turn", err)
		return
	}
	if in.ReplyTo != "" {
		var valid, answered bool
		if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM bot_turns WHERE bot_id=$1 AND id=$2 AND status='complete'),EXISTS(SELECT 1 FROM bot_turns WHERE bot_id=$1 AND reply_to=$2 AND status<>'failed' AND id<>$3)`, b.ID, in.ReplyTo, in.ID).Scan(&valid, &answered); err != nil {
			s.internalError(w, "check form response", err)
			return
		}
		if !valid || answered {
			writeError(w, 409, "This message form is unavailable or already answered")
			return
		}
	}
	var status, text string
	err := tx.QueryRow(r.Context(), `SELECT status,user_text FROM bot_turns WHERE bot_id=$1 AND id=$2`, b.ID, in.ID).Scan(&status, &text)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.internalError(w, "read turn", err)
		return
	}
	if err == nil && text != in.Text {
		writeError(w, 409, "this request ID belongs to another message")
		return
	}
	if status == "complete" || status == "pending" {
		writeJSON(w, 200, map[string]any{"started": false, "status": status})
		return
	}
	var active bool
	if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM bot_turns WHERE bot_id=$1 AND status='pending')`, b.ID).Scan(&active); err != nil {
		s.internalError(w, "check active turn", err)
		return
	}
	if active {
		writeError(w, 409, "wait for the current reply before sending another message")
		return
	}
	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		s.internalError(w, "create run", err)
		return
	}
	attempt := hex.EncodeToString(nonce)
	_, err = tx.Exec(r.Context(), `INSERT INTO bot_turns(id,bot_id,user_text,status,attempt,provider,model,reply_to) VALUES($1,$2,$3,'pending',$4,$5,$6,$7) ON CONFLICT(bot_id,id) DO UPDATE SET status='pending',error='',assistant_text='',attempt=EXCLUDED.attempt,provider=EXCLUDED.provider,model=EXCLUDED.model,started_at=now(),completed_at=NULL`, in.ID, b.ID, in.Text, attempt, in.Provider, in.Model, in.ReplyTo)
	if err != nil {
		s.internalError(w, "start turn", err)
		return
	}
	for _, attachmentID := range in.Attachments {
		tag, attachErr := tx.Exec(r.Context(), `UPDATE bot_attachments SET turn_id=$1 WHERE id=$2 AND bot_id=$3 AND (turn_id IS NULL OR turn_id=$1)`, in.ID, attachmentID, b.ID)
		if attachErr != nil {
			s.internalError(w, "attach file", attachErr)
			return
		}
		if tag.RowsAffected() != 1 {
			writeError(w, 400, "Attachment is unavailable or already belongs to another message")
			return
		}
	}
	if _, err = tx.Exec(r.Context(), `UPDATE bots SET updated_at=now() WHERE id=$1`, b.ID); err != nil {
		s.internalError(w, "update bot time", err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "start bot turn", err)
		return
	}
	writeJSON(w, 200, map[string]any{"started": true, "attempt": attempt})
}
func (s *Server) finishBotTurn(w http.ResponseWriter, r *http.Request) {
	b, ok := s.ownedBot(w, r)
	if !ok {
		return
	}
	var in struct {
		ID      string          `json:"id"`
		Attempt string          `json:"attempt"`
		Text    string          `json:"text"`
		Error   string          `json:"error"`
		Task    json.RawMessage `json:"task"`
	}
	if decodeJSON(w, r, &in) != nil || !turnIDPattern.MatchString(in.ID) || len(in.Attempt) != 64 || len(in.Text) > 500000 || len(in.Error) > 500 || strings.ContainsRune(in.Text+in.Error, 0) {
		writeError(w, 400, "invalid reply")
		return
	}
	title, command, valid := validTaskPlan(in.Task)
	if !valid {
		writeError(w, 400, "invalid task proposal")
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
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	tag, err := tx.Exec(r.Context(), `UPDATE bot_turns SET assistant_text=$1,status=$2,error=$3,completed_at=now() WHERE bot_id=$4 AND id=$5 AND attempt=$6 AND status='pending'`, in.Text, status, in.Error, b.ID, in.ID, in.Attempt)
	if err != nil {
		s.internalError(w, "save reply", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, 409, "this run is no longer active")
		return
	}
	if _, err = tx.Exec(r.Context(), `UPDATE bots SET updated_at=now() WHERE id=$1`, b.ID); err != nil {
		s.internalError(w, "update bot", err)
		return
	}
	if status == "complete" && command != "" {
		if _, err = tx.Exec(r.Context(), `INSERT INTO computer_tasks(bot_id,turn_id,title,command) VALUES($1,$2,$3,$4) ON CONFLICT(bot_id,turn_id) DO NOTHING`, b.ID, in.ID, title, command); err != nil {
			s.internalError(w, "save task proposal", err)
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "save bot reply", err)
		return
	}
	w.WriteHeader(204)
}
func (s *Server) botImage(w http.ResponseWriter, r *http.Request) {
	b, ok := s.ownedBot(w, r)
	if !ok {
		return
	}
	if r.Method == "GET" {
		var data []byte
		var kind *string
		err := s.pool.QueryRow(r.Context(), `SELECT image,image_type FROM bots WHERE id=$1 AND user_id=$2`, b.ID, userFrom(r.Context()).ID).Scan(&data, &kind)
		if err != nil {
			s.internalError(w, "read bot image", err)
			return
		}
		if len(data) == 0 || kind == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", *kind)
		w.Header().Set("Cache-Control", "private, no-store")
		w.Write(data)
		return
	}
	var data []byte
	var kind, version *string
	if r.Method == "PUT" {
		var err error
		data, err = io.ReadAll(http.MaxBytesReader(w, r.Body, maxProfileImageBytes))
		if err != nil {
			writeError(w, 400, "choose a JPEG or PNG up to 5 MB")
			return
		}
		cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || (format != "jpeg" && format != "png") || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 4096 || cfg.Height > 4096 {
			writeError(w, 400, "choose a JPEG or PNG up to 4096 × 4096 pixels")
			return
		}
		if _, _, err = image.Decode(bytes.NewReader(data)); err != nil {
			writeError(w, 400, "image is damaged")
			return
		}
		hash := sha256.Sum256(data)
		v := hex.EncodeToString(hash[:])
		k := "image/" + format
		kind = &k
		version = &v
	}
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	_, err := tx.Exec(r.Context(), `UPDATE bots SET image=$1,image_type=$2,image_version=$3,updated_at=now() WHERE id=$4 AND user_id=$5`, data, kind, version, b.ID, userFrom(r.Context()).ID)
	if err != nil {
		s.internalError(w, "save bot image", err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "save bot image", err)
		return
	}
	writeJSON(w, 200, map[string]any{"image_version": version})
}

// deleteBot removes only the signed-in account's bot. Foreign keys cascade its
// messages, uploads, memories, schedules and tasks; shared engines stay intact.
func (s *Server) deleteBot(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeError(w, 404, "bot not found")
		return
	}
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	tag, err := tx.Exec(r.Context(), "DELETE FROM bots WHERE id=$1 AND user_id=$2", id, userFrom(r.Context()).ID)
	if err != nil {
		s.internalError(w, "delete bot", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, 404, "bot not found")
		return
	}
	if _, err = tx.Exec(r.Context(), "SELECT pg_notify('blew_chat',$1)", strconv.FormatInt(id, 10)); err != nil {
		s.internalError(w, "notify bot deletion", err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "delete bot", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
