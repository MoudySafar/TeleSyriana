BEGIN;

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  ticket_number BIGSERIAL NOT NULL UNIQUE,
  external_reference TEXT UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  order_number TEXT,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  tracking_number TEXT,
  subject TEXT,
  type TEXT NOT NULL DEFAULT 'general_question',
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('emergency', 'high', 'medium', 'normal')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open',
      'waiting_customer',
      'waiting_courier',
      'waiting_supplier',
      'escalated',
      'resolved',
      'closed'
    )),
  risk TEXT NOT NULL DEFAULT 'low'
    CHECK (risk IN ('low', 'medium', 'high')),
  internal_summary TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS tickets_project_updated_idx
  ON tickets (project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS tickets_project_status_updated_idx
  ON tickets (project_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS tickets_project_assignee_status_idx
  ON tickets (project_id, assigned_to_user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS tickets_project_team_status_idx
  ON tickets (project_id, assigned_team_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS tickets_project_order_idx
  ON tickets (project_id, order_number)
  WHERE order_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS tickets_project_tracking_idx
  ON tickets (project_id, tracking_number)
  WHERE tracking_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS tickets_project_customer_email_lower_idx
  ON tickets (project_id, LOWER(customer_email))
  WHERE customer_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS tickets_project_customer_name_lower_idx
  ON tickets (project_id, LOWER(customer_name) text_pattern_ops)
  WHERE customer_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS ticket_comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ticket_comments_ticket_created_idx
  ON ticket_comments (ticket_id, created_at ASC);

CREATE TABLE IF NOT EXISTS ticket_history (
  id BIGSERIAL PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ticket_history_ticket_created_idx
  ON ticket_history (ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ticket_history_project_created_idx
  ON ticket_history (project_id, created_at DESC);

COMMIT;
