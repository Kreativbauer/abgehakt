-- Admin-Anmeldung: Begrenzung pro Gerät/Netz statt pro E-Mail-Adresse, damit niemand fremde Admins aussperren oder
-- das Tageslimit für alle aufbrauchen kann. Gespeichert wird nur eine Prüfsumme der IP-Adresse (kind 'mail' = Code
-- angefordert, 'fail' = falscher Code; jeweils mit der E-Mail-Adresse). Der tägliche Lauf löscht alles nach 24 Stunden.
CREATE TABLE IF NOT EXISTS login_limits (
  ip_hash     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('mail', 'fail')),
  email       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_limits_ip ON login_limits(ip_hash, kind, created_at);
CREATE INDEX IF NOT EXISTS idx_login_limits_created ON login_limits(created_at);
