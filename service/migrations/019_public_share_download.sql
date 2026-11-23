-- DEV-057: native file download is opt-in for each active public revision share.
-- Keep all existing and future shares disabled by default. No automatic grants.
ALTER TABLE bw_public_shares
  DROP CONSTRAINT IF EXISTS bw_public_shares_allow_download_check;
-- The original unnamed column CHECK may have been generated with this name.
ALTER TABLE bw_public_shares
  DROP CONSTRAINT IF EXISTS bw_public_shares_allow_download_check1;
-- PostgreSQL auto-names the inline CHECK as bw_public_shares_allow_download_check;
-- only the owner-scoped repository method may enable it subsequently.
