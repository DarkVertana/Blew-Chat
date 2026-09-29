-- Session metadata for the "active sessions" view and revocation by id.
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS id           BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    ADD COLUMN IF NOT EXISTS ip           INET,
    ADD COLUMN IF NOT EXISTS user_agent   TEXT,
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Failed/successful sign-in attempts drive the account and IP lockout.
CREATE TABLE IF NOT EXISTS login_attempts (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email      TEXT NOT NULL,
    ip         INET,
    success    BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON login_attempts (email, created_at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx    ON login_attempts (ip, created_at DESC);

-- One row per API request (except /health). user_id survives account deletion
-- as NULL so history is kept.
CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    method      TEXT NOT NULL,
    path        TEXT NOT NULL,
    status      INT  NOT NULL,
    duration_ms INT  NOT NULL,
    ip          INET,
    user_agent  TEXT,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_user_idx   ON audit_log (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_ip_idx     ON audit_log (ip, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action, occurred_at DESC);
