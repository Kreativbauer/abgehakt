# Konzept: Abgehakt – das Klassen-Hausaufgabenheft

Nov 9, 2026 · @Nils

Ein kostenloses, öffentliches Hausaufgabenheft im Browser: Admins einer Klasse tragen Hausaufgaben ein, alle Mitglieder lesen mit und haken für sich ab. Es ist ein privates, nicht-kommerzielles Projekt ohne Einnahmen.

## Ziel und Grundsätze

Jede Klasse bekommt ihr eigenes Heft, das sich die Klasse selbst organisiert – ohne Kosten, ohne App-Store, ohne Werbung.

- **Kostenlos und offen:** Jeder kann eine Klasse anlegen. Keine Einnahmen – der Spenden-Link (Ko-fi, ID `I6G02AD2DQ`) ist vorerst entfernt, bis geklärt ist, ob Spenden ein Gewerbe oder Steuern auslösen (Finanzamt/Gewerbeamt fragen).
- **Web-App statt Store-App:** Läuft im Browser und lässt sich auf den Home-Bildschirm legen. Keine Gebühren für App Store oder Google Play, Updates sind sofort bei allen.
- **So wenig Daten wie möglich:** Nur Admins geben eine E-Mail an. Mitglieder treten mit Code und Namen bei.
- **Die Klasse regelt sich selbst:** Admins kümmern sich um Mitglieder und Inhalte, nicht der Betreiber.
- **Basis ist das bestehende Hausaufgabenheft:** dunkles Design, Tagesansicht, Status pro Person, offline nutzbar.

Ausgangspunkt ist die bisherige Klassen-Version: Ihre Grundidee (Rollen, Rechte, Status pro Person, private Notizen) bleibt. Neu umgesetzt wird alles, was dort gestört hat – vor allem die E-Mail-Anmeldung für alle. Mitglieder treten künftig nur mit Code und Namen bei; dazu kommen das dunkle Design und die Verbesserungen des bestehenden Hefts.

## Rollen und Rechte

Drei Rollen pro Klasse. Wer eintragen darf, legt der Admin fest; lesen und abhaken können alle.

| Recht | Admin | Eintragende | Mitglied |
| --- | --- | --- | --- |
| Hausaufgaben lesen | ja | ja | ja |
| Eigenen Status setzen | ja | ja | ja |
| Private Notiz pro Aufgabe | ja | ja | ja |
| Private Aufgaben nur für sich eintragen, bearbeiten, löschen | ja | ja | ja |
| Festlegen, wer den eigenen Status sieht | ja | ja | ja |
| Hausaufgaben für die Klasse eintragen | ja | ja | nein |
| Hausaufgaben bearbeiten | ja, alle | ja, alle | nein |
| Hausaufgaben löschen | ja, alle | nur eigene | nein |
| Mitglieder einladen und entfernen | ja | nein | nein |
| Rechte vergeben, weitere Admins ernennen | ja | nein | nein |
| Klasse umbenennen oder löschen | ja | nein | nein |
| Braucht eine E-Mail-Adresse | ja | nein | nein |

Eine Klasse kann mehrere Admins haben, damit sie nicht an einer Person hängt. Eintragende dürfen alles bearbeiten, damit jeder Fehler sofort korrigieren kann; jede Aufgabe zeigt „zuletzt geändert von“. Löschen – der einzige Schritt, der etwas unwiderruflich entfernt – dürfen Eintragende nur bei eigenen Einträgen. Wer den eigenen Status sieht, legt jede Person selbst fest: niemand (Standard), alle oder bestimmte Personen.

**Private Aufgaben:** Jede Person kann Einträge nur für sich anlegen, zum Beispiel „Vokabeln für den Test lernen“ – auch ohne Eintragsrecht. Sie stehen in derselben Tagesansicht mit Schloss-Symbol und dem Hinweis „Nur für dich“, haben Status und Abgabedatum wie alle anderen und sind für niemanden sonst sichtbar, auch nicht für Admins. Beim Eintragen gibt es dafür einen Schalter „Nur für mich“; wer kein Eintragsrecht hat, legt automatisch private Aufgaben an.

## Beitritt und Anmeldung

Admins melden sich per E-Mail-Code an (kein Passwort). Mitglieder brauchen kein Konto: ein Code und ein Name reichen, danach bleibt das Gerät angemeldet.

**Admin**

