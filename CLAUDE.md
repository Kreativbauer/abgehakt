# CLAUDE.md – Regeln für Abgehakt

Abgehakt ist ein kostenloses Klassen-Hausaufgabenheft als Web-App (PWA).
Das vollständige Konzept steht in `KONZEPT.md` – bei inhaltlichen Fragen dort nachsehen.

## Feste Regeln (immer einhalten)

0. **Das Repository ist öffentlich – alles darin kann jede Person lesen** (Code, Commits, Branches, PR-Texte und
   -Kommentare, Abläufe mit Protokollen, Dateien in PRs). Nie hineinschreiben: Namen echter Personen außer Nils
   (z. B. Mitschüler:innen, auch nur Vornamen), Anschrift, private E-Mail-Adressen, Klassennamen oder -codes,
   Kennungen, Inhalte aus Heften, Screenshots mit echten Daten, Schlüssel/Secrets, Datenbank-Exporte.
   Wünsche von Personen neutral beschreiben („Wunsch aus der Klasse“). **Im Zweifel vorher Nils fragen.**
   Privates (offene Punkte, Sicherungen) gehört ins private Repo `Kreativbauer/abgehakt-sicherung`.


1. **Versionsnummer erhöhen – einmal pro Pull Request, nicht pro Änderung.** Erst das Mergen nach `main` ist eine neue
   Version (Wunsch von Nils: mehrere Sachen als eine Version bringen). Solange ein PR offen ist, kommen weitere Änderungen
   in denselben PR, **ohne** erneute Erhöhung – nur von PATCH auf MINOR hochstufen, wenn eine neue Funktion dazukommt,
   und den „Was ist neu“-Eintrag dieser Version ergänzen. Die Testversion zeigt zusätzlich eine Build-Nummer
   („Version 0.36.0-3“ = 3. Commit dieses PRs; `deploy.yml` setzt sie nur dort in package.json, HTML und – mit
   Laufnummer – im Offline-Speicher, nie committen). Bei Änderungen an Skript, Styles, HTML oder Worker-Code (`public/`, `src/`) gegenüber `main` also
   die Version erhöhen – an allen Stellen gleichzeitig:
   - `version` in `package.json`
   - alle `?v=…`-Angaben und angezeigten „Version x.y.z“ in den HTML-Dateien (`public/**/*.html`)
   - `VERSION` in `public/sw.js` (neuer Cache für den Offline-Modus)
   - `npm install --package-lock-only`, damit `package-lock.json` mitzieht
   Schema: `MAJOR.MINOR.PATCH` – Fehlerbehebung = PATCH, neue Funktion = MINOR.
   `npm run check` prüft, dass alles zusammenpasst; der Deploy bricht sonst ab.
   Neue Funktion (MINOR, `x.y.0`) → oben in `public/js/changelog.js` einen Eintrag „Was ist neu“ ergänzen:
   1–3 kurze Sätze in Alltagssprache aus Sicht der Nutzer. Fehlerbehebungen (PATCH) bekommen keinen.

2. **Nie Daten löschen oder überschreiben.**
   - Datenbank-Migrationen in `migrations/` sind nur additiv: neue Tabellen, neue Spalten,
     neue Indizes. Kein `DROP`, `DELETE`, `TRUNCATE`, `UPDATE` oder `REPLACE` in Migrationen.
   - Bestehende Migrationsdateien nie ändern – immer eine neue Datei `NNNN_beschreibung.sql` anlegen.
   - Keine Befehle gegen die echte Datenbank (`--remote`) ausführen, die Daten verändern.
   - Löschen gibt es nur dort, wo es das Konzept als Funktion vorsieht – und nur über die App-Logik
     in `src/lib/purge.js`: Person verlässt die Klasse / wird entfernt (Häkchen, Notizen, private
     Aufgaben löschen, Name → „Ehemaliges Mitglied“), Klasse löschen (Admin, Not-Werkzeug,
     12 Monate ohne Aktivität), Aufräumen im täglichen Lauf (`src/jobs/cleanup.js`), Benachrichtigungen
     (Abo ausschalten/ungültig, Gerätewechsel per Admin-Code, Warteschlange nach Versand), Admin-Anmeldungen nach
     90 Tagen ohne Nutzung. Aufgaben löschen = nur ausblenden (`deleted_at`).

3. **Strenge CSP, kein Inline-Code.**
   - Kein `<script>` mit Inhalt, kein `<style>`-Block, kein `style="…"`, keine `onclick="…"`,
     keine `javascript:`-Links. Alles in eigene Dateien unter `public/css/` und `public/js/`.
   - Keine fremden Skripte, Schriften, Bilder, CDNs, Tracking- oder Analyse-Tools.
   - Die Header stehen in `public/_headers` (statische Dateien) und in `src/worker.js` (API).
     Die CSP nie lockern (kein `'unsafe-inline'`, kein `'unsafe-eval'`, keine fremden Domains).
   - Dynamische Inhalte per `textContent` / DOM-API einsetzen, nie per `innerHTML` mit Nutzerdaten.

4. **Design: dunkel und hell nach System.** Linear als Basis, Fachfarben nach Notion. Farben nur über die
   CSS-Variablen in `public/css/style.css` – nie feste Farbwerte in Regeln. Das helle Design
   (`@media (prefers-color-scheme: light)`) setzt nur dieselben Variablen neu: schlichtes Gegenstück zum dunklen
   (Weiß/Grau, gleiche Akzentfarbe), nicht bunter. Neue Variablen immer für beide Designs festlegen.

   **Farb-Designs** (Wunsch von Nils, pro Gerät `abgehakt.theme`): Einstellungen → Für mich → Design: „Standard“, fertige
   Farben (`THEMES` in `app.js`, z. B. Pink) oder eigene Farbe (`<input type="color">`). `themeVars()` leitet aus einer
   Grundfarbe alle Variablen für dunkel/hell ab und setzt sie per CSSOM (`style.setProperty` – erlaubt die CSP, ist kein
   `style="…"`); „Standard“ entfernt sie wieder. Neue Farb-Variablen, die getönt werden sollen → in `THEME_VARS`/`themeVars()`.

