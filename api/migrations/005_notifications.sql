CREATE TABLE notification_preferences (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    messages BOOLEAN NOT NULL DEFAULT true,
    previews BOOLEAN NOT NULL DEFAULT true,
    sounds BOOLEAN NOT NULL DEFAULT true,
    groups BOOLEAN NOT NULL DEFAULT true,
    status BOOLEAN NOT NULL DEFAULT true
);

-- Keep a stable application identity across restarts and API instances.
CREATE TABLE web_push_keys (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL
);

-- Revoking/expiring a login must also stop its notifications.
CREATE TABLE push_subscriptions (
    session_hash BYTEA PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions(user_id);
