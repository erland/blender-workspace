-- Preserve historical source provenance separately from optimistic write revision.
-- Older revisions remain immutable and their lineage is left unknown.
ALTER TABLE bw_jobs ADD COLUMN source_revision integer
  CHECK (source_revision IS NULL OR source_revision BETWEEN 1 AND expected_revision);
ALTER TABLE bw_project_revisions ADD COLUMN source_revision integer
  CHECK (source_revision IS NULL OR source_revision BETWEEN 1 AND revision-1);
COMMENT ON COLUMN bw_jobs.source_revision IS
  'Read-only native BLEND revision selected as input; expected_revision locks latest destination';
COMMENT ON COLUMN bw_project_revisions.source_revision IS
  'Revision used to create this revision; NULL for imported/older history with unknown provenance';
