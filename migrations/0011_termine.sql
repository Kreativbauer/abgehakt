-- Art eines Eintrags: Hausaufgabe oder Termin (Schulaufgabe, Kurzarbeit, Test/Abfrage, Referat/Abgabe).
ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'homework'
  CHECK (kind IN ('homework', 'exam', 'short_exam', 'test', 'presentation'));
