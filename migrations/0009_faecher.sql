-- Migration 0009: Feste Fächerliste pro Klasse, Wahlfächer
-- Nur additiv (siehe CLAUDE.md).

-- Fächer einer Klasse. elective = 1: Wahlfach (nicht alle haben es).
-- archived_at gesetzt = aus der Liste entfernt (Aufgaben behalten ihren Fachnamen).
CREATE TABLE IF NOT EXISTS subjects (
  id           TEXT PRIMARY KEY,
  class_id     TEXT NOT NULL REFERENCES classes(id),
  name         TEXT NOT NULL,
  elective     INTEGER NOT NULL DEFAULT 0 CHECK (elective IN (0, 1)),
  created_at   INTEGER NOT NULL,
  archived_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_subjects_class ON subjects(class_id);

-- Aufgabe gehört zu einem Fach der Liste (ältere Aufgaben haben nur den Fachnamen als Text).
ALTER TABLE tasks ADD COLUMN subject_id TEXT REFERENCES subjects(id);

-- Welche Wahlfächer eine Person belegt (JSON-Array mit subject-IDs) und ob sie schon gewählt hat.
-- Solange electives_chosen_at leer ist, sieht die Person alle Fächer.
ALTER TABLE members ADD COLUMN elective_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE members ADD COLUMN electives_chosen_at INTEGER;

-- Bestehende Klassen: aus den bisher frei eingetippten Fachnamen eine Fächerliste anlegen
-- (alle als „für alle“). Ältere Aufgaben werden über den Namen zugeordnet (siehe src/api/tasks.js).
INSERT INTO subjects (id, class_id, name, elective, created_at)
SELECT lower(hex(randomblob(16))), class_id, MIN(subject), 0, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM tasks
 WHERE subject != '' AND deleted_at IS NULL AND owner_member_id IS NULL
 GROUP BY class_id, lower(subject);
