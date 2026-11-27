// Geräte-Schlüssel für Mitglieder anlegen.
import { newDeviceToken, sha256Hex } from "./crypto.js";

/** Neuer Geräte-Schlüssel für eine Person: { token, stmt } – stmt muss noch ausgeführt werden. */
export async function newDeviceFor(env, memberId, now) {
  const token = newDeviceToken();
  const tokenHash = await sha256Hex(token);
  const stmt = env.DB.prepare(
    "INSERT INTO devices (token_hash, member_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)"
  ).bind(tokenHash, memberId, now, now);
  return { token, stmt };
}