## Weitere Grundsätze aus dem Konzept

- HTML, CSS und JavaScript **ohne Framework**, kein Build-Schritt für den Client.
- **Datensparsamkeit:** Mitglieder haben keine E-Mail; nur Admins. Keine unnötigen Daten speichern.
- Der Betreiber hat **keinen Lese-Zugang** zu Heften – keine Admin-Ansicht für Inhalte bauen.
- Klassen-Seiten bekommen `noindex`. Die Startseite wäre als einzige indexierbar – ist aber **vorerst auch
  `noindex`** (Abgehakt ist noch nicht veröffentlicht, siehe „Sichtbarkeit in Suchmaschinen“).
- Texte in der App sind auf Deutsch.
- **Datenschutzerklärung aktuell halten:** Wer neue Daten speichert, einen neuen Dienstleister einbindet
  oder Speicherdauern ändert, passt `public/datenschutz.html` im selben Pull Request an.
  Platzhalter `<span class="todo">[…]</span>` füllt nur Nils aus (`npm run check` weist darauf hin).
- **Anschrift nie in den Code:** In `impressum.html` und `datenschutz.html` stehen nur `@@ANSCHRIFT_STRASSE@@` und
  `@@ANSCHRIFT_ORT@@`. `deploy.yml` setzt sie beim Veröffentlichen aus den GitHub-Secrets `ANSCHRIFT_STRASSE` /
  `ANSCHRIFT_ORT` ein (`scripts/anschrift-einsetzen.js`; echte Seite: fehlt ein Secret → Abbruch, Testversion: Hinweistext).
  Lokal sieht man die Platzhalter. `npm run check` prüft, dass sie da sind.

## Projektstruktur

```
public/              statische Dateien (werden direkt von Cloudflare ausgeliefert)
  _headers           Sicherheits- und Cache-Header (/app/* mit noindex)
  index.html         öffentliche Startseite (vorerst noindex), img/ (Bild der App), sitemap.xml, robots.txt
  impressum.html, datenschutz.html   Rechtliches (/impressum, /datenschutz); beide noindex (Name/Anschrift)
  sw.js              Service Worker (Offline-Modus), manifest.webmanifest, icons/ (Home-Bildschirm)
  app/index.html     die App: Beitreten, Klassen-Heft (noindex)
  css/, js/          Styles und Skripte (mit ?v=<Version> eingebunden); js/changelog.js = „Was ist neu“
src/worker.js        Router für /api/* und täglicher Lauf (scheduled)
src/jobs/cleanup.js  täglicher Lauf: inaktive Klassen warnen/löschen, aufräumen
src/jobs/notify.js   alle 5 Minuten: Benachrichtigungen verschicken (Warteschlange, Erinnerung am Vorabend)
src/api/             API-Endpunkte (join.js, me.js, tasks.js, account.js, classes.js, members.js, operator.js, reports.js, feedback.js, subjects.js, push.js, operator-push.js)
src/lib/             Hilfen: http.js (Antworten, Fehler, Rate-Limit), crypto.js, auth.js, devices.js, email.js, purge.js, webpush.js
migrations/          D1-Migrationen (nur additiv!)
scripts/             check-version.js (Regelprüfung), create-class.js (Testklasse anlegen)
wrangler.jsonc       Cloudflare-Konfiguration (Worker, Assets, D1, Rate-Limit)
.github/workflows/deploy.yml   prüft PRs und veröffentlicht sie auf die Testversion, veröffentlicht main automatisch
```

## Anmeldung und Codes (Technik)

- Mitglieder melden sich per **Geräte-Schlüssel** an: zufällige 256 Bit, nur auf dem Gerät
  (localStorage `abgehakt.memberships`), auf dem Server nur der SHA-256-Hash (`devices`).
  Gesendet als `Authorization: Bearer <schlüssel>`; `requireMember()` in `src/lib/auth.js`.
- Ein Gerät kann in mehreren Klassen sein: ein Schlüssel pro Klasse.
- Codes: 8 Zeichen ohne 0/O/1/I/L, angezeigt als `XXXX-XXXX`. Einladungslink: `/app/#code=XXXXXXXX`
  (im `#`-Teil, damit der Code nicht in Server-Logs landet).
- Code-Endpunkte sind pro Netz begrenzt (`clientNet()` in `src/lib/http.js`: IPv4 bzw. IPv6-/64; `CODE_LIMITER`, 60/Minute – Schulklassen teilen sich eine IP), mit **getrennten
  Zählern je Bereich** (`limit` in `ROUTES`: `code-check`, `join`, `login-start`, `login`, `operator`). Anmelde-E-Mails
  zusätzlich `LOGIN_LIMITER` (5/Minute/IP), ebenso das Passwort der Testversion.
- Beitreten mit Einladungscode: höchstens `MAX_MEMBERS` (200) Personen pro Klasse (`src/api/join.js`).
- Entfernen = `removed_at` setzen; das Gerät verliert sofort den Zugang.

## Admin-Anmeldung (Technik)

