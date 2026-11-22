-- Files are owner-private, immutable assets, never executed in the API.
CREATE TABLE bw_uploaded_assets (
  id uuid PRIMARY KEY,
  owner_key varchar(200) NOT NULL,
  filename varchar(200) NOT NULL,
  format varchar(5) NOT NULL CHECK(format IN ('blend','glb')),
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 20 AND 33554432),
  sha256 char(64) NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bw_uploaded_assets_owner_idx
 ON bw_uploaded_assets(owner_key,created_at DESC,id DESC);
