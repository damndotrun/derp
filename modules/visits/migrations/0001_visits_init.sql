-- Kiszállás-ütemezés (6. munkacsomag). Időpontok UTC-ben; törlés rejtéssel (deleted_at), szerkesztés verziószámmal.
CREATE TABLE visits_visit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  address text NOT NULL DEFAULT '',
  task text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'utemezett' CHECK (status IN ('utemezett', 'folyamatban', 'kesz', 'elmaradt')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (ends_at > starts_at)
);
CREATE INDEX visits_visit_project_idx ON visits_visit (project_id) WHERE deleted_at IS NULL;
CREATE INDEX visits_visit_time_idx ON visits_visit (starts_at, ends_at) WHERE deleted_at IS NULL;

-- A kiszállásra beosztott kollégák.
CREATE TABLE visits_assignee (
  visit_id uuid NOT NULL REFERENCES visits_visit(id),
  user_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (visit_id, user_id)
);
CREATE INDEX visits_assignee_user_idx ON visits_assignee (user_id);

-- Kollégánként egy ICS-token; csak a HMAC-SHA256(ICS_TOKEN_PEPPER, token) hash-e tárolódik. Újrageneráláskor felülíródik.
CREATE TABLE visits_ics_token (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
