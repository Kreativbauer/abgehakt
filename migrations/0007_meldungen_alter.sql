-- Migration 0007: Meldungen und Alters-Bestätigung
-- Nur additiv (siehe CLAUDE.md).

-- Gemeldete Einträge. Beim Melden speichert der Server eine Kopie des Eintrags (snapshot_*),
-- damit Admins und Betreiber genau das sehen, was gemeldet wurde – nicht mehr, nicht weniger.
CREATE TABLE IF NOT EXISTS reports (
  id                  TEXT PRIMARY KEY,
  class_id            TEXT NOT NULL REFERENCES classes(id),
  task_id             TEXT NOT NULL REFERENCES tasks(id),
  reporter_member_id  TEXT NOT NULL REFERENCES members(id),  -- für Admins/Betreiber nicht sichtbar
  reason              TEXT NOT NULL CHECK (reason IN ('beleidigend', 'rechtswidrig', 'spam', 'sonstiges')),
  comment             TEXT NOT NULL DEFAULT '',
  snapshot_subject    TEXT NOT NULL DEFAULT '',
  snapshot_title      TEXT NOT NULL,
  snapshot_details    TEXT NOT NULL DEFAULT '',
  snapshot_author     TEXT NOT NULL DEFAULT '',             -- „zuletzt geändert von“ zum Zeitpunkt der Meldung
  created_at          INTEGER NOT NULL,
  -- open → von Admins erledigt (admin_hidden / admin_dismissed) → ggf. vom Betreiber entschieden
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'admin_hidden', 'admin_dismissed',
                                        'op_dismissed', 'op_hidden', 'op_warned')),
  resolved_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reports_class ON reports(class_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);

-- Zeitpunkt, zu dem die Person bestätigt hat: mindestens 16 oder Eltern einverstanden.
ALTER TABLE members ADD COLUMN age_confirmed_at INTEGER;
