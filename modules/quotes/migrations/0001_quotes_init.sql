-- Árajánlat (10. munkacsomag). Egy ajánlatnak (projektenként több is lehet) verziói vannak; csak a tervezet
-- szerkeszthető, a kiküldött (elfogadott, elutasított) verzió és a PDF-jei megmaradnak, módosításhoz új verzió készül.
-- Pénz fillérben (1/100 Ft), egész számként.

-- number: az ajánlat sorszáma, rendszerszinten folyamatos.
CREATE TABLE quotes_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id),
  number integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quotes_quotes_project_idx ON quotes_quotes (project_id, created_at DESC);

-- items: a tételek a cikk adatainak másolatával ([{ id, catalogItemId, sku, name, unit, quantity, netUnitPriceFiller,
-- vatRate, discountPercent }]); revision: minden mentéssel nő (eltérő revision-nel küldött mentés 409).
-- event_id: a verzió létrehozásának eseménye; a státuszváltás és a PDF eseménye erre mutat (`parentId`).
CREATE TABLE quotes_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes_quotes (id),
  version_no integer NOT NULL CHECK (version_no > 0),
  status text NOT NULL DEFAULT 'tervezet' CHECK (status IN ('tervezet', 'kikuldve', 'elfogadva', 'elutasitva')),
  revision integer NOT NULL DEFAULT 1,
  items jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(items) = 'array'),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  valid_until date,
  event_id uuid REFERENCES events (id),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_id, version_no)
);
-- Egy ajánlatnak egyszerre legfeljebb egy tervezete van.
CREATE UNIQUE INDEX quotes_versions_one_draft ON quotes_versions (quote_id) WHERE status = 'tervezet';

-- Az elkészült PDF-ek (a verzióval együtt megmaradnak; a tervezetnél minden kérés újat ad).
CREATE TABLE quotes_pdfs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES quotes_versions (id),
  revision integer NOT NULL,
  file_name text NOT NULL,
  content bytea NOT NULL,
  total_filler bigint NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quotes_pdfs_version_idx ON quotes_pdfs (version_id, created_at DESC);

-- A PDF fejléce (a cég adatai és a logó): egyetlen sor, az admin szerkeszti. A magban nincs beállítás-tár.
CREATE TABLE quotes_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  tax_number text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  bank_account text NOT NULL DEFAULT '',
  footer text NOT NULL DEFAULT '',
  logo bytea,
  logo_mime text CHECK (logo_mime IN ('image/png', 'image/jpeg')),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO quotes_settings (id) VALUES (1);
