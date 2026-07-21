BEGIN;

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS user_sessions_user_last_seen_idx
  ON user_sessions (user_id, last_seen_at DESC);

COMMIT;
