-- Dedicated per-principal Modal credentials; never store raw tokens.
CREATE TABLE bw_modal_accounts (
  owner_key varchar(200) PRIMARY KEY,
  iv bytea NOT NULL,
  ciphertext bytea NOT NULL,
  auth_tag bytea NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('connected','revoked')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(iv)=12),
  CHECK (octet_length(auth_tag)=16)
);
