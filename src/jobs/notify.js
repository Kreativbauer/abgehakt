// Benachrichtigungen verschicken (Cron Trigger alle 5 Minuten, siehe wrangler.jsonc):
//   0. Warteschlange des Betreibers (operator_push_outbox: Idee/Fehler, abgelehnte Meldung, neue Klasse)
//   1. Warteschlange der Klassen (push_outbox: neuer Eintrag, neue Meldung für Admins)
//   2. Erinnerung am Vorabend zur gewählten Uhrzeit (deutsche Zeit): was für morgen noch offen ist,
//      dazu Termine morgen und in 3 Tagen
//
// Pro Lauf höchstens MAX_SENDS Benachrichtigungen – der kostenlose Cloudflare-Tarif erlaubt pro Lauf
// höchstens 50 ausgehende Anfragen und wenig Rechenzeit. Was nicht drankommt, folgt im nächsten Lauf.
import {
  deleteOperatorOutboxStmt, deleteOperatorPushStmts, deleteOutboxStmt, deletePushSubscriptionStmts,
  deleteStaleOperatorOutboxStmt, deleteStaleOutboxStmt,
} from "../lib/purge.js";
import { pushConfigured, sendPush } from "../lib/webpush.js";
import { taskLabel } from "../api/push.js";

const MAX_SENDS = 15;
const OUTBOX_MAX_AGE = 24 * 60 * 60 * 1000;   // nicht verschickte „Neu“-Nachrichten nach 1 Tag verwerfen
const LATE_HOURS = 3;                          // Erinnerung höchstens 3 Stunden nach der gewählten Uhrzeit

