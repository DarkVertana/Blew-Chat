CREATE TABLE bot_attachments (
 id TEXT PRIMARY KEY,
 bot_id BIGINT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
 turn_id TEXT,
 name TEXT NOT NULL,
 media_type TEXT NOT NULL,
 data BYTEA NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(bot_id,turn_id) REFERENCES bot_turns(bot_id,id) ON DELETE CASCADE
);
CREATE INDEX bot_attachments_turn_idx ON bot_attachments(bot_id,turn_id);