1. E-Mail-Adresse eingeben, Code aus der E-Mail eintippen.
2. Klasse anlegen (Name, z. B. „8b Gymnasium X“).
3. Einladungscode erzeugen und in der Klassengruppe teilen.

**Mitglied**

1. Seite öffnen, Code eingeben.
2. Namen eingeben – fertig. Das Gerät bleibt angemeldet.

**Zwei Arten von Codes**

| Code | Gilt für | Läuft ab | Wofür |
| --- | --- | --- | --- |
| Einladungscode | beliebig viele Personen | nach 7 Tagen (Standard), optional zusätzlich nach Anzahl (z. B. 30 Beitritte) | Start: alle treten auf einmal bei |
| Persönlicher Code | genau eine Person, Name vom Admin festgelegt | nach einmaliger Nutzung | Nachzügler, Gerätewechsel |

Gerätewechsel oder gelöschter Browser-Speicher: Der Admin erzeugt einen persönlichen Code für die bestehende Person. Wer ihn einlöst, ist wieder dieselbe Person – mit eigenem Status und eigenen Notizen.

Wird jemand entfernt, verliert sein Gerät sofort den Zugang. Der Admin kann laufende Einladungscodes jederzeit ungültig machen.

## Betreiber

Der Betreiber schaut nicht in die Hefte. Für Inhalte und Mitglieder sind die Admins der jeweiligen Klasse zuständig.

- **Kein Lese-Zugang:** Es gibt keine Seite, auf der der Betreiber Hefte ansehen kann. Technisch liegen die Daten auf seinem Server; vollständige Unlesbarkeit gäbe es nur mit Ende-zu-Ende-Verschlüsselung, die bei Schlüsselverlust das ganze Heft unwiderruflich löscht – für ein Hausaufgabenheft unverhältnismäßig.
- **Nur ein Not-Werkzeug:** eine Klasse anhand ihrer Kennung komplett löschen, ohne sie vorher anzusehen – für den Fall, dass rechtswidrige Inhalte gemeldet werden.
- **Meldeadresse:** eine Kontakt-E-Mail im Impressum für solche Meldungen.
- **Ehrlich formuliert:** In der Datenschutzerklärung steht „Wir sehen uns die Inhalte nicht an“, nicht „wir können sie nicht sehen“.

## Datenschutz und Recht

Auch kostenlos gilt die DSGVO – und die Nutzer sind großteils Minderjährige. Die folgenden Punkte sind eine Prüfliste, keine Rechtsberatung; vor dem öffentlichen Start prüfen lassen.

- [x] **Datenschutzerklärung:** steht unter `/datenschutz`, vollständig ausgefüllt (Verantwortlicher, alle Dienstleister mit Vertrag und Übermittlungsgrundlage, Beschwerderecht allgemein). Offen: fachkundige Prüfung.
- [x] **Impressum:** steht unter `/impressum`, vollständig ausgefüllt (mit Meldeweg). Auch ohne Spenden nötig (§ 18 MStV: Name und Anschrift). Impressum und Datenschutz tragen „noindex“, damit die Anschrift nicht über Google auffindbar ist.
- [ ] **Unter 16 Jahren:** Beim Beitreten und Anlegen bestätigt jede Person „mindestens 16 oder Eltern einverstanden“ (gespeichert). Standardtext in der Datenschutzerklärung eingetragen (Rechtsgrundlage Nutzung des Dienstes, Art. 8 nicht unmittelbar, Kontakt für Eltern). Offen: Prüfung durch eine fachkundige Stelle.
- [x] **Auftragsverarbeitung und Übermittlung in die USA** (Data Privacy Framework für Cloudflare und GitHub am 10.11.2026 als aktiv geprüft):
  - [x] Cloudflare: Auftragsverarbeitungsvertrag ist Teil der Nutzungsbedingungen; Standardvertragsklauseln und Data Privacy Framework – eingetragen.
  - [x] Resend: Auftragsverarbeitungsvertrag unterschrieben (Plus Five Five, Inc.; EU-Standardvertragsklauseln, Modul 2) – eingetragen. Unterschriebenes PDF liegt bei Nils, nicht im Repository.
  - [x] GitHub (verschlüsselte Datensicherung): unter dem Data Privacy Framework zertifiziert – eingetragen.
