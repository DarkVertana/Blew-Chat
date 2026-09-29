package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"blew/api/internal/audit"
)

type Note struct {
	ID        int64     `json:"id"         db:"id"`
	Body      string    `json:"body"       db:"body"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := s.pool.Ping(ctx); err != nil {
		slog.Warn("health: database ping failed", "err", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded", "db": "unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "db": "ok"})
}

func (s *Server) listNotes(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r.Context())
	audit.FromContext(r.Context()).SetAction("notes.list")
	rows, err := s.pool.Query(r.Context(),
		`SELECT id, body, created_at FROM notes
		  WHERE user_id = $1
		  ORDER BY created_at DESC, id DESC LIMIT 100`, user.ID)
	if err != nil {
		s.internalError(w, "list notes", err)
		return
	}
	notes, err := pgx.CollectRows(rows, pgx.RowToStructByName[Note])
	if err != nil {
		s.internalError(w, "list notes", err)
		return
	}
	if notes == nil {
		notes = []Note{}
	}
	writeJSON(w, http.StatusOK, notes)
}

func (s *Server) createNote(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Body string `json:"body"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	in.Body = strings.TrimSpace(in.Body)
	if n := utf8.RuneCountInString(in.Body); n == 0 || n > 1000 {
		writeError(w, http.StatusBadRequest, "body must be between 1 and 1000 characters")
		return
	}

	user := userFrom(r.Context())
	var note Note
	err := s.pool.QueryRow(r.Context(),
		`INSERT INTO notes (user_id, body) VALUES ($1, $2) RETURNING id, body, created_at`,
		user.ID, in.Body,
	).Scan(&note.ID, &note.Body, &note.CreatedAt)
	if err != nil {
		s.internalError(w, "create note", err)
		return
	}
	info := audit.FromContext(r.Context())
	info.SetAction("note.create")
	info.Set("note_id", note.ID)
	writeJSON(w, http.StatusCreated, note)
}

// decodeJSON reads a JSON body of at most 1 MiB into v.
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	return json.NewDecoder(r.Body).Decode(v)
}

func (s *Server) internalError(w http.ResponseWriter, op string, err error) {
	slog.Error(op, "err", err)
	writeError(w, http.StatusInternalServerError, "internal server error")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("write response", "err", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
