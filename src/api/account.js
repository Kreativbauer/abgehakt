// Admin-Anmeldung per E-Mail-Code (kein Passwort).
//   POST /api/account/start   { email }          → schickt einen 6-stelligen Code
//   POST /api/account/verify  { email, code }    → meldet an, liefert Konto-Schlüssel + Admin-Klassen
//   POST /api/account/link    { memberToken }    → verknüpft eine Admin-Person auf diesem Gerät mit dem Konto
import { ApiError, json, readJson } from "../lib/http.js";
import { newDeviceToken, newId, newLoginCode, sha256Hex } from "../lib/crypto.js";
import { requireAccount } from "../lib/auth.js";
import { newDeviceFor } from "../lib/devices.js";
import { sendLoginCode } from "../lib/email.js";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_WINDOW = 3;           // pro E-Mail-Adresse und Netz …
const CODE_WINDOW_MS = 15 * 60 * 1000;    // … in 15 Minuten
const DAY_MS = 24 * 60 * 60 * 1000;
// Begrenzungen pro Netz (IP, nur als Prüfsumme in login_limits, 24 Stunden) – nie pro E-Mail-Adresse allein, sonst
// könnte jemand Fremdes einen Admin aussperren (der echte Admin kommt aus einem anderen Netz).
const MAX_MAILS_PER_IP_DAY = 15;          // angeforderte Codes pro IP in 24 Stunden
const MAX_FAILS_PER_IP_EMAIL = 10;        // falsche Codes pro IP und Adresse in 24 Stunden
const MAX_FAILS_PER_IP = 20;              // falsche Codes pro IP insgesamt in 24 Stunden
const MAX_MAILS_PER_DAY = 60;             // Anmelde-E-Mails insgesamt (Resend kostenlos: 100/Tag, Rest für Löschwarnungen)

/** Prüfsumme der IP-Adresse (die Adresse selbst wird nicht gespeichert). */
async function ipHashOf(request) {
  return sha256Hex(`login-ip:${request.headers.get("CF-Connecting-IP") || "unbekannt"}`);
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
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_codes WHERE created_at > ?").bind(now - DAY_MS).first();
  if (total.n >= MAX_MAILS_PER_DAY) {
    throw new ApiError(429, "Heute wurden schon sehr viele Anmelde-Codes verschickt. Bitte morgen erneut versuchen.", "rate_limited");
  }

  const code = newLoginCode();
  const id = newId();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO login_codes (id, email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, email, await codeHash(email, code), now, now + CODE_TTL_MS),
    env.DB.prepare("INSERT INTO login_limits (ip_hash, kind, email, created_at) VALUES (?, 'mail', ?, ?)").bind(ipHash, email, now),
  ]);

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
  // Gesperrt wird nur das Netz, aus dem falsch geraten wurde – der echte Admin kann sich weiter anmelden.
  const ipHash = await ipHashOf(request);
  const since = now - DAY_MS;
  if (await countLimits(env, "ip_hash = ? AND kind = 'fail' AND email = ? AND created_at > ?", [ipHash, email, since]) >= MAX_FAILS_PER_IP_EMAIL
    || await countLimits(env, "ip_hash = ? AND kind = 'fail' AND created_at > ?", [ipHash, since]) >= MAX_FAILS_PER_IP) {
    throw LOCKED();
  }

  // Alle noch gültigen Codes dieser Adresse zählen – nicht nur der neueste. Sonst könnte jemand Fremdes kurz nach dem
  // Admin einen weiteren Code anfordern, und der richtige Code des Admins würde abgelehnt.
  const { results: rows } = await env.DB.prepare(
    `SELECT id, code_hash, created_at FROM login_codes
      WHERE email = ? AND used_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC LIMIT 10`
  ).bind(email, now).all();
  if (!rows.length) throw new ApiError(400, "Der Code ist abgelaufen. Bitte einen neuen anfordern.", "code_expired");
  // Höchstens 5 Fehlversuche seit dem neuesten Code – gezählt pro Netz, damit Fremde nicht die Versuche des Admins
  // verbrauchen (login_codes.attempts zählt nur noch mit).
  const tries = await countLimits(env, "ip_hash = ? AND kind = 'fail' AND email = ? AND created_at >= ?", [ipHash, email, rows[0].created_at]);
  if (tries >= MAX_ATTEMPTS) {
    throw new ApiError(429, "Zu viele falsche Versuche. Bitte einen neuen Code anfordern.", "code_expired");
  }
  const hash = await codeHash(email, code);
  const row = rows.find((r) => r.code_hash === hash);
  if (!row) {
    await env.DB.batch([
      ...rows.map((r) => env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?").bind(r.id)),
      env.DB.prepare("INSERT INTO login_limits (ip_hash, kind, email, created_at) VALUES (?, 'fail', ?, ?)").bind(ipHash, email, now),
    ]);
    const left = MAX_ATTEMPTS - tries - 1;
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
