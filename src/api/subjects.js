// Fächerliste einer Klasse und Wahlfächer.
//   GET   /api/subjects                       Liste (auch in GET /api/tasks enthalten)
//   POST  /api/subjects        { name, elective }   Fach anlegen          (Admin, Eintragende)
//   PATCH /api/subjects/:id    { name?, elective? } umbenennen / Wahlfach (Admin, Eintragende)
//   POST  /api/subjects/:id/archive                 aus der Liste nehmen   (Admin, Eintragende)
//   PUT   /api/me/subjects     { subjectIds }       eigene Wahlfächer wählen (jede Person)
//   PUT   /api/timetable       { abWeeks, monday, currentWeek }  A/B-Wochen an/aus (Admin, Eintragende)
// Stundenplan: PATCH /api/subjects/:id { daysA, daysB } – Wochentage 1 (Mo) bis 5 (Fr).
import { ApiError, json, readJson } from "../lib/http.js";
import { newId } from "../lib/crypto.js";
import { isRestrictedEditor, requireMember } from "../lib/auth.js";

const MANAGERS = new Set(["admin", "editor"]);
const MAX_SUBJECTS = 60;

/** Fächerliste und Stundenplan pflegen: Admins und Eintragende für alle Fächer (nicht die mit Fach-Liste). */
export function canManageSubjects(member) {
  return MANAGERS.has(member.role) && !isRestrictedEditor(member);
}

function cleanSubjectName(input) {
  const name = typeof input === "string"
    ? input.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "").replace(/\s+/g, " ").trim()
    : "";
  if (!name) throw new ApiError(400, "Bitte einen Namen für das Fach eingeben.");
  if ([...name].length > 40) throw new ApiError(400, "Der Fachname darf höchstens 40 Zeichen haben.");
  return name;
}

