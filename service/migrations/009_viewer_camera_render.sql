-- DEV-039: viewer camera is an optional render-job override, not a model revision.
ALTER TABLE bw_render_jobs
  ADD COLUMN requested_from varchar(16) NOT NULL DEFAULT 'project'
    CHECK (requested_from IN ('project','viewer')),
  ADD COLUMN camera_override jsonb;
ALTER TABLE bw_render_jobs
  ADD CONSTRAINT bw_render_jobs_viewer_camera
  CHECK ((requested_from='viewer' AND camera_override IS NOT NULL AND engine='CYCLES')
     OR (requested_from='project' AND camera_override IS NULL));
