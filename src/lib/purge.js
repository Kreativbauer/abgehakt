// Endgültiges Löschen – nur dort, wo das Konzept es als Funktion vorsieht (siehe CLAUDE.md, Regel 2):
//   - Person verlässt die Klasse oder wird entfernt (auch durch den Betreiber auf Wunsch der Eltern) → persönliche
//     Daten löschen, Name anonymisieren; ein nicht mehr gebrauchtes Admin-Konto gleich mit
//   - Klasse löschen (Admin, Not-Werkzeug des Betreibers, später: 12 Monate ohne Aktivität)
//   - Benachrichtigungen ausschalten / Empfangsadresse ungültig; verschickte Benachrichtigungen aus der Warteschlange
//     (auch die des Betreibers auf /betrieb)

export const FORMER_MEMBER_NAME = "Ehemaliges Mitglied";

/**
 * Anweisungen, um eine Person aus der Klasse zu nehmen:
 * Zugang weg (Geräte, offene persönliche Codes), Häkchen, Notizen und private Aufgaben gelöscht,
 * Name durch „Ehemaliges Mitglied“ ersetzt. Klassen-Aufgaben, die sie eingetragen hat, bleiben
 * (zeigen dann „zuletzt geändert von Ehemaliges Mitglied“).
 */
export function removeMemberStmts(env, memberId, now) {
  return [
    env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL").bind(now, memberId),
    env.DB.prepare(
      "UPDATE join_codes SET revoked_at = ? WHERE member_id = ? AND kind = 'personal' AND revoked_at IS NULL"
    ).bind(now, memberId),
    // Benachrichtigungen dieser Person (Warteschlange zuerst).
    env.DB.prepare(
      "DELETE FROM push_outbox WHERE subscription_id IN (SELECT id FROM push_subscriptions WHERE member_id = ?)"
    ).bind(memberId),
    env.DB.prepare("DELETE FROM push_subscriptions WHERE member_id = ?").bind(memberId),
    // Eigener Status und eigene Notizen (auch zu Klassen-Aufgaben).
    env.DB.prepare("DELETE FROM task_states WHERE member_id = ?").bind(memberId),
    // Private Aufgaben – deren Status/Notizen gehörten nur dieser Person und sind oben schon weg.
    env.DB.prepare("DELETE FROM tasks WHERE owner_member_id = ?").bind(memberId),
    env.DB.prepare(
      `UPDATE members SET removed_at = ?, name = ?, account_id = NULL,
              status_visibility = 'none', status_viewers = '[]', elective_ids = '[]',
              electives_chosen_at = NULL, editor_subject_ids = '[]'
        WHERE id = ? AND removed_at IS NULL`
    ).bind(now, FORMER_MEMBER_NAME, memberId),
  ];
}

/**
 * Gerätewechsel mit einem persönlichen Code, den ein Admin erzeugt hat: alle bisherigen Geräte der Person abmelden
 * (außer dem neuen) und ihre Benachrichtigungs-Abos löschen – sonst bekämen die alten Geräte weiter Nachrichten.
 * Nur wenn das neue Gerät wirklich angelegt wurde (EXISTS), damit niemand ohne Gerät dasteht.
 */
export function replaceDevicesStmts(env, memberId, newTokenHash, now) {
  const created = "EXISTS (SELECT 1 FROM devices WHERE token_hash = ?2 AND member_id = ?1)";
  return [
    env.DB.prepare(
      `UPDATE devices SET revoked_at = ?3 WHERE member_id = ?1 AND token_hash != ?2 AND revoked_at IS NULL AND ${created}`
    ).bind(memberId, newTokenHash, now),
    env.DB.prepare(
      `DELETE FROM push_outbox WHERE subscription_id IN (SELECT id FROM push_subscriptions WHERE member_id = ?1) AND ${created}`
    ).bind(memberId, newTokenHash),
    env.DB.prepare(`DELETE FROM push_subscriptions WHERE member_id = ?1 AND ${created}`).bind(memberId, newTokenHash),
  ];
}

/**
 * Löscht eine Klasse mit allem, was dazugehört. Gibt die Anzahl gelöschter Einträge zurück
 * (keine Inhalte – der Betreiber sieht nichts davon).
 */
