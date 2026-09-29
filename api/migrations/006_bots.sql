CREATE TABLE bots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  designation TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  image BYTEA,
  image_type TEXT,
  image_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bots_user_updated_idx ON bots(user_id, updated_at DESC);
CREATE TABLE bot_turns (
  sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id TEXT NOT NULL,
  bot_id BIGINT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  user_text TEXT NOT NULL,
  assistant_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending','complete','failed')),
  error TEXT NOT NULL DEFAULT '',
  attempt TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(bot_id,id)
);
CREATE INDEX bot_turns_bot_sequence_idx ON bot_turns(bot_id, sequence);
CREATE UNIQUE INDEX bot_turns_one_pending_idx ON bot_turns(bot_id) WHERE status='pending';
