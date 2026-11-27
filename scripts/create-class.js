// Legt eine Klasse mit Einladungscode an – Übergangslösung, bis es die Admin-Anmeldung gibt.
//
//   npm run class:create -- "8b Test"            → lokale Testdatenbank
//   npm run class:create -- "8b Test" --remote   → echte Datenbank (nur von Nils auszuführen)
//
// Optionen: --tage 7 (Gültigkeit des Codes), --max 30 (höchstens so viele Beitritte)
// Es wird nur etwas HINZUGEFÜGT, nie gelöscht oder überschrieben.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomInt, randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const name = args.find((a, i) => !a.startsWith("--") && !["--tage", "--max"].includes(args[i - 1]));
if (!name) {
  console.error('Aufruf: npm run class:create -- "Klassenname" [--remote] [--tage 7] [--max 30]');
  process.exit(1);
}
const days = Number(opt("--tage", 7));
const max = opt("--max", null);

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const classId = randomUUID();
const now = Date.now();
const expires = now + days * 24 * 60 * 60 * 1000;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const sql = `
INSERT INTO classes (id, name, created_at, last_active_at) VALUES (${q(classId)}, ${q(name)}, ${now}, ${now});
INSERT INTO join_codes (code, class_id, kind, created_at, expires_at, max_uses)
  VALUES (${q(code)}, ${q(classId)}, 'invite', ${now}, ${expires}, ${max ? Number(max) : "NULL"});
`;

const dir = mkdtempSync(join(tmpdir(), "abgehakt-"));
const file = join(dir, "class.sql");
writeFileSync(file, sql);
try {
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", flag("--remote") ? "--remote" : "--local", "--file", file], {
    stdio: "inherit",
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const pretty = `${code.slice(0, 4)}-${code.slice(4)}`;
console.log(`\nKlasse „${name}“ angelegt.`);
console.log(`Einladungscode: ${pretty} (gültig ${days} Tage${max ? `, höchstens ${max} Beitritte` : ""})`);
console.log(`Link zum Teilen: <Adresse>/app/#code=${code}`);