- [x] **Datensparsamkeit umsetzen:** keine E-Mail für Mitglieder, Spitznamen erlaubt, kein Tracking, keine Analyse-Tools, keine fremden Skripte; Feedback anonym.
- [x] **Speicherdauer:** Klassen ohne Aktivität werden nach 12 Monaten gelöscht, Admins mindestens 30 Tage vorher per E-Mail gewarnt; Meldungen, Feedback, Anmeldecodes und verwaiste Admin-Konten werden ebenfalls automatisch gelöscht.
- [x] **Recht auf Löschung:** Mitglieder können austreten (Häkchen, Notizen, private Aufgaben werden gelöscht, Name anonymisiert), Admins ihre Klasse löschen.

Kostenlose Grundprüfung ohne Anwalt (ersetzt keine Rechtsberatung): Datenschutzbeauftragte(r) der Schule fragen; mit kostenlosen Generatoren vergleichen (datenschutz-generator.de, eRecht24); Leitfäden der Landesdatenschutzbehörde.

## Technik

Entschieden und umgesetzt: komplett kostenlos bei Cloudflare, getrennt vom bestehenden Hetzner-Webspace; entwickelt in einem Git-Repository mit Claude Code, veröffentlicht automatisch.

| Bereich | Entscheidung | Warum |
| --- | --- | --- |
| App | Web-App (PWA): HTML, CSS, JavaScript ohne Framework | keine Store-Kosten, läuft auf iPhone und Android, offline nutzbar |
| Hosting | Cloudflare Workers (App-Dateien und Server-Logik) | kostenlos, schläft nie ein, eigene Server-Logik für Codes und Rechte |
| Daten | Cloudflare D1 (SQL-Datenbank) | kostenlos, großzügige Limits, echte Datenbank statt JSON-Datei |
| Anmeldung | Geräte-Schlüssel für Mitglieder, E-Mail-Code für Admins über Resend | kein Passwort, keine Mitglieder-E-Mails |
| Adresse | zum Start die kostenlose Cloudflare-Adresse (`abgehakt.nilskaplan8.workers.dev`), eigene Domain später. **Ohne eigene Domain kann Resend nur an das eigene Konto schicken – andere Admins bekommen dann keine Anmeldecodes und Löschwarnungen** (ca. 10 € im Jahr; DNS läuft schon über Cloudflare, Anschluss in wenigen Minuten). Keine Subdomain von skyhome42.de, weil die Domain in der Schule teilweise geblockt wird | eigene Domain wirkt seriöser und wird seltener von Schulfiltern geblockt |
| Auffindbarkeit | öffentliche Startseite mit Erklärung, `sitemap.xml`; später in der Google Search Console anmelden (am besten erst mit eigener Domain); App, Impressum, Datenschutz und `/betrieb` mit „noindex“ | Google findet das Produkt, aber nie die Hefte und nicht die Anschrift |
| Code | privates GitHub-Repository, Arbeit mit Claude Code, Regeln in `CLAUDE.md` | eine Quelle, jede Änderung nachvollziehbar und rückgängig zu machen |
| Veröffentlichen | automatisch bei jeder freigegebenen Änderung (GitHub → Cloudflare) | keine vergessenen oder vertauschten Dateien |
| Sicherheit | strenge Sicherheits-Header (CSP ohne Inline-Code), HTTPS, tägliche verschlüsselte Datensicherung bei GitHub (90 Tage) plus D1 Time Travel (7 Tage) | wie beim bestehenden Heft |
| Design | das aktuelle dunkle Design (Linear als Basis, Fachfarben nach Notion) | bereits erprobt |

In der `CLAUDE.md` stehen feste Regeln, zum Beispiel: Versionsnummer bei jeder Änderung an Skript oder Styles erhöhen; nie Daten löschen oder überschreiben.

**Warum Cloudflare** (kostenlose Tarife, Stand November 2026)

| Anbieter | Kostenlos enthalten | Haken |
| --- | --- | --- |
| Cloudflare Workers + D1 | 100.000 Anfragen pro Tag; Datenbank: 5 Mio. gelesene und 100.000 geschriebene Zeilen pro Tag, 5 GB | bei Überschreitung schlagen Abfragen bis Mitternacht (UTC) fehl; Server-Code in JavaScript statt PHP |
| Supabase | Datenbank mit Anmeldung | Projekt wird pausiert, wenn eine Woche lang zu wenig los ist – riskant in den Sommerferien |
| Firebase | Datenbank und Hosting | eigene Server-Logik (für Codes mit Ablauf) nur im Bezahltarif |
| Hetzner-Webspace | PHP und Datenbank | kostet bereits Geld und ist mit deinen anderen Seiten verbunden |