- Nur Admins haben ein Konto (`accounts`, E-Mail klein geschrieben). Anmeldung per 6-stelligem
  Code aus der E-Mail (`login_codes`, 10 Minuten gültig). Grenzen (`src/api/account.js`):
  - **Grenzen pro Code und pro E-Mail-Adresse, nie nur pro Netz – Netze lassen sich wechseln:** jeder Code höchstens 5 Prüfungen
    insgesamt, atomar reserviert (`UPDATE … attempts + 1 … RETURNING`, dann vergleichen; jeder gültige Code zählt, nicht
    nur der neueste); höchstens 6 Codes pro Adresse und Tag über alle Netze (Einfügen nur mit Platz, in einem Schritt)
    → höchstens 30 Rateversuche pro Adresse und Tag.
  - **Pro Netz** (`login_limits`, Migration 0018, Prüfsumme von `clientNet()` = IPv4 bzw. IPv6-/64, 24 Stunden):
    3 Codes pro 15 Minuten je Adresse, 15 Codes pro Tag, 10 falsche Codes je Adresse bzw. 20 insgesamt → nur dieses Netz ist gesperrt.
  - Ohne gültigen Code („abgelaufen“) oder mit verbrauchten Codes („neuen Code anfordern“) zählt ein Versuch nicht.
  - Tageskontingent Anmelde-E-Mails: 40 für Adressen mit Konto, 20 für neue (Rest des Resend-Kontingents für
    Löschwarnungen), gleiche Meldung für beide. Scheitert der Versand, wird der Code sofort entwertet (zählt aber mit).
- Konto-Schlüssel (`account_sessions`) verfallen nach 90 Tagen ohne Nutzung (`ACCOUNT_SESSION_MAX_IDLE_MS` in
  `src/lib/auth.js`, der tägliche Lauf löscht sie).
- Nach der Anmeldung: Konto-Schlüssel (`account_sessions`) für „Klasse anlegen“. In der Klasse
  handelt ein Admin wie alle anderen über seinen Geräte-Schlüssel (`requireAdmin()`).
- Einstiege: „Klasse anlegen“ (danach Formular), „Du bist schon Admin? Mit E-Mail anmelden“ (holt alle
  Admin-Klassen aufs Gerät) und „Mit E-Mail absichern“ in der Mitgliederliste (verknüpft nur).
- `members.account_id` verknüpft Admin-Personen mit dem Konto. Beim Anmelden auf einem neuen Gerät
  bekommt es automatisch Geräte-Schlüssel für alle Klassen, in denen das Konto Admin ist.
- E-Mails über Resend (`src/lib/email.js`). Schlüssel `RESEND_API_KEY` nur als Cloudflare-Secret,
  nie ins Repository. Absender `EMAIL_FROM` in `wrangler.jsonc`.
- Lokal: `.dev.vars` mit `DEV_MODE=1` – der Code erscheint dann in der Konsole von `npm run dev`.

## Mitglieder und Rechte (Technik)

- Namen: jede Person ändert ihren eigenen (`PUT /api/me/name`), Admins auch fremde
  (`PATCH /api/members/:id { name }`). Namen sind pro Klasse eindeutig (Groß-/Kleinschreibung egal).
- Eintragende für bestimmte Fächer: `members.editor_subject_ids` (JSON, leer = alle Fächer; Migration 0015). Admin setzt sie in
  „Mitglieder“ → „Fächer“ (`PATCH /api/members/:id { editorSubjects }`; Rollenwechsel setzt zurück). Zur Auswahl (und vom
  Server angenommen) nur Fächer, die die Person selbst hat: Pflichtfächer und gewählte Wahlfächer (noch nicht gewählt → alle). Dafür liefert `GET /api/members` Admins die
  Wahlfächer – nur bei Eintragenden (`electives`), sonst sieht sie niemand außer der Person selbst (Datenschutzerklärung). Server prüft mit
  `maySubject()` (`src/lib/auth.js`) in `rights()`, `createTask`, `updateTask`: Klassen-Einträge nur in diesen Fächern, kein
  „Kein Fach“; private Aufgaben gehen immer. Mit Fach-Liste kein Fächer-/Stundenplan-Verwalten (`canManageSubjects()`).
  Die App bekommt `postSubjects` (null = alle) und zeigt im Formular für Klassen-Einträge nur diese Fächer.
- Rollen ändern, Personen hinzufügen (Nachzügler mit persönlichem Code), persönliche Codes und
  Entfernen nur für Admins (`src/api/members.js`). Eine Klasse hat immer mindestens einen Admin –
  der letzte Admin kann weder herabgestuft werden noch austreten.
- Persönlicher Code: 7 Tage, einmal nutzbar; ein neuer Code macht ältere derselben Person ungültig.
  Admins erzeugen ihn für andere, jede Person auch für sich selbst (`POST /api/me/code`, „Weiteres
  Gerät anmelden“ in den Einstellungen). **Selbst erzeugt:** bisherige Geräte bleiben angemeldet. **Vom Admin für eine
  andere Person erzeugt** (`join_codes.created_by != member_id`) = Gerätewechsel: Beim Einlösen werden die bisherigen
  Geräte abgemeldet und ihre Benachrichtigungs-Abos gelöscht (`replaceDevicesStmts()` in `src/lib/purge.js`) – sonst
  könnte ein Admin unbemerkt private Aufgaben und Notizen mitlesen. Die Installations-Anleitung merkt sich ihren Code
  (`abgehakt.installCode.<classId>`), damit nicht jedes Neuladen einen neuen erzeugt – vor dem Anzeigen prüft sie ihn
  (`/api/code/check`); ist er schon eingelöst, kommt ein neuer. Dazu der Knopf „Neuen Code erzeugen“.
- Entfernen / Austreten (`removeMemberStmts()` in `src/lib/purge.js`): `members.removed_at`, Name →
  „Ehemaliges Mitglied“, Häkchen/Notizen/private Aufgaben gelöscht, Geräte und persönliche Codes ungültig.
