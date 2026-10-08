CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE projects (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES users(id),
  freelancer_id uuid NOT NULL REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  current_version integer NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  funding_started boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (client_id <> freelancer_id),
  CHECK (created_by IN (client_id, freelancer_id))
);
CREATE INDEX projects_client ON projects(client_id);
CREATE INDEX projects_freelancer ON projects(freelancer_id);
CREATE TABLE agreement_versions (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  agreement jsonb NOT NULL,
  published_by uuid NOT NULL REFERENCES users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, version)
);
CREATE TABLE acceptances (
  project_id uuid NOT NULL,
  version integer NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('client', 'freelancer')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, version, user_id),
  UNIQUE (project_id, version, role),
  FOREIGN KEY (project_id, version) REFERENCES agreement_versions(project_id, version) ON DELETE CASCADE
);
CREATE TABLE drafts (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  agreement jsonb NOT NULL,
  base_version integer NOT NULL CHECK (base_version >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
