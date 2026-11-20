-- Rendering is an explicitly requested, separately billed operation.
-- It never increments the immutable Blender model revision.
CREATE TABLE bw_render_jobs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES bw_projects(id) ON DELETE RESTRICT,
  owner_key varchar(200) NOT NULL,
  source_revision integer NOT NULL CHECK (source_revision>0),
  engine varchar(8) NOT NULL CHECK (engine IN ('BLENDER_EEVEE_NEXT','CYCLES')),
  width integer NOT NULL CHECK (width BETWEEN 128 AND 1024),
  height integer NOT NULL CHECK (height BETWEEN 128 AND 1024),
  samples integer NOT NULL CHECK (samples BETWEEN 1 AND 64),
  status varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','needs_recovery','completed','failed')),
  error_code varchar(40),
  sha256 char(64),
  size_bytes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY (project_id,source_revision)
    REFERENCES bw_project_revisions(project_id,revision) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX bw_render_jobs_one_active_per_project
  ON bw_render_jobs(project_id)
  WHERE status IN ('pending','running','needs_recovery');
CREATE INDEX bw_render_jobs_owner_project_idx ON bw_render_jobs(owner_key,project_id,created_at DESC);
CREATE INDEX bw_render_jobs_pending_idx ON bw_render_jobs(created_at,id) WHERE status='pending';