- Meine Daten (Auskunft/Datenübertragbarkeit, Art. 15/20): „Einstellungen → Für mich → Meine Daten“ →
  `GET /api/me/export` (`src/api/me.js`) liefert alles zur anfragenden Person (Name, Rolle, Häkchen, Notizen, private
  Aufgaben, eigene Klassen-Einträge, eigene Meldungen, Geräte, Benachrichtigungen, Admin-Konto) – nie Daten anderer;
  die App speichert es als JSON-Datei. Neue Daten zu einer Person → hier mit aufnehmen!
- Person entfernen durch den Betreiber (Wunsch der Eltern): `/betrieb` → `POST /api/operator/remove-member`
  { target: Klassen-Kennung, name } → `removeMemberStmts()` + `deleteUnusedAccountStmts()`. Gibt keine Inhalte zurück.
- Status-Sichtbarkeit: `members.status_visibility` (`none` Standard, `all`, `some`) und
  `members.status_viewers` (JSON-Array mit member-IDs). Die API gibt `doneBy` nur mit Namen von
  Personen zurück, die ihren Status für die anfragende Person freigegeben haben.

## Klasse löschen und Not-Werkzeug (Technik)

- Einstellungen: Zahnrad oben im Heft, zwei Reiter „Für mich“ (`openSettings()`: Name, Wahlfächer, Sichtbarkeit,
  weiteres Gerät, Idee/Fehler, Klasse verlassen) und „Klasse“ (`openClassSettings()`: Name der Klasse, Fächer und
  Stundenplan, Kennung, Klasse löschen). Beide führen mit „Zurück“ ins Heft.
- Admins: „Klasseneinstellungen“ umbenennen (`PATCH /api/class`) und endgültig löschen
  (`POST /api/class/delete`, Bestätigung durch Eintippen des Klassennamens).
- Not-Werkzeug des Betreibers: Seite `/betrieb` (nirgends verlinkt, noindex) →
  `POST /api/operator/delete-class` mit Kennung (Klassen-ID) oder Code. Geschützt durch das
  Cloudflare-Secret `OPERATOR_KEY` (mind. 32 Zeichen); ohne Secret antwortet der Endpunkt mit 404.
  Gibt nur Anzahlen zurück, nie Inhalte. Die Kennung steht in der App unter „Einstellungen → Klasse“.
- `/betrieb` hat ein eigenes Symbol (orange mit Schild, `public/betrieb.svg`, `icons/betrieb-*.png`) und ein eigenes
  Manifest (`betrieb.webmanifest`), damit es als eigene App auf den Home-Bildschirm kann.
- Angemeldet bleiben (`public/js/betrieb.js`, nur im Browser, Server unverändert): „Angemeldet bleiben (Face ID)“
  legt einen Passkey nur für diese Seite an; dessen PRF-Geheimnis (nur nach Face ID / Fingerabdruck) verschlüsselt
  den Betreiber-Schlüssel (AES-GCM) in localStorage `abgehakt.betrieb.vault`. Alternativ „Ohne Face ID merken“
  (Klartext, mit Warnung). Angeboten erst, nachdem der Schlüssel einmal funktioniert hat.

## Meldungen (Technik)

- Mitglieder melden Klassen-Aufgaben (`POST /api/tasks/:id/report`, Grund + optionale Begründung).
  Der Server speichert eine Kopie des Eintrags (`reports.snapshot_*`) – fälschungssicher.
  Wer gemeldet hat (`reporter_member_id`), sehen weder Admins noch Betreiber.
- Admins: Hinweis in der Klasse und fester Menüpunkt „Meldungen“ (mit Zähler) in „Mitglieder“
  (`openReports` aus `GET /api/tasks`) → „Eintrag entfernen“ oder
  „Ist in Ordnung“ (`POST /api/reports/:id`). Abgelehnte Meldungen landen beim Betreiber.
- Betreiber in `/betrieb`: offene und von Admins abgelehnte Meldungen, nur der gemeldete Eintrag →
  „Ist in Ordnung“ (`dismiss`) / ausblenden / ausblenden + Admins per E-Mail verwarnen / Klasse löschen.
- Erledigte Meldungen werden nach 6 Monaten gelöscht (täglicher Lauf), sonst mit der Klasse.

## Ideen und Fehler (Technik)

- „Idee oder Fehler?“ (Fußzeile im Heft, Einstellungen) → `POST /api/feedback` (Art + Text, max. 5/Tag).
  Anonym: gespeichert werden nur Text, Art, App-Version und grobe Geräteart – keine Person, keine Klasse
  (`feedback.sender_hash` ist für neue Nachrichten leer). Die Begrenzung steht getrennt in `feedback_limits`
  (SHA-256 der member-ID + Uhrzeit, Migration 0017), der tägliche Lauf löscht sie nach 24 Stunden.
- Betreiber liest in `/betrieb` → „Feedback laden“, hakt ab („Erledigt“). Täglicher Lauf löscht
  Erledigtes nach 6 Monaten, alles nach spätestens 12 Monaten.

## Alters-Bestätigung

- Beitreten und Klasse anlegen verlangen `ageConfirmed: true` („mindestens 16 oder Eltern
  einverstanden“); gespeichert als `members.age_confirmed_at`.

## Täglicher Lauf (Technik)

- Cron Trigger in `wrangler.jsonc` (02:23 UTC) → `scheduled()` in `src/worker.js` → `src/jobs/cleanup.js`.
  Der zweite Zeitplan (`*/5 * * * *`) verschickt Benachrichtigungen (`src/jobs/notify.js`).
- Klassen seit 11 Monaten inaktiv (`classes.last_active_at`) → Warn-E-Mail an alle Admins mit Konto,
  `classes.deletion_warned_at` setzen. Gelöscht wird erst bei 12 Monaten Inaktivität **und** frühestens
  30 Tage nach der Warnung. Aktivität nach der Warnung (`last_active_at > deletion_warned_at`) hebt sie auf.
