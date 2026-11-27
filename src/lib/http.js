// Antworten und Fehler für die API.

const API_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: API_HEADERS });
}

/** Fehler mit HTTP-Status und deutscher Meldung für die Nutzerin / den Nutzer. */
export class ApiError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorResponse(err) {
  if (err instanceof ApiError) {
    return json({ error: err.message, code: err.code }, err.status);
  }
  console.error("Unerwarteter Fehler:", err);
  return json({ error: "Interner Fehler. Bitte später erneut versuchen." }, 500);
}

/** Liest einen JSON-Body (max. 10 KB). */
export async function readJson(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.includes("application/json")) {
    throw new ApiError(415, "Erwartet JSON.");
  }
  const text = await request.text();
  if (text.length > 10_000) throw new ApiError(413, "Anfrage zu groß.");
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new ApiError(400, "Ungültiges JSON.");
  }
}

/** Begrenzt Anfragen pro IP (Schutz vor dem Durchprobieren von Codes). */
export async function rateLimit(limiter, request, scope) {
  if (!limiter) return; // z. B. in Tests ohne Binding
  const ip = request.headers.get("CF-Connecting-IP") || "unbekannt";
  const { success } = await limiter.limit({ key: `${scope}:${ip}` });
  if (!success) {
    throw new ApiError(429, "Zu viele Versuche. Bitte eine Minute warten.", "rate_limited");
  }
}
