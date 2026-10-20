-- dERP mag: felhasználók, munkamenetek, projektek, közös eseménynapló.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'iroda', 'terepes')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- A süti a nyers tokent hordozza; itt csak annak sha256-a van.
CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- client_name: szöveges ügyfél a 2b. munkacsomagig. deleted_at: törlés után az események megmaradnak.
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_name text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX projects_active_idx ON projects (created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects (id),
  type text NOT NULL CHECK (type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  source text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES users (id),
  title text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  parent_id uuid REFERENCES events (id)
);
CREATE INDEX events_project_time_idx ON events (project_id, occurred_at DESC);
CREATE INDEX events_parent_idx ON events (parent_id) WHERE parent_id IS NOT NULL;

-- Az eseménynapló csak hozzáfűzhető.
CREATE FUNCTION events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'events: csak hozzáfűzés engedélyezett (% tiltott)', TG_OP;
END;
$$;
CREATE TRIGGER events_append_only
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_append_only();
