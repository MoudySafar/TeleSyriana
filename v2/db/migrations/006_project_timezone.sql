BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

UPDATE projects
SET timezone = 'Asia/Damascus', updated_at = NOW()
WHERE id = 'ipro';

COMMIT;
