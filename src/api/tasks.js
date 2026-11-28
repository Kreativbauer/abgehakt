// Hausaufgaben, Status und private Notizen.
//   GET    /api/tasks?since=YYYY-MM-DD   Aufgaben der Klasse + eigene private, mit eigenem Status
//   POST   /api/tasks                    neue Aufgabe (Mitglieder: automatisch privat)
//   PATCH  /api/tasks/:id                Aufgabe bearbeiten
//   DELETE /api/tasks/:id                Aufgabe löschen (wird nur ausgeblendet, siehe CLAUDE.md)
//          ?following=1                  bei wiederkehrenden Einträgen: diesen und alle späteren der Reihe
//   POST   /api/tasks  { …, repeat: { every: 1|2|"lessons", until } }   wiederkehrend: jede (2.) Woche bzw. jede
//                                         Stunde des Fachs laut Stundenplan bis „until“
//   PUT    /api/tasks/:id/state          eigenen Status / eigene Notiz setzen
//   GET    /api/tasks/deleted            Admin: gelöschte Klassen-Aufgaben der letzten 30 Tage
//   POST   /api/tasks/:id/restore        Admin: gelöschte Klassen-Aufgabe wiederherstellen
//
// Rechte (KONZEPT.md):
//   Klassen-Aufgaben eintragen/bearbeiten: Admin, Eintragende
//   Klassen-Aufgaben löschen: Admin alle, Eintragende nur eigene
//   Private Aufgaben: nur die Person selbst – auch Admins sehen sie nicht.
import { ApiError, json, readJson } from "../lib/http.js";
import { maySubject, requireAdmin, requireMember } from "../lib/auth.js";
import { newId } from "../lib/crypto.js";
import { subjectInfo } from "./subjects.js";
import { enqueueNewTask } from "./push.js";

const LIMITS = { subject: 40, title: 200, details: 2000, note: 1000 };
const CAN_POST_FOR_CLASS = new Set(["admin", "editor"]);
// Schutz vor Massen-Einträgen (z. B. per Skript), damit niemand das Datenbank-Kontingent für alle aufbraucht.
// Beim normalen Eintragen erreicht man das nie – auch nicht beim Nachtragen einer ganzen Woche.
const MAX_NEW_TASKS_PER_HOUR = 60;

function cleanText(value, field, { required = false } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw new ApiError(400, "Ungültige Eingabe.");
  // Steuerzeichen entfernen (Zeilenumbrüche bleiben bei Details und Notizen erlaubt).
  let text = value.normalize("NFC").replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "");
  text = field === "details" || field === "note" ? text.replace(/\r\n?/g, "\n").trim() : text.replace(/\s+/g, " ").trim();
  if (required && !text) throw new ApiError(400, "Bitte eintragen, was zu tun ist.");
  if ([...text].length > LIMITS[field]) {
    throw new ApiError(400, `Zu lang: höchstens ${LIMITS[field]} Zeichen.`);
  }
  return text;
}

function cleanDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, "Bitte ein gültiges Abgabedatum wählen.");
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, "Bitte ein gültiges Abgabedatum wählen.");
  }
  const year = d.getUTCFullYear();
  if (year < 2020 || year > 2100) throw new ApiError(400, "Bitte ein gültiges Abgabedatum wählen.");
  return value;
}

function rights(row, member) {
  if (row.owner_member_id) {
    const own = row.owner_member_id === member.id;
    return { canEdit: own, canDelete: own };
  }
  // Eintragende mit Fach-Liste: nur Einträge ihrer Fächer (subj_id = Fach aus der Liste oder über den Namen zugeordnet).
  const inScope = maySubject(member, row.subj_id ?? row.subject_id);
  return {
    canEdit: CAN_POST_FOR_CLASS.has(member.role) && inScope,
    canDelete: member.role === "admin" || (member.role === "editor" && row.created_by === member.id && inScope),
  };
}

// Art des Eintrags: Hausaufgabe (Standard) oder ein Termin.
export const KIND_LABELS = {
  homework: "Hausaufgabe",
  exam: "Schulaufgabe",
  short_exam: "Kurzarbeit",
  test: "Test / Abfrage",
  presentation: "Referat / Abgabe",
  other: "Sonstiger Termin",
};
const KINDS = new Set(Object.keys(KIND_LABELS));
// Brauchen einen eigenen Text: Hausaufgaben („Was ist zu tun?“) und sonstige Termine („Was ist es?“).
const NEEDS_TITLE = new Set(["homework", "other"]);

/** Art aus der Datenbank → API (sonstige Termine: siehe migrations/0014_sonstige_termine.sql). */
export function kindOf(row) {
  return row.other_event ? "other" : row.kind || "homework";
}

