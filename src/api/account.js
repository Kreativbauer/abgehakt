// Admin-Anmeldung per E-Mail-Code (kein Passwort).
//   POST /api/account/start   { email }          → schickt einen 6-stelligen Code
//   POST /api/account/verify  { email, code }    → meldet an, liefert Konto-Schlüssel + Admin-Klassen
//   POST /api/account/link    { memberToken }    → verknüpft eine Admin-Person auf diesem Gerät mit dem Konto
import { ApiError, clientNet, json, readJson } from "../lib/http.js";
import { newDeviceToken, newId, newLoginCode, sha256Hex } from "../lib/crypto.js";
import { requireAccount } from "../lib/auth.js";
import { newDeviceFor } from "../lib/devices.js";
import { sendLoginCode } from "../lib/email.js";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_WINDOW = 3;           // pro E-Mail-Adresse und Netz …
const CODE_WINDOW_MS = 15 * 60 * 1000;    // … in 15 Minuten
const DAY_MS = 24 * 60 * 60 * 1000;
// Grenzen pro Code und pro E-Mail-Adresse, nie nur pro Netz – Netze lassen sich wechseln:
//   - jeder Code höchstens MAX_ATTEMPTS Prüfungen insgesamt (atomar reserviert, siehe verifyLogin)
//   - höchstens MAX_CODES_PER_EMAIL_DAY Codes pro Adresse und Tag → höchstens 6 × 5 = 30 Rateversuche pro Tag
// Zusätzlich pro Netz (Prüfsumme in login_limits, 24 Stunden).
const MAX_CODES_PER_EMAIL_DAY = 6;        // Codes pro Adresse in 24 Stunden, über alle Netze
const MAX_MAILS_PER_IP_DAY = 15;          // angeforderte Codes pro Netz in 24 Stunden
const MAX_FAILS_PER_IP_EMAIL = 10;        // falsche Codes pro Netz und Adresse in 24 Stunden
const MAX_FAILS_PER_IP = 20;              // falsche Codes pro Netz insgesamt in 24 Stunden
// Anmelde-E-Mails insgesamt pro Tag (Resend kostenlos: 100/Tag, Rest für Löschwarnungen) – getrennte Kontingente für
// Adressen mit und ohne Konto, mit derselben Meldung.
const MAX_MAILS_KNOWN_DAY = 40;           // Adressen mit Admin-Konto
const MAX_MAILS_NEW_DAY = 20;             // neue Adressen (Klasse anlegen)

/** Prüfsumme des Netzes (die IP-Adresse selbst wird nicht gespeichert; IPv6 gekürzt auf /64, siehe clientNet). */
async function ipHashOf(request) {
  return sha256Hex(`login-ip:${clientNet(request)}`);
}

