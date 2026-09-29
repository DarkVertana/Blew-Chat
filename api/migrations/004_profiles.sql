CREATE TABLE user_profiles (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    about TEXT NOT NULL DEFAULT '',
    image BYTEA,
    image_type TEXT,
    image_version TEXT
);
