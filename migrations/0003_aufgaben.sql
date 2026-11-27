-- Migration 0003: Hausaufgaben, Status und private Notizen
-- Nur additiv (siehe CLAUDE.md). Zeiten in Millisekunden (UTC), Abgabedatum als 'YYYY-MM-DD'.

-- Eine Aufgabe. owner_member_id leer = für die ganze Klasse,
-- gesetzt = private Aufgabe, die nur diese Person sieht (auch Admins nicht).
CREATE TABLE IF NOT EXISTS tasks (
  id               TEXT PRIMARY KEY,
  class_id         TEXT NOT NULL REFERENCES classes(id),
  owner_member_id  TEXT REFERENCES members(id),
  subject          TEXT NOT NULL DEFAULT '',   -- Fach, z. B. „Mathe“
  title            TEXT NOT NULL,              -- was zu tun ist
  details          TEXT NOT NULL DEFAULT '',
  due_date         TEXT NOT NULL,              -- Abgabetermin 'YYYY-MM-DD'
  created_by       TEXT NOT NULL REFERENCES members(id),
  created_at       INTEGER NOT NULL,
  updated_by       TEXT NOT NULL REFERENCES members(id),  -- „zuletzt geändert von“
  updated_at       INTEGER NOT NULL,
  deleted_at       INTEGER,                    -- gesetzt = gelöscht (wird nicht mehr angezeigt)
  deleted_by       TEXT REFERENCES members(id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_class_due ON tasks(class_id, due_date);

-- Status und private Notiz einer Person zu einer Aufgabe.
CREATE TABLE IF NOT EXISTS task_states (
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  member_id   TEXT NOT NULL REFERENCES members(id),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  note        TEXT NOT NULL DEFAULT '',        -- private Notiz, sieht nur diese Person
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (task_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_task_states_member ON task_states(member_id);
