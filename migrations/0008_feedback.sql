-- Migration 0008: Ideen und Fehlermeldungen an den Betreiber
-- Nur additiv (siehe CLAUDE.md). Bewusst ohne Verweis auf Person oder Klasse:
-- sender_hash dient nur der Begrenzung (max. 5 pro Tag) und lässt sich nicht zurückrechnen.
CREATE TABLE IF NOT EXISTS feedback (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('idee', 'fehler', 'sonstiges')),
  text         TEXT NOT NULL,
  app_version  TEXT NOT NULL DEFAULT '',
  platform     TEXT NOT NULL DEFAULT '',     -- grob: iPhone, Android, Computer
  sender_hash  TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')),
  resolved_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_sender ON feedback(sender_hash, created_at);
