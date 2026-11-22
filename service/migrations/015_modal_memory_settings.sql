-- DEV-049: independently owned compute preferences. Credentials are stored
-- separately; disconnecting a Modal account does not erase its resource choice.
CREATE TABLE bw_modal_memory_settings (
  owner_key varchar(200) PRIMARY KEY,
  memory_mib integer NOT NULL DEFAULT 2048
    CHECK (memory_mib IN (2048,4096,8192,16384)),
  updated_at timestamptz NOT NULL DEFAULT now()
);
