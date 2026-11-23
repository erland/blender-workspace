-- Request intent is durable and owner-scoped. Existing rows remain unchanged.
ALTER TABLE bw_jobs ADD COLUMN IF NOT EXISTS cancellation_requested_at timestamptz;
-- Existing partial unique index must continue to guard a cancelling execution.
DROP INDEX IF EXISTS bw_jobs_one_active_per_project;
CREATE UNIQUE INDEX bw_jobs_one_active_per_project ON bw_jobs(project_id)
  WHERE status IN ('pending','running','cancelling','needs_recovery');
-- Preserve the original check semantics while adding two new states.
ALTER TABLE bw_jobs DROP CONSTRAINT IF EXISTS bw_jobs_status_check;
ALTER TABLE bw_jobs ADD CONSTRAINT bw_jobs_status_check
  CHECK (status IN ('pending','running','cancelling','cancelled','completed','failed','needs_recovery'));
