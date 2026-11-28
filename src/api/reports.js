// Meldungen: Mitglieder melden Klassen-Aufgaben, erst die Admins der Klasse prüfen,
// der Betreiber sieht offene und von Admins als „in Ordnung“ markierte Meldungen – immer nur den gemeldeten Eintrag.
//   POST /api/tasks/:id/report   { reason, comment }   Mitglied meldet eine Klassen-Aufgabe
//   GET  /api/reports                                  offene Meldungen der Klasse (Admin)
//   POST /api/reports/:id        { action }            Admin: "hide" (Eintrag entfernen) | "dismiss"
import { ApiError, json, readJson } from "../lib/http.js";
import { newId } from "../lib/crypto.js";
import { requireAdmin, requireMember } from "../lib/auth.js";
import { KIND_LABELS, kindOf } from "./tasks.js";
import { enqueueReportForAdmins } from "./push.js";
import { enqueueOperator } from "./operator-push.js";

export const REASONS = {
  beleidigend: "Beleidigend oder Mobbing",
  rechtswidrig: "Rechtswidrig",
  spam: "Spam oder Unsinn",
  sonstiges: "Sonstiges",
};
const MAX_REPORTS_PER_DAY = 10;

function cleanComment(v) {
  const text = typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  if ([...text].length > 500) throw new ApiError(400, "Die Begründung darf höchstens 500 Zeichen haben.");
  return text;
}

export function toReport(r) {
  return {
    id: r.id,
    reason: r.reason,
    reasonLabel: REASONS[r.reason] || r.reason,
    comment: r.comment,
    subject: r.snapshot_subject,
    title: r.snapshot_title,
    details: r.snapshot_details,
    author: r.snapshot_author,
    createdAt: r.created_at,
    status: r.status,
  };
}

export async function reportTask(request, env, { id }) {
  const { member, classInfo } = await requireMember(request, env);
  const body = await readJson(request);
  if (typeof body.reason !== "string" || !Object.hasOwn(REASONS, body.reason)) throw new ApiError(400, "Bitte einen Grund auswählen.");
  const comment = cleanComment(body.comment);

  const task = await env.DB.prepare(
    `SELECT t.id, t.subject, t.kind, t.other_event, t.title, t.details, ub.name AS author
       FROM tasks t LEFT JOIN members ub ON ub.id = t.updated_by
      WHERE t.id = ? AND t.class_id = ? AND t.owner_member_id IS NULL AND t.deleted_at IS NULL`
  ).bind(id, classInfo.id).first();
  if (!task) throw new ApiError(404, "Diese Aufgabe gibt es nicht mehr.");

  const now = Date.now();
  const dup = await env.DB.prepare(
    "SELECT 1 FROM reports WHERE task_id = ? AND reporter_member_id = ? AND status = 'open'"
  ).bind(id, member.id).first();
  if (dup) throw new ApiError(409, "Du hast diese Aufgabe schon gemeldet.");
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM reports WHERE reporter_member_id = ? AND created_at > ?"
  ).bind(member.id, now - 24 * 60 * 60 * 1000).first();
  if (recent.n >= MAX_REPORTS_PER_DAY) throw new ApiError(429, "Du hast heute schon viele Meldungen geschickt. Weitere gehen morgen wieder.");

  await env.DB.prepare(
    `INSERT INTO reports (id, class_id, task_id, reporter_member_id, reason, comment,
                          snapshot_subject, snapshot_title, snapshot_details, snapshot_author, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(newId(), classInfo.id, id, member.id, body.reason, comment,
    // Termine haben oft keinen Text – dann die Art als Bezeichnung (z. B. „Schulaufgabe“).
    task.subject, task.title || (kindOf(task) !== "homework" ? KIND_LABELS[kindOf(task)] : ""),
    task.details, task.author || "", now).run();
  try {
    await enqueueReportForAdmins(env, classInfo, member.id);
  } catch (err) {
    console.error("Meldung: Benachrichtigung nicht eingereiht:", err.message);
  }
  return json({ ok: true }, 201);
}

export async function listReports(request, env) {
  const { classInfo } = await requireAdmin(request, env);
  const { results } = await env.DB.prepare(
    "SELECT * FROM reports WHERE class_id = ? AND status = 'open' ORDER BY created_at"
  ).bind(classInfo.id).all();
  return json({ reports: results.map(toReport) });
}

/** Ausblenden einer gemeldeten Aufgabe + alle offenen Meldungen dazu schließen. */
export function hideReportedTaskStmts(env, report, deletedBy, status, now) {
  return [
    env.DB.prepare("UPDATE tasks SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(now, deletedBy, report.task_id),
    env.DB.prepare(
      `UPDATE reports SET status = ?, resolved_at = ?
        WHERE task_id = ? AND status IN ('open', 'admin_dismissed')`
    ).bind(status, now, report.task_id),
  ];
}

export async function resolveReport(request, env, { id }) {
  const { member, classInfo } = await requireAdmin(request, env);
  const action = (await readJson(request)).action;
  const report = await env.DB.prepare(
    "SELECT * FROM reports WHERE id = ? AND class_id = ? AND status = 'open'"
  ).bind(id, classInfo.id).first();
  if (!report) throw new ApiError(404, "Diese Meldung ist schon erledigt.");
  const now = Date.now();

  if (action === "hide") {
    await env.DB.batch(hideReportedTaskStmts(env, report, member.id, "admin_hidden", now));
  } else if (action === "dismiss") {
    // Abgelehnte Meldungen landen beim Betreiber – damit Admins nichts unter den Teppich kehren können.
    await env.DB.prepare("UPDATE reports SET status = 'admin_dismissed', resolved_at = ? WHERE id = ?")
      .bind(now, id).run();
    await enqueueOperator(env, "reports", "Admins halten einen gemeldeten Eintrag für in Ordnung – bitte prüfen.");
  } else {
    throw new ApiError(400, "Ungültige Aktion.");
  }
  return json({ ok: true });
}
