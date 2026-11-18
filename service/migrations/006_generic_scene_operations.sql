-- Separate typed operation from legacy monster-specific edit_spec.
ALTER TABLE bw_jobs ADD COLUMN operation_spec jsonb;
ALTER TABLE bw_jobs ADD CONSTRAINT bw_jobs_operation_spec_object
  CHECK (operation_spec IS NULL OR jsonb_typeof(operation_spec)='object');
ALTER TABLE bw_jobs ADD CONSTRAINT bw_jobs_one_operation
  CHECK (NOT (operation_spec IS NOT NULL AND edit_spec IS NOT NULL));
