// Abgehakt – Worker (Server-Logik)
// Statische Dateien aus /public liefert Cloudflare direkt aus (Header siehe public/_headers).
// Dieser Worker bearbeitet nur Anfragen unter /api/*.

import pkg from "../package.json";
import { ApiError, errorResponse, json, rateLimit } from "./lib/http.js";
import { checkCode, join } from "./api/join.js";
import { exportMyData, me } from "./api/me.js";
import { deleteAccount, linkMember, startLogin, verifyLogin } from "./api/account.js";
import { createClass, createInvite, deleteClass, listInvites, renameClass, revokeInvite } from "./api/classes.js";
import { operatorDeleteClass, operatorListReports, operatorRemoveMember, operatorResolveReport } from "./api/operator.js";
import { listReports, reportTask, resolveReport } from "./api/reports.js";
import { operatorListFeedback, operatorResolveFeedback, sendFeedback } from "./api/feedback.js";
import { archiveSubject, chooseSubjects, createSubject, listSubjects, setTimetable, updateSubject } from "./api/subjects.js";
import { gateActive, testGate } from "./lib/testgate.js";
import { runDailyCleanup } from "./jobs/cleanup.js";
import { runNotifications } from "./jobs/notify.js";
import { deleteSubscription, pushKey, saveSubscription, subscriptionStatus, testPush } from "./api/push.js";
import { addMember, createOwnCode, createPersonalCode, leaveClass, listMembers, removeMember, renameSelf, updateMember, updateSettings } from "./api/members.js";
import { createTask, deleteTask, listDeletedTasks, listTasks, restoreTask, setTaskState, updateTask } from "./api/tasks.js";
import { operatorPushDelete, operatorPushSave, operatorPushStatus, operatorPushTest } from "./api/operator-push.js";

const VERSION = pkg.version;
const DAILY_CRON = "23 2 * * *"; // muss zu wrangler.jsonc passen

async function health(env) {
  let db = "nicht verbunden";
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first();
    db = `ok (Schema ${row.n})`;
  } catch (err) {
    db = "Fehler";
    console.error("D1-Fehler bei /api/health:", err);
  }
  return json({ app: "abgehakt", version: VERSION, db });
}