async function countLimits(env, where, binds) {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM login_limits WHERE ${where}`).bind(...binds).first();
  return r.n;
}
const LOCKED = () => new ApiError(429, "Zu viele falsche Codes von diesem Gerät bzw. Netz. Bitte morgen erneut versuchen.", "locked");

export function cleanEmail(input) {
  const email = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new ApiError(400, "Bitte eine gültige E-Mail-Adresse eingeben.", "invalid_email");
  }
  return email;
}

const codeHash = (email, code) => sha256Hex(`login:${email}:${code}`);

export async function startLogin(request, env) {
  const body = await readJson(request);
  const email = cleanEmail(body.email);
  const now = Date.now();

  // Höchstens 3 Codes in 15 Minuten – pro Adresse UND Netz, damit niemand Fremdes das Kontingent eines Admins aufbraucht.
  const ipHash = await ipHashOf(request);
  if (await countLimits(env, "ip_hash = ? AND kind = 'mail' AND email = ? AND created_at > ?", [ipHash, email, now - CODE_WINDOW_MS]) >= MAX_CODES_PER_WINDOW) {
    throw new ApiError(429, "Es wurden gerade schon mehrere Codes verschickt. Bitte in 15 Minuten erneut versuchen.", "rate_limited");
  }
  if (await countLimits(env, "ip_hash = ? AND kind = 'mail' AND created_at > ?", [ipHash, now - DAY_MS]) >= MAX_MAILS_PER_IP_DAY) {
    throw new ApiError(429, "Von diesem Gerät bzw. Netz wurden heute schon viele Codes angefordert. Bitte morgen erneut versuchen.", "rate_limited");
  }
  const known = Boolean(await env.DB.prepare("SELECT 1 FROM accounts WHERE email = ?").bind(email).first());
  const since = now - DAY_MS;

  // Nur einfügen, wenn pro Adresse und im passenden Tageskontingent noch Platz ist – in EINEM Schritt, damit auch
  // gleichzeitige Anfragen die Grenzen nicht überschreiten. Gescheiterte Versände zählen mit (bleiben als benutzt stehen).
  const code = newLoginCode();
  const id = newId();
  const [inserted] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO login_codes (id, email, code_hash, created_at, expires_at)
       SELECT ?1, ?2, ?3, ?4, ?5
        WHERE (SELECT COUNT(*) FROM login_codes WHERE email = ?2 AND created_at > ?6) < ?7
          AND (SELECT COUNT(*) FROM login_codes
                WHERE created_at > ?6 AND ${known ? "" : "NOT "}email IN (SELECT email FROM accounts)) < ?8`
    ).bind(id, email, await codeHash(email, code), now, now + CODE_TTL_MS, since, MAX_CODES_PER_EMAIL_DAY,
      known ? MAX_MAILS_KNOWN_DAY : MAX_MAILS_NEW_DAY),
    env.DB.prepare(
      "INSERT INTO login_limits (ip_hash, kind, email, created_at) SELECT ?, 'mail', ?, ? WHERE changes() = 1"
    ).bind(ipHash, email, now),
  ]);
  if (inserted.meta.changes !== 1) {
    const perEmail = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?").bind(email, since).first();
    throw new ApiError(429, perEmail.n >= MAX_CODES_PER_EMAIL_DAY
      ? "Für diese Adresse wurden heute schon mehrere Codes verschickt. Bitte einen davon benutzen oder morgen erneut versuchen."
      : "Heute wurden schon sehr viele Anmelde-Codes verschickt. Bitte morgen erneut versuchen.", "rate_limited");
  }

  // Nur Testversion (abgehakt-test, Variable TEST_SHOW_CODES in wrangler.jsonc → env.test): keine E-Mail, der Code
  // geht direkt an die App. Doppelt abgesichert über den Hostnamen – auf der echten Adresse passiert das nie.
  if (env.TEST_SHOW_CODES === "1" && new URL(request.url).hostname.startsWith("abgehakt-test.")) {
    return json({ ok: true, testCode: code });
  }
  try {
    await sendLoginCode(env, email, code);
  } catch (err) {
    // Nicht verschickt → Code sofort entwerten (sonst ließe er sich 10 Minuten lang unbemerkt erraten).
    await env.DB.prepare("UPDATE login_codes SET used_at = ? WHERE id = ?").bind(now, id).run();
    throw err;
  }
  return json({ ok: true });
}

