// Mitglieder, Rechte, persönliche Codes, Status-Sichtbarkeit, Austreten.
//   GET   /api/members                    alle aktiven Mitglieder der Klasse + eigene Einstellungen
//   POST  /api/members          { name }   Nachzügler anlegen + persönlichen Code erzeugen   (Admin)
//   PATCH /api/members/:id      { role?, name?, editorSubjects? }   Rolle ändern / umbenennen /
//                                          Fächer von Eintragenden ([] = alle Fächer)        (Admin)
//   POST  /api/members/:id/code            persönlichen Code erzeugen (Gerätewechsel)         (Admin)
//   POST  /api/members/:id/remove          aus der Klasse entfernen                           (Admin)
//   POST  /api/me/code                     persönlichen Code für mich selbst (weiteres Gerät)
//   PUT   /api/me/name          { name }   eigenen Namen ändern
//   PUT   /api/me/settings      { visibility, viewers }   wer sieht meinen Status
//   POST  /api/me/leave                    selbst austreten
import { ApiError, json, readJson } from "../lib/http.js";
import { newId, newJoinCode } from "../lib/crypto.js";
import { requireAdmin, requireMember } from "../lib/auth.js";
import { cleanName, MAX_MEMBERS } from "./join.js";
import { removeMemberStmts } from "../lib/purge.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PERSONAL_CODE_DAYS = 7;
const ROLES = new Set(["admin", "editor", "member"]);

async function loadMember(env, classId, memberId) {
  const row = await env.DB.prepare(
    "SELECT id, name, role FROM members WHERE id = ? AND class_id = ? AND removed_at IS NULL"
  ).bind(memberId, classId).first();
  if (!row) throw new ApiError(404, "Diese Person gibt es in der Klasse nicht mehr.");
  return row;
}

async function adminCount(env, classId) {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM members WHERE class_id = ? AND role = 'admin' AND removed_at IS NULL"
  ).bind(classId).first();
  return r.n;
}

/** Neuer persönlicher Code; ältere persönliche Codes derselben Person werden ungültig. */
function personalCodeStmts(env, classId, memberId, createdBy, now) {
  const code = newJoinCode();
  const expiresAt = now + PERSONAL_CODE_DAYS * DAY_MS;
  return {
    code: { code, expiresAt },
    stmts: [
      env.DB.prepare(
        "UPDATE join_codes SET revoked_at = ? WHERE member_id = ? AND kind = 'personal' AND revoked_at IS NULL"
      ).bind(now, memberId),
      env.DB.prepare(
        `INSERT INTO join_codes (code, class_id, kind, member_id, created_by, created_at, expires_at, max_uses)
         VALUES (?, ?, 'personal', ?, ?, ?, ?, 1)`
      ).bind(code, classId, memberId, createdBy, now, expiresAt),
    ],
  };
}