/** Art aus der API → Spalten kind + other_event. */
function dbKind(kind) {
  return kind === "other" ? { kind: "test", other: 1 } : { kind, other: 0 };
}

function cleanKind(value) {
  if (value === undefined || value === null || value === "") return "homework";
  if (!KINDS.has(value)) throw new ApiError(400, "Unbekannte Art des Eintrags.");
  return value;
}

function toTask(row, member) {
  return {
    id: row.id,
    subject: row.subj_name || "",
    subjectId: row.subj_id || null,
    elective: Boolean(row.subj_elective),
    kind: kindOf(row),
    seriesId: row.series_id || null,
    title: row.title,
    details: row.details,
    dueDate: row.due_date,
    private: Boolean(row.owner_member_id),
    updatedByName: row.updated_by_name || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status || "open",
    note: row.note || "",
    ...rights(row, member),
  };
}

const SELECT_TASK = `
  SELECT t.*, ub.name AS updated_by_name, s.status, s.note,
         COALESCE(sj.id, sn.id) AS subj_id,
         COALESCE(sj.name, t.subject) AS subj_name,
         -- Aus der Liste entfernte Fächer zählen nicht mehr als Wahlfach (sonst wären die Aufgaben unsichtbar)
         COALESCE(CASE WHEN sj.archived_at IS NULL THEN sj.elective ELSE 0 END, sn.elective, 0) AS subj_elective
    FROM tasks t
    LEFT JOIN members ub ON ub.id = t.updated_by
    LEFT JOIN task_states s ON s.task_id = t.id AND s.member_id = ?1
    -- Fach aus der Liste; ältere Aufgaben (nur Fachname als Text) über den Namen zuordnen
    LEFT JOIN subjects sj ON sj.id = t.subject_id
    LEFT JOIN subjects sn ON t.subject_id IS NULL AND t.subject != '' AND sn.class_id = t.class_id
                         AND sn.archived_at IS NULL AND lower(sn.name) = lower(t.subject)
   WHERE t.class_id = ?2 AND t.deleted_at IS NULL
     AND (t.owner_member_id IS NULL OR t.owner_member_id = ?1)`;

/** Lädt eine Aufgabe, die diese Person sehen darf – sonst 404. */
async function loadVisibleTask(env, member, classId, taskId) {
  const row = await env.DB.prepare(`${SELECT_TASK} AND t.id = ?3`).bind(member.id, classId, taskId).first();
  if (!row) throw new ApiError(404, "Diese Aufgabe gibt es nicht mehr.", "task_not_found");
  return row;
}

/**
 * Fach einer Aufgabe bestimmen: bevorzugt `subjectId` aus der Fächerliste der Klasse,
 * sonst (ältere App-Versionen, Offline-Warteschlange) ein freier Fachname als Text.
 * Gibt { subject, subjectId } zurück.
 */
async function resolveSubject(env, classId, body, fallback = { subject: "", subjectId: null }) {
  if ("subjectId" in body) {
    if (body.subjectId === null || body.subjectId === "") return { subject: "", subjectId: null };
    if (typeof body.subjectId !== "string") throw new ApiError(400, "Ungültiges Fach.");
    const row = await env.DB.prepare(
      "SELECT id, name FROM subjects WHERE id = ? AND class_id = ? AND archived_at IS NULL"
    ).bind(body.subjectId, classId).first();
    if (!row) throw new ApiError(400, "Dieses Fach gibt es nicht mehr. Bitte ein anderes wählen.");
    return { subject: row.name, subjectId: row.id };
  }
  if ("subject" in body) return { subject: cleanText(body.subject, "subject"), subjectId: null };
  return fallback;
}

async function touchClass(env, classId, now) {
  await env.DB.prepare("UPDATE classes SET last_active_at = ? WHERE id = ?").bind(now, classId).run();
}

