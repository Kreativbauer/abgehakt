// Ideen, Fehler und Sonstiges an den Betreiber – anonym.
//   POST /api/feedback                  { kind, text }   jedes Mitglied (max. 5 pro Tag)
//   GET  /api/operator/feedback                          Betreiber: neue Einträge
//   POST /api/operator/feedback/:id     { action }       Betreiber: "done"
import { ApiError, json, readJson } from "../lib/http.js";
import { newId, sha256Hex } from "../lib/crypto.js";
import { requireMember } from "../lib/auth.js";
import { requireOperator } from "./operator.js";
import { enqueueOperator } from "./operator-push.js";
import pkg from "../../package.json";

const KINDS = { idee: "Idee", fehler: "Fehler", sonstiges: "Sonstiges" };
const MAX_PER_DAY = 5;

function platformOf(request) {
  const ua = request.headers.get("User-Agent") || "";
  if (/iPhone|iPad|iPod/.test(ua)) return "iPhone/iPad";
  if (/Android/.test(ua)) return "Android";
  return "Computer";
}

export async function sendFeedback(request, env) {
  const { member } = await requireMember(request, env);
  const body = await readJson(request);
  if (!(body.kind in KINDS)) throw new ApiError(400, "Bitte auswählen, worum es geht.");
  const text = typeof body.text === "string" ? body.text.normalize("NFC").replace(/\r\n?/g, "\n").trim() : "";
  if ([...text].length < 5) throw new ApiError(400, "Bitte beschreibe kurz deine Idee oder den Fehler.");
  if ([...text].length > 2000) throw new ApiError(400, "Bitte höchstens 2000 Zeichen.");

  // Nur zum Begrenzen: Hash statt Person – der Betreiber sieht nicht, wer geschrieben hat.
  const senderHash = await sha256Hex(`feedback:${member.id}`);
  const now = Date.now();
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM feedback WHERE sender_hash = ? AND created_at > ?"
  ).bind(senderHash, now - 24 * 60 * 60 * 1000).first();
  if (recent.n >= MAX_PER_DAY) throw new ApiError(429, "Danke für deinen Eifer! Heute geht nichts mehr – morgen wieder.");

  await env.DB.prepare(
    `INSERT INTO feedback (id, kind, text, app_version, platform, sender_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(newId(), body.kind, text, pkg.version, platformOf(request), senderHash, now).run();
  const preview = text.length > 120 ? `${text.slice(0, 117).trimEnd()} …` : text;
  await enqueueOperator(env, "feedback", `${KINDS[body.kind]}: ${preview}`);
  return json({ ok: true }, 201);
}

export async function operatorListFeedback(request, env) {
  await requireOperator(request, env);
  const { results } = await env.DB.prepare(
    "SELECT id, kind, text, app_version, platform, created_at FROM feedback WHERE status = 'new' ORDER BY created_at DESC LIMIT 200"
  ).all();
  return json({
    feedback: results.map((f) => ({
      id: f.id, kind: f.kind, kindLabel: KINDS[f.kind], text: f.text,
      appVersion: f.app_version, platform: f.platform, createdAt: f.created_at,
    })),
  });
}

export async function operatorResolveFeedback(request, env, { id }) {
  await requireOperator(request, env);
  if ((await readJson(request)).action !== "done") throw new ApiError(400, "Ungültige Aktion.");
  const res = await env.DB.prepare(
    "UPDATE feedback SET status = 'done', resolved_at = ? WHERE id = ? AND status = 'new'"
  ).bind(Date.now(), id).run();
  if (res.meta.changes !== 1) throw new ApiError(404, "Schon erledigt.");
  return json({ ok: true });
}