function parseDays(text) {
  try {
    const v = JSON.parse(text || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function cleanDays(input) {
  if (!Array.isArray(input)) throw new ApiError(400, "Ungültige Wochentage.");
  return [...new Set(input.filter((d) => Number.isInteger(d) && d >= 1 && d <= 5))].sort();
}

const toSubject = (s) => ({
  id: s.id,
  name: s.name,
  elective: Boolean(s.elective),
  daysA: parseDays(s.days_a),
  daysB: parseDays(s.days_b),
});

/** Fächer der Klasse (ohne entfernte) und eigene Wahlfach-Auswahl. */
export async function subjectInfo(env, member, classId) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, elective, days_a, days_b FROM subjects WHERE class_id = ? AND archived_at IS NULL ORDER BY lower(name)"
  ).bind(classId).all();
  const cls = await env.DB.prepare("SELECT ab_weeks_ref FROM classes WHERE id = ?").bind(classId).first();
  const me = await env.DB.prepare(
    "SELECT elective_ids, electives_chosen_at FROM members WHERE id = ?"
  ).bind(member.id).first();
  return {
    subjects: results.map(toSubject),
    abWeeksRef: cls?.ab_weeks_ref || null,
    mySubjects: JSON.parse(me?.elective_ids || "[]"),
    electivesChosen: Boolean(me?.electives_chosen_at),
    canManageSubjects: canManageSubjects(member),
    // Für welche Fächer diese Person Klassen-Einträge machen darf: null = alle (bzw. keine Eintrage-Rechte).
    postSubjects: isRestrictedEditor(member) ? member.editorSubjects : null,
  };
}

async function requireManager(request, env) {
  const ctx = await requireMember(request, env);
  if (!canManageSubjects(ctx.member)) throw new ApiError(403, "Fächer verwalten dürfen nur Admins und Eintragende für alle Fächer.");
  return ctx;
}

async function assertNameFree(env, classId, name, exceptId = "") {
  const taken = await env.DB.prepare(
    "SELECT 1 FROM subjects WHERE class_id = ? AND archived_at IS NULL AND lower(name) = lower(?) AND id != ?"
  ).bind(classId, name, exceptId).first();
  if (taken) throw new ApiError(409, `Das Fach „${name}“ gibt es schon.`, "subject_exists");
}

export async function listSubjects(request, env) {
  const { member, classInfo } = await requireMember(request, env);
  return json(await subjectInfo(env, member, classInfo.id));
}

export async function createSubject(request, env) {
  const { classInfo } = await requireManager(request, env);
  const body = await readJson(request);
  const name = cleanSubjectName(body.name);
  await assertNameFree(env, classInfo.id, name);
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM subjects WHERE class_id = ? AND archived_at IS NULL"
  ).bind(classInfo.id).first();
  if (count.n >= MAX_SUBJECTS) throw new ApiError(429, `Eine Klasse kann höchstens ${MAX_SUBJECTS} Fächer haben.`);
  const subject = { id: newId(), name, elective: body.elective === true, daysA: [], daysB: [] };
  await env.DB.prepare(
    "INSERT INTO subjects (id, class_id, name, elective, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(subject.id, classInfo.id, name, subject.elective ? 1 : 0, Date.now()).run();
  return json({ subject }, 201);
}

async function loadSubject(env, classId, id) {
  const row = await env.DB.prepare(
    "SELECT id, name, elective, days_a, days_b FROM subjects WHERE id = ? AND class_id = ? AND archived_at IS NULL"
  ).bind(id, classId).first();
  if (!row) throw new ApiError(404, "Dieses Fach gibt es nicht (mehr).");
  return row;
}

export async function updateSubject(request, env, { id }) {
  const { classInfo } = await requireManager(request, env);
  const body = await readJson(request);
  const row = await loadSubject(env, classInfo.id, id);
  const name = "name" in body ? cleanSubjectName(body.name) : row.name;
  if (name !== row.name) await assertNameFree(env, classInfo.id, name, id);
  const elective = "elective" in body ? body.elective === true : Boolean(row.elective);
  const daysA = "daysA" in body ? cleanDays(body.daysA) : parseDays(row.days_a);
  const daysB = "daysB" in body ? cleanDays(body.daysB) : parseDays(row.days_b);
  await env.DB.prepare("UPDATE subjects SET name = ?, elective = ?, days_a = ?, days_b = ? WHERE id = ?")
    .bind(name, elective ? 1 : 0, JSON.stringify(daysA), JSON.stringify(daysB), id).run();
  return json({ subject: { id, name, elective, daysA, daysB } });
}

export async function archiveSubject(request, env, { id }) {
  const { classInfo } = await requireManager(request, env);
  await loadSubject(env, classInfo.id, id);
  await env.DB.prepare("UPDATE subjects SET archived_at = ? WHERE id = ?").bind(Date.now(), id).run();
  return json({ ok: true });
}

export async function chooseSubjects(request, env) {
  const { member, classInfo } = await requireMember(request, env);
  const body = await readJson(request);
  if (!Array.isArray(body.subjectIds) || body.subjectIds.length > MAX_SUBJECTS) throw new ApiError(400, "Ungültige Auswahl.");
  const ids = [...new Set(body.subjectIds.filter((v) => typeof v === "string" && /^[A-Za-z0-9-]{1,64}$/.test(v)))];
  let chosen = [];
  if (ids.length) {
    // Nur Wahlfächer dieser Klasse übernehmen.
    const { results } = await env.DB.prepare(
      `SELECT id FROM subjects WHERE class_id = ? AND archived_at IS NULL AND elective = 1
          AND id IN (SELECT value FROM json_each(?))`
    ).bind(classInfo.id, JSON.stringify(ids)).all();
    chosen = results.map((r) => r.id);
  }
  await env.DB.prepare("UPDATE members SET elective_ids = ?, electives_chosen_at = ? WHERE id = ?")
    .bind(JSON.stringify(chosen), Date.now(), member.id).run();
  return json({ mySubjects: chosen, electivesChosen: true });
}

/** A/B-Wochen ein- oder ausschalten. `monday` ist der Montag der aktuellen Woche (aus Sicht des Geräts). */
export async function setTimetable(request, env) {
  const { classInfo } = await requireManager(request, env);
  const body = await readJson(request);
  let ref = null;
  if (body.abWeeks === true) {
    const m = typeof body.monday === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(body.monday);
    const date = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    if (!date || date.getUTCDay() !== 1 || date.toISOString().slice(0, 10) !== body.monday) {
      throw new ApiError(400, "Ungültiges Datum.");
    }
    if (body.currentWeek !== "a" && body.currentWeek !== "b") throw new ApiError(400, "Bitte A- oder B-Woche wählen.");
    // Gespeichert wird immer der Montag einer A-Woche.
    if (body.currentWeek === "b") date.setUTCDate(date.getUTCDate() - 7);
    ref = date.toISOString().slice(0, 10);
  }
  const before = await env.DB.prepare("SELECT ab_weeks_ref FROM classes WHERE id = ?").bind(classInfo.id).first();
  const stmts = [env.DB.prepare("UPDATE classes SET ab_weeks_ref = ? WHERE id = ?").bind(ref, classInfo.id)];
  // Beim Einschalten startet die B-Woche als Kopie des bisherigen Plans (nur wo noch nichts eingetragen ist).
  if (ref && !before?.ab_weeks_ref) {
    stmts.push(env.DB.prepare(
      "UPDATE subjects SET days_b = days_a WHERE class_id = ? AND archived_at IS NULL AND days_b = '[]'"
    ).bind(classInfo.id));
  }
  await env.DB.batch(stmts);
  return json({ abWeeksRef: ref });
}
