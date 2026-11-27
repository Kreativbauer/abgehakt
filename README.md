# Abgehakt

Das kostenlose Klassen-Hausaufgabenheft – Web-App auf Cloudflare Workers + D1.
Konzept: [KONZEPT.md](KONZEPT.md) · Regeln für die Entwicklung: [CLAUDE.md](CLAUDE.md)

## Lokal starten

```bash
npm install
echo "DEV_MODE=1" > .dev.vars   # Anmeldecodes erscheinen in der Konsole statt per E-Mail
npm run db:migrate:local
npm run dev
```

Testklasse anlegen (gibt einen Einladungscode aus):

```bash
npm run class:create -- "8b Test"
```

Dann http://localhost:8787 öffnen. `http://localhost:8787/api/health` zeigt Version und Datenbank-Status.

## Einmalige Einrichtung (Cloudflare + GitHub)

1. **D1-Datenbank anlegen:** Cloudflare-Dashboard → *Storage & Databases* → *D1 SQL Database* →
   *Create* → Name `abgehakt-db`. Die angezeigte **Database ID** in `wrangler.jsonc` bei
   `database_id` eintragen.
2. **API-Token erstellen:** Dashboard → *My Profile* → *API Tokens* → *Create Token* →
   Vorlage *Edit Cloudflare Workers* → zusätzlich Berechtigung *Account · D1 · Edit* hinzufügen.
3. **Account-ID kopieren:** Dashboard → *Workers & Pages* → rechts *Account ID*.
4. **GitHub-Secrets anlegen:** Repository → *Settings* → *Secrets and variables* → *Actions* →
   `CLOUDFLARE_API_TOKEN` und `CLOUDFLARE_ACCOUNT_ID`.
5. Optional: **Branch-Schutz** für `main` mit Pflicht-Check „Regeln prüfen“.

Danach veröffentlicht jeder Push auf `main` automatisch unter `https://abgehakt.<subdomain>.workers.dev`.

**Eine Version pro Pull Request:** Mehrere Änderungen landen im selben offenen Pull Request und werden zusammen zu
einer Version – erst das Mergen nach `main` veröffentlicht sie.

**Testversion vor dem Mergen:** Jeder Pull Request landet automatisch auf
`https://abgehakt-test.nilskaplan8.workers.dev/app/` – eigener Worker `abgehakt-test` mit eigener Datenbank
`abgehakt-test-db`, die echten Daten bleiben unberührt. Dort ausprobieren (eigene Testklasse anlegen), dann mergen.
Der Link steht im Pull Request beim Ablauf „Testversion veröffentlichen“ („View deployment“). Die Benachrichtigungs-Schlüssel
(`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) der Testversion erzeugt der Ablauf beim ersten Mal selbst und speichert sie direkt
als Secret – eigene Schlüssel, die echten bleiben unberührt. E-Mail braucht die Testversion nicht:
Beim Anmelden als Admin zeigt sie den Code direkt in der App an (`TEST_SHOW_CODES`, nur in der Test-Umgebung). Für
`/betrieb` in der Testversion bei Bedarf beim Worker `abgehakt-test` einen eigenen `OPERATOR_KEY` (mind. 32 Zeichen) setzen.

## Klasse in der echten Datenbank anlegen

Solange es noch keine Admin-Anmeldung gibt:

```bash
npm run class:create -- "8b Gymnasium X" --remote
```

Dafür einmalig `npx wrangler login` ausführen. Der ausgegebene Link
`https://abgehakt.nilskaplan8.workers.dev/app/#code=…` kann direkt in die Klassengruppe.

## Datensicherung

- **A – D1 Time Travel** (bei Cloudflare, automatisch, 7 Tage).
- **C – Tägliche verschlüsselte Kopie** im privaten Repo `abgehakt-sicherung` (eigenes Repo, damit die Sicherungen
  nicht für alle herunterladbar sind). Dort stehen auch Wiederherstellen per Knopfdruck und die Anleitung.

## Lizenz

Abgehakt ist freie Software unter der [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).
Du darfst den Code lesen, verändern und selbst betreiben – wer eine veränderte Fassung im Internet anbietet,
muss deren Quellcode unter derselben Lizenz offenlegen.
