package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Memory struct {
	ID           int64     `json:"id"`
	Kind         string    `json:"kind"`
	SourceID     string    `json:"source_id"`
	Title        string    `json:"title"`
	Body         string    `json:"body"`
	AttachmentID *string   `json:"attachment_id"`
	OccurredAt   time.Time `json:"occurred_at"`
	Revision     int64     `json:"revision"`
	score        float64
}
type Recall struct {
	Memories []Memory `json:"memories"`
	Total    int      `json:"total"`
	Pending  int      `json:"pending"`
	Semantic bool     `json:"semantic"`
}

const memoryColumns = `id,kind,source_id,title,body,attachment_id,occurred_at,revision`

var memoryWords = regexp.MustCompile(`[\pL\pN_]+`)

func (s *Server) recall(ctx context.Context, botID, userID int64, query, exclude string) (Recall, error) {
	result := Recall{Memories: []Memory{}}
	if err := s.pool.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE indexed_revision<>revision) FROM bot_memories WHERE bot_id=$1 AND NOT hidden`, botID).Scan(&result.Total, &result.Pending); err != nil {
		return result, err
	}
	candidates := map[int64]Memory{}
	add := func(sql string, args []any, weight float64) error {
		rows, err := s.pool.Query(ctx, sql, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		rank := 0
		for rows.Next() {
			var m Memory
			if err = rows.Scan(&m.ID, &m.Kind, &m.SourceID, &m.Title, &m.Body, &m.AttachmentID, &m.OccurredAt, &m.Revision); err != nil {
				return err
			}
			rank++
			m.score = weight / float64(60+rank)
			if old, ok := candidates[m.ID]; ok {
				m.score += old.score
			}
			candidates[m.ID] = m
		}
		return rows.Err()
	}
	if query != "" {
		words := memoryWords.FindAllString(query, 32)
		quoted := []string{}
		for _, word := range words {
			if len(word) > 1 {
				quoted = append(quoted, strconv.Quote(word))
			}
		}
		if err := add(`SELECT `+memoryColumns+` FROM bot_memories WHERE bot_id=$1 AND NOT hidden AND source_id<>$3 AND search @@ websearch_to_tsquery('simple',$2) ORDER BY ts_rank_cd(search,websearch_to_tsquery('simple',$2)) DESC,occurred_at DESC LIMIT 24`, []any{botID, strings.Join(quoted, " OR "), exclude}, 2); err != nil {
			return result, err
		}
		secret := os.Getenv("MEMORY_SECRET")
		endpoint := os.Getenv("MEMORY_URL")
		if len(secret) >= 32 && endpoint != "" {
			data, _ := json.Marshal(map[string]any{"user_id": userID, "bot_id": botID, "query": query})
			callCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
			defer cancel()
			request, err := http.NewRequestWithContext(callCtx, "POST", endpoint+"/search", bytes.NewReader(data))
			if err == nil {
				request.Header.Set("X-Memory-Key", secret)
				request.Header.Set("Content-Type", "application/json")
				response, err := http.DefaultClient.Do(request)
				if err == nil {
					defer response.Body.Close()
					var out struct {
						Hits []struct {
							ID       int64 `json:"id"`
							Revision int64 `json:"revision"`
						}
					}
					if response.StatusCode == 200 && json.NewDecoder(http.MaxBytesReader(nil, response.Body, 32000)).Decode(&out) == nil {
						result.Semantic = true
						for rank, hit := range out.Hits {
							if rank >= 24 {
								break
							}
							var m Memory
							// Never trust the vector store as an authorization boundary. Check live SQL ownership, revision and exclusion.
							err = s.pool.QueryRow(ctx, `SELECT `+memoryColumns+` FROM bot_memories WHERE id=$1 AND bot_id=$2 AND revision=$3 AND NOT hidden AND source_id<>$4`, hit.ID, botID, hit.Revision, exclude).Scan(&m.ID, &m.Kind, &m.SourceID, &m.Title, &m.Body, &m.AttachmentID, &m.OccurredAt, &m.Revision)
							if err == nil {
								m.score = 3 / float64(61+rank)
								if old, ok := candidates[m.ID]; ok {
									m.score += old.score
								}
								candidates[m.ID] = m
							}
						}
					}
				}
			}
		}
	}
	// Explicitly saved facts and recent events provide continuity for vague follow-ups.
	if err := add(`SELECT `+memoryColumns+` FROM bot_memories WHERE bot_id=$1 AND NOT hidden AND kind='note' ORDER BY occurred_at DESC,part LIMIT 8`, []any{botID}, 4); err != nil {
		return result, err
	}
	if err := add(`SELECT `+memoryColumns+` FROM bot_memories WHERE bot_id=$1 AND NOT hidden AND source_id<>$2 ORDER BY occurred_at DESC,id DESC LIMIT 8`, []any{botID, exclude}, 0.3); err != nil {
		return result, err
	}
	for _, m := range candidates {
		result.Memories = append(result.Memories, m)
	}
	sort.Slice(result.Memories, func(i, j int) bool {
		if result.Memories[i].score == result.Memories[j].score {
			return result.Memories[i].ID > result.Memories[j].ID
		}
		return result.Memories[i].score > result.Memories[j].score
	})
	if len(result.Memories) > 24 {
		result.Memories = result.Memories[:24]
	}
	return result, nil
}
func (s *Server) searchMemory(w http.ResponseWriter, r *http.Request) {
	bot, ok := s.ownedBot(w, r)
	if !ok {
		return
	}
	q := r.URL.Query().Get("q")
	if len(q) > 4000 {
		writeError(w, 400, "Memory search is too long")
		return
	}
	result, err := s.recall(r.Context(), bot.ID, userFrom(r.Context()).ID, q, r.URL.Query().Get("exclude"))
	if err != nil {
		s.internalError(w, "recall memory", err)
		return
	}
	writeJSON(w, 200, result)
}
func (s *Server) saveMemory(w http.ResponseWriter, r *http.Request) {
	bot, ok := s.ownedBot(w, r)
	if !ok {
		return
	}
	var in struct {
		Text string `json:"text"`
	}
	if decodeJSON(w, r, &in) != nil || strings.TrimSpace(in.Text) == "" || len(in.Text) > 32000 || strings.ContainsRune(in.Text, 0) {
		writeError(w, 400, "Add a memory up to 32 KB")
		return
	}
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `INSERT INTO bot_memory_notes(bot_id,text) VALUES($1,$2)`, bot.ID, in.Text); err != nil {
		s.internalError(w, "save memory", err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "save memory", err)
		return
	}
	w.WriteHeader(204)
}
func (s *Server) forgetMemory(w http.ResponseWriter, r *http.Request) {
	bot, ok := s.ownedBot(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("memory"), 10, 64)
	if err != nil {
		writeError(w, 404, "Memory not found")
		return
	}
	tx, ok := s.sessionMutation(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	var kind, source string
	if err = tx.QueryRow(r.Context(), `SELECT kind,source_id FROM bot_memories WHERE id=$1 AND bot_id=$2 AND NOT hidden FOR UPDATE`, id, bot.ID).Scan(&kind, &source); err != nil {
		writeError(w, 404, "Memory not found")
		return
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO bot_memory_exclusions(bot_id,kind,source_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, bot.ID, kind, source); err != nil {
		s.internalError(w, "forget memory", err)
		return
	}
	if _, err = tx.Exec(r.Context(), `UPDATE bot_memories SET hidden=true,revision=revision+1 WHERE bot_id=$1 AND kind=$2 AND source_id=$3`, bot.ID, kind, source); err != nil {
		s.internalError(w, "forget memory", err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.internalError(w, "forget memory", err)
		return
	}
	w.WriteHeader(204)
}

// Scheduled executions use the active run lease to derive ownership, never a supplied user ID.
func (s *Server) scheduledMemory(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID    int64  `json:"id"`
		Lease string `json:"lease"`
		Query string `json:"query"`
	}
	if decodeJSON(w, r, &in) != nil || len(in.Lease) != 64 || len(in.Query) > 4000 {
		writeError(w, 400, "Invalid run")
		return
	}
	var botID, userID int64
	var turn string
	if err := s.pool.QueryRow(r.Context(), `SELECT r.bot_id,b.user_id,r.turn_id FROM schedule_runs r JOIN bots b ON b.id=r.bot_id WHERE r.id=$1 AND r.lease=$2 AND r.status='running' AND r.started_at>now()-interval '5 minutes'`, in.ID, in.Lease).Scan(&botID, &userID, &turn); err != nil {
		writeError(w, 409, "Run is no longer active")
		return
	}
	result, err := s.recall(r.Context(), botID, userID, in.Query, turn)
	if err != nil {
		s.internalError(w, "scheduled memory", err)
		return
	}
	writeJSON(w, 200, result)
}
