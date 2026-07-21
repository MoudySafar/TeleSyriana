BEGIN;

CREATE TABLE IF NOT EXISTS shopify_connections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  shop_domain TEXT,
  api_version TEXT,
  credential_source TEXT NOT NULL
    CHECK (credential_source IN ('legacy_env', 'encrypted_db')),
  credential_payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'disabled')),
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified', 'failed')),
  verified_at TIMESTAMPTZ,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    credential_source = 'legacy_env'
    OR (credential_source = 'encrypted_db' AND shop_domain IS NOT NULL AND credential_payload IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS shopify_connections_project_domain_idx
  ON shopify_connections (project_id, shop_domain)
  WHERE shop_domain IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shopify_connections_one_default_per_project_idx
  ON shopify_connections (project_id)
  WHERE is_default = TRUE AND status = 'active';

CREATE INDEX IF NOT EXISTS shopify_connections_project_status_idx
  ON shopify_connections (project_id, status, created_at DESC);

-- Preserve the current iPro Shopify connection as the protected default.
-- Its credentials remain in the existing server environment; nothing is copied
-- into the V2 database during this migration.
INSERT INTO shopify_connections (
  id,
  project_id,
  label,
  credential_source,
  status,
  verification_status,
  is_default
)
VALUES (
  'shopify:ipro:legacy',
  'ipro',
  'Current iPro Shopify',
  'legacy_env',
  'active',
  'verified',
  TRUE
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
