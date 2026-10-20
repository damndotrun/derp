-- Elvetett (pl. hírlevél) hozzárendeletlen szál: kikerül a „Hozzárendeletlen levelek” listából, visszaállítható.
ALTER TABLE gmail_threads ADD COLUMN dismissed_at timestamptz;
ALTER TABLE gmail_threads ADD COLUMN dismissed_by uuid REFERENCES users (id);

DROP INDEX gmail_threads_unassigned_idx;
CREATE INDEX gmail_threads_unassigned_idx ON gmail_threads (last_message_at DESC) WHERE project_id IS NULL AND dismissed_at IS NULL;
CREATE INDEX gmail_threads_dismissed_idx ON gmail_threads (dismissed_at DESC) WHERE project_id IS NULL AND dismissed_at IS NOT NULL;
