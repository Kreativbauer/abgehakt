// Benachrichtigungen (Web Push) – jede Person schaltet sie pro Klasse und Gerät selbst ein.
//   GET  /api/push/key                         öffentlicher Schlüssel für die App (null = nicht eingerichtet)
//   PUT  /api/push/subscription                einschalten bzw. Einstellungen speichern
//        { endpoint, keys: { p256dh, auth }, remindHour, reminder, events, newEntries, reports }
//   POST /api/push/subscription/status { endpoint }   Einstellungen dieses Geräts (oder null)
//   POST /api/push/subscription/delete { endpoint }   ausschalten
//   POST /api/push/test { endpoint }                  Test-Benachrichtigung an dieses Gerät
//
// Neue Einträge (enqueueNewTask) und neue Meldungen für Admins (enqueueReportForAdmins) landen in der
// Warteschlange push_outbox; verschickt wird alle
// 5 Minuten in kleinen Paketen (src/jobs/notify.js) – der kostenlose Cloudflare-Tarif erlaubt pro Lauf
// nur wenig Rechenzeit und höchstens 50 ausgehende Anfragen.
import { ApiError, json, readJson } from "../lib/http.js";
import { requireMember } from "../lib/auth.js";
import { newId } from "../lib/crypto.js";
import { deletePushSubscriptionStmts } from "../lib/purge.js";
import { isAllowedEndpoint, pushConfigured, sendPush, unb64url } from "../lib/webpush.js";

const MAX_SUBSCRIPTIONS_PER_MEMBER = 5;
const MAX_RECIPIENTS = 200;

const KIND_LABELS = {
  exam: "Schulaufgabe",
  short_exam: "Kurzarbeit",
  test: "Test / Abfrage",
  presentation: "Referat / Abgabe",
};
const DATE_SHORT = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" });

export function formatDay(date) {
  return DATE_SHORT.format(new Date(`${date}T12:00:00Z`));
}

/** Bezeichnung eines Eintrags wie in der App: Hausaufgabe = Text, Termin = Art (+ Text). */
export function taskLabel(task) {
  if (!task.kind || task.kind === "homework") return task.title;
  if (task.kind === "other") return task.title || "Termin"; // sonstiger Termin: der Text sagt, was es ist
  const kind = KIND_LABELS[task.kind] || "Termin";
  return task.title ? `${kind} · ${task.title}` : kind;
}

export function cleanEndpoint(value) {
  if (typeof value !== "string" || value.length > 1000 || !isAllowedEndpoint(value)) {
    throw new ApiError(400, "Dieser Browser wird für Benachrichtigungen leider nicht unterstützt.");
  }
  return value;
}

export function cleanKey(value, bytes) {
  if (typeof value !== "string" || value.length > 200) throw new ApiError(400, "Ungültige Anfrage.");
  let raw;
  try { raw = unb64url(value); } catch { throw new ApiError(400, "Ungültige Anfrage."); }
  if (raw.length !== bytes) throw new ApiError(400, "Ungültige Anfrage.");
  return value;
}

export const flag = (v, fallback) => (typeof v === "boolean" ? (v ? 1 : 0) : fallback);

function toSettings(row) {
  return {
    remindHour: row.remind_hour,
    reminder: Boolean(row.notify_reminder),
    events: Boolean(row.notify_events),
    newEntries: Boolean(row.notify_new),
    reports: Boolean(row.notify_reports),
  };
}

async function findSubscription(env, memberId, endpoint) {
  return env.DB.prepare("SELECT * FROM push_subscriptions WHERE member_id = ? AND endpoint = ?").bind(memberId, endpoint).first();
}

export async function pushKey(request, env) {
  await requireMember(request, env);
  return json({ publicKey: pushConfigured(env) ? String(env.VAPID_PUBLIC_KEY).trim() : null });
}

export async function saveSubscription(request, env) {
  const { member, classInfo } = await requireMember(request, env);
  if (!pushConfigured(env)) throw new ApiError(503, "Benachrichtigungen sind noch nicht eingerichtet.");
  const body = await readJson(request);
  const endpoint = cleanEndpoint(body.endpoint);
  const p256dh = cleanKey(body.keys?.p256dh, 65);
  const auth = cleanKey(body.keys?.auth, 16);
  const hour = Number.isInteger(body.remindHour) && body.remindHour >= 14 && body.remindHour <= 22 ? body.remindHour : null;
  const now = Date.now();

  const existing = await findSubscription(env, member.id, endpoint);
  if (existing) {
    await env.DB.prepare(
      `UPDATE push_subscriptions SET p256dh = ?, auth = ?, remind_hour = ?, notify_reminder = ?, notify_events = ?,
              notify_new = ?, notify_reports = ?, updated_at = ? WHERE id = ?`
    ).bind(p256dh, auth, hour ?? existing.remind_hour, flag(body.reminder, existing.notify_reminder),
      flag(body.events, existing.notify_events), flag(body.newEntries, existing.notify_new),
      flag(body.reports, existing.notify_reports), now, existing.id).run();
  } else {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE member_id = ?").bind(member.id).first();
    if (count.n >= MAX_SUBSCRIPTIONS_PER_MEMBER) {
      throw new ApiError(429, `Benachrichtigungen gehen auf höchstens ${MAX_SUBSCRIPTIONS_PER_MEMBER} Geräten. Schalte sie auf einem alten Gerät aus.`);
    }
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (id, member_id, class_id, endpoint, p256dh, auth, remind_hour,
                                       notify_reminder, notify_events, notify_new, notify_reports, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newId(), member.id, classInfo.id, endpoint, p256dh, auth, hour ?? 18,
      flag(body.reminder, 1), flag(body.events, 1), flag(body.newEntries, 0), flag(body.reports, 1), // „Neu“ nur auf Wunsch
      now, now).run();
  }
  const row = await findSubscription(env, member.id, endpoint);
  return json({ subscription: toSettings(row) });
}