- Aufräumen: erledigte Meldungen und Feedback nach 6 Monaten (Feedback spätestens nach 12), Anmeldecodes nach 1 Tag,
  `feedback_limits` und `login_limits` nach 1 Tag, alte Feedback-Prüfsummen (vor 0.36.4) werden geleert, Admin-Anmeldungen nach 90 Tagen ohne Nutzung, Admin-Konten ohne Klasse
  nach 12 Monaten ohne Anmeldung.
- Höchstens 40 Warnungen/Löschungen pro Lauf (Resend kostenlos: 100 E-Mails/Tag).
- Lokal testen: `npm run dev`, dann
  `curl -X POST "localhost:8787/cdn-cgi/local/explorer/api/local/scheduled?worker=abgehakt" -H 'Content-Type: application/json' -d '{"cron":"23 2 * * *"}'`

## Datensicherung (Technik)

- A: D1 Time Travel (Cloudflare, 7 Tage, automatisch).
- C: tägliche verschlüsselte Kopie (03:47 UTC, GPG AES-256, 90 Tage als Artefakt) im **privaten** Repo
  `Kreativbauer/abgehakt-sicherung` – mit Wiederherstellen per Knopfdruck (nur in eine neue Datenbank, das macht Nils),
  Anleitung und eigener CLAUDE.md. Bewusst nicht hier, damit dieses Repo öffentlich sein kann.
- Neue Tabellen mit Fremdschlüsseln → dort `scripts/sicherung-pruefen.py` prüfen (Import-Reihenfolge); neue
  wrangler-Version → dort mitziehen.

## Aufgaben (Technik)

- `tasks.owner_member_id` leer = Klassen-Aufgabe, gesetzt = private Aufgabe. Private Aufgaben,
  Status und Notizen (`task_states`) liefert die API nur an die Person selbst – auch nie an Admins.
- Rechte werden **nur auf dem Server** geprüft (`rights()` in `src/api/tasks.js`); die API liefert
  `canEdit`/`canDelete` mit, die App blendet danach nur Knöpfe ein oder aus.
- Löschen setzt `deleted_at` (Aufgabe verschwindet für alle, Daten bleiben erhalten). Admins holen gelöschte
  Klassen-Aufgaben der letzten 30 Tage zurück: „Einstellungen → Klasse → Zuletzt gelöscht“ (`view-deleted`,
  `GET /api/tasks/deleted`, `POST /api/tasks/:id/restore`). Vom Betreiber nach einer Meldung Ausgeblendetes
  (`reports.status` `op_hidden`/`op_warned`) bleibt weg.
- Doppelte Einträge: Beim Eintragen prüft `findDuplicates()` (nur in der App) gleiche Art + gleiches Fach + gleichen
  Tag unter den sichtbaren Einträgen. Treffer → Hinweis „Gibt es schon?“, zweites Tippen auf „Trotzdem speichern“ speichert.
- Wiederkehrende Einträge: Formular „Wiederholen“ (jede Woche / alle 2 Wochen / jede Stunde laut Stundenplan) + „Bis“ →
  `POST /api/tasks` mit `repeat: { every: 1|2|"lessons", until }` legt einzelne Einträge an (max. 40, `repeatDates()`;
  „lessons“ = jeder Tag mit Unterricht im gewählten Fach, A/B-Woche beachtet, braucht den Stundenplan), verbunden über `tasks.series_id`
  (Migration 0016); Antwort `tasks: [...]`. Nur online, nur beim Eintragen. Jeder Eintrag einzeln bearbeitbar;
  „Ab hier alle löschen“ → `DELETE /api/tasks/:id?following=1`. „Neu“-Benachrichtigung nur einmal pro Reihe.
  Im Heft steht von jeder Reihe nur der nächste Eintrag (`onlyNextOfSeries()`, bei Hausaufgaben der nächste nicht
  abgehakte), mit „↻ wiederkehrend“. Ferien werden nicht beachtet (einzeln löschen). Zählt voll zur Mengenbremse.
- Mengenbremse: höchstens 60 neue Einträge pro Person und Stunde (`MAX_NEW_TASKS_PER_HOUR`, 429). Die
  Offline-Warteschlange behandelt 429 wie „offline“ und sendet später erneut – es geht nichts verloren.
- Abgabedatum ist ein Kalendertag `YYYY-MM-DD` (kein Zeitstempel, keine Zeitzonen-Probleme).
- Tagesansicht: Standard ist heute (am Wochenende der Montag), ‹ › blättert über Schultage.
  Gezeigt wird alles, was **ab** dem Tag noch fällig ist, gruppiert nach Abgabetag (Erledigtes unten);
  für vergangene Tage nur Aufgaben, die damals schon eingetragen waren. Nach dem Abgabetag verschwindet eine Aufgabe
  aus dem Heft, auch wenn sie nicht abgehakt ist (bewusst kein Abschnitt „Noch offen“ – Wunsch von Nils). Wer eine Aufgabe
  mit vergangenem Abgabetag speichert, bekommt einen Hinweis (`noticeIfPast()`). Neue Aufgaben: Abgabe vorbelegt mit dem
  nächsten Schultag.
- Fälligkeit an jeder Aufgabe (`dueInfo()`): auf dem Start-Tag (`isHomeDay()`: heute bzw. am Wochenende
  Montag) relativ („bis morgen“, „in 9 Tagen“); auf anderen Tagen nur Datum („bis Mi., 11.11.“),
  damit „morgen“ immer wirklich morgen heißt. Farbe immer nach echter Dringlichkeit.
