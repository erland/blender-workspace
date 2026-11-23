-- DEV-053: Existing owner-scoped asset store also holds immutable image textures.
ALTER TABLE bw_uploaded_assets
  DROP CONSTRAINT IF EXISTS bw_uploaded_assets_format_check;
ALTER TABLE bw_uploaded_assets
  ADD CONSTRAINT bw_uploaded_assets_format_check
  CHECK (format IN ('blend','glb','png','jpg'));
