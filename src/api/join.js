// Beitreten mit Code und Namen.
//   POST /api/code/check  { code }          → prüft den Code, nennt die Klasse
//   POST /api/join        { code, name }    → tritt bei, liefert den Geräte-Schlüssel
import { ApiError, json, readJson } from "../lib/http.js";
import { newDeviceToken, newId, normalizeCode, sha256Hex } from "../lib/crypto.js";
import { replaceDevicesStmts } from "../lib/purge.js";

const NAME_MAX = 40;
export const MAX_MEMBERS = 200;

/** Name säubern: Leerzeichen zusammenfassen, keine Steuerzeichen, 1–40 Zeichen. */
export function cleanName(input) {
  if (typeof input !== "string") throw new ApiError(400, "Bitte einen Namen eingeben.");
  const name = input.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "").replace(/\s+/g, " ").trim();
  if (!name) throw new ApiError(400, "Bitte einen Namen eingeben.");
  if ([...name].length > NAME_MAX) throw new ApiError(400, `Der Name darf höchstens ${NAME_MAX} Zeichen haben.`);
  return name;
}

/** Sucht einen gültigen Code oder wirft eine verständliche Fehlermeldung. */
async function findValidCode(env, rawCode, now) {
  const code = normalizeCode(rawCode);
  if (code.length !== 8) throw new ApiError(400, "Ein Code hat 8 Zeichen, z. B. K7MP-4XQ2.", "invalid_code");

  const row = await env.DB.prepare(
    `SELECT jc.code, jc.kind, jc.class_id, jc.member_id, jc.created_by, jc.expires_at, jc.max_uses, jc.use_count,
            jc.revoked_at, c.name AS class_name, m.name AS member_name, m.removed_at AS member_removed_at
       FROM join_codes jc
       JOIN classes c ON c.id = jc.class_id
       LEFT JOIN members m ON m.id = jc.member_id
      WHERE jc.code = ?`
  ).bind(code).first();

  if (!row) throw new ApiError(404, "Diesen Code gibt es nicht. Bitte noch einmal prüfen.", "invalid_code");
  if (row.revoked_at) throw new ApiError(410, "Dieser Code wurde ungültig gemacht. Frag nach einem neuen.", "code_revoked");
  if (row.expires_at <= now) throw new ApiError(410, "Dieser Code ist abgelaufen. Frag nach einem neuen.", "code_expired");
  if (row.max_uses !== null && row.use_count >= row.max_uses) {
    throw new ApiError(410, row.kind === "personal"
      ? "Dieser persönliche Code wurde schon benutzt. Frag nach einem neuen."
      : "Dieser Code wurde schon so oft benutzt wie erlaubt. Frag nach einem neuen.", "code_used_up");
  }
  if (row.kind === "personal" && (!row.member_id || row.member_removed_at)) {
    throw new ApiError(410, "Dieser Code ist nicht mehr gültig.", "code_revoked");
  }
  return row;
}

export async function checkCode(request, env) {
  const body = await readJson(request);
  const row = await findValidCode(env, body.code, Date.now());
  return json({
    kind: row.kind,
    className: row.class_name,
    // Bei persönlichen Codes steht der Name schon fest.
    name: row.kind === "personal" ? row.member_name : null,
  });
}

export async function join(request, env) {
  const body = await readJson(request);
  if (body.ageConfirmed !== true) throw new ApiError(400, "Bitte bestätige, dass du mindestens 16 Jahre alt bist oder deine Eltern einverstanden sind.", "age_required");
  const now = Date.now();
  const row = await findValidCode(env, body.code, now);

  let memberId, memberName, role;
  if (row.kind === "personal") {
    memberId = row.member_id;
    const m = await env.DB.prepare("SELECT name, role FROM members WHERE id = ?").bind(memberId).first();
    memberName = m.name;
    role = m.role;
  } else {
    memberId = newId();
    memberName = cleanName(body.name);
    role = "member";
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM members WHERE class_id = ? AND removed_at IS NULL"
    ).bind(row.class_id).first();
    if (count.n >= MAX_MEMBERS) throw new ApiError(429, `Eine Klasse kann höchstens ${MAX_MEMBERS} Personen haben.`, "class_full");
    const taken = await env.DB.prepare(
      "SELECT 1 FROM members WHERE class_id = ? AND removed_at IS NULL AND lower(name) = lower(?)"
    ).bind(row.class_id, memberName).first();
    if (taken) {
      throw new ApiError(409, `„${memberName}“ gibt es in dieser Klasse schon. Bitte einen anderen Namen wählen, z. B. mit dem ersten Buchstaben des Nachnamens.`, "name_taken");
    }
  }

  const token = newDeviceToken();
  const tokenHash = await sha256Hex(token);

  // Alles in einer Transaktion: Code verbrauchen und nur bei Erfolg Person + Gerät anlegen.
  // changes() bezieht sich auf die vorherige Anweisung – so gewinnt bei gleichzeitigen
  // Beitritten mit einem fast verbrauchten Code nie eine Person zu viel.
  const stmts = [
    env.DB.prepare(
      `UPDATE join_codes SET use_count = use_count + 1
        WHERE code = ? AND revoked_at IS NULL AND expires_at > ?
          AND (max_uses IS NULL OR use_count < max_uses)`
    ).bind(row.code, now),
  ];
  if (row.kind === "invite") {
    stmts.push(env.DB.prepare(
      `INSERT INTO members (id, class_id, name, role, created_at, age_confirmed_at)
       SELECT ?, ?, ?, 'member', ?, ? WHERE changes() = 1`
    ).bind(memberId, row.class_id, memberName, now, now));
  }
  // Code, den ein Admin für eine ANDERE Person erzeugt hat = Gerätewechsel: Die bisherigen Geräte dieser Person werden
  // abgemeldet (sie merkt es sofort). So kann niemand mit einem fremden Code still mitlesen (private Aufgaben, Notizen).
  // Selbst erzeugte Codes („Weiteres Gerät anmelden“) lassen die alten Geräte angemeldet.
  const switchesDevice = row.kind === "personal" && row.created_by !== row.member_id;
  const deviceIndex = stmts.length;
  stmts.push(
    env.DB.prepare(
      `INSERT INTO devices (token_hash, member_id, created_at, last_seen_at)
       SELECT ?, ?, ?, ? WHERE changes() = 1`
    ).bind(tokenHash, memberId, now, now),
    env.DB.prepare("UPDATE classes SET last_active_at = ? WHERE id = ?").bind(now, row.class_id),
    // Alters-Bestätigung festhalten (bei persönlichen Codes für die bestehende Person).
    env.DB.prepare("UPDATE members SET age_confirmed_at = COALESCE(age_confirmed_at, ?) WHERE id = ?").bind(now, memberId),
  );

  // Erst nach dem neuen Gerät – und nur, wenn es wirklich angelegt wurde (sonst bliebe die Person ganz ohne Gerät).
  if (switchesDevice) stmts.push(...replaceDevicesStmts(env, memberId, tokenHash, now));

  const results = await env.DB.batch(stmts);
  if (results[0].meta.changes !== 1 || results[deviceIndex].meta.changes !== 1) {
    throw new ApiError(409, "Das hat gerade nicht geklappt. Bitte noch einmal versuchen.", "conflict");
  }

  return json({
    token,
    class: { id: row.class_id, name: row.class_name },
    member: { id: memberId, name: memberName, role },
  }, 201);
}
