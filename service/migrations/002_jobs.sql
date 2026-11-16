-- Durable job journal. One active job per project prevents concurrent revision publication.
CREATE TABLE bw_jobs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES bw_projects(id) ON DELETE RESTRICT,
  owner_key varchar(200) NOT NULL,
  expected_revision integer NOT NULL CHECK (expected_revision >= 0),
  requested_revision integer NOT NULL CHECK (requested_revision = expected_revision + 1),
  status varchar(24) NOT NULL CHECK (status IN ('pending','running','needs_recovery','completed','failed')),
  note varchar(5000) NOT NULL DEFAULT '',
  error_message varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX bw_jobs_one_active_per_project
  ON bw_jobs(project_id) WHERE status IN ('pending','running','needs_recovery');
CREATE INDEX bw_jobs_owner_created_idx ON bw_jobs(owner_key,created_at DESC);
