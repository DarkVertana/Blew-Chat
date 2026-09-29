CREATE TABLE IF NOT EXISTS users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only a SHA-256 hash of the session token is stored; the raw token lives in
-- the browser cookie, so a leaked table cannot be replayed.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash BYTEA PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

-- Notes become per-user. Rows created before auth existed have no owner and
-- are removed.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
DELETE FROM notes WHERE user_id IS NULL;
ALTER TABLE notes ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS notes_user_id_created_at_idx ON notes (user_id, created_at DESC);