export async function subscriptionStatus(request, env) {
  const { member } = await requireMember(request, env);
  const body = await readJson(request);
  if (typeof body.endpoint !== "string") return json({ subscription: null });
  const row = await findSubscription(env, member.id, body.endpoint);
  return json({ subscription: row ? toSettings(row) : null });
}

export async function deleteSubscription(request, env) {
  const { member } = await requireMember(request, env);
  const body = await readJson(request);
  if (typeof body.endpoint === "string") {
    const row = await findSubscription(env, member.id, body.endpoint);
    if (row) await env.DB.batch(deletePushSubscriptionStmts(env, row.id));
  }
  return json({ ok: true });
}

export async function testPush(request, env) {
  const { member, classInfo } = await requireMember(request, env);
  const body = await readJson(request);
  const row = typeof body.endpoint === "string" ? await findSubscription(env, member.id, body.endpoint) : null;
  if (!row) throw new ApiError(404, "Benachrichtigungen sind auf diesem Gerät nicht eingeschaltet.");
  const status = await sendPush(env, row, {
    title: classInfo.name,
    body: "So sehen Benachrichtigungen von Abgehakt aus.",
    tag: "test",
    url: "/app/",
  });
  if (status === 404 || status === 410) {
    await env.DB.batch(deletePushSubscriptionStmts(env, row.id));
    throw new ApiError(410, "Dieses Gerät ist beim Push-Dienst nicht mehr angemeldet. Bitte Benachrichtigungen neu einschalten.");
  }
  if (status < 200 || status >= 300) throw new ApiError(502, "Der Push-Dienst hat die Benachrichtigung gerade nicht angenommen.");
  return json({ ok: true });
}

/**
 * Neuer Klassen-Eintrag → Benachrichtigung für alle anderen in der Klasse, die „Neue Einträge“ an haben.
 * Wahlfächer werden beachtet (wer das Wahlfach nicht gewählt hat, bekommt nichts).
 */
export async function enqueueNewTask(env, classInfo, member, task) {
  if (!pushConfigured(env)) return;
  const subject = task.subjectId
    ? await env.DB.prepare("SELECT name, elective, archived_at FROM subjects WHERE id = ?").bind(task.subjectId).first()
    : null;
  const elective = Boolean(subject && subject.elective && !subject.archived_at);
  const isEvent = task.kind && task.kind !== "homework";
  const prefix = task.subject ? `Neu in ${task.subject}` : "Neu";
  const payload = JSON.stringify({
    title: classInfo.name,
    body: `${prefix}: ${taskLabel(task)} – ${isEvent ? "am" : "bis"} ${formatDay(task.dueDate)}`
      + (task.every ? ({ 1: ", jede Woche", 2: ", alle 2 Wochen", lessons: ", jede Stunde" })[task.every] || "" : ""),
    tag: `task-${task.id}`,
    url: "/app/",
  });
  await env.DB.prepare(
    `INSERT INTO push_outbox (id, subscription_id, payload, created_at)
     SELECT lower(hex(randomblob(16))), s.id, ?1, ?2
       FROM push_subscriptions s JOIN members m ON m.id = s.member_id
      WHERE s.class_id = ?3 AND s.notify_new = 1 AND s.member_id != ?4 AND m.removed_at IS NULL
        AND (?5 = 0 OR m.electives_chosen_at IS NULL
             OR EXISTS (SELECT 1 FROM json_each(m.elective_ids) WHERE value = ?6))
      LIMIT ${MAX_RECIPIENTS}`
  ).bind(payload, Date.now(), classInfo.id, member.id, elective ? 1 : 0, task.subjectId || "").run();
}

/**
 * Neue Meldung → Benachrichtigung an die Admins der Klasse (Schalter „Meldungen“). Ohne Inhalt des Eintrags –
 * den sehen Admins in der App. Wer gemeldet hat, steht nirgends; die meldende Person selbst bekommt nichts.
 */
export async function enqueueReportForAdmins(env, classInfo, reporterId) {
  if (!pushConfigured(env)) return;
  const payload = JSON.stringify({
    title: classInfo.name,
    body: "Ein Eintrag wurde gemeldet. Bitte unter „Mitglieder → Meldungen“ ansehen.",
    tag: `reports-${classInfo.id}`, // mehrere Meldungen kurz hintereinander → nur eine Benachrichtigung
    url: "/app/",
  });
  await env.DB.prepare(
    `INSERT INTO push_outbox (id, subscription_id, payload, created_at)
     SELECT lower(hex(randomblob(16))), s.id, ?1, ?2
       FROM push_subscriptions s JOIN members m ON m.id = s.member_id
      WHERE s.class_id = ?3 AND s.notify_reports = 1 AND s.member_id != ?4
        AND m.role = 'admin' AND m.removed_at IS NULL
      LIMIT ${MAX_RECIPIENTS}`
  ).bind(payload, Date.now(), classInfo.id, reporterId).run();
}