- Einfügen ins Feld „Was ist zu tun?“ (`onTitlePaste()`): mehrzeiliger oder zu langer Text (z. B. Teams-Nachricht)
  wird aufgeteilt – erste sinnvolle Zeile = Aufgabe, Rest = Details. Eine erste Zeile ohne Leerzeichen mit „_“
  (Kurs-/Teamname wie `2627_WPF_Sp12_2_Dö`) wird übersprungen.
- Termine: `tasks.kind` = `homework` (Standard) oder `exam` (Schulaufgabe), `short_exam` (Kurzarbeit),
  `test` (Test / Abfrage), `presentation` (Referat / Abgabe), `other` (Sonstiger Termin: Text „Was ist es?“ Pflicht,
  z. B. Klassenfoto; angezeigt wird nur der Text). `other` steht in der Datenbank als `kind = 'test'` + `other_event = 1`
  (CHECK-Liste aus 0011 lässt sich nur per Tabellen-Neubau ändern) – immer über `kindOf()`/`dbKind()` in `src/api/tasks.js`
  lesen/schreiben, in SQL `CASE WHEN other_event = 1 THEN 'other' ELSE kind END`. Termine stehen im Heft gesammelt oben („Termine“,
  `isEvent()`), mit „am …“ statt „bis …“ (`eventInfo()`) und
  bekommen keinen Stundenplan-Vorschlag. Prüfungs-Termine haben keinen Text („Was ist zu tun?“ entfällt, `title` leer),
  nur optionale Details („Themen / Details“); angezeigt wird die Art (`taskLabel()`). Filter im Heft
  „Alles · Hausaufgaben · Termine“ (pro Gerät, `abgehakt.kindFilter`), nur sichtbar, wenn es Termine gibt.
  Termine kann man nicht abhaken (Kalender-Symbol statt Haken).
  Unter „Alles“ nur Termine der nächsten 7 Tage (`EVENTS_AHEAD_DAYS`), spätere als Knopf „+ n weitere Termine
  später“ (wechselt zum Filter „Termine“, dort stehen alle).
- Links: `findLinks()` sucht http(s)-Adressen in Text und Details (max. 5). Klickbar nur im aufgeklappten
  Eintrag (nicht im Knopf), mit Website-Namen, `target="_blank"` und `rel="noopener noreferrer nofollow ugc"`.
  Im zugeklappten Eintrag nur der Hinweis „Link“. Andere Protokolle (`javascript:` usw.) werden nie verlinkt.
  Im angezeigten Text sind die Adressen ausgeblendet (`withoutLinks()`); gespeichert bleibt der Text unverändert.

## Fächer und Wahlfächer (Technik)

- Fächerliste pro Klasse (`subjects`, `src/api/subjects.js`): anlegen, umbenennen, „Wahlfach“ an/aus und
  entfernen (`archived_at`, nur ausblenden) dürfen Admins und Eintragende – auch direkt beim Eintragen
  („+ Neues Fach …“, nur online). `tasks.subject_id` verweist aufs Fach, `tasks.subject` bleibt als Name erhalten
  (alte Aufgaben ohne `subject_id` werden über den Namen zugeordnet). Migration 0009 legt die Liste aus
  bisherigen Fachnamen an.
- Jede Person wählt ihre Wahlfächer (`members.elective_ids`, `PUT /api/me/subjects`) – direkt nach dem
  Beitreten, sonst per Hinweis im Heft oder „Einstellungen → Für mich → Meine Wahlfächer“. Solange nicht gewählt
  (`electives_chosen_at` leer), sieht man alles.
- Gefiltert wird nur in der App (`isTaskVisible()`): Aufgaben aus nicht gewählten Wahlfächern ausblenden.
  Admins und Eintragende haben den Schalter „Alle Fächer zeigen“ (pro Gerät, `abgehakt.showAll.<classId>`).
  Entfernte Fächer zählen nicht mehr als Wahlfach → deren Aufgaben sehen wieder alle.
- Stundenplan (nur Wochentage): `subjects.days_a`/`days_b` (JSON, 1 = Mo … 5 = Fr), gepflegt in „Fächer“.
  A/B-Wochen optional: `classes.ab_weeks_ref` = Montag einer A-Woche (`PUT /api/timetable`), leer = jede Woche gleich.
  Beim Eintragen schlägt `suggestDue()` die nächste Stunde des Fachs nach dem angezeigten Tag vor – nur bis
  man das Datum von Hand ändert. Ferien und Feiertage werden nicht beachtet.

## Navigation (Technik)

- Pfeil ‹ oben links auf allen Unterseiten; `backActionFor(view)` in `public/js/app.js` legt fest,
  wohin „Zurück“ führt (eine Ebene höher). Neue Ansichten dort eintragen!
- Beim Verlassen des Hefts genau ein Eintrag im Browser-Verlauf (`history.pushState`), damit die
  Zurück-Taste/-Geste auf Android in der App zurückgeht statt sie zu schließen (`popstate` → `runBack()`).
- Seitenwechsel als Überblendung: `show()` lässt die alte Seite absolut darüber ausblenden (`.view-leave`),
  die neue blendet gleichzeitig ein (`.view-enter`). Tage wechseln über `changeDay()` mit Gleiten in
  Blätterrichtung. Abhaken „ploppt“. Bei „Bewegung reduzieren“ alles aus.
- Einladungslinks: `takeCodeFromUrl()` entfernt `#code=…` sofort aus der Adresse – sonst würde
  „Zurück“ später auf die Link-Adresse springen und den Beitritt erneut starten.

## Offline (Technik)

