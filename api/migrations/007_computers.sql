CREATE TABLE computer_pairings (
 code_hash BYTEA PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE computers (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash BYTEA NOT NULL UNIQUE,
 name TEXT NOT NULL,
 platform TEXT NOT NULL DEFAULT 'linux',
 last_seen TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE computer_tasks (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 bot_id BIGINT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
 turn_id TEXT NOT NULL,
 computer_id BIGINT REFERENCES computers(id) ON DELETE SET NULL,
 title TEXT NOT NULL,
 command TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','running','complete','failed','cancelled')),
 output TEXT NOT NULL DEFAULT '',
 exit_code INTEGER,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 started_at TIMESTAMPTZ,
 UNIQUE(bot_id,turn_id)
);
CREATE INDEX computer_tasks_queue ON computer_tasks(computer_id,status,id);
