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
const MAX_CODES_PER_WINDOW = 3;           // pro E-Mail-Adresse …
const CODE_WINDOW_MS = 15 * 60 * 1000;    // … in 15 Minuten

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

  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?"
  ).bind(email, now - CODE_WINDOW_MS).first();
  if (recent.n >= MAX_CODES_PER_WINDOW) {
    throw new ApiError(429, "Es wurden gerade schon mehrere Codes verschickt. Bitte in 15 Minuten erneut versuchen.", "rate_limited");
  }

  const code = newLoginCode();
  await env.DB.prepare(
    "INSERT INTO login_codes (id, email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(newId(), email, await codeHash(email, code), now, now + CODE_TTL_MS).run();

  // Nur Testversion (abgehakt-test, Variable TEST_SHOW_CODES in wrangler.jsonc → env.test): keine E-Mail, der Code
  // geht direkt an die App. Doppelt abgesichert über den Hostnamen – auf der echten Adresse passiert das nie.
  if (env.TEST_SHOW_CODES === "1" && new URL(request.url).hostname.startsWith("abgehakt-test.")) {
    return json({ ok: true, testCode: code });
  }
  await sendLoginCode(env, email, code);
  return json({ ok: true });
}

export async function verifyLogin(request, env) {
  const body = await readJson(request);
  const email = cleanEmail(body.email);
  const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
  if (code.length !== 6) throw new ApiError(400, "Der Code hat 6 Ziffern.", "invalid_code");
  const now = Date.now();

  const row = await env.DB.prepare(
    `SELECT id, code_hash, attempts FROM login_codes
      WHERE email = ? AND used_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1`
  ).bind(email, now).first();
  if (!row) throw new ApiError(400, "Der Code ist abgelaufen. Bitte einen neuen anfordern.", "code_expired");
  if (row.attempts >= MAX_ATTEMPTS) {
    throw new ApiError(429, "Zu viele falsche Versuche. Bitte einen neuen Code anfordern.", "code_expired");
  }
  if (row.code_hash !== (await codeHash(email, code))) {
    await env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run();
    const left = MAX_ATTEMPTS - row.attempts - 1;
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
