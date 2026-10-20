-- Dokumentumtár: tartalom szerint címzett blobok (sha256), projektmappák és fájlok (metaadat).
-- Egy blobra több fájl-sor is hivatkozhat (ugyanaz a fotó több helyen); a blob sora és a lemezen lévő fájl csak az
-- utolsó hivatkozó fájl-sor törlése után törlődik. A külső kulcs adatbázis-szinten is kizárja a hivatkozott blob törlését.

CREATE TABLE docs_blobs (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size bigint NOT NULL CHECK (size >= 0),
  has_thumb boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE docs_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id),
  parent_id uuid REFERENCES docs_folders (id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
-- Egy szinten belül egyedi név (kis- és nagybetűtől függetlenül).
CREATE UNIQUE INDEX docs_folders_name_key
  ON docs_folders (project_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- id: a kliens generálja (UUID), így az újraküldött feltöltés nem duplikál.
CREATE TABLE docs_files (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id),
  folder_id uuid REFERENCES docs_folders (id),
  sha256 text NOT NULL REFERENCES docs_blobs (sha256),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  mime text NOT NULL,
  size bigint NOT NULL CHECK (size >= 0),
  uploaded_by uuid REFERENCES users (id),
  event_id uuid REFERENCES events (id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX docs_files_project_idx ON docs_files (project_id, created_at DESC);
CREATE INDEX docs_files_folder_idx ON docs_files (folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX docs_files_sha256_idx ON docs_files (sha256);
