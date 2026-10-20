-- Mappafigyelő: projekt ↔ almappa hozzárendelés (projektenként egy), és a figyelt fájlok utolsó ismert állapota.
-- Az útvonalak a WATCH_ROOT-hoz (hozzárendelés), illetve a hozzárendelt almappához (fájl) képest relatívak, '/'-rel.

CREATE TABLE watch_mappings (
  project_id uuid PRIMARY KEY REFERENCES projects (id),
  path text NOT NULL CHECK (length(path) BETWEEN 1 AND 1000),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  -- Az utolsó sikeres bejárás ideje; a hiba szövege, ha az utolsó bejárás nem sikerült (pl. a mappa nem érhető el).
  last_scan_at timestamptz,
  last_error text
);
-- Egy almappa egyszerre csak egy projekthez tartozhat.
CREATE UNIQUE INDEX watch_mappings_path_key ON watch_mappings (path);

-- id: stabil, amíg a fájl létezik (módosításkor és átnevezéskor is), így az esemény letöltés-linkje él.
-- Törléskor (vagy a hozzárendelés változásakor) csak a deleted_at kap értéket.
CREATE TABLE watch_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id),
  path text NOT NULL CHECK (length(path) BETWEEN 1 AND 4000),
  size bigint NOT NULL CHECK (size >= 0),
  mtime timestamptz NOT NULL,
  sha256 text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX watch_files_path_key ON watch_files (project_id, path) WHERE deleted_at IS NULL;
