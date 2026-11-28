// Passwort-Schutz NUR für die Testversion (abgehakt-test). Der echte Worker hat TEST_GATE nicht → nie aktiv.
//
// Ohne gültiges Cookie zeigt jede Seite ein Passwort-Formular (POST /__test-login). Das Passwort kommt aus dem
// Secret TEST_PASSWORD (deploy.yml überträgt es aus dem gleichnamigen GitHub-Secret). Das Cookie enthält nur einen
// HMAC des Passworts – ein neues Passwort meldet alle Geräte ab. Fehlt das Secret, bleibt die Testversion gesperrt.
//
// Frei zugänglich (enthält nichts aus Heften, wird vom Browser teils ohne Cookie geladen): Manifest, Symbole, CSS.
import pkg from "../../package.json";
import { rateLimit } from "./http.js";

const COOKIE = "abgehakt_test";
const LOGIN_PATH = "/__test-login";
const MAX_AGE = 365 * 24 * 60 * 60;
const OPEN = [/^\/manifest\.webmanifest$/, /^\/betrieb\.webmanifest$/, /^\/icons\//, /^\/favicon\.svg$/, /^\/betrieb\.svg$/, /^\/css\//];

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow",
};

/** Ist der Schutz für diese Anfrage aktiv? Doppelt abgesichert: Variable UND Hostname der Testversion. */
export function gateActive(env, url) {
  return env.TEST_GATE === "1" && url.hostname.startsWith("abgehakt-test.");
}

/** null = durchlassen, sonst die Antwort (Formular, 401 oder Weiterleitung nach der Anmeldung). */
export async function testGate(request, env, url) {
  if (url.pathname === LOGIN_PATH && request.method === "POST") return login(request, env, url);
  if (OPEN.some((re) => re.test(url.pathname))) return null;
  const password = env.TEST_PASSWORD || "";
  if (password && cookieOf(request) === (await tokenFor(password))) return null;

  if (url.pathname.startsWith("/api/")) {
    // 403 statt 401: Bei 401 würde die App die Klasse vom Gerät nehmen (handleAuthError).
    return new Response(JSON.stringify({ error: "Testversion: bitte zuerst das Passwort eingeben (Seite neu laden).", code: "test_locked" }), {
      status: 403,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (url.pathname === "/sw.js" || url.pathname === "/betrieb-sw.js") return new Response("", { status: 401 });
  return page(password ? "" : "Für die Testversion ist noch kein Passwort eingerichtet.", url.pathname + url.search, 401);
}

async function login(request, env, url) {
  // Nur von dieser Seite. Formulare schicken wegen „Referrer-Policy: no-referrer“ als Origin „null“ – daher zählt
  // vor allem Sec-Fetch-Site (setzen alle aktuellen Browser, lässt sich von Seiten nicht fälschen).
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");
  if ((site && site !== "same-origin" && site !== "none") || (origin && origin !== "null" && origin !== url.origin)) {
    return new Response("Nicht erlaubt.", { status: 403 });
  }
  try {
    await rateLimit(env.LOGIN_LIMITER, request, "test-login"); // 5 Versuche pro Minute und IP
  } catch {
    return page("Zu viele Versuche. Bitte eine Minute warten.", "/app/", 429);
  }
  const form = await request.formData().catch(() => null);
  const given = String(form?.get("password") || "");
  const next = safeNext(String(form?.get("next") || ""));
  const password = env.TEST_PASSWORD || "";
  if (!password || !(await sameText(given, password))) {
    return page(password ? "Falsches Passwort." : "Für die Testversion ist noch kein Passwort eingerichtet.", next, 401);
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: next,
      "Set-Cookie": `${COOKIE}=${await tokenFor(password)}; Path=/; Max-Age=${MAX_AGE}; Secure; HttpOnly; SameSite=Lax`,
      "Cache-Control": "no-store",
    },
  });
}

/** Nur Pfade auf dieser Seite (kein „//andere-seite“, keine fremden Adressen). */
function safeNext(next) {
  return /^\/(?![/\\])[^\s]*$/.test(next) && !next.startsWith(LOGIN_PATH) ? next : "/app/";
}

function cookieOf(request) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return "";
}

async function hmac(key, text) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const tokenFor = (password) => hmac(password, "abgehakt-test-zugang");

/** Vergleich ohne Zeitunterschiede (beide Seiten erst hashen). */
async function sameText(a, b) {
  const [x, y] = await Promise.all([hmac("vergleich", a), hmac("vergleich", b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(message, next, status) {
  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="dark light">
  <meta name="robots" content="noindex, nofollow">
  <title>Testversion – Abgehakt</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css?v=${pkg.version}">
</head>
<body class="app">
  <main class="content legal">
    <h1>Testversion</h1>
    <p>Das ist die Testversion von Abgehakt. Sie ist mit einem Passwort geschützt.</p>
    ${message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : ""}
    <form method="post" action="${LOGIN_PATH}">
      <input type="hidden" name="next" value="${escapeHtml(next)}">
      <label for="password">Passwort</label>
      <input id="password" class="input" name="password" type="password" autocomplete="current-password" required autofocus>
      <p><button class="button button-primary" type="submit">Öffnen</button></p>
    </form>
  </main>
</body>
</html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}