Für Admin-E-Mails reicht Resend kostenlos: 100 E-Mails pro Tag, 3.000 pro Monat.

Quellen: [Cloudflare Workers – Preise](https://developers.cloudflare.com/workers/platform/pricing/), [Cloudflare D1 – Durchsetzung der Gratis-Limits](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/), [Supabase – Pausieren freier Projekte](https://supabase.com/kb/faqs/platform/free-project-pausing), [Resend – Kontingente](https://resend.com/docs/knowledge-base/account-quotas-and-limits)

## Version 1

Version 1 soll eine Klasse komplett tragen; getestet wird zuerst mit der eigenen Klasse, dann mit ein, zwei Parallelklassen.

**Drin**

- [x] Klasse anlegen, Admin-Anmeldung per E-Mail-Code
- [x] Einladungscode mit Ablauf nach Zeit und Anzahl, jederzeit widerrufbar
- [x] Persönlicher Code für Nachzügler und Gerätewechsel
- [x] Rollen Admin, Eintragende, Mitglied; Rechte vergeben, Mitglieder entfernen
- [x] Tagesansicht wie im bestehenden Heft: offene Aufgaben, Abgabetermine, Wochenende überspringen
- [x] Status pro Person, private Notizen, private Aufgaben nur für sich selbst
- [x] Mehrere Klassen pro Gerät (Umschalter oben)
- [x] Offline nutzbar, Änderungen werden nachgeschickt
- [x] Impressum, Datenschutzerklärung (vollständig; fachkundige Prüfung steht aus) – Ko-fi-Link vorerst entfernt
- [x] Not-Werkzeug für den Betreiber: Klasse löschen
- [x] Automatische Datensicherung, automatisches Hochladen

**Zusätzlich umgesetzt**

- Öffentliche Startseite mit Erklärung, Bild der App und häufigen Fragen
- Meldungen: Mitglieder melden Einträge, erst prüfen die Admins, dann bei Bedarf der Betreiber (nur den gemeldeten Eintrag)
- Ideen und Fehler anonym an den Entwickler
- Alters-Bestätigung beim Beitreten
- Weiteres Gerät selbst anmelden, eigenen Namen ändern, Klasse umbenennen
- Automatische Löschung inaktiver Klassen mit Warn-E-Mail
- Installations-Anleitung je nach Gerät, Aktualisieren per Knopf und Herunterziehen, Zurück-Pfeil
- Fächerliste mit Wahlfächern: jede Person sieht nur Hausaufgaben ihrer Fächer
- Stundenplan (Wochentage, optional A/B-Wochen): Abgabetag = nächste Stunde des Fachs, von Hand änderbar
- Termine: Schulaufgaben, Kurzarbeiten, Tests/Abfragen, Referate/Abgaben – gesammelt oben im Heft
- Benachrichtigungen: Erinnerung am Vorabend, Termine, auf Wunsch neue Einträge; für Admins neue Meldungen;
  für den Betreiber auf /betrieb neue Ideen/Fehler, von Admins abgelehnte Meldungen, neue Klassen
- Doppelte Einträge: beim Eintragen Hinweis „Gibt es schon?“ (gleiche Art, gleiches Fach, gleicher Tag)
- Zuletzt gelöscht: Admins holen gelöschte Einträge der letzten 30 Tage zurück

**Später**

- Dateien oder Fotos an Hausaufgaben

## Offene Fragen

Entschieden: Status-Sichtbarkeit stellt jede Person selbst ein, Einladungscodes gelten 7 Tage, inaktive Klassen werden nach 12 Monaten gelöscht, Hosting bei Cloudflare, eigene Domain erst später, Name: Abgehakt. Offen ist noch:

- [x] Marke prüfen: in [TMview](https://www.tmdn.org/tmview/) nach „Abgehakt“ gesucht – keine eingetragene Marke gefunden (Stand November 2026).
- [ ] Datenschutz und Impressum ausfüllen und prüfen lassen (siehe oben).
- [ ] Test mit der eigenen Klasse auf echten Geräten (iPhone und Android).
- [ ] Später Domain (Voraussetzung, damit andere Admins E-Mails bekommen): abgehakt.org bei Cloudflare registrieren (8,50 $ im ersten Jahr, danach 11,20 $ pro Jahr; DNS und Hosting liegen dann im selben Konto).
