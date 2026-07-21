BEGIN;

CREATE TABLE IF NOT EXISTS chat_channels (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  channel_type TEXT NOT NULL DEFAULT 'project'
    CHECK (channel_type IN ('project', 'team')),
  team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (channel_type = 'project' AND team_id IS NULL)
    OR (channel_type = 'team' AND team_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_project_name_idx
  ON chat_channels (project_id, LOWER(name))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS chat_channels_project_idx
  ON chat_channels (project_id, status, created_at ASC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  sequence_number BIGSERIAL NOT NULL UNIQUE,
  channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS chat_messages_channel_sequence_idx
  ON chat_messages (channel_id, sequence_number DESC);

CREATE TABLE IF NOT EXISTS chat_reactions (
  message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (CHAR_LENGTH(emoji) BETWEEN 1 AND 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS chat_reactions_message_idx
  ON chat_reactions (message_id, created_at ASC);

CREATE TABLE IF NOT EXISTS chat_read_states (
  channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_sequence BIGINT NOT NULL DEFAULT 0,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_read_states_user_idx
  ON chat_read_states (user_id, last_read_at DESC);

INSERT INTO chat_channels (
  id,
  project_id,
  name,
  channel_type,
  status
)
VALUES (
  'chat:ipro:general',
  'ipro',
  'General',
  'project',
  'active'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
