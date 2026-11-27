-- Migration 0004: Admin-Anmeldung per E-Mail-Code
-- Nur additiv (siehe CLAUDE.md). Nur Admins haben eine E-Mail-Adresse.

-- Ein Admin-Konto = eine E-Mail-Adresse.
CREATE TABLE IF NOT EXISTS accounts (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,      -- immer klein geschrieben
  created_at     INTEGER NOT NULL,
  last_login_at  INTEGER NOT NULL
);

-- Einmal-Codes, die per E-Mail verschickt werden (6 Ziffern, 10 Minuten gültig, max. 5 Versuche).
CREATE TABLE IF NOT EXISTS login_codes (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,                -- SHA-256, der Code selbst wird nicht gespeichert
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email, created_at);

-- Angemeldete Admin-Geräte (Konto-Schlüssel, nur als Hash).
CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash    TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  revoked_at    INTEGER
);

-- Verknüpft Admin-Personen in einer Klasse mit ihrem Konto
-- (damit ein Admin nach Gerätewechsel per E-Mail-Code wieder an seine Klassen kommt).
ALTER TABLE members ADD COLUMN account_id TEXT REFERENCES accounts(id);
CREATE INDEX IF NOT EXISTS idx_members_account ON members(account_id);
