-- Eintragende für bestimmte Fächer: JSON-Array mit subject-IDs. Leer ('[]') = alle Fächer (wie bisher).
-- Nur für die Rolle „editor“ von Bedeutung; Admins dürfen immer alles.
ALTER TABLE members ADD COLUMN editor_subject_ids TEXT NOT NULL DEFAULT '[]';