export async function listTasks(request, env) {
  const { member, classInfo } = await requireMember(request, env);
  const since = new URL(request.url).searchParams.get("since");
  const sinceDate = since ? cleanDate(since) : new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    `${SELECT_TASK} AND t.due_date >= ?3 ORDER BY t.due_date, t.subject, t.created_at LIMIT 1000`
  ).bind(member.id, classInfo.id, sinceDate).all();
  // Wer hat Klassen-Aufgaben schon erledigt? Nur Personen, die ihren Status für mich freigegeben haben
  // (status_visibility 'all' oder 'some' mit mir in status_viewers).
  const { results: done } = await env.DB.prepare(
    `SELECT ts.task_id, m.name
       FROM task_states ts
       JOIN members m ON m.id = ts.member_id
       JOIN tasks t ON t.id = ts.task_id
      WHERE t.class_id = ?1 AND t.owner_member_id IS NULL AND t.deleted_at IS NULL AND t.due_date >= ?3
        AND ts.status = 'done' AND m.removed_at IS NULL AND m.id != ?2
        AND (m.status_visibility = 'all'
             OR (m.status_visibility = 'some'
                 AND EXISTS (SELECT 1 FROM json_each(m.status_viewers) WHERE value = ?2)))
      ORDER BY lower(m.name)`
  ).bind(classInfo.id, member.id, sinceDate).all();
  const doneBy = new Map();
  for (const d of done) {
    if (!doneBy.has(d.task_id)) doneBy.set(d.task_id, []);
    doneBy.get(d.task_id).push(d.name);
  }

  // Admins: Anzahl offener Meldungen für den Hinweis in der App.
  let openReports = 0;
  if (member.role === "admin") {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE class_id = ? AND status = 'open'")
      .bind(classInfo.id).first();
    openReports = r.n;
  }

  return json({
    member,
    class: classInfo,
    openReports,
    ...(await subjectInfo(env, member, classInfo.id)),
    canPostForClass: CAN_POST_FOR_CLASS.has(member.role),
    tasks: results.map((r) => ({ ...toTask(r, member), doneBy: doneBy.get(r.id) || [] })),
  });
}