export async function purgeClass(env, classId) {
  const exists = await env.DB.prepare("SELECT 1 FROM classes WHERE id = ?").bind(classId).first();
  if (!exists) return null;

  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM members WHERE class_id = ?1) AS members,
            (SELECT COUNT(*) FROM tasks WHERE class_id = ?1) AS tasks`
  ).bind(classId).first();

  const memberIds = "SELECT id FROM members WHERE class_id = ?";
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reports WHERE class_id = ?").bind(classId),
    env.DB.prepare(
      "DELETE FROM push_outbox WHERE subscription_id IN (SELECT id FROM push_subscriptions WHERE class_id = ?)"
    ).bind(classId),
    env.DB.prepare("DELETE FROM push_subscriptions WHERE class_id = ?").bind(classId),
    env.DB.prepare(`DELETE FROM task_states WHERE task_id IN (SELECT id FROM tasks WHERE class_id = ?)`).bind(classId),
    env.DB.prepare(`DELETE FROM task_states WHERE member_id IN (${memberIds})`).bind(classId),
    env.DB.prepare("DELETE FROM tasks WHERE class_id = ?").bind(classId),
    env.DB.prepare("DELETE FROM subjects WHERE class_id = ?").bind(classId),
    env.DB.prepare("DELETE FROM join_codes WHERE class_id = ?").bind(classId),
    env.DB.prepare(`DELETE FROM devices WHERE member_id IN (${memberIds})`).bind(classId),
    env.DB.prepare("DELETE FROM members WHERE class_id = ?").bind(classId),
    env.DB.prepare("DELETE FROM classes WHERE id = ?").bind(classId),
  ]);
  return { classes: 1, members: counts.members, tasks: counts.tasks };
}

/** Ein Benachrichtigungs-Abo löschen (ausgeschaltet oder vom Push-Dienst als ungültig gemeldet). */
export function deletePushSubscriptionStmts(env, subscriptionId) {
  return [
    env.DB.prepare("DELETE FROM push_outbox WHERE subscription_id = ?").bind(subscriptionId),
    env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(subscriptionId),
  ];
}

/** Verschickte (oder zu alte) Benachrichtigungen aus der Warteschlange entfernen. */
export function deleteOutboxStmt(env, outboxId) {
  return env.DB.prepare("DELETE FROM push_outbox WHERE id = ?").bind(outboxId);
}

export function deleteStaleOutboxStmt(env, before) {
  return env.DB.prepare("DELETE FROM push_outbox WHERE created_at < ?").bind(before);
}

/** Benachrichtigungen des Betreibers (/betrieb): Gerät ausgeschaltet oder vom Push-Dienst abgemeldet. */
export function deleteOperatorPushStmts(env, subscriptionId) {
  return [
    env.DB.prepare("DELETE FROM operator_push_outbox WHERE subscription_id = ?").bind(subscriptionId),
    env.DB.prepare("DELETE FROM operator_push_subscriptions WHERE id = ?").bind(subscriptionId),
  ];
}

export function deleteOperatorOutboxStmt(env, outboxId) {
  return env.DB.prepare("DELETE FROM operator_push_outbox WHERE id = ?").bind(outboxId);
}

export function deleteStaleOperatorOutboxStmt(env, before) {
  return env.DB.prepare("DELETE FROM operator_push_outbox WHERE created_at < ?").bind(before);
}

/**
 * Admin-Konto löschen, wenn es in keiner Klasse mehr gebraucht wird (z. B. nach „Person entfernen“ durch den
 * Betreiber auf Wunsch der Eltern). Ist das Konto noch irgendwo Admin, passiert nichts.
 */
export function deleteUnusedAccountStmts(env, accountId) {
  const unused = "NOT EXISTS (SELECT 1 FROM members m WHERE m.account_id = ?1 AND m.removed_at IS NULL)";
  return [
    env.DB.prepare(`DELETE FROM account_sessions WHERE account_id = ?1 AND ${unused}`).bind(accountId),
    env.DB.prepare(`UPDATE members SET account_id = NULL WHERE account_id = ?1 AND ${unused}`).bind(accountId),
    env.DB.prepare(`DELETE FROM login_codes WHERE email = (SELECT email FROM accounts WHERE id = ?1) AND ${unused}`).bind(accountId),
    env.DB.prepare(`DELETE FROM accounts WHERE id = ?1 AND ${unused}`).bind(accountId),
  ];
}
