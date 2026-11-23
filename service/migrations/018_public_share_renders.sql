-- DEV-056: deliberately selected, owner-approved completed render IDs only.
-- Preserve all pre-existing shares, tokens and revocation state.
ALTER TABLE bw_public_shares
  DROP CONSTRAINT IF EXISTS bw_public_shares_allow_renders_check;
ALTER TABLE bw_public_shares
  DROP CONSTRAINT IF EXISTS bw_public_shares_selected_render_ids_check;
ALTER TABLE bw_public_shares
  ADD CONSTRAINT bw_public_shares_selected_render_ids_check
  CHECK (
    (allow_renders AND cardinality(selected_render_ids) BETWEEN 1 AND 12)
    OR (NOT allow_renders AND cardinality(selected_render_ids)=0)
  );
-- Public BLEND download remains strictly disabled until DEV-057.
