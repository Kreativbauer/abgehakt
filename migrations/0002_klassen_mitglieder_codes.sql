-- Migration 0002: Klassen, Mitglieder, Geräte und Beitritts-Codes
-- Nur additiv (siehe CLAUDE.md). Zeiten sind Millisekunden seit 1970 (UTC).

-- Eine Klasse = ein Hausaufgabenheft.
CREATE TABLE IF NOT EXISTS classes (
  id              TEXT PRIMARY KEY,           -- zufällige Kennung (UUID)
  name            TEXT NOT NULL,              -- z. B. „8b Gymnasium X“
  created_at      INTEGER NOT NULL,
  last_active_at  INTEGER NOT NULL            -- für die automatische Löschung nach 12 Monaten
);

-- Eine Person in einer Klasse. Keine E-Mail: Mitglieder brauchen nur einen Namen.
CREATE TABLE IF NOT EXISTS members (
  id                 TEXT PRIMARY KEY,
  class_id           TEXT NOT NULL REFERENCES classes(id),
  name               TEXT NOT NULL,           -- Anzeigename, Spitznamen erlaubt
  role               TEXT NOT NULL DEFAULT 'member'
                     CHECK (role IN ('admin', 'editor', 'member')),
  status_visibility  TEXT NOT NULL DEFAULT 'none'
                     CHECK (status_visibility IN ('none', 'all', 'some')),
  created_at         INTEGER NOT NULL,
  removed_at         INTEGER                  -- gesetzt = aus der Klasse entfernt, kein Zugang mehr
);
CREATE INDEX IF NOT EXISTS idx_members_class ON members(class_id);

-- Angemeldete Geräte. Gespeichert wird nur der SHA-256-Hash des Geräte-Schlüssels,
-- der Schlüssel selbst liegt nur auf dem Gerät.
CREATE TABLE IF NOT EXISTS devices (
  token_hash    TEXT PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES members(id),
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  revoked_at    INTEGER                       -- gesetzt = Gerät abgemeldet
);
CREATE INDEX IF NOT EXISTS idx_devices_member ON devices(member_id);

-- Beitritts-Codes.
--   kind = 'invite':   Einladungscode für beliebig viele Personen (Ablauf nach Zeit, optional nach Anzahl)
--   kind = 'personal': persönlicher Code für genau eine bestehende Person (member_id), einmal nutzbar
CREATE TABLE IF NOT EXISTS join_codes (
  code         TEXT PRIMARY KEY,              -- 8 Zeichen, ohne Bindestrich gespeichert
  class_id     TEXT NOT NULL REFERENCES classes(id),
  kind         TEXT NOT NULL CHECK (kind IN ('invite', 'personal')),
  member_id    TEXT REFERENCES members(id),   -- nur bei 'personal'
  created_by   TEXT REFERENCES members(id),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  max_uses     INTEGER,                       -- NULL = unbegrenzt
  use_count    INTEGER NOT NULL DEFAULT 0,
  revoked_at   INTEGER                        -- gesetzt = vom Admin ungültig gemacht
);
CREATE INDEX IF NOT EXISTS idx_join_codes_class ON join_codes(class_id);
