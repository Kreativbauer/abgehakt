// Setzt die Anschrift für Impressum und Datenschutzerklärung ein – nur beim Veröffentlichen (deploy.yml), nie committen.
// Im Repository stehen nur Platzhalter, damit die Anschrift nicht im (öffentlichen) Code steht. Die echten Angaben
// kommen aus den GitHub-Secrets ANSCHRIFT_STRASSE und ANSCHRIFT_ORT.
//
//   node scripts/anschrift-einsetzen.js            fehlende Angaben → Hinweistext (Testversion)
//   node scripts/anschrift-einsetzen.js --pflicht  fehlende Angaben → Abbruch (echte Seite: Impressumspflicht)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILES = ["impressum.html", "datenschutz.html"];
const strict = process.argv.includes("--pflicht");
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const values = {};
for (const [key, fallback] of [["ANSCHRIFT_STRASSE", "[Straße]"], ["ANSCHRIFT_ORT", "[PLZ Ort]"]]) {
  const v = (process.env[key] || "").trim();
  if (!v) {
    if (strict) {
      console.error(`::error::Secret ${key} fehlt (Settings → Secrets and variables → Actions). Ohne Anschrift kein Impressum.`);
      process.exit(1);
    }
    console.warn(`Hinweis: ${key} fehlt – „${fallback}“ wird angezeigt.`);
  }
  values[key] = escape(v || fallback);
}

const root = join(import.meta.dirname, "..", "public");
for (const name of FILES) {
  const path = join(root, name);
  let html = readFileSync(path, "utf8");
  for (const [key, value] of Object.entries(values)) html = html.replaceAll(`@@${key}@@`, value);
  if (html.includes("@@ANSCHRIFT_")) {
    console.error(`::error::In public/${name} ist ein Platzhalter übrig geblieben.`);
    process.exit(1);
  }
  writeFileSync(path, html);
}
console.log("Anschrift in Impressum und Datenschutzerklärung eingesetzt.");
