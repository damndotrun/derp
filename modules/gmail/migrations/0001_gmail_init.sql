-- Gmail (11. munkacsomag): bekötött fiókok, levélszálak és levelek, szál → projekt hozzárendelési szabályok.

-- source: honnan jönnek a levelek (`mock` fixture-ökből, `gmail` élőben, 14. munkacsomag). history_id: a Gmail
-- `historyId`, ahonnan a következő növekményes betöltés folytatódik (NULL: még nem volt betöltés).
CREATE TABLE gmail_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  source text NOT NULL CHECK (source IN ('mock', 'gmail')),
  history_id text,
  last_sync_at timestamptz,
  last_sync_error text,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gmail_accounts_email_key ON gmail_accounts (lower(email));

-- Egy Gmail-szál egy fiókban; egy szál legfeljebb egy projekthez tartozik (project_id).
CREATE TABLE gmail_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES gmail_accounts (id),
  gmail_thread_id text NOT NULL,
  subject text NOT NULL DEFAULT '',
  first_message_at timestamptz NOT NULL,
  last_message_at timestamptz NOT NULL,
  project_id uuid REFERENCES projects (id),
  assigned_by uuid REFERENCES users (id),
  assigned_at timestamptz,
  UNIQUE (account_id, gmail_thread_id)
);
CREATE INDEX gmail_threads_unassigned_idx ON gmail_threads (last_message_at DESC) WHERE project_id IS NULL;
CREATE INDEX gmail_threads_project_idx ON gmail_threads (project_id) WHERE project_id IS NOT NULL;

-- A levél: a Gmail üzenet-azonosítója fiókon belül egyedi, ez zárja ki a duplikációt (újrabetöltéskor is).
-- direction és kind a classify.ts szerint; event_id: a `gmail.message` esemény, ha a szál projekthez tartozik.
CREATE TABLE gmail_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES gmail_accounts (id),
  gmail_message_id text NOT NULL,
  thread_id uuid NOT NULL REFERENCES gmail_threads (id),
  rfc822_message_id text,
  sent_at timestamptz NOT NULL,
  from_addr text NOT NULL DEFAULT '',
  to_addrs text[] NOT NULL DEFAULT '{}',
  cc_addrs text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL DEFAULT '',
  snippet text NOT NULL DEFAULT '',
  label_ids text[] NOT NULL DEFAULT '{}',
  body_text text NOT NULL DEFAULT '',
  body_html text,
  attachments jsonb NOT NULL DEFAULT '[]',
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  kind text NOT NULL CHECK (kind IN ('order', 'quote_in', 'rfq_out', 'client_rfq', 'msg')),
  event_id uuid REFERENCES events (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, gmail_message_id)
);
CREATE INDEX gmail_messages_thread_idx ON gmail_messages (thread_id, sent_at);
CREATE INDEX gmail_messages_account_time_idx ON gmail_messages (account_id, sent_at DESC);

-- Hozzárendelési szabály: kis- és nagybetűtől független reguláris kifejezés a szál tárgyára és törzsére (projektkód
-- vagy kulcsszó); a javaslat az első illeszkedő szabály projektje (position szerint).
CREATE TABLE gmail_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern text NOT NULL CHECK (length(pattern) BETWEEN 1 AND 200),
  project_id uuid NOT NULL REFERENCES projects (id),
  position integer NOT NULL,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gmail_rules_position_idx ON gmail_rules (position, created_at);
