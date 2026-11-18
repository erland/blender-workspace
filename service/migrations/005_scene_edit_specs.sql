-- Persist a typed edit alongside the reserved job so dispatcher restarts preserve the command.
ALTER TABLE bw_jobs ADD COLUMN edit_spec jsonb;
ALTER TABLE bw_jobs ADD CONSTRAINT bw_jobs_edit_spec_object
  CHECK (edit_spec IS NULL OR jsonb_typeof(edit_spec) = 'object');
