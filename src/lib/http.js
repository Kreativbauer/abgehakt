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

/**
 * Netz der anfragenden Person für Begrenzungen: IPv4 = die Adresse, IPv6 = nur der /64-Bereich (ein Anschluss hat
 * meist ein ganzes /64 – sonst zählte jede der 2⁶⁴ Adressen einzeln). IPv4 in IPv6-Schreibweise (::ffff:1.2.3.4)
 * zählt als IPv4. Achtung: Angreifer bekommen leicht ein /56 oder /48 (256 bis 65.536 Netze) – /64 erschwert das nur.
 * Den eigentlichen Schutz liefern Grenzen pro Code und pro E-Mail-Adresse (src/api/account.js).
 */
export function clientNet(request) {
  const raw = (request.headers.get("CF-Connecting-IP") || "unbekannt").trim().toLowerCase().replace(/%.*$/, "");
  if (!raw.includes(":")) return raw;
  const mapped = raw.match(/^(?:::|(?:0{1,4}:){5})ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  const [head, tail] = raw.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = raw.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return raw;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** Begrenzt Anfragen pro Netz (Schutz vor dem Durchprobieren von Codes). */
export async function rateLimit(limiter, request, scope) {
  if (!limiter) return; // z. B. in Tests ohne Binding
  const { success } = await limiter.limit({ key: `${scope}:${clientNet(request)}` });
  if (!success) {
    throw new ApiError(429, "Zu viele Versuche. Bitte eine Minute warten.", "rate_limited");
  }
}