- `public/sw.js`: App-Hülle (HTML, CSS, JS, Symbole) wird **einmal pro Version beim Installieren**
  vorab gespeichert. Seiten: erst Netz, offline die gespeicherte Hülle. Versionierte Dateien: erst Cache,
  sonst Netz. `/api/*` geht nie über den Cache. **Keine Kopien nebenbei** (`res.clone()` + `cache.put`):
  beim Versionswechsel kann das in Safari die Antwort abbrechen → CSS kommt nur halb an.
- Sicherheitsnetz: `style.css` endet mit `:root { --css-complete: 1; }` (prüft `npm run check`). Fehlt die
  Variable beim Start, lädt die App einmal neu (`healMissingStyles()`, max. ein Versuch pro Sitzung).
- Aufgaben liegen pro Klasse in localStorage (`abgehakt.cache.<classId>`) und erscheinen sofort.
- Offline-Änderungen landen in `abgehakt.queue.<classId>` (neue Aufgaben mit `local-…`-ID, Status,
  Notizen) und werden beim Öffnen, bei „online“ und beim Zurückkehren in die App nachgeschickt.
  Bearbeiten/Löschen bestehender Aufgaben geht nur online.
- Aktualisieren: Symbol oben rechts und „nach unten ziehen“ im Heft (`refreshApp()`): sendet die
  Warteschlange, lädt die aktuelle Ansicht neu; meldet `/api/health` eine andere Version als die
  angezeigte („Version x.y.z“ in der Fußzeile), wartet `installUpdate()`, bis der neue Service Worker
  aktiv ist (max. 6 s), und lädt dann neu (Update ohne App-Neustart).
- Installieren: Direkt nach dem Beitreten Schritt-für-Schritt-Anleitung (`view-install`), danach
  Hinweis in der Klasse („Später“ = 14 Tage Ruhe), jederzeit auch über „Einstellungen → Für mich → Als App installieren“
  (`renderInstallCard()`, zurück in die Einstellungen über `installReturn`). Anleitung je nach Plattform (`installPlatform()`:
  iPhone-Safari/-Chrome/-Firefox, iPad, In-App-Browser, Android, Computer mit `beforeinstallprompt`).
- **Samsung Internet** (`installsViaChrome()`): nie direkt installieren – Samsung baut ein Android-Paket mit alter
  Zielversion, Google Play Protect blockiert es als „unsichere App“. Stattdessen persönlicher Code + Knopf
  „Link kopieren und Chrome öffnen“: kopiert den Anmelde-Link `/app/#code=…` und öffnet Chrome
  (`intent://…;package=com.android.chrome`). Chrome lädt die Seite dabei nicht von selbst – man fügt den Link
  in die Adressleiste ein und ist direkt angemeldet.
- Langer Klassenname: `fitClassHead()` setzt `.is-stacked` – „Mitglieder“ und Zahnrad stehen dann unter dem Namen.
- **iPhone:** Die Home-Bildschirm-App hat einen eigenen Speicher, getrennt von Safari. Deshalb erzeugt
  die Anleitung einen persönlichen Code (`POST /api/me/code`), den man in der installierten App eingibt.
  Die installierte App ohne Klasse zeigt dazu einen Hinweis (`standalone-hint`).

## Benachrichtigungen (Technik)

- Web Push ohne Bibliothek (`src/lib/webpush.js`: RFC 8291 aes128gcm + VAPID). Schlüssel als Cloudflare-Secrets
  `VAPID_PUBLIC_KEY` (base64url) und `VAPID_PRIVATE_KEY` (base64url, nur „d“; JWK-JSON geht auch) – sind eingetragen (das Erzeugungs-Werkzeug auf `/betrieb` ist wieder entfernt); nie neu erzeugen, sonst müssen alle neu einschalten.
  `VAPID_SUBJECT` in `wrangler.jsonc`. Gesendet wird nur an bekannte Push-Dienste (`isAllowedEndpoint()`, Schutz vor SSRF).
- Pro Person, Klasse und Gerät ein Abo (`push_subscriptions`, max. 5 Geräte pro Person) mit Uhrzeit und Schaltern:
  Erinnerung am Vorabend, Termine (morgen und in 3 Tagen), neue Einträge (standardmäßig aus), für Admins „Meldungen“
  (`notify_reports`, standardmäßig an; `enqueueReportForAdmins()` beim Melden – ohne Inhalt, ohne meldende Person). Einstellungen → Für mich → Benachrichtigungen;
  einmaliger Hinweis im Heft (`abgehakt.pushHintDone`). iPhone/iPad nur als installierte App.
- Versand im Cron alle 5 Minuten (`src/jobs/notify.js`), höchstens 25 pro Lauf (kostenloser Tarif: 50 ausgehende Anfragen
  und 50 D1-Abfragen pro Aufruf, wenig CPU – Warteschlangen per `batch` löschen, Erinnerungen gesammelt als erledigt
  markieren, höchstens 25 Personen prüfen; VAPID-Header pro Push-Dienst ~11 Stunden wiederverwenden): zuerst die Warteschlange `push_outbox` („Neu: …“, beim Eintragen über `enqueueNewTask()` gefüllt, Wahlfächer
  beachtet, verfällt nach 1 Tag), dann die Erinnerungen (deutsche Zeit, höchstens 3 Stunden nach der gewählten Uhrzeit,
  einmal pro Tag über `last_reminder_date`). 404/410 vom Push-Dienst → Abo löschen.
