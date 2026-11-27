// Zufallswerte, Codes und Geräte-Schlüssel.

// Ohne leicht verwechselbare Zeichen (0/O, 1/I/L). Gleichverteilt durch Verwerfen zu großer Werte.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function newId() {
  return crypto.randomUUID();
}

/** Neuer Beitritts-Code, z. B. „K7MP4XQ2“ (angezeigt als „K7MP-4XQ2“). */
export function newJoinCode() {
  const out = [];
  while (out.length < CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const b of bytes) {
      const i = b & 31;
      if (i < CODE_ALPHABET.length && out.length < CODE_LENGTH) out.push(CODE_ALPHABET[i]);
    }
  }
  return out.join("");
}

/** Normalisiert eine Eingabe: Großbuchstaben, nur erlaubte Zeichen. */
export function normalizeCode(input) {
  if (typeof input !== "string") return "";
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
}

/** Neuer Geräte-Schlüssel (256 Bit, base64url). Wird nur auf dem Gerät gespeichert. */
export function newDeviceToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sechsstelliger Zahlencode für die E-Mail-Anmeldung, z. B. „048213“. */
export function newLoginCode() {
  const max = 4_294_000_000; // Vielfaches von 1.000.000 unter 2^32 → gleichverteilt
  let n;
  do {
    n = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (n >= max);
  return String(n % 1_000_000).padStart(6, "0");
}
