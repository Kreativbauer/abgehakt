-- Benachrichtigungen (Web Push). Eine Zeile pro Person, Klasse und Gerät (Empfangsadresse des Push-Dienstes).
-- Gelöscht wird nur über die App-Logik (src/lib/purge.js): Ausschalten, Klasse verlassen/entfernt,
-- Klasse gelöscht oder wenn der Push-Dienst meldet, dass die Adresse nicht mehr gilt.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id                 TEXT PRIMARY KEY,
  member_id          TEXT NOT NULL REFERENCES members(id),
  class_id           TEXT NOT NULL REFERENCES classes(id),
  endpoint           TEXT NOT NULL,              -- Empfangsadresse beim Push-Dienst (Apple, Google, Mozilla, Microsoft)
  p256dh             TEXT NOT NULL,              -- öffentlicher Schlüssel des Geräts (zum Verschlüsseln)
  auth               TEXT NOT NULL,              -- Geheimnis des Geräts (zum Verschlüsseln)
  remind_hour        INTEGER NOT NULL DEFAULT 18 CHECK (remind_hour BETWEEN 0 AND 23),
  notify_reminder    INTEGER NOT NULL DEFAULT 1 CHECK (notify_reminder IN (0, 1)),  -- Erinnerung am Vorabend
  notify_events      INTEGER NOT NULL DEFAULT 1 CHECK (notify_events IN (0, 1)),    -- Termine (morgen, in 3 Tagen)
  notify_new         INTEGER NOT NULL DEFAULT 1 CHECK (notify_new IN (0, 1)),       -- neue Einträge der Klasse
  last_reminder_date TEXT,                       -- 'YYYY-MM-DD': Erinnerung für diesen Tag schon erledigt
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  UNIQUE (member_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_class ON push_subscriptions(class_id);

-- Warteschlange für „neuer Eintrag“: wird alle 5 Minuten in kleinen Paketen verschickt und danach gelöscht.
CREATE TABLE IF NOT EXISTS push_outbox (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id),
  payload         TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_outbox_created ON push_outbox(created_at);
