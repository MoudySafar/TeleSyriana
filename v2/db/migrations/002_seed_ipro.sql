BEGIN;

INSERT INTO projects (id, slug, name, status, is_default)
VALUES ('ipro', 'ipro', 'iPro', 'active', TRUE)
ON CONFLICT (id) DO UPDATE
SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  status = 'active',
  is_default = TRUE,
  updated_at = NOW();

COMMIT;
