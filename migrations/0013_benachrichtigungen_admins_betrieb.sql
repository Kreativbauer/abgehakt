-- Benachrichtigungen für Admins (neue Meldung in ihrer Klasse) und für den Betreiber (/betrieb).
-- Nur additiv. Gelöscht wird nur über die App-Logik (src/lib/purge.js).

-- Admins: Schalter „Meldungen“ pro Gerät (für Nicht-Admins ohne Wirkung).
ALTER TABLE push_subscriptions ADD COLUMN notify_reports INTEGER NOT NULL DEFAULT 1 CHECK (notify_reports IN (0, 1));

-- Betreiber: Geräte, die auf /betrieb Benachrichtigungen eingeschaltet haben. Keine Person, keine Klasse.
CREATE TABLE IF NOT EXISTS operator_push_subscriptions (
  id              TEXT PRIMARY KEY,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  notify_feedback INTEGER NOT NULL DEFAULT 1 CHECK (notify_feedback IN (0, 1)),  -- neue Idee / neuer Fehler
  notify_reports  INTEGER NOT NULL DEFAULT 1 CHECK (notify_reports IN (0, 1)),   -- Meldung von Admins abgelehnt
  notify_classes  INTEGER NOT NULL DEFAULT 0 CHECK (notify_classes IN (0, 1)),   -- neue Klasse angelegt
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- Warteschlange für den Betreiber, verschickt im Lauf alle 5 Minuten (wie push_outbox).
CREATE TABLE IF NOT EXISTS operator_push_outbox (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES operator_push_subscriptions(id),
  payload         TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_operator_push_outbox_created ON operator_push_outbox(created_at);
