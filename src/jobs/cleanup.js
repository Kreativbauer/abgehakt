// Täglicher Lauf (Cron Trigger, siehe wrangler.jsonc):
//   1. Klassen löschen, die 12 Monate inaktiv sind und deren Admins mindestens 30 Tage vorher gewarnt wurden
//   2. Admins von Klassen warnen, die seit 11 Monaten inaktiv sind
//   3. Aufräumen: erledigte Meldungen und Feedback (6 Monate), abgelaufene Anmeldecodes, Admin-Konten ohne Klasse
//
// „Aktiv“ = irgendjemand hat die Klasse benutzt (classes.last_active_at, siehe src/lib/auth.js).
// Wird eine gewarnte Klasse wieder benutzt, ist last_active_at > deletion_warned_at → Warnung hinfällig.
import { ACCOUNT_SESSION_MAX_IDLE_MS } from "../lib/auth.js";
import { purgeClass } from "../lib/purge.js";
import { sendDeletionWarning } from "../lib/email.js";

const DAY = 24 * 60 * 60 * 1000;
export const DELETE_AFTER = 365 * DAY;      // 12 Monate ohne Aktivität
export const WARN_BEFORE = 30 * DAY;        // Warnung mindestens 30 Tage vorher
const MAX_PER_RUN = 40;                     // Resend kostenlos: 100 E-Mails/Tag

export async function runDailyCleanup(env, now = Date.now()) {
  const summary = { deleted: 0, warned: 0, emails: 0, emailErrors: 0, reports: 0, feedback: 0, loginCodes: 0, accounts: 0 };

  // 1. Löschen
  const { results: toDelete } = await env.DB.prepare(
    `SELECT id FROM classes
      WHERE last_active_at < ?1
        AND deletion_warned_at IS NOT NULL
        AND deletion_warned_at >= last_active_at
        AND deletion_warned_at <= ?2
      LIMIT ${MAX_PER_RUN}`
  ).bind(now - DELETE_AFTER, now - WARN_BEFORE).all();
  for (const c of toDelete) {
    if (await purgeClass(env, c.id)) summary.deleted++;
  }

  // 2. Warnen
  const { results: toWarn } = await env.DB.prepare(
    `SELECT id, name, last_active_at FROM classes
      WHERE last_active_at < ?1
        AND (deletion_warned_at IS NULL OR deletion_warned_at < last_active_at)
      LIMIT ${MAX_PER_RUN}`
  ).bind(now - (DELETE_AFTER - WARN_BEFORE)).all();
  const appUrl = env.APP_URL || "https://abgehakt.nilskaplan8.workers.dev/app/";
  for (const c of toWarn) {
    const { results: admins } = await env.DB.prepare(
      `SELECT DISTINCT a.email FROM members m JOIN accounts a ON a.id = m.account_id
        WHERE m.class_id = ? AND m.role = 'admin' AND m.removed_at IS NULL`
    ).bind(c.id).all();
    const deleteAt = Math.max(c.last_active_at + DELETE_AFTER, now + WARN_BEFORE);
    let sent = 0;
    let retryable = 0;
    for (const a of admins) {
      try {
        await sendDeletionWarning(env, a.email, c.name, deleteAt, appUrl);
        sent++;
      } catch (err) {
        summary.emailErrors++;
        if (err.status !== 502 || !/Testbetrieb/.test(err.message)) retryable++;
      }
    }
    summary.emails += sent;
    // Nur wenn der Versand vorübergehend komplett fehlschlug: morgen erneut versuchen.
    if (admins.length && !sent && retryable) continue;
    await env.DB.prepare("UPDATE classes SET deletion_warned_at = ? WHERE id = ?").bind(now, c.id).run();
    summary.warned++;
  }

  // 3. Aufräumen
  // Erledigte Meldungen (samt Kopie des Eintrags) nach 6 Monaten löschen.
  const reports = await env.DB.prepare(
    `DELETE FROM reports WHERE status NOT IN ('open', 'admin_dismissed') AND resolved_at < ?`
  ).bind(now - 182 * DAY).run();
  summary.reports = reports.meta.changes;

  // Feedback: erledigtes nach 6 Monaten, unbearbeitetes spätestens nach 12 Monaten löschen.
  const fb = await env.DB.prepare(
    `DELETE FROM feedback WHERE (status = 'done' AND resolved_at < ?) OR created_at < ?`
  ).bind(now - 182 * DAY, now - DELETE_AFTER).run();
  summary.feedback = fb.meta.changes;

  const codes = await env.DB.prepare("DELETE FROM login_codes WHERE created_at < ?").bind(now - DAY).run();
  summary.loginCodes = codes.meta.changes;

  // Admin-Anmeldungen, die 90 Tage nicht benutzt wurden (gelten dann ohnehin nicht mehr, siehe requireAccount).
  const sessions = await env.DB.prepare("DELETE FROM account_sessions WHERE last_seen_at < ?")
    .bind(now - ACCOUNT_SESSION_MAX_IDLE_MS).run();
  summary.accountSessions = sessions.meta.changes;

  // Begrenzung für Ideen/Fehler: nur 24 Stunden gebraucht.
  const limits = await env.DB.prepare("DELETE FROM feedback_limits WHERE created_at < ?").bind(now - DAY).run();
  summary.feedbackLimits = limits.meta.changes;

  const orphan = `SELECT a.id FROM accounts a
                   WHERE a.last_login_at < ?
                     AND NOT EXISTS (SELECT 1 FROM members m WHERE m.account_id = a.id AND m.removed_at IS NULL)`;
  const cutoff = now - DELETE_AFTER;
  const results = await env.DB.batch([
    env.DB.prepare(`DELETE FROM account_sessions WHERE account_id IN (${orphan})`).bind(cutoff),
    env.DB.prepare(`UPDATE members SET account_id = NULL WHERE account_id IN (${orphan})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM accounts WHERE id IN (${orphan})`).bind(cutoff),
  ]);
  summary.accounts = results[2].meta.changes;

  console.log(`[Täglicher Lauf] ${JSON.stringify(summary)}`);
  return summary;
}
