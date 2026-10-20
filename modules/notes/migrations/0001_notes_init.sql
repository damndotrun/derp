-- Helyszíni jegyzet és felmérés, projekthez kötve. Mindkettő hozzáfűzés jellegű (nincs szerkesztés).

-- id: a kliens generálja (UUID), így az újraküldött jegyzet nem duplikál.
CREATE TABLE notes_notes (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id),
  author_id uuid NOT NULL REFERENCES users (id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  event_id uuid REFERENCES events (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_notes_project_idx ON notes_notes (project_id, created_at DESC);

-- materials: a becsült anyag tételesen ([{ "name", "quantity", "unit" }], legalább egy tétel).
-- photos: a csatolt fotók a kliens által előre kiosztott `docs_files.id`-vel és névvel ([{ "id", "name" }]); a fotók a
-- felmérés után töltődnek fel a dokumentumtárba, a feltöltés eseménye a felmérés eseménye alá kerül (`parentId`).
CREATE TABLE notes_surveys (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id),
  author_id uuid NOT NULL REFERENCES users (id),
  location text NOT NULL CHECK (length(location) BETWEEN 1 AND 300),
  condition text NOT NULL CHECK (length(condition) BETWEEN 1 AND 4000),
  proposed_work text NOT NULL CHECK (length(proposed_work) BETWEEN 1 AND 4000),
  materials jsonb NOT NULL CHECK (jsonb_typeof(materials) = 'array' AND jsonb_array_length(materials) > 0),
  photos jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(photos) = 'array'),
  event_id uuid REFERENCES events (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_surveys_project_idx ON notes_surveys (project_id, created_at DESC);