- Service Worker zeigt an (`push`) und öffnet beim Antippen das Heft (`notificationclick`).
- **Betreiber** (`src/api/operator-push.js`, Karte „Benachrichtigungen“ auf `/betrieb`): eigener Service Worker
  `public/betrieb-sw.js` (Scope `/betrieb`, kein Cache), Abos in `operator_push_subscriptions` (max. 5 Geräte), Warteschlange
  `operator_push_outbox` (wird im 5-Minuten-Lauf zuerst verschickt). Anlässe über `enqueueOperator()`: neue Idee/neuer
  Fehler (Anfang des Textes), Meldung von Admins als „in Ordnung“ markiert, neue Klasse (standardmäßig aus). Keine
  Heft-Inhalte, keine Klassennamen. Endpunkte unter `/api/operator/push*`, geschützt mit `OPERATOR_KEY`.
- Offline-Änderungen: zusätzlich alle 30 Sekunden erneut senden, solange die App sichtbar ist und etwas wartet.

## Was ist neu (Technik)

- `public/js/changelog.js` (`CHANGELOG`, neueste zuerst, nur MINOR-Versionen). Nach einem Update erscheint oben im
  Heft einmalig „Neu in Abgehakt“ mit allen Einträgen seit der zuletzt gesehenen Version (`abgehakt.seenVersion`),
  „Verstanden“ blendet aus. Wer zum ersten Mal öffnet, bekommt keinen Hinweis. Ganze Liste: „Einstellungen →
  Was ist neu“ (`view-changelog`).

## Sichtbarkeit in Suchmaschinen

Vorerst ist **alles `noindex`**, auch die Startseite – Nils entscheidet noch, ob Abgehakt veröffentlicht wird.
Erreichbar ist alles weiterhin über den Link. Zum Veröffentlichen an drei Stellen zurückstellen:
`<meta name="robots">` in `public/index.html` entfernen, die `X-Robots-Tag`-Zeilen bei `/`, `/index.html`
und `/img/*` in `public/_headers` entfernen, die `Sitemap:`-Zeile in `public/robots.txt` wieder aktivieren.

## Adresse und Domain

Die öffentliche Adresse steht an diesen Stellen – bei eigener Domain alle zusammen ändern:
`public/index.html` (canonical, og:url, og:image), `public/sitemap.xml`, `public/robots.txt` (Sitemap),
`wrangler.jsonc` (`APP_URL`, `EMAIL_FROM` auf die bei Resend verifizierte Domain).

## Befehle

- `npm run dev` – lokal starten (http://localhost:8787)
- `npm run db:migrate:local` – Migrationen auf die lokale Testdatenbank anwenden
- `npm run check` – Regelprüfung (Version, CSP, Migrationen)
- `npm run class:create -- "Name"` – Testklasse mit Einladungscode in der lokalen Datenbank anlegen
  (mit `--remote` in der echten Datenbank – nur Nils führt das aus, nie Claude)
- Veröffentlichen passiert automatisch bei jedem Push auf `main` – nicht von Hand deployen.
- **Testversion:** Jeder Pull Request wird automatisch auf `https://abgehakt-test.nilskaplan8.workers.dev/app/` veröffentlicht
  (Job `deploy-test` in `deploy.yml`, `wrangler.jsonc` → `env.test`: Worker `abgehakt-test`, eigene D1 `abgehakt-test-db`,
  Migrationen laufen dort zuerst). Nils testet dort, dann merged er. In der Test-App steht oben „Testversion“ (`#test-banner`).
  Eigene VAPID-Schlüssel der Testversion erzeugt der Job beim ersten Mal selbst (`wrangler secret bulk --env test`, niemand
  sieht sie); `RESEND_API_KEY` braucht die Testversion nicht: Mit `TEST_SHOW_CODES=1` (nur in `env.test`, plus Prüfung des Hostnamens
  `abgehakt-test.`) gibt `startLogin` den Anmeldecode direkt an die App zurück (`testCode`), keine E-Mail. Eigenen
  `OPERATOR_KEY` setzt Nils bei Bedarf beim Worker `abgehakt-test`. Lokal: `npx wrangler deploy --env test --dry-run`.
  **Passwort-Schutz** (`src/lib/testgate.js`): In `env.test` läuft der Worker für jede Anfrage zuerst (`run_worker_first: true`),
  `TEST_GATE=1` + Hostname `abgehakt-test.` aktivieren ihn. Ohne Cookie zeigt jede Seite ein Passwort-Formular
  (`POST /__test-login`, `LOGIN_LIMITER`), die API antwortet 403 `test_locked` (nicht 401 – sonst nähme die App die Klasse vom Gerät); frei sind nur Manifest, Symbole und CSS. Passwort =
  GitHub-Secret `TEST_PASSWORD`, `deploy-test` überträgt es als Worker-Secret (fehlt es → gesperrt). Cookie = HMAC des Passworts,
  1 Jahr; neues Passwort meldet alle ab. Lokal testen: `npx wrangler dev --env test --var TEST_PASSWORD:…` und Header
  `Host: abgehakt-test.nilskaplan8.workers.dev`.

## Arbeitsweise

- **Offene Punkte stehen im privaten Repo: Issue `Kreativbauer/abgehakt-sicherung#1`** („Was noch fehlt bis Version 1.0“, privat, damit es nicht öffentlich wird). Wenn etwas erledigt ist oder
  neu dazukommt, die Checkliste dort aktualisieren – und zwar so:
  1. **Immer zuerst die aktuelle Fassung lesen** (`issue_read`), nie aus einer älteren Kopie neu schreiben –
     Nils hakt zwischendurch selbst ab.
  2. Von Nils abgehakte Punkte gelten als erledigt und **fliegen raus** (kein Abschnitt „Erledigt“, keine stehen
     gelassenen Haken, keine Punkte „PR mergen“).
  3. Sonst nur gezielt ändern: Neues ergänzen, selbst Erledigtes entfernen, „Stand“-Zeile anpassen.

- Vor jedem Commit `npm run check` ausführen.
- Änderungen über einen Branch und Pull Request nach `main`; `main` wird automatisch veröffentlicht.