/** Datum und Stunde in Deutschland. */
export function berlinNow(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function plural(n, one, many) {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/** Wahlfach-Filter wie in der App: Aufgaben aus nicht gewählten Wahlfächern zählen nicht. */
function visibleFor(sub) {
  const chosen = sub.electives_chosen_at ? new Set(JSON.parse(sub.elective_ids || "[]")) : null;
  return (t) => !(t.elective && !t.archived && chosen && !chosen.has(t.subject_id));
}

async function deliver(env, sub, message, stats, removeStmts = deletePushSubscriptionStmts) {
  const status = await sendPush(env, sub, message);
  if (status === 404 || status === 410) {
    await env.DB.batch(removeStmts(env, sub.id)); // Gerät ist beim Push-Dienst abgemeldet
    stats.gone++;
  } else if (status >= 200 && status < 300) {
    stats.sent++;
  } else {
    stats.failed++;
  }
}

async function sendOperatorOutbox(env, now, budget, stats) {
  await deleteStaleOperatorOutboxStmt(env, now - OUTBOX_MAX_AGE).run();
  const { results } = await env.DB.prepare(
    `SELECT o.id AS outbox_id, o.payload, s.id, s.endpoint, s.p256dh, s.auth
       FROM operator_push_outbox o JOIN operator_push_subscriptions s ON s.id = o.subscription_id
      ORDER BY o.created_at LIMIT ?`
  ).bind(budget).all();
  for (const row of results) {
    await deleteOperatorOutboxStmt(env, row.outbox_id).run();
    await deliver(env, row, JSON.parse(row.payload), stats, deleteOperatorPushStmts);
  }
  return results.length;
}

async function sendOutbox(env, now, budget, stats) {
  await deleteStaleOutboxStmt(env, now - OUTBOX_MAX_AGE).run();
  const { results } = await env.DB.prepare(
    `SELECT o.id AS outbox_id, o.payload, s.id, s.endpoint, s.p256dh, s.auth
       FROM push_outbox o JOIN push_subscriptions s ON s.id = o.subscription_id
      ORDER BY o.created_at LIMIT ?`
  ).bind(budget).all();
  for (const row of results) {
    await deleteOutboxStmt(env, row.outbox_id).run();
    await deliver(env, row, JSON.parse(row.payload), stats);
  }
  return results.length;
}

async function reminderMessage(env, sub, today) {
  const tomorrow = addDays(today, 1);
  const in3 = addDays(today, 3);
  const { results } = await env.DB.prepare(
    `SELECT CASE WHEN t.other_event = 1 THEN 'other' ELSE t.kind END AS kind, t.title, t.due_date, t.subject_id, COALESCE(sj.name, t.subject) AS subject,
            COALESCE(sj.elective, 0) AS elective, sj.archived_at IS NOT NULL AS archived, ts.status
       FROM tasks t
       LEFT JOIN subjects sj ON sj.id = t.subject_id
       LEFT JOIN task_states ts ON ts.task_id = t.id AND ts.member_id = ?1
      WHERE t.class_id = ?2 AND t.deleted_at IS NULL
        AND (t.owner_member_id IS NULL OR t.owner_member_id = ?1)
        AND t.due_date IN (?3, ?4)
      ORDER BY t.subject`
  ).bind(sub.member_id, sub.class_id, tomorrow, in3).all();
  const tasks = results.filter(visibleFor(sub));

  const lines = [];
  if (sub.notify_reminder) {
    const open = tasks.filter((t) => t.kind === "homework" && t.due_date === tomorrow && t.status !== "done");
    if (open.length) {
      const subjects = [...new Set(open.map((t) => t.subject).filter(Boolean))];
      lines.push(`Für morgen noch offen: ${plural(open.length, "Hausaufgabe", "Hausaufgaben")}${subjects.length ? ` (${subjects.join(", ")})` : ""}`);
    }
  }
  if (sub.notify_events) {
    for (const t of tasks.filter((x) => x.kind !== "homework")) {
      const when = t.due_date === tomorrow ? "Morgen" : "In 3 Tagen";
      lines.push(`${when}: ${[taskLabel(t), t.subject].filter(Boolean).join(" ")}`);
    }
  }
  if (!lines.length) return null;
  return { title: sub.class_name, body: lines.join("\n"), tag: `reminder-${today}`, url: "/app/" };
}

async function sendReminders(env, now, budget, stats) {
  const { date, hour } = berlinNow(now);
  const { results } = await env.DB.prepare(
    `SELECT s.*, m.elective_ids, m.electives_chosen_at, c.name AS class_name
       FROM push_subscriptions s
       JOIN members m ON m.id = s.member_id AND m.removed_at IS NULL
       JOIN classes c ON c.id = s.class_id
      WHERE (s.notify_reminder = 1 OR s.notify_events = 1)
        AND s.remind_hour <= ?1 AND ?1 < s.remind_hour + ${LATE_HOURS}
        AND (s.last_reminder_date IS NULL OR s.last_reminder_date != ?2)
      LIMIT ?3`
  ).bind(hour, date, budget).all();
  for (const sub of results) {
    // Erst als erledigt markieren – so gibt es auch bei einem Fehler keine doppelte Erinnerung.
    await env.DB.prepare("UPDATE push_subscriptions SET last_reminder_date = ? WHERE id = ?").bind(date, sub.id).run();
    const message = await reminderMessage(env, sub, date);
    if (message) await deliver(env, sub, message, stats);
    else stats.nothing++;
  }
}

export async function runNotifications(env, now = Date.now()) {
  if (!pushConfigured(env)) return null;
  const stats = { sent: 0, failed: 0, gone: 0, nothing: 0 };
  let used = await sendOperatorOutbox(env, now, MAX_SENDS, stats);
  if (used < MAX_SENDS) used += await sendOutbox(env, now, MAX_SENDS - used, stats);
  if (used < MAX_SENDS) await sendReminders(env, now, MAX_SENDS - used, stats);
  if (stats.sent || stats.failed || stats.gone) console.log(`[Benachrichtigungen] ${JSON.stringify(stats)}`);
  return stats;
}