export async function createTask(request, env) {
  const { member, classInfo } = await requireMember(request, env);
  const body = await readJson(request);
  const now = Date.now();
  const isPrivate = body.private === true || !CAN_POST_FOR_CLASS.has(member.role);
  const id = newId();
  const subj = await resolveSubject(env, classInfo.id, body);
  if (!isPrivate && !maySubject(member, subj.subjectId)) {
    throw new ApiError(403, "Für die Klasse darfst du nur in deinen Fächern eintragen. Für dich selbst geht es mit „Nur für mich“.");
  }
  const kind = cleanKind(body.kind); // Termine brauchen keinen Text – Art, Fach und Datum reichen
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM tasks WHERE class_id = ? AND created_by = ? AND created_at > ?"
  ).bind(classInfo.id, member.id, now - 60 * 60 * 1000).first();
  if (recent.n >= MAX_NEW_TASKS_PER_HOUR) {
    throw new ApiError(429, "Du hast gerade sehr viele Einträge angelegt. Bitte in einer Stunde weitermachen.");
  }

  const title = cleanText(body.title, "title", { required: NEEDS_TITLE.has(kind) });
  const details = cleanText(body.details, "details");
  const dueDate = cleanDate(body.dueDate);
  const dates = await repeatDates(env, classInfo.id, subj.subjectId, dueDate, body.repeat);
  if (recent.n + dates.length > MAX_NEW_TASKS_PER_HOUR) {
    throw new ApiError(429, "So viele Einträge auf einmal gehen gerade nicht. Bitte weniger Wochen wählen oder später weitermachen.");
  }
  const seriesId = dates.length > 1 ? newId() : null;
  const ids = dates.map((_, i) => (i === 0 ? id : newId()));
  const stored = dbKind(kind);
  const insert = env.DB.prepare(
    `INSERT INTO tasks (id, class_id, owner_member_id, subject, subject_id, kind, other_event, title, details, due_date,
                        series_id, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await env.DB.batch(dates.map((date, i) => insert.bind(
    ids[i], classInfo.id, isPrivate ? member.id : null,
    subj.subject, subj.subjectId, stored.kind, stored.other, title, details, date, seriesId,
    member.id, now, member.id, now,
  )));
  await touchClass(env, classInfo.id, now);
  // Klassen-Einträge: Benachrichtigung „Neu: …“ für die anderen vormerken (verschickt wird alle 5 Minuten) –
  // bei einer Reihe nur einmal (für den ersten Termin), nicht für jede Woche.
  if (!isPrivate) {
    await enqueueNewTask(env, classInfo, member, {
      id, kind, title, subject: subj.subject, subjectId: subj.subjectId, dueDate, every: seriesId ? body.repeat.every : 0,
    });
  }

  const tasks = [];
  for (const tid of ids) tasks.push(toTask(await loadVisibleTask(env, member, classInfo.id, tid), member));
  return json({ task: tasks[0], tasks }, 201);
}

const MAX_REPEATS = 40;

/**
 * Termine einer wiederkehrenden Reihe bis einschließlich „until“ (max. 40):
 *   every 1 / 2      – ab dueDate jede bzw. jede 2. Woche
 *   every "lessons"  – jeder Tag ab dueDate, an dem das Fach laut Stundenplan Unterricht hat (A/B-Wochen beachtet)
 */
async function repeatDates(env, classId, subjectId, dueDate, repeat) {
  if (repeat === undefined || repeat === null) return [dueDate];
  if (typeof repeat !== "object" || ![1, 2, "lessons"].includes(repeat.every)) throw new ApiError(400, "Ungültige Wiederholung.");
  const until = cleanDate(repeat.until);
  if (until <= dueDate) throw new ApiError(400, "„Bis“ muss nach dem ersten Termin liegen.");
  const tooMany = () => new ApiError(400, `Höchstens ${MAX_REPEATS} Wiederholungen auf einmal – bitte ein früheres „Bis“-Datum wählen.`);
  const dates = [];
  const d = new Date(`${dueDate}T12:00:00Z`);
  const iso = () => d.toISOString().slice(0, 10);

  if (repeat.every === "lessons") {
    const sub = subjectId
      ? await env.DB.prepare("SELECT days_a, days_b FROM subjects WHERE id = ? AND class_id = ?").bind(subjectId, classId).first()
      : null;
    const cls = await env.DB.prepare("SELECT ab_weeks_ref FROM classes WHERE id = ?").bind(classId).first();
    const daysA = JSON.parse(sub?.days_a || "[]");
    const daysB = cls?.ab_weeks_ref ? JSON.parse(sub?.days_b || "[]") : daysA;
    if (!daysA.length && !daysB.length) {
      throw new ApiError(400, "Für dieses Fach ist kein Stundenplan eingetragen (Einstellungen → Klasse → Fächer).");
    }
    for (; iso() <= until; d.setUTCDate(d.getUTCDate() + 1)) {
      const days = weekTypeOf(iso(), cls?.ab_weeks_ref) === "b" ? daysB : daysA;
      if (!days.includes(d.getUTCDay())) continue;
      dates.push(iso());
      if (dates.length > MAX_REPEATS) throw tooMany();
    }
    if (!dates.length) throw new ApiError(400, "In diesem Zeitraum hat das Fach laut Stundenplan keine Stunde.");
    return dates;
  }

  for (; iso() <= until; d.setUTCDate(d.getUTCDate() + 7 * repeat.every)) {
    dates.push(iso());
    if (dates.length > MAX_REPEATS) throw tooMany();
  }
  return dates;
}

/** A- oder B-Woche wie in der App (classes.ab_weeks_ref = Montag einer A-Woche), ohne A/B-Wochen null. */
function weekTypeOf(date, ref) {
  if (!ref) return null;
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Montag dieser Woche
  const weeks = Math.round((d - new Date(`${ref}T12:00:00Z`)) / (7 * 86400000));
  return ((weeks % 2) + 2) % 2 === 0 ? "a" : "b";
}

export async function updateTask(request, env, { id }) {
  const { member, classInfo } = await requireMember(request, env);
  const row = await loadVisibleTask(env, member, classInfo.id, id);
  if (!rights(row, member).canEdit) throw new ApiError(403, "Du darfst diese Aufgabe nicht bearbeiten.");

  const body = await readJson(request);
  const subj = await resolveSubject(env, classInfo.id, body, { subject: row.subject, subjectId: row.subject_id });
  const kind = "kind" in body ? cleanKind(body.kind) : kindOf(row);
  // Fach geändert? Dann muss auch das neue Fach zu den eigenen gehören (Eintragende mit Fach-Liste).
  if (!row.owner_member_id && ("subjectId" in body || "subject" in body) && !maySubject(member, subj.subjectId)) {
    throw new ApiError(403, "Du darfst nur in deinen Fächern eintragen – dieses Fach gehört nicht dazu.");
  }
  const next = {
    subject: subj.subject,
    subjectId: subj.subjectId,
    kind,
    title: "title" in body ? cleanText(body.title, "title", { required: NEEDS_TITLE.has(kind) }) : row.title,
    details: "details" in body ? cleanText(body.details, "details") : row.details,
    dueDate: "dueDate" in body ? cleanDate(body.dueDate) : row.due_date,
  };
  if (kind === "homework" && !next.title) throw new ApiError(400, "Bitte eintragen, was zu tun ist.");
  if (kind === "other" && !next.title) throw new ApiError(400, "Bitte eintragen, was für ein Termin es ist.");
  const now = Date.now();
  const stored = dbKind(kind);
  await env.DB.prepare(
    `UPDATE tasks SET subject = ?, subject_id = ?, kind = ?, other_event = ?, title = ?, details = ?, due_date = ?,
                      updated_by = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL`
  ).bind(next.subject, next.subjectId, stored.kind, stored.other, next.title, next.details, next.dueDate, member.id, now, id).run();
  await touchClass(env, classInfo.id, now);

  const updated = await loadVisibleTask(env, member, classInfo.id, id);
  return json({ task: toTask(updated, member) });
}

export async function deleteTask(request, env, { id }) {
  const { member, classInfo } = await requireMember(request, env);
  const row = await loadVisibleTask(env, member, classInfo.id, id);
  if (!rights(row, member).canDelete) {
    throw new ApiError(403, member.role === "editor"
      ? "Eintragende dürfen nur eigene Aufgaben löschen."
      : "Du darfst diese Aufgabe nicht löschen.");
  }
  const now = Date.now();
  const following = new URL(request.url).searchParams.get("following") === "1" && row.series_id;
  if (following) {
    // Diesen und alle späteren Einträge derselben Reihe (gleiche Person hat sie zusammen angelegt).
    const res = await env.DB.prepare(
      `UPDATE tasks SET deleted_at = ?1, deleted_by = ?2
        WHERE series_id = ?3 AND class_id = ?4 AND due_date >= ?5 AND deleted_at IS NULL
          AND created_by = ?6 AND COALESCE(owner_member_id, '') = COALESCE(?7, '')`
    ).bind(now, member.id, row.series_id, classInfo.id, row.due_date, row.created_by, row.owner_member_id).run();
    await touchClass(env, classInfo.id, now);
    return json({ ok: true, deleted: res.meta.changes });
  }
  await env.DB.prepare(
    "UPDATE tasks SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL"
  ).bind(now, member.id, id).run();
  await touchClass(env, classInfo.id, now);
  return json({ ok: true, deleted: 1 });
}

export async function setTaskState(request, env, { id }) {
  const { member, classInfo } = await requireMember(request, env);
  const row = await loadVisibleTask(env, member, classInfo.id, id);
  const body = await readJson(request);

  let status = row.status || "open";
  if ("status" in body) {
    if (body.status !== "open" && body.status !== "done") throw new ApiError(400, "Ungültiger Status.");
    status = body.status;
  }
  const note = "note" in body ? cleanText(body.note, "note") : row.note || "";

  await env.DB.prepare(
    `INSERT INTO task_states (task_id, member_id, status, note, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (task_id, member_id) DO UPDATE SET status = excluded.status, note = excluded.note,
                                                    updated_at = excluded.updated_at`
  ).bind(id, member.id, status, note, Date.now()).run();
  return json({ status, note });
}

// ---------- Zuletzt gelöscht (nur Admins) ----------

const RESTORE_DAYS = 30;
// Was der Betreiber nach einer Meldung ausgeblendet hat, bleibt weg – Admins können das nicht rückgängig machen.
const RESTORABLE = `t.class_id = ?1 AND t.owner_member_id IS NULL AND t.deleted_at IS NOT NULL AND t.deleted_at > ?2
  AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.task_id = t.id AND r.status IN ('op_hidden', 'op_warned'))`;

export async function listDeletedTasks(request, env) {
  const { classInfo } = await requireAdmin(request, env);
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.subject, t.kind, t.other_event, t.title, t.details, t.due_date, t.deleted_at, db.name AS deleted_by_name
       FROM tasks t LEFT JOIN members db ON db.id = t.deleted_by
      WHERE ${RESTORABLE}
      ORDER BY t.deleted_at DESC LIMIT 100`
  ).bind(classInfo.id, Date.now() - RESTORE_DAYS * 24 * 60 * 60 * 1000).all();
  return json({
    days: RESTORE_DAYS,
    tasks: results.map((r) => ({
      id: r.id, subject: r.subject, kind: kindOf(r), title: r.title, details: r.details,
      dueDate: r.due_date, deletedAt: r.deleted_at, deletedBy: r.deleted_by_name || "",
    })),
  });
}

export async function restoreTask(request, env, { id }) {
  const { classInfo } = await requireAdmin(request, env);
  const now = Date.now();
  const res = await env.DB.prepare(
    `UPDATE tasks SET deleted_at = NULL, deleted_by = NULL
      WHERE id = ?3 AND id IN (SELECT t.id FROM tasks t WHERE ${RESTORABLE})`
  ).bind(classInfo.id, now - RESTORE_DAYS * 24 * 60 * 60 * 1000, id).run();
  if (res.meta.changes !== 1) throw new ApiError(404, "Dieser Eintrag lässt sich nicht mehr wiederherstellen.");
  await touchClass(env, classInfo.id, now);
  return json({ ok: true });
}
