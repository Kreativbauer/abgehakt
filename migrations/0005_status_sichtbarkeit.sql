-- Migration 0005: Wer sieht meinen Status?
-- Nur additiv (siehe CLAUDE.md).
-- members.status_visibility gibt es schon ('none' = niemand, 'all' = alle, 'some' = bestimmte Personen).
-- Hier kommt die Liste der bestimmten Personen dazu (JSON-Array mit member-IDs).
ALTER TABLE members ADD COLUMN status_viewers TEXT NOT NULL DEFAULT '[]';
