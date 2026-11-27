-- „Sonstiger Termin“ (z. B. Klassenfoto, Wandertag): eigener Text, Fach optional.
-- Die Spalte tasks.kind hat eine feste Liste erlaubter Werte (CHECK in 0011). Diese Liste lässt sich in SQLite nur
-- ändern, indem man die Tabelle neu baut – das verbieten unsere Regeln (nur additive Migrationen). Deshalb:
-- Sonstige Termine stehen mit kind = 'test' in der Tabelle und other_event = 1; die API macht daraus kind = 'other'
-- (siehe kindOf()/dbKind() in src/api/tasks.js).
ALTER TABLE tasks ADD COLUMN other_event INTEGER NOT NULL DEFAULT 0 CHECK (other_event IN (0, 1));
