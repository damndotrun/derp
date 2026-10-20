-- Cikktörzs (9. munkacsomag). A nettó egységár fillérben (1/100 Ft), egész számként; az ÁFA-kulcs százalékban.
-- A `search_text` a cikkszám, a megnevezés és a beszállító kisbetűs, ékezet nélküli alakja (a szerver tölti), erre
-- megy a keresés.
CREATE TABLE catalog_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  unit text NOT NULL,
  net_unit_price_filler bigint NOT NULL CHECK (net_unit_price_filler >= 0),
  vat_rate smallint NOT NULL CHECK (vat_rate IN (0, 5, 18, 27)),
  supplier text NOT NULL DEFAULT '',
  search_text text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalog_item_name_idx ON catalog_item (name, sku);
