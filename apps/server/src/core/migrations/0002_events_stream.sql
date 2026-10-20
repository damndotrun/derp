-- Élő frissítés (SSE): beszúrási sorszám a Last-Event-ID-hez, és NOTIFY minden új eseményről.
-- A sorszám a beszúrás sorrendje, nem a commité; a folytatáskor kimaradó, később commitolt esemény élőben
-- (NOTIFY) akkor is megérkezik, ha a kapcsolat közben él.

ALTER TABLE events ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX events_seq_key ON events (seq);

-- A payload csak a sorszám (a NOTIFY 8000 bájtos korlátja miatt); a szerver ebből olvassa vissza az eseményt.
CREATE FUNCTION events_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('derp_events', NEW.seq::text);
  RETURN NULL;
END;
$$;
CREATE TRIGGER events_notify
  AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION events_notify();
