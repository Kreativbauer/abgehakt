-- Migration 0006: Warnung vor der automatischen Löschung inaktiver Klassen
-- Nur additiv (siehe CLAUDE.md).
-- Zeitpunkt, zu dem die Admins vor der Löschung gewarnt wurden. Ist die Klasse danach wieder
-- aktiv (last_active_at > deletion_warned_at), gilt die Warnung nicht mehr.
ALTER TABLE classes ADD COLUMN deletion_warned_at INTEGER;
