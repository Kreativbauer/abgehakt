// Benachrichtigungen für den Betreiber auf /betrieb (geschützt mit OPERATOR_KEY wie alle Betreiber-Endpunkte).
//   POST /api/operator/push/status { endpoint }   öffentlicher Schlüssel + Einstellungen dieses Geräts (oder null)
//   PUT  /api/operator/push        { endpoint, keys: { p256dh, auth }, feedback, reports, classes }   einschalten / speichern
//   POST /api/operator/push/delete { endpoint }   ausschalten
//   POST /api/operator/push/test   { endpoint }   Test-Benachrichtigung
//
// Anlässe (über enqueueOperator() in die Warteschlange operator_push_outbox, verschickt in src/jobs/notify.js):
//   feedback – neue Idee / neuer Fehler · reports – Admins halten einen gemeldeten Eintrag für in Ordnung
//   classes  – neue Klasse angelegt (standardmäßig aus)
// Die Nachrichten enthalten keine Inhalte aus Heften und keine Klassennamen.
import { ApiError, json, readJson } from "../lib/http.js";
import { newId } from "../lib/crypto.js";
import { deleteOperatorPushStmts } from "../lib/purge.js";
import { pushConfigured, sendPush } from "../lib/webpush.js";
import { requireOperator } from "./operator.js";
import { cleanEndpoint, cleanKey, flag } from "./push.js";

const MAX_DEVICES = 5;
const COLUMNS = { feedback: "notify_feedback", reports: "notify_reports", classes: "notify_classes" };

function toSettings(row) {
  return { feedback: Boolean(row.notify_feedback), reports: Boolean(row.notify_reports), classes: Boolean(row.notify_classes) };
}

function find(env, endpoint) {
  return env.DB.prepare("SELECT * FROM operator_push_subscriptions WHERE endpoint = ?").bind(endpoint).first();
}

export async function operatorPushStatus(request, env) {
  await requireOperator(request, env);
  const body = await readJson(request);
  const row = typeof body.endpoint === "string" ? await find(env, body.endpoint) : null;
  return json({
    publicKey: pushConfigured(env) ? String(env.VAPID_PUBLIC_KEY).trim() : null,
    subscription: row ? toSettings(row) : null,
  });
}

export async function operatorPushSave(request, env) {
  await requireOperator(request, env);
  if (!pushConfigured(env)) throw new ApiError(503, "Benachrichtigungen sind noch nicht eingerichtet.");
  const body = await readJson(request);
  const endpoint = cleanEndpoint(body.endpoint);
  const p256dh = cleanKey(body.keys?.p256dh, 65);
  const auth = cleanKey(body.keys?.auth, 16);
  const now = Date.now();
  const existing = await find(env, endpoint);
  if (existing) {
    await env.DB.prepare(
      `UPDATE operator_push_subscriptions SET p256dh = ?, auth = ?, notify_feedback = ?, notify_reports = ?,
              notify_classes = ?, updated_at = ? WHERE id = ?`
    ).bind(p256dh, auth, flag(body.feedback, existing.notify_feedback), flag(body.reports, existing.notify_reports),
      flag(body.classes, existing.notify_classes), now, existing.id).run();
  } else {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM operator_push_subscriptions").first();
    if (count.n >= MAX_DEVICES) throw new ApiError(429, `Höchstens ${MAX_DEVICES} Geräte. Schalte sie auf einem alten Gerät aus.`);
    await env.DB.prepare(
      `INSERT INTO operator_push_subscriptions (id, endpoint, p256dh, auth, notify_feedback, notify_reports,
                                                notify_classes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newId(), endpoint, p256dh, auth, flag(body.feedback, 1), flag(body.reports, 1), flag(body.classes, 0), now, now).run();
  }
  return json({ subscription: toSettings(await find(env, endpoint)) });
}

export async function operatorPushDelete(request, env) {
  await requireOperator(request, env);
  const body = await readJson(request);
  const row = typeof body.endpoint === "string" ? await find(env, body.endpoint) : null;
  if (row) await env.DB.batch(deleteOperatorPushStmts(env, row.id));
  return json({ ok: true });
}

export async function operatorPushTest(request, env) {
  await requireOperator(request, env);
  const body = await readJson(request);
  const row = typeof body.endpoint === "string" ? await find(env, body.endpoint) : null;
  if (!row) throw new ApiError(404, "Benachrichtigungen sind auf diesem Gerät nicht eingeschaltet.");
  const status = await sendPush(env, row, { title: "Abgehakt · Betrieb", body: "So sehen Benachrichtigungen für den Betrieb aus.", tag: "op-test", url: "/betrieb" });
  if (status === 404 || status === 410) {
    await env.DB.batch(deleteOperatorPushStmts(env, row.id));
    throw new ApiError(410, "Dieses Gerät ist beim Push-Dienst nicht mehr angemeldet. Bitte neu einschalten.");
  }
  if (status < 200 || status >= 300) throw new ApiError(502, "Der Push-Dienst hat die Benachrichtigung gerade nicht angenommen.");
  return json({ ok: true });
}

/** Benachrichtigung an alle Betreiber-Geräte, die diesen Anlass eingeschaltet haben. Fehler stören den Aufrufer nie. */
export async function enqueueOperator(env, kind, body) {
  const column = COLUMNS[kind];
  if (!column || !pushConfigured(env)) return;
  try {
    const payload = JSON.stringify({ title: "Abgehakt · Betrieb", body, tag: `op-${kind}`, url: "/betrieb" });
    await env.DB.prepare(
      `INSERT INTO operator_push_outbox (id, subscription_id, payload, created_at)
       SELECT lower(hex(randomblob(16))), id, ?, ? FROM operator_push_subscriptions WHERE ${column} = 1`
    ).bind(payload, Date.now()).run();
  } catch (err) {
    console.error("Betreiber-Benachrichtigung nicht eingereiht:", err.message);
  }
}
