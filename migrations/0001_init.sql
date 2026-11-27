-- Migration 0001: Grundgerüst
-- Regel: Migrationen sind nur additiv. Nie DROP, DELETE oder überschreibende UPDATEs
-- auf bestehende Daten. Neue Spalten/Tabellen immer in einer neuen Migrationsdatei.

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_meta (key, value) VALUES ('schema_version', '1');
