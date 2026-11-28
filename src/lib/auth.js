// Anmeldung über den Geräte-Schlüssel (Authorization: Bearer <schlüssel>).
import { ApiError } from "./http.js";
import { sha256Hex } from "./crypto.js";

function parseIdList(text) {
  try {
    const v = JSON.parse(text || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Darf diese Person für die Klasse im Fach `subjectId` eintragen/bearbeiten? Admins immer; Eintragende ohne
 * Fach-Liste in allen Fächern, mit Liste nur in diesen Fächern (Eintrag ohne Fach dann nicht).
 */
export function maySubject(member, subjectId) {
  if (member.role === "admin") return true;
  if (member.role !== "editor") return false;
  const list = member.editorSubjects || [];
  return list.length === 0 || (Boolean(subjectId) && list.includes(subjectId));
}

/** Eintragende mit Fach-Liste – für sie gelten Einschränkungen (Fächer verwalten, „Kein Fach“). */
export function isRestrictedEditor(member) {
  return member.role === "editor" && (member.editorSubjects || []).length > 0;
}

// last_seen_at höchstens einmal pro Stunde schreiben (spart D1-Schreibzugriffe).
const SEEN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Liefert { member, classInfo, tokenHash } oder wirft 401.
 * Entfernte Personen und abgemeldete Geräte verlieren sofort den Zugang.
 */
export async function requireMember(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer ([A-Za-z0-9_-]{20,100})$/);
  if (!match) throw new ApiError(401, "Nicht angemeldet.", "unauthenticated");

  const tokenHash = await sha256Hex(match[1]);
  const row = await env.DB.prepare(
    `SELECT d.last_seen_at, d.revoked_at AS device_revoked_at,
            m.id AS member_id, m.name AS member_name, m.role, m.removed_at, m.editor_subject_ids,
            c.id AS class_id, c.name AS class_name
       FROM devices d
       JOIN members m ON m.id = d.member_id
       JOIN classes c ON c.id = m.class_id
      WHERE d.token_hash = ?`
  ).bind(tokenHash).first();

  if (row && row.removed_at) {
    throw new ApiError(401, "Du bist nicht mehr Mitglied dieser Klasse.", "removed");
  }
  if (!row) {
    throw new ApiError(401, "Diese Klasse gibt es nicht mehr oder dein Gerät ist nicht mehr angemeldet.", "unauthenticated");
  }
  if (row.device_revoked_at) {
    throw new ApiError(401, "Dieses Gerät ist nicht mehr angemeldet.", "unauthenticated");
  }

  const now = Date.now();
  if (now - row.last_seen_at > SEEN_INTERVAL_MS) {
    await env.DB.batch([
      env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE token_hash = ?").bind(now, tokenHash),
      env.DB.prepare("UPDATE classes SET last_active_at = ? WHERE id = ?").bind(now, row.class_id),
    ]);
  }

  return {
    tokenHash,
    member: { id: row.member_id, name: row.member_name, role: row.role, editorSubjects: parseIdList(row.editor_subject_ids) },
    classInfo: { id: row.class_id, name: row.class_name },
  };
}

/**
 * Admin-Konto über den Konto-Schlüssel (Authorization: Bearer <schlüssel>).
 * Liefert { account: { id, email }, tokenHash } oder wirft 401.
 */
/** Admin-Anmeldungen (Konto-Schlüssel) gelten nach 90 Tagen ohne Nutzung nicht mehr (täglicher Lauf löscht sie). */
export const ACCOUNT_SESSION_MAX_IDLE_MS = 90 * 24 * 60 * 60 * 1000;

export async function requireAccount(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer ([A-Za-z0-9_-]{20,100})$/);
  if (!match) throw new ApiError(401, "Bitte als Admin anmelden.", "account_unauthenticated");

  const tokenHash = await sha256Hex(match[1]);
  const row = await env.DB.prepare(
    `SELECT s.last_seen_at, s.revoked_at, a.id, a.email
       FROM account_sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ?`
  ).bind(tokenHash).first();
  const now = Date.now();
  if (!row || row.revoked_at || now - row.last_seen_at > ACCOUNT_SESSION_MAX_IDLE_MS) {
    throw new ApiError(401, "Deine Admin-Anmeldung ist abgelaufen. Bitte neu anmelden.", "account_unauthenticated");
  }
  if (now - row.last_seen_at > SEEN_INTERVAL_MS) {
    await env.DB.prepare("UPDATE account_sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
  }
  return { tokenHash, account: { id: row.id, email: row.email } };
}

/** Wie requireMember, aber nur für Admins der Klasse. */
export async function requireAdmin(request, env) {
  const ctx = await requireMember(request, env);
  if (ctx.member.role !== "admin") throw new ApiError(403, "Das dürfen nur Admins.");
  return ctx;
}
