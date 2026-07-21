BEGIN;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  department TEXT,
  employment_type TEXT NOT NULL DEFAULT 'full_time'
    CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'temporary')),
  hours_text TEXT,
  pay_rate NUMERIC(12, 2),
  currency TEXT,
  positions INTEGER NOT NULL DEFAULT 1 CHECK (positions > 0),
  description TEXT NOT NULL,
  requirements TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed', 'archived')),
  closes_at TIMESTAMPTZ,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jobs_project_status_updated_idx
  ON jobs (project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS job_applications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  applicant_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN (
      'new',
      'under_review',
      'interview',
      'offer',
      'hired',
      'rejected',
      'withdrawn'
    )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, applicant_user_id)
);

CREATE INDEX IF NOT EXISTS job_applications_job_status_idx
  ON job_applications (job_id, status, created_at ASC);

CREATE TABLE IF NOT EXISTS job_referrals (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  referred_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  candidate_name TEXT NOT NULL,
  candidate_email TEXT,
  candidate_phone TEXT,
  relationship TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN (
      'new',
      'under_review',
      'interview',
      'offer',
      'hired',
      'rejected',
      'withdrawn'
    )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_referrals_job_status_idx
  ON job_referrals (job_id, status, created_at ASC);

COMMIT;