// Methode + Pfad → Funktion. :name = Platzhalter. limit = Schutz vor dem Durchprobieren von Codes.
// limit = Bereich für das Rate-Limit pro IP (siehe unten).
const ROUTES = [
  ["GET", "/api/health", (req, env) => health(env)],
  ["POST", "/api/code/check", checkCode, "code-check"],
  ["POST", "/api/join", join, "join"],
  ["GET", "/api/me", me],
  ["GET", "/api/me/export", exportMyData],
  ["GET", "/api/tasks", listTasks],
  ["GET", "/api/tasks/deleted", listDeletedTasks],
  ["POST", "/api/tasks/:id/restore", restoreTask],
  ["POST", "/api/tasks", createTask],
  ["PATCH", "/api/tasks/:id", updateTask],
  ["DELETE", "/api/tasks/:id", deleteTask],
  ["PUT", "/api/tasks/:id/state", setTaskState],
  ["POST", "/api/account/start", startLogin, "login-start"],
  ["POST", "/api/account/verify", verifyLogin, "login"],
  ["POST", "/api/account/link", linkMember],
  ["POST", "/api/account/delete", deleteAccount],
  ["POST", "/api/classes", createClass],
  ["GET", "/api/invites", listInvites],
  ["POST", "/api/invites", createInvite],
  ["POST", "/api/invites/:code/revoke", revokeInvite],
  ["PATCH", "/api/class", renameClass],
  ["POST", "/api/class/delete", deleteClass],
  ["POST", "/api/operator/delete-class", operatorDeleteClass, "operator"],
  ["POST", "/api/operator/remove-member", operatorRemoveMember, "operator"],
  ["GET", "/api/operator/reports", operatorListReports, "operator"],
  ["POST", "/api/operator/reports/:id", operatorResolveReport, "operator"],
  ["POST", "/api/tasks/:id/report", reportTask],
  ["POST", "/api/feedback", sendFeedback],
  ["GET", "/api/subjects", listSubjects],
  ["POST", "/api/subjects", createSubject],
  ["PATCH", "/api/subjects/:id", updateSubject],
  ["POST", "/api/subjects/:id/archive", archiveSubject],
  ["PUT", "/api/me/subjects", chooseSubjects],
  ["PUT", "/api/timetable", setTimetable],
  ["GET", "/api/push/key", pushKey],
  ["PUT", "/api/push/subscription", saveSubscription],
  ["POST", "/api/push/subscription/status", subscriptionStatus],
  ["POST", "/api/push/subscription/delete", deleteSubscription],
  ["POST", "/api/push/test", testPush],
  ["GET", "/api/operator/feedback", operatorListFeedback, "operator"],
  ["POST", "/api/operator/feedback/:id", operatorResolveFeedback, "operator"],
  ["POST", "/api/operator/push/status", operatorPushStatus, "operator"],
  ["PUT", "/api/operator/push", operatorPushSave, "operator"],
  ["POST", "/api/operator/push/delete", operatorPushDelete, "operator"],
  ["POST", "/api/operator/push/test", operatorPushTest, "operator"],
  ["GET", "/api/reports", listReports],
  ["POST", "/api/reports/:id", resolveReport],
  ["GET", "/api/members", listMembers],
  ["POST", "/api/members", addMember],
  ["PATCH", "/api/members/:id", updateMember],
  ["POST", "/api/members/:id/code", createPersonalCode],
  ["POST", "/api/members/:id/remove", removeMember],
  ["POST", "/api/me/code", createOwnCode],
  ["PUT", "/api/me/name", renameSelf],
  ["PUT", "/api/me/settings", updateSettings],
  ["POST", "/api/me/leave", leaveClass],
].map(([method, path, handler, limit]) => ({
  method,
  pattern: new RegExp("^" + path.replace(/:(\w+)/g, "(?<$1>[A-Za-z0-9-]{1,64})") + "$"),
  handler,
  limit,
}));

function findRoute(method, pathname) {
  let pathMatched = false;
  for (const route of ROUTES) {
    const m = route.pattern.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (route.method === method) return { route, params: m.groups || {} };
  }
  throw pathMatched ? new ApiError(405, "Methode nicht erlaubt.") : new ApiError(404, "Nicht gefunden.");
}

export default {
  // Zeitpläne in wrangler.jsonc: täglich aufräumen, alle 5 Minuten Benachrichtigungen verschicken.
  async scheduled(event, env, ctx) {
    if (event.cron === DAILY_CRON) ctx.waitUntil(runDailyCleanup(env, Date.now()));
    else ctx.waitUntil(runNotifications(env, Date.now()));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    // Nur Testversion: Passwort-Schutz vor allem anderen (dort läuft der Worker für jede Anfrage zuerst).
    if (gateActive(env, url)) {
      const locked = await testGate(request, env, url);
      if (locked) return locked;
    }
    if (!url.pathname.startsWith("/api/")) {
      // Echte Seite: kommt wegen run_worker_first nicht vor. Testversion: freigegebene statische Datei ausliefern.
      return env.ASSETS.fetch(request);
    }

    try {
      const { route, params } = findRoute(request.method, url.pathname);

      // Schreibende Anfragen nur von der eigenen Seite (Schutz vor fremden Formularen).
      if (request.method !== "GET") {
        const origin = request.headers.get("Origin");
        if (origin && origin !== url.origin) throw new ApiError(403, "Nicht erlaubt.");
      }

      // Getrennte Zähler je Bereich (Beitreten, Anmelden, Betrieb …), damit eine Klasse, die im Schul-WLAN gemeinsam
      // beitritt, nicht die anderen Bereiche sperrt. Anmelde-E-Mails zusätzlich strenger (LOGIN_LIMITER).
      if (route.limit) await rateLimit(env.CODE_LIMITER, request, route.limit);
      if (route.limit === "login-start") await rateLimit(env.LOGIN_LIMITER, request, route.limit);
      return await route.handler(request, env, params);
    } catch (err) {
      return errorResponse(err);
    }
  },
};
