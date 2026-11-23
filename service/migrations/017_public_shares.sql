-- DEV-055: one revocable, unguessable public link per immutable project revision.
-- Only a SHA-256 digest of the bearer link is persisted in PostgreSQL.
-- Future phases may explicitly grant selected render IDs and BLEND downloads;
-- both start disabled. No public write/Modal capability is created here.
CREATE TABLE bw_public_shares (
  project_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 99999999),
  owner_key varchar(200) NOT NULL,
  token_sha256 char(64) NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  allow_glb boolean NOT NULL DEFAULT true CHECK (allow_glb),
  allow_renders boolean NOT NULL DEFAULT false CHECK (NOT allow_renders),
  allow_download boolean NOT NULL DEFAULT false CHECK (NOT allow_download),
  selected_render_ids uuid[] NOT NULL DEFAULT '{}'::uuid[]
    CHECK (cardinality(selected_render_ids)=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  PRIMARY KEY (project_id, revision),
  FOREIGN KEY (project_id, revision)
    REFERENCES bw_project_revisions(project_id, revision) ON DELETE CASCADE
);
CREATE INDEX bw_public_shares_owner_idx
  ON bw_public_shares(owner_key, project_id, revision);
