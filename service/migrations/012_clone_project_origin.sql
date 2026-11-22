ALTER TABLE bw_project_revisions ADD COLUMN source_project_id uuid,
 ADD COLUMN source_project_revision integer,
 ADD CONSTRAINT bw_clone_origin_pair CHECK (
  (source_project_id IS NULL AND source_project_revision IS NULL)
  OR (source_project_id IS NOT NULL AND source_project_revision > 0)
 );
-- No FK: deleting a source must never affect independently cloned projects.
