// Not-Werkzeug des Betreibers: eine Klasse anhand ihrer Kennung (oder eines ihrer Codes)
// vollständig löschen – ohne sie vorher anzusehen. Gibt nur Anzahlen zurück, keine Inhalte.
//   POST /api/operator/delete-class   { target }   Authorization: Bearer <OPERATOR_KEY>
//   POST /api/operator/remove-member  { target, name }   eine Person entfernen (Wunsch der Eltern / der Person):
//        Kennung der Klasse + Name in der Klasse → wie „Klasse verlassen“. Gibt keine Inhalte zurück.
//   GET  /api/operator/reports                       offene und von Admins als „in Ordnung“ markierte Meldungen
//   POST /api/operator/reports/:id    { action }     "dismiss" (= ist in Ordnung) | "hide" | "warn" | "delete_class"
//
// OPERATOR_KEY ist ein Cloudflare-Secret (mindestens 32 Zeichen). Ohne Secret ist das Werkzeug aus.
import { ApiError, json, readJson } from "../lib/http.js";
import { normalizeCode, sha256Hex } from "../lib/crypto.js";
import { deleteUnusedAccountStmts, purgeClass, removeMemberStmts } from "../lib/purge.js";
import { sendReportWarning } from "../lib/email.js";
import { hideReportedTaskStmts, toReport } from "./reports.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function requireOperator(request, env) {
  const key = env.OPERATOR_KEY || "";
  if (key.length < 32) throw new ApiError(404, "Nicht gefunden.");
  const given = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
  // Hashes vergleichen: gleich lang, kein Rückschluss über die Laufzeit.
  const [a, b] = await Promise.all([sha256Hex(`op:${given}`), sha256Hex(`op:${key}`)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (diff !== 0) throw new ApiError(403, "Falscher Betreiber-Schlüssel.");
}

export async function operatorDeleteClass(request, env) {
  await requireOperator(request, env);
  const raw = (await readJson(request)).target;
  const target = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  let classId = null;
  if (UUID.test(target)) {
    classId = target;
  } else {
    const code = normalizeCode(target);
    if (code.length === 8) {
      const row = await env.DB.prepare("SELECT class_id FROM join_codes WHERE code = ?").bind(code).first();
      if (row) classId = row.class_id;
    }
  }
  if (!classId) throw new ApiError(404, "Keine Klasse mit dieser Kennung oder diesem Code gefunden.");

  const result = await purgeClass(env, classId);
  if (!result) throw new ApiError(404, "Keine Klasse mit dieser Kennung oder diesem Code gefunden.");
  console.log(`[Betreiber] Klasse ${classId} gelöscht (${result.members} Personen, ${result.tasks} Aufgaben).`);
  return json({ deleted: result });
}

export async function operatorRemoveMember(request, env) {
  await requireOperator(request, env);
  const body = await readJson(request);
  const classId = typeof body.target === "string" ? body.target.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  if (!UUID.test(classId)) throw new ApiError(400, "Bitte die Kennung der Klasse eingeben (steht in der App unter Einstellungen → Klasse).");
  if (!name) throw new ApiError(400, "Bitte den Namen eingeben, unter dem die Person in der Klasse steht.");

  const { results } = await env.DB.prepare(
    "SELECT id, role, account_id FROM members WHERE class_id = ? AND removed_at IS NULL AND lower(name) = lower(?)"
  ).bind(classId, name).all();
  if (results.length !== 1) throw new ApiError(404, "In dieser Klasse gibt es (noch) keine Person mit genau diesem Namen.");
  const target = results[0];

  await env.DB.batch(removeMemberStmts(env, target.id, Date.now()));
  if (target.account_id) await env.DB.batch(deleteUnusedAccountStmts(env, target.account_id));
  const admins = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM members WHERE class_id = ? AND role = 'admin' AND removed_at IS NULL"
  ).bind(classId).first();
  console.log(`[Betreiber] Person aus Klasse ${classId} entfernt.`);
  let result = "Person entfernt: Zugang weg, Häkchen, Notizen, private Aufgaben und Wahlfächer gelöscht, Name → „Ehemaliges Mitglied“.";
  if (target.account_id) result += " Ihr Admin-Konto (E-Mail) ist gelöscht, falls es sonst nirgends gebraucht wird.";
  if (target.role === "admin" && admins.n === 0) result += " Achtung: Die Klasse hat jetzt keinen Admin mehr.";
  return json({ result });
}

export async function operatorListReports(request, env) {
  await requireOperator(request, env);
  const { results } = await env.DB.prepare(
    `SELECT r.*,
            (SELECT COUNT(*) FROM reports r2 WHERE r2.class_id = r.class_id) AS class_reports,
            (SELECT deleted_at IS NOT NULL FROM tasks t WHERE t.id = r.task_id) AS task_deleted
       FROM reports r
      WHERE r.status IN ('open', 'admin_dismissed')
      ORDER BY r.created_at
      LIMIT 200`
  ).all();
  return json({
    reports: results.map((r) => ({
      ...toReport(r),
      classId: r.class_id,
      classReports: r.class_reports,
      taskDeleted: Boolean(r.task_deleted),
    })),
  });
}

export async function operatorResolveReport(request, env, { id }) {
  await requireOperator(request, env);
  const action = (await readJson(request)).action;
  const report = await env.DB.prepare(
    "SELECT * FROM reports WHERE id = ? AND status IN ('open', 'admin_dismissed')"
  ).bind(id).first();
  if (!report) throw new ApiError(404, "Diese Meldung ist schon erledigt.");
  const now = Date.now();

  if (action === "dismiss") {
    await env.DB.prepare("UPDATE reports SET status = 'op_dismissed', resolved_at = ? WHERE id = ?").bind(now, id).run();
    return json({ result: "Erledigt: Eintrag ist in Ordnung und bleibt stehen." });
  }
  if (action === "hide") {
    await env.DB.batch(hideReportedTaskStmts(env, report, null, "op_hidden", now));
    return json({ result: "Eintrag ausgeblendet." });
  }
  if (action === "warn") {
    const cls = await env.DB.prepare("SELECT name FROM classes WHERE id = ?").bind(report.class_id).first();
    const { results: admins } = await env.DB.prepare(
      `SELECT DISTINCT a.email FROM members m JOIN accounts a ON a.id = m.account_id
        WHERE m.class_id = ? AND m.role = 'admin' AND m.removed_at IS NULL`
    ).bind(report.class_id).all();
    let sent = 0;
    for (const a of admins) {
      try {
        await sendReportWarning(env, a.email, cls ? cls.name : "", report.snapshot_title, env.APP_URL || "");
        sent++;
      } catch (err) {
        console.error("Verwarnung nicht zugestellt:", err.message);
      }
    }
    await env.DB.batch(hideReportedTaskStmts(env, report, null, "op_warned", now));
    return json({ result: `Eintrag ausgeblendet, Verwarnung an ${sent} von ${admins.length} ${admins.length === 1 ? "Admin" : "Admins"} geschickt.` });
  }
  if (action === "delete_class") {
    const res = await purgeClass(env, report.class_id);
    console.log(`[Betreiber] Klasse ${report.class_id} nach Meldung gelöscht.`);
    return json({ result: res ? `Klasse gelöscht (${res.members} Personen, ${res.tasks} Aufgaben).` : "Klasse gab es schon nicht mehr." });
  }
  throw new ApiError(400, "Ungültige Aktion.");
}