export async function verifyLogin(request, env) {
  const body = await readJson(request);
  const email = cleanEmail(body.email);
  const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
  if (code.length !== 6) throw new ApiError(400, "Der Code hat 6 Ziffern.", "invalid_code");
  const now = Date.now();
  // Pro Netz: Ein Netz, das zu oft falsch geraten hat, ist gesperrt – andere Netze (der echte Admin) nicht.
  const ipHash = await ipHashOf(request);
  const since = now - DAY_MS;
  if (await countLimits(env, "ip_hash = ? AND kind = 'fail' AND email = ? AND created_at > ?", [ipHash, email, since]) >= MAX_FAILS_PER_IP_EMAIL
    || await countLimits(env, "ip_hash = ? AND kind = 'fail' AND created_at > ?", [ipHash, since]) >= MAX_FAILS_PER_IP) {
    throw LOCKED();
  }

  // Erst einen Versuch bei ALLEN noch gültigen Codes dieser Adresse reservieren, dann vergleichen – in einem Schritt.
  // So bekommt kein Code mehr als MAX_ATTEMPTS Prüfungen, egal aus wie vielen Netzen und wie gleichzeitig geraten wird.
  // Jeder gültige Code zählt (nicht nur der neueste) – sonst würde der Code des Admins ungültig, sobald Fremde einen
  // weiteren anfordern.
  const { results: rows } = await env.DB.prepare(
    `UPDATE login_codes SET attempts = attempts + 1
      WHERE email = ? AND used_at IS NULL AND expires_at > ? AND attempts < ?
     RETURNING id, code_hash, attempts`
  ).bind(email, now, MAX_ATTEMPTS).all();
  if (!rows.length) {
    // Nichts reserviert: entweder kein gültiger Code oder alle verbraucht. Zählt nicht als Fehlversuch.
    const open = await env.DB.prepare(
      "SELECT 1 FROM login_codes WHERE email = ? AND used_at IS NULL AND expires_at > ? LIMIT 1"
    ).bind(email, now).first();
    throw open
      ? new ApiError(429, "Zu viele falsche Versuche. Bitte einen neuen Code anfordern.", "code_expired")
      : new ApiError(400, "Der Code ist abgelaufen. Bitte einen neuen anfordern.", "code_expired");
  }
  const hash = await codeHash(email, code);
  const row = rows.find((r) => r.code_hash === hash);
  if (!row) {
    await env.DB.prepare("INSERT INTO login_limits (ip_hash, kind, email, created_at) VALUES (?, 'fail', ?, ?)")
      .bind(ipHash, email, now).run();
    const left = MAX_ATTEMPTS - Math.min(...rows.map((r) => r.attempts));
    throw new ApiError(400, left > 0
      ? `Der Code stimmt nicht. Noch ${left} ${left === 1 ? "Versuch" : "Versuche"}.`
      : "Der Code stimmt nicht. Bitte einen neuen anfordern.", "wrong_code");
  }

  // Code verbrauchen (nur einmal nutzbar, auch bei gleichzeitigen Anfragen).
  const used = await env.DB.prepare(
    "UPDATE login_codes SET used_at = ? WHERE id = ? AND used_at IS NULL"
  ).bind(now, row.id).run();
  if (used.meta.changes !== 1) throw new ApiError(400, "Der Code wurde schon benutzt.", "code_expired");

  // Konto anlegen oder Anmeldezeit aktualisieren.
  await env.DB.prepare(
    `INSERT INTO accounts (id, email, created_at, last_login_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET last_login_at = excluded.last_login_at`
  ).bind(newId(), email, now, now).run();
  const account = await env.DB.prepare("SELECT id, email FROM accounts WHERE email = ?").bind(email).first();

  const token = newDeviceToken();
  const stmts = [
    env.DB.prepare(
      "INSERT INTO account_sessions (token_hash, account_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)"
    ).bind(await sha256Hex(token), account.id, now, now),
  ];

  // Für alle Klassen, in denen dieses Konto Admin ist, dieses Gerät anmelden (neueste zuerst –
  // die App öffnet die erste).
  const { results: admins } = await env.DB.prepare(
    `SELECT m.id AS member_id, m.name AS member_name, m.role, c.id AS class_id, c.name AS class_name
       FROM members m JOIN classes c ON c.id = m.class_id
      WHERE m.account_id = ? AND m.removed_at IS NULL AND m.role = 'admin'
      ORDER BY c.created_at DESC`
  ).bind(account.id).all();
  const memberships = [];
  for (const a of admins) {
    const device = await newDeviceFor(env, a.member_id, now);
    stmts.push(device.stmt);
    memberships.push({
      token: device.token, classId: a.class_id, className: a.class_name,
      memberId: a.member_id, memberName: a.member_name, role: a.role,
    });
  }
  await env.DB.batch(stmts);

  return json({ token, email: account.email, memberships });
}

export async function linkMember(request, env) {
  const { account } = await requireAccount(request, env);
  const body = await readJson(request);
  const memberToken = typeof body.memberToken === "string" ? body.memberToken : "";
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(memberToken)) throw new ApiError(400, "Ungültige Anfrage.");

  const row = await env.DB.prepare(
    `SELECT m.id, m.role, m.account_id FROM devices d JOIN members m ON m.id = d.member_id
      WHERE d.token_hash = ? AND d.revoked_at IS NULL AND m.removed_at IS NULL`
  ).bind(await sha256Hex(memberToken)).first();
  if (!row || row.role !== "admin") return json({ linked: false });
  if (row.account_id && row.account_id !== account.id) return json({ linked: false });

  await env.DB.prepare(
    "UPDATE members SET account_id = ? WHERE id = ? AND account_id IS NULL"
  ).bind(account.id, row.id).run();
  return json({ linked: true });
}
