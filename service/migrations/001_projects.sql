CREATE TABLE bw_projects (
  id uuid PRIMARY KEY,
  owner_key varchar(200) NOT NULL CHECK (length(owner_key)>0),
  name varchar(200) NOT NULL CHECK (length(btrim(name))>0),
  description varchar(5000) NOT NULL DEFAULT '',
  current_revision integer NOT NULL DEFAULT 0 CHECK (current_revision>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX bw_projects_owner_updated_idx ON bw_projects(owner_key,updated_at DESC,id) WHERE deleted_at IS NULL;
CREATE TABLE bw_project_revisions (
  project_id uuid NOT NULL REFERENCES bw_projects(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision>0),
  note varchar(5000) NOT NULL DEFAULT '',
  artifact_prefix varchar(1024),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,revision)
);
