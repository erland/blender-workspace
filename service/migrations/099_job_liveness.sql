-- DEV-049: independently observable worker and Blender progress, no source or secrets.
ALTER TABLE bw_jobs
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS blender_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS progress_phase text,
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz;
CREATE INDEX IF NOT EXISTS bw_jobs_running_liveness_idx
  ON bw_jobs (worker_heartbeat_at) WHERE status='running';
