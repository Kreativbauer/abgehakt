-- Stundenplan (nur Wochentage): an welchen Tagen ein Fach Unterricht hat.
-- days_a/days_b: JSON-Arrays mit Wochentagen 1 (Mo) bis 5 (Fr); days_b nur bei A/B-Wochen.
ALTER TABLE subjects ADD COLUMN days_a TEXT NOT NULL DEFAULT '[]';
ALTER TABLE subjects ADD COLUMN days_b TEXT NOT NULL DEFAULT '[]';
-- A/B-Wochen: Montag einer A-Woche ('YYYY-MM-DD'); leer = jede Woche gleich.
ALTER TABLE classes ADD COLUMN ab_weeks_ref TEXT;
