-- Source references are snapshots, not live dependencies. They are owner-checked
-- on reservation and rechecked before the paid execution is started.
ALTER TABLE bw_jobs ADD COLUMN asset_sources jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(asset_sources) = 'array'
    AND jsonb_array_length(asset_sources) <= 4);
COMMENT ON COLUMN bw_jobs.asset_sources IS
  'Up to four owned, immutable BLEND revision sources and placement offsets for compositing';
