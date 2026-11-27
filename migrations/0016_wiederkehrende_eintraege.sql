-- Wiederkehrende Einträge (z. B. jeden Montag Mathe-Abfrage): Beim Anlegen entstehen einzelne Einträge, die über
-- series_id zusammengehören – so lässt sich „ab hier alle löschen“. Leer = einzelner Eintrag.
ALTER TABLE tasks ADD COLUMN series_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_series ON tasks(series_id);
