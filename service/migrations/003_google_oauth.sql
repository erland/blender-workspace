-- Google is an upstream identity provider; these are Blender Workspace OAuth artifacts.
-- Secrets, one-time codes and refresh tokens are stored only as SHA-256 hashes.
CREATE TABLE bw_oauth_clients (
  client_id text PRIMARY KEY,
  redirect_uris jsonb NOT NULL,
  client_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bw_oauth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES bw_oauth_clients(client_id),
  redirect_uri text NOT NULL,
  google_subject text NOT NULL,
  identity_email text,
  scope text NOT NULL,
  resource text NOT NULL,
  pkce_challenge text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX bw_oauth_codes_expiry ON bw_oauth_codes(expires_at);
CREATE TABLE bw_oauth_refresh (
  token_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES bw_oauth_clients(client_id),
  google_subject text NOT NULL,
  identity_email text,
  scope text NOT NULL,
  resource text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX bw_oauth_refresh_expiry ON bw_oauth_refresh(expires_at);