export async function listMembers(request, env) {
  const { member, classInfo } = await requireMember(request, env);
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.name, m.role, m.editor_subject_ids, m.elective_ids, m.electives_chosen_at,
            EXISTS (SELECT 1 FROM devices d WHERE d.member_id = m.id AND d.revoked_at IS NULL) AS has_device
       FROM members m
      WHERE m.class_id = ? AND m.removed_at IS NULL
      ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, lower(m.name)`
  ).bind(classInfo.id).all();
  const me = await env.DB.prepare(
    "SELECT status_visibility, status_viewers, account_id FROM members WHERE id = ?"
  ).bind(member.id).first();

  return json({
    members: results.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      isMe: r.id === member.id,
      // Eintragende für bestimmte Fächer: IDs der Fächer (leer = alle Fächer).
      ...(r.role === "editor" ? { editorSubjects: JSON.parse(r.editor_subject_ids || "[]") } : {}),
      // Nur für Admins und nur bei Eintragenden: gewählte Wahlfächer (null = noch nicht gewählt) – damit sie
      // nur Fächer zuteilen können, die die Person hat. Sonst sieht die Wahlfächer niemand außer der Person selbst.
      ...(member.role === "admin" && r.role === "editor"
        ? { electives: r.electives_chosen_at ? JSON.parse(r.elective_ids || "[]") : null } : {}),
      // Ob jemand schon ein Gerät angemeldet hat, sehen nur Admins (für Nachzügler-Codes).
      ...(member.role === "admin" ? { joined: Boolean(r.has_device) } : {}),
    })),
    settings: {
      visibility: me.status_visibility,
      viewers: JSON.parse(me.status_viewers || "[]"),
      ...(member.role === "admin" ? { linkedToEmail: Boolean(me.account_id) } : {}),
    },
  });
}

export async function addMember(request, env) {
  const { member, classInfo } = await requireAdmin(request, env);
  const name = cleanName((await readJson(request)).name);
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM members WHERE class_id = ? AND removed_at IS NULL"
  ).bind(classInfo.id).first();
  if (count.n >= MAX_MEMBERS) throw new ApiError(429, `Eine Klasse kann höchstens ${MAX_MEMBERS} Personen haben.`);
  const taken = await env.DB.prepare(
    "SELECT 1 FROM members WHERE class_id = ? AND removed_at IS NULL AND lower(name) = lower(?)"
  ).bind(classInfo.id, name).first();
  if (taken) throw new ApiError(409, `„${name}“ gibt es in dieser Klasse schon.`, "name_taken");

  const now = Date.now();
  const id = newId();
  const personal = personalCodeStmts(env, classInfo.id, id, member.id, now);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO members (id, class_id, name, role, created_at) VALUES (?, ?, ?, 'member', ?)"
    ).bind(id, classInfo.id, name, now),
    ...personal.stmts,
  ]);
  return json({ member: { id, name, role: "member", isMe: false, joined: false }, code: personal.code }, 201);
}

/** Namen ändern (eindeutig in der Klasse, Groß-/Kleinschreibung egal). */
async function rename(env, classId, memberId, rawName) {
  const name = cleanName(rawName);
  const taken = await env.DB.prepare(
    "SELECT 1 FROM members WHERE class_id = ? AND removed_at IS NULL AND lower(name) = lower(?) AND id != ?"
  ).bind(classId, name, memberId).first();
  if (taken) throw new ApiError(409, `„${name}“ gibt es in dieser Klasse schon.`, "name_taken");
  await env.DB.prepare("UPDATE members SET name = ? WHERE id = ? AND removed_at IS NULL").bind(name, memberId).run();
  return name;
}

export async function updateMember(request, env, { id }) {
  const { classInfo } = await requireAdmin(request, env);
  const body = await readJson(request);
  const target = await loadMember(env, classInfo.id, id);
  const result = { name: target.name, role: target.role };
  let roleChanged = false;

  if ("name" in body) result.name = await rename(env, classInfo.id, target.id, body.name);

  if ("role" in body && body.role !== target.role) {
    if (!ROLES.has(body.role)) throw new ApiError(400, "Ungültige Rolle.");
    if (target.role === "admin" && (await adminCount(env, classInfo.id)) <= 1) {
      throw new ApiError(409, "Die Klasse braucht mindestens einen Admin. Ernenne erst eine andere Person zum Admin.");
    }
    // Neue Rolle → Fach-Liste zurücksetzen (wer wieder Eintragende*r wird, darf zunächst alle Fächer).
    await env.DB.prepare("UPDATE members SET role = ?, editor_subject_ids = '[]' WHERE id = ? AND removed_at IS NULL").bind(body.role, id).run();
    result.role = body.role;
    roleChanged = true;
  }

  if ("editorSubjects" in body) {
    if (result.role !== "editor") throw new ApiError(400, "Fächer lassen sich nur für Eintragende festlegen.");
    if (!Array.isArray(body.editorSubjects) || body.editorSubjects.length > 60) throw new ApiError(400, "Ungültige Fächer.");
    const ids = [...new Set(body.editorSubjects.filter((v) => typeof v === "string" && /^[A-Za-z0-9-]{1,64}$/.test(v)))];
    // Nur Fächer dieser Klasse (keine entfernten) – und nur solche, die die Person selbst hat:
    // Pflichtfächer immer, Wahlfächer nur, wenn sie sie gewählt hat (oder noch gar keine Wahlfächer gewählt hat).
    const t = await env.DB.prepare("SELECT elective_ids, electives_chosen_at FROM members WHERE id = ?").bind(id).first();
    const valid = ids.length
      ? (await env.DB.prepare(
        `SELECT id FROM subjects
          WHERE class_id = ?1 AND archived_at IS NULL AND id IN (SELECT value FROM json_each(?2))
            AND (elective = 0 OR ?3 IS NULL OR id IN (SELECT value FROM json_each(?4)))`
      ).bind(classInfo.id, JSON.stringify(ids), t.electives_chosen_at, t.elective_ids || "[]").all()).results.map((r) => r.id)
      : [];
    if (ids.length && !valid.length) throw new ApiError(400, "Diese Fächer hat die Person nicht (als Wahlfach nicht gewählt) oder es gibt sie nicht mehr.");
    await env.DB.prepare("UPDATE members SET editor_subject_ids = ? WHERE id = ? AND removed_at IS NULL")
      .bind(JSON.stringify(valid), id).run();
    result.editorSubjects = valid;
  } else if (roleChanged && result.role === "editor") {
    result.editorSubjects = [];
  }
  return json({ member: result });
}

export async function renameSelf(request, env) {
  const { member, classInfo } = await requireMember(request, env);
  const name = await rename(env, classInfo.id, member.id, (await readJson(request)).name);
  return json({ name });
}

export async function createPersonalCode(request, env, { id }) {
  const { member, classInfo } = await requireAdmin(request, env);
  const target = await loadMember(env, classInfo.id, id);
  const personal = personalCodeStmts(env, classInfo.id, target.id, member.id, Date.now());
  await env.DB.batch(personal.stmts);
  return json({ code: personal.code }, 201);
}

/** Jede Person kann sich selbst einen Code für ein weiteres Gerät erzeugen (altes Gerät bleibt angemeldet). */
export async function createOwnCode(request, env) {
  const { member, classInfo } = await requireMember(request, env);
  const personal = personalCodeStmts(env, classInfo.id, member.id, member.id, Date.now());
  await env.DB.batch(personal.stmts);
  return json({ code: personal.code }, 201);
}

export async function removeMember(request, env, { id }) {
  const { member, classInfo } = await requireAdmin(request, env);
  const target = await loadMember(env, classInfo.id, id);
  if (target.id === member.id) throw new ApiError(400, "Um selbst auszutreten, nutze „Klasse verlassen“ in deinen Einstellungen.");
  if (target.role === "admin" && (await adminCount(env, classInfo.id)) <= 1) {
    throw new ApiError(409, "Die Klasse braucht mindestens einen Admin.");
  }
  await env.DB.batch(removeMemberStmts(env, target.id, Date.now()));
  return json({ ok: true });
}

export async function updateSettings(request, env) {
  const { member, classInfo } = await requireMember(request, env);
  const body = await readJson(request);
  const visibility = body.visibility;
  if (!["none", "all", "some"].includes(visibility)) throw new ApiError(400, "Ungültige Einstellung.");

  let viewers = [];
  if (visibility === "some") {
    if (!Array.isArray(body.viewers) || body.viewers.length > MAX_MEMBERS) throw new ApiError(400, "Ungültige Auswahl.");
    const ids = [...new Set(body.viewers.filter((v) => typeof v === "string" && /^[A-Za-z0-9-]{1,64}$/.test(v)))];
    if (ids.length) {
      // Nur Personen aus derselben Klasse übernehmen.
      const { results } = await env.DB.prepare(
        `SELECT id FROM members WHERE class_id = ? AND removed_at IS NULL AND id != ?
            AND id IN (SELECT value FROM json_each(?))`
      ).bind(classInfo.id, member.id, JSON.stringify(ids)).all();
      viewers = results.map((r) => r.id);
    }
  }
  await env.DB.prepare(
    "UPDATE members SET status_visibility = ?, status_viewers = ? WHERE id = ?"
  ).bind(visibility, JSON.stringify(viewers), member.id).run();
  return json({ settings: { visibility, viewers } });
}

export async function leaveClass(request, env) {
  const { member, classInfo } = await requireMember(request, env);
  if (member.role === "admin" && (await adminCount(env, classInfo.id)) <= 1) {
    throw new ApiError(409, "Du bist die einzige Person mit Admin-Rechten. Ernenne erst eine andere Person zum Admin, bevor du austrittst.");
  }
  await env.DB.batch(removeMemberStmts(env, member.id, Date.now()));
  return json({ ok: true });
}
