-- Derived GLB previews are separately billed, immutable and never alter
-- the source BLEND revision or its manifest.
CREATE TABLE bw_glb_preview_jobs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES bw_projects(id) ON DELETE RESTRICT,
  owner_key varchar(200) NOT NULL,
  source_revision integer NOT NULL CHECK (source_revision > 0),
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
CREATE UNIQUE INDEX bw_glb_preview_one_active_per_revision
  ON bw_glb_preview_jobs(project_id,source_revision)
  WHERE status IN ('pending','running','needs_recovery');
CREATE INDEX bw_glb_preview_next_idx ON bw_glb_preview_jobs(created_at,id)
  WHERE status='pending';
CREATE INDEX bw_glb_preview_latest_idx ON bw_glb_preview_jobs
  (project_id,source_revision,created_at DESC,id DESC)
  WHERE status='completed';
