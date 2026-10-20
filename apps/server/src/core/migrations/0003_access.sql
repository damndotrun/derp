-- 2b. munkacsomag: felhasználók kezelése, projekt-hozzárendelés (terepes-szűrés), ügyfelek és kapcsolattartók,
-- auditnapló.

-- Kikapcsolt felhasználó nem léphet be; a sora megmarad, mert események és auditbejegyzések hivatkoznak rá.
ALTER TABLE users ADD COLUMN deactivated_at timestamptz;
ALTER TABLE users ADD COLUMN version integer NOT NULL DEFAULT 1;

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX clients_active_name_idx ON clients (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients (id),
  name text NOT NULL,
  position text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX client_contacts_client_idx ON client_contacts (client_id) WHERE deleted_at IS NULL;

-- A szöveges ügyfélmező kiváltása: minden eltérő (nem üres) névből egy ügyfél lesz, a projekt arra hivatkozik.
ALTER TABLE projects ADD COLUMN client_id uuid REFERENCES clients (id);
INSERT INTO clients (name)
  SELECT DISTINCT btrim(client_name) FROM projects WHERE btrim(client_name) <> '';
UPDATE projects p SET client_id = c.id FROM clients c WHERE c.name = btrim(p.client_name);
ALTER TABLE projects DROP COLUMN client_name;
CREATE INDEX projects_client_idx ON projects (client_id) WHERE deleted_at IS NULL;

-- Projekt ↔ kolléga. A terepes szerepkörű felhasználó csak azokat a projekteket látja, amelyekhez itt hozzá van rendelve.
CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects (id),
  user_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user_idx ON project_members (user_id);

-- Auditnapló: ki, mikor, mit nézett meg vagy módosított. Csak hozzáfűzhető, mint az eseménynapló.
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES users (id),
  action text NOT NULL CHECK (action IN ('view', 'create', 'update', 'delete', 'login')),
  entity_type text NOT NULL CHECK (entity_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$'),
  entity_id text NOT NULL,
  label text NOT NULL DEFAULT '',
  project_id uuid REFERENCES projects (id),
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, id DESC);
CREATE INDEX audit_log_user_idx ON audit_log (user_id, id DESC);
CREATE INDEX audit_log_project_idx ON audit_log (project_id, id DESC) WHERE project_id IS NOT NULL;

CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log: csak hozzáfűzés engedélyezett (% tiltott)', TG_OP;
END;
$$;
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
