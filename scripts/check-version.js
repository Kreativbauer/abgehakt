// Prüft die festen Regeln aus CLAUDE.md automatisch (läuft lokal und vor jedem Deploy):
//  1. Alle ?v=…-Angaben, angezeigten „Version x.y.z“ und die VERSION in public/sw.js stimmen mit
//     der Version in package.json überein.
//  2. Kein Inline-Code im HTML (<script> mit Inhalt, <style>, style="…", on…="…", javascript:).
//  3. Migrationen löschen oder überschreiben keine Daten (kein DROP, DELETE, TRUNCATE, UPDATE, REPLACE).
//  4. Optional: `node scripts/check-version.js <git-ref>` – wenn sich seit <git-ref> Dateien in
//     public/ oder src/ geändert haben, muss auch die Version erhöht worden sein.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { execSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const errors = [];

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// 1 + 2: HTML prüfen
for (const file of walk(join(root, "public")).filter((f) => extname(f) === ".html")) {
  const html = readFileSync(file, "utf8");
  const rel = file.slice(root.length);

  for (const m of html.matchAll(/\?v=([\w.-]+)/g)) {
    if (m[1] !== version) errors.push(`${rel}: ?v=${m[1]} passt nicht zu Version ${version}`);
  }
  for (const m of html.matchAll(/Version (\d+\.\d+\.\d+)/g)) {
    if (m[1] !== version) errors.push(`${rel}: angezeigte „Version ${m[1]}“ passt nicht zu ${version}`);
  }
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) errors.push(`${rel}: Inline-<script> gefunden`);
  if (/<style[\s>]/i.test(html)) errors.push(`${rel}: <style>-Block gefunden`);
  if (/\sstyle\s*=/i.test(html)) errors.push(`${rel}: style="…"-Attribut gefunden`);
  if (/\son[a-z]+\s*=/i.test(html)) errors.push(`${rel}: Inline-Event-Handler (on…="…") gefunden`);
  if (/javascript:/i.test(html)) errors.push(`${rel}: javascript:-Link gefunden`);
}

// 1b: Service Worker – neue Version = neuer Cache, sonst bekommen Geräte offline alte Dateien.
const swVersion = readFileSync(join(root, "public", "sw.js"), "utf8").match(/const VERSION = "([^"]+)"/);
if (!swVersion || swVersion[1] !== version) {
  errors.push(`public/sw.js: VERSION ${swVersion ? swVersion[1] : "fehlt"} passt nicht zu ${version}`);
}

// 1c: Markierung für „CSS vollständig geladen“ muss die letzte Regel in style.css sein
// (die App lädt sich sonst neu, siehe healMissingStyles() in public/js/app.js).
const css = readFileSync(join(root, "public", "css", "style.css"), "utf8").trimEnd();
if (!css.endsWith(":root { --css-complete: 1; }")) {
  errors.push("public/css/style.css: muss mit „:root { --css-complete: 1; }“ enden – neue Regeln davor einfügen");
}

// 2b: Unsichtbare Sonderzeichen im Code (z. B. Zeilentrenner U+2028) – können Skripte unbemerkt kaputt machen.
const INVISIBLE = /[\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/;
for (const file of [...walk(join(root, "public")), ...walk(join(root, "src"))]) {
  if (![".js", ".css", ".html"].includes(extname(file))) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (INVISIBLE.test(line)) errors.push(`${file.slice(root.length)}:${i + 1}: unsichtbares Sonderzeichen – als \\u-Escape schreiben`);
  });
}

// „Was ist neu“: Jede Version mit neuer Funktion (x.y.0) braucht einen Eintrag in public/js/changelog.js.
{
  const changelog = readFileSync(join(root, "public", "js", "changelog.js"), "utf8");
  const listed = [...changelog.matchAll(/version: "([^"]+)"/g)].map((m) => m[1]);
  if (/^\d+\.\d+\.0$/.test(version) && !listed.includes(version)) {
    errors.push(`public/js/changelog.js: Eintrag für ${version} fehlt (neue Funktion → kurz in Alltagssprache beschreiben)`);
  }
  if (listed[0] && listed[0] !== version && !/^\d+\.\d+\.[1-9]\d*$/.test(version)) {
    errors.push(`public/js/changelog.js: oberster Eintrag ist ${listed[0]}, erwartet ${version}`);
  }
}

// 3: Migrationen prüfen (Kommentare ignorieren)
for (const file of walk(join(root, "migrations")).filter((f) => extname(f) === ".sql")) {
  const sql = readFileSync(file, "utf8").replace(/--.*$/gm, "");
  const rel = file.slice(root.length);
  const bad = sql.match(/\b(DROP|DELETE|TRUNCATE|UPDATE|REPLACE)\b/i);
  if (bad) errors.push(`${rel}: verbotenes SQL „${bad[1]}“ – Migrationen dürfen keine Daten löschen/überschreiben`);
}

// 4: Versionserhöhung seit <git-ref>
const baseRef = process.argv[2];
if (baseRef && !/^0+$/.test(baseRef)) {
  try {
    const changed = execSync(`git diff --name-only ${baseRef} HEAD -- public src`, { cwd: root })
      .toString().trim();
    if (changed) {
      const oldPkg = JSON.parse(execSync(`git show ${baseRef}:package.json`, { cwd: root }).toString());
      if (oldPkg.version === version) {
        errors.push(`Dateien in public/ oder src/ geändert, aber Version ist noch ${version}:\n    ${changed.split("\n").join("\n    ")}`);
      }
    }
  } catch (err) {
    console.warn(`Hinweis: Versionsvergleich mit ${baseRef} übersprungen (${err.message.split("\n")[0]})`);
  }
}

// Anschrift nur als Platzhalter (setzt deploy.yml aus Secrets ein, scripts/anschrift-einsetzen.js) – nie im Code.
for (const name of ["impressum.html", "datenschutz.html"]) {
  const html = readFileSync(join(root, "public", name), "utf8");
  if (!html.includes("@@ANSCHRIFT_STRASSE@@") || !html.includes("@@ANSCHRIFT_ORT@@")) {
    errors.push(`public/${name}: Anschrift bitte nur als Platzhalter @@ANSCHRIFT_STRASSE@@ / @@ANSCHRIFT_ORT@@ (siehe CLAUDE.md).`);
  }
}

// Hinweis (kein Fehler): Platzhalter in Impressum/Datenschutz, die noch ausgefüllt werden müssen.
for (const name of ["impressum.html", "datenschutz.html"]) {
  const n = (readFileSync(join(root, "public", name), "utf8").match(/class="todo"/g) || []).length;
  if (n) console.warn(`Hinweis: public/${name} enthält noch ${n} Platzhalter („[…]“) – vor dem öffentlichen Start ausfüllen.`);
}

if (errors.length) {
  console.error("Regelprüfung fehlgeschlagen:\n  - " + errors.join("\n  - "));
  process.exit(1);
}
console.log(`Regelprüfung ok (Version ${version}).`);
