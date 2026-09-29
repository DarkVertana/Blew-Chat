package server

import (
	"crypto/rand"
	"encoding/hex"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"
)

type ChatAttachment struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	MediaType string `json:"media_type"`
	Size      int    `json:"size"`
}

func (s *Server) uploadAttachment(w http.ResponseWriter, r *http.Request) {
	b, ok := s.ownedBot(w, r)
	if !ok {
		return
	}
	name, err := url.QueryUnescape(r.Header.Get("X-File-Name"))
	if err != nil || !utf8.ValidString(name) || strings.TrimSpace(name) == "" || len(name) > 255 || strings.ContainsAny(name, "\x00\r\n/\\") {
		writeError(w, 400, "invalid filename")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 10<<20))
	if err != nil || len(data) == 0 {
		writeError(w, 400, "choose a nonempty file up to 10 MB")
		return
	}
	kind := http.DetectContentType(data)
	nonce := make([]byte, 24)
	if _, err = rand.Read(nonce); err != nil {
		s.internalError(w, "attachment ID", err)
		return
	}
	id := hex.EncodeToString(nonce)
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	// Serialize uploads for this bot; bound storage including unsubmitted drafts.
	if _, err = tx.Exec(r.Context(), `SELECT id FROM bots WHERE id=$1 FOR UPDATE`, b.ID); err != nil {
		s.internalError(w, "lock uploads", err)
		return
	}
	var used int64
	if err = tx.QueryRow(r.Context(), `SELECT COALESCE(sum(octet_length(data)),0) FROM bot_attachments WHERE bot_id=$1`, b.ID).Scan(&used); err != nil {
		s.internalError(w, "attachment quota", err)
		return
	}
	if used+int64(len(data)) > 250<<20 {
		writeError(w, 400, "This chat has reached its 250 MB attachment storage limit.")
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO bot_attachments(id,bot_id,name,media_type,data) VALUES($1,$2,$3,$4,$5)`, id, b.ID, name, kind, data)
	if err != nil {
		s.internalError(w, "save attachment", err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "save attachment", err)
		return
	}
	writeJSON(w, 201, ChatAttachment{id, name, kind, len(data)})
}
func (s *Server) attachment(w http.ResponseWriter, r *http.Request) {
	b, ok := s.ownedBot(w, r)
	if !ok {
		return
	}
	id := r.PathValue("attachment")
	if r.Method == "DELETE" {
		tx, ok := s.sessionMutation(w, r)
		if !ok {
			return
		}
		defer tx.Rollback(r.Context())
		tag, err := tx.Exec(r.Context(), `DELETE FROM bot_attachments WHERE id=$1 AND bot_id=$2 AND turn_id IS NULL`, id, b.ID)
		if err != nil {
			s.internalError(w, "remove attachment", err)
			return
		}
		if tag.RowsAffected() == 0 {
			writeError(w, 404, "Draft attachment not found")
			return
		}
		if err = tx.Commit(r.Context()); err != nil {
			s.internalError(w, "remove attachment", err)
			return
		}
		w.WriteHeader(204)
		return
	}
	var name, kind string
	var data []byte
	if err := s.pool.QueryRow(r.Context(), `SELECT name,media_type,data FROM bot_attachments WHERE id=$1 AND bot_id=$2`, id, b.ID).Scan(&name, &kind, &data); err != nil {
		writeError(w, 404, "Attachment not found")
		return
	}
	w.Header().Set("Content-Type", kind)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Write(data)
}

// A paired computer can fetch only files explicitly referenced by its currently
// running approved command, belonging to the task owner's chat.
func (s *Server) companionAttachment(w http.ResponseWriter, r *http.Request) {
	computer, ok := s.companionID(w, r)
	if !ok {
		return
	}
	var data []byte
	err := s.pool.QueryRow(r.Context(), `SELECT a.data FROM bot_attachments a JOIN computer_tasks t ON t.bot_id=a.bot_id JOIN bots b ON b.id=t.bot_id JOIN computers c ON c.id=t.computer_id WHERE t.id=$1 AND c.id=$2 AND c.user_id=b.user_id AND t.status='running' AND t.started_at>now()-interval '3 minutes' AND a.id=$3 AND a.turn_id IS NOT NULL AND position('BLEW_FILE_'||a.id in t.command)>0`, r.PathValue("task"), computer, r.PathValue("attachment")).Scan(&data)
	if err != nil {
		writeError(w, 404, "File is not available to this active task")
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write(data)
}
