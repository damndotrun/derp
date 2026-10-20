-- Projekt-chat: üzenetek projektenként és felhasználónkénti olvasottság.

-- id: a kliens generálja (UUID), így az újraküldött üzenet nem duplikál. A sorrend a `seq` (a szerverre érkezés sorrendje).
-- attachments: a csatolt fájlok a kliens által előre kiosztott `docs_files.id`-vel és névvel ([{ "id", "name" }]); a fájl
-- az üzenet után töltődik fel a dokumentumtárba, a feltöltés eseménye az üzenet eseménye alá kerül (`parentId`).
CREATE TABLE chat_messages (
  id uuid PRIMARY KEY,
  seq bigserial NOT NULL UNIQUE,
  project_id uuid NOT NULL REFERENCES projects (id),
  author_id uuid NOT NULL REFERENCES users (id),
  body text NOT NULL CHECK (length(body) <= 4000),
  mentions uuid[] NOT NULL DEFAULT '{}',
  attachments jsonb NOT NULL DEFAULT '[]',
  event_id uuid REFERENCES events (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(body) > 0 OR jsonb_array_length(attachments) > 0)
);
CREATE INDEX chat_messages_project_idx ON chat_messages (project_id, seq DESC);
CREATE INDEX chat_messages_mentions_idx ON chat_messages USING gin (mentions);

-- Meddig olvasta a felhasználó a projekt chatjét (az utolsó látott üzenet `seq`-je; csak nőhet).
CREATE TABLE chat_reads (
  project_id uuid NOT NULL REFERENCES projects (id),
  user_id uuid NOT NULL REFERENCES users (id),
  last_read_seq bigint NOT NULL DEFAULT 0,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
