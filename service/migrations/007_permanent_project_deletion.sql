-- Separate explicit permanent-delete requests from legacy soft-deleted projects.
-- Legacy hidden projects are left untouched unless deliberately migrated.
ALTER TABLE bw_projects ADD COLUMN deletion_requested_at timestamptz;
CREATE INDEX bw_projects_pending_permanent_delete_idx
  ON bw_projects(deletion_requested_at,id)
  WHERE deletion_requested_at IS NOT NULL;
