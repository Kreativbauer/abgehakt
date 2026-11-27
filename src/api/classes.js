// Klassen anlegen und Einladungscodes verwalten.
//   POST /api/classes                    { className, adminName }  (Admin-Konto)
//   GET  /api/invites                                               (Admin der Klasse)
//   POST /api/invites                    { days, maxUses }          (Admin der Klasse)
//   POST /api/invites/:code/revoke                                  (Admin der Klasse)
//   PATCH /api/class                     { name }                   Klasse umbenennen (Admin)
//   POST /api/class/delete               { confirmName }            Klasse endgültig löschen (Admin)
import { ApiError, json, readJson } from "../lib/http.js";
import { newId, newJoinCode, normalizeCode } from "../lib/crypto.js";
import { requireAccount, requireAdmin } from "../lib/auth.js";
import { newDeviceFor } from "../lib/devices.js";
import { cleanName } from "./join.js";
import { purgeClass } from "../lib/purge.js";
import { enqueueOperator } from "./operator-push.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CLASSES_PER_ACCOUNT = 20;
const MAX_ACTIVE_INVITES = 10;
const CLASS_NAME_MAX = 60;

function cleanClassName(input) {
  // Wie bei Personennamen: keine Steuer- und Richtungszeichen (landen sonst z. B. im Betreff von E-Mails).
  const name = typeof input === "string"
    ? input.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "").replace(/\s+/g, " ").trim()
    : "";
  if (!name) throw new ApiError(400, "Bitte einen Namen für die Klasse eingeben.");
  if ([...name].length > CLASS_NAME_MAX) throw new ApiError(400, `Der Klassenname darf höchstens ${CLASS_NAME_MAX} Zeichen haben.`);
  return name;
}

function inviteOptions(body) {
  const days = body.days === undefined ? 7 : Number(body.days);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new ApiError(400, "Gültigkeit: 1 bis 30 Tage.");
  let maxUses = null;
  if (body.maxUses !== undefined && body.maxUses !== null && body.maxUses !== "") {
    maxUses = Number(body.maxUses);
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 500) throw new ApiError(400, "Anzahl: 1 bis 500 Beitritte.");
  }
  return { days, maxUses };
}

function insertInvite(env, classId, createdBy, now, { days, maxUses }) {
  const code = newJoinCode();
  const stmt = env.DB.prepare(
    `INSERT INTO join_codes (code, class_id, kind, created_by, created_at, expires_at, max_uses)
     VALUES (?, ?, 'invite', ?, ?, ?, ?)`
  ).bind(code, classId, createdBy, now, now + days * DAY_MS, maxUses);
  return { code, stmt, invite: { code, expiresAt: now + days * DAY_MS, maxUses, useCount: 0 } };
}

export async function createClass(request, env) {
  const { account } = await requireAccount(request, env);
  const body = await readJson(request);
  const className = cleanClassName(body.className);
  const adminName = cleanName(body.adminName);
  if (body.ageConfirmed !== true) {
    throw new ApiError(400, "Bitte bestätige, dass du mindestens 16 Jahre alt bist oder deine Eltern einverstanden sind.", "age_required");
  }

  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM members WHERE account_id = ? AND role = 'admin' AND removed_at IS NULL"
  ).bind(account.id).first();
  if (count.n >= MAX_CLASSES_PER_ACCOUNT) {
    throw new ApiError(429, `Du bist schon Admin in ${MAX_CLASSES_PER_ACCOUNT} Klassen – mehr geht nicht.`);
  }

  const now = Date.now();
  const classId = newId();
  const memberId = newId();
  const device = await newDeviceFor(env, memberId, now);
  const invite = insertInvite(env, classId, memberId, now, { days: 7, maxUses: null });

  await env.DB.batch([
    env.DB.prepare("INSERT INTO classes (id, name, created_at, last_active_at) VALUES (?, ?, ?, ?)")
      .bind(classId, className, now, now),
    env.DB.prepare(
      `INSERT INTO members (id, class_id, name, role, created_at, account_id, age_confirmed_at)
       VALUES (?, ?, ?, 'admin', ?, ?, ?)`
    ).bind(memberId, classId, adminName, now, account.id, now),
    device.stmt,
    invite.stmt,
  ]);
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM classes").first();
  await enqueueOperator(env, "classes", `Neue Klasse angelegt (jetzt ${total.n} insgesamt).`);

  return json({
    membership: { token: device.token, classId, className, memberId, memberName: adminName, role: "admin" },
    invite: invite.invite,
  }, 201);
}

export async function listInvites(request, env) {
  const { classInfo } = await requireAdmin(request, env);
  const { results } = await env.DB.prepare(
    `SELECT code, expires_at, max_uses, use_count FROM join_codes
      WHERE class_id = ? AND kind = 'invite' AND revoked_at IS NULL AND expires_at > ?
        AND (max_uses IS NULL OR use_count < max_uses)
      ORDER BY created_at DESC`
  ).bind(classInfo.id, Date.now()).all();
  return json({
    invites: results.map((r) => ({ code: r.code, expiresAt: r.expires_at, maxUses: r.max_uses, useCount: r.use_count })),
  });
}

export async function createInvite(request, env) {
  const { member, classInfo } = await requireAdmin(request, env);
  const options = inviteOptions(await readJson(request));
  const now = Date.now();
  const active = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM join_codes WHERE class_id = ? AND kind = 'invite'
        AND revoked_at IS NULL AND expires_at > ? AND (max_uses IS NULL OR use_count < max_uses)`
  ).bind(classInfo.id, now).first();
  if (active.n >= MAX_ACTIVE_INVITES) {
    throw new ApiError(429, `Es gibt schon ${MAX_ACTIVE_INVITES} gültige Einladungscodes. Mach erst einen ungültig.`);
  }
  const invite = insertInvite(env, classInfo.id, member.id, now, options);
  await invite.stmt.run();
  return json({ invite: invite.invite }, 201);
}

export async function revokeInvite(request, env, { code }) {
  const { classInfo } = await requireAdmin(request, env);
  const result = await env.DB.prepare(
    "UPDATE join_codes SET revoked_at = ? WHERE code = ? AND class_id = ? AND kind = 'invite' AND revoked_at IS NULL"
  ).bind(Date.now(), normalizeCode(code), classInfo.id).run();
  if (result.meta.changes !== 1) throw new ApiError(404, "Diesen Code gibt es nicht mehr.");
  return json({ ok: true });
}

export async function renameClass(request, env) {
  const { classInfo } = await requireAdmin(request, env);
  const name = cleanClassName((await readJson(request)).name);
  await env.DB.prepare("UPDATE classes SET name = ? WHERE id = ?").bind(name, classInfo.id).run();
  return json({ name });
}

export async function deleteClass(request, env) {
  const { classInfo } = await requireAdmin(request, env);
  const confirm = (await readJson(request)).confirmName;
  const norm = (v) => (typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase() : "");
  if (norm(confirm) !== norm(classInfo.name)) {
    throw new ApiError(400, "Zur Bestätigung bitte den Namen der Klasse genau eintippen.");
  }
  await purgeClass(env, classInfo.id);
  return json({ ok: true });
}
