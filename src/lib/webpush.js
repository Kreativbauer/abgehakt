// Web Push ohne fremde Bibliothek: Verschlüsselung nach RFC 8291 (aes128gcm) und Absender-Nachweis nach
// RFC 8292 (VAPID). Nur WebCrypto. Die Schlüssel liegen als Cloudflare-Secrets:
//   VAPID_PUBLIC_KEY  – öffentlicher Schlüssel (base64url, 65 Byte), geht auch an die App
//   VAPID_PRIVATE_KEY – privater Schlüssel (base64url, 32 Byte), nie ins Repository
// Einmalig im November 2026 erzeugt und bei Cloudflare eingetragen. Nicht neu erzeugen – sonst müssen alle
// Benachrichtigungen neu einschalten. (Das Werkzeug dafür auf /betrieb ist inzwischen entfernt.)

const enc = new TextEncoder();

export function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(s) {
  let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

async function hkdf(salt, ikm, info, bits) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bits));
}

/** Verschlüsselt den Inhalt für genau ein Gerät (RFC 8291, ein Datensatz). */
async function encrypt(payload, p256dh, auth) {
  const uaPublic = unb64url(p256dh);
  const authSecret = unb64url(auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\u0000"), uaPublic, asPublic), 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\u0000"), 128);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\u0000"), 96);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plain = concat(enc.encode(payload), new Uint8Array([2])); // 0x02 = letzter Datensatz, keine Auffüllung
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

let signingKey = null;
/** Privater Schlüssel: einfache Zeichenkette (d) – x und y kommen aus dem öffentlichen Schlüssel. */
async function vapidKey(env) {
  if (!signingKey) {
    const secret = String(env.VAPID_PRIVATE_KEY).trim();
    let jwk;
    if (secret.startsWith("{")) {
      jwk = JSON.parse(secret); // ältere Form: ganzer JWK
    } else {
      const pub = unb64url(String(env.VAPID_PUBLIC_KEY).trim());
      jwk = { kty: "EC", crv: "P-256", d: secret, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)) };
    }
    signingKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  }
  return signingKey;
}

async function vapidAuthorization(env, endpoint) {
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || "mailto:info@skyhome42.de",
  })));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await vapidKey(env), enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${String(env.VAPID_PUBLIC_KEY).trim()}`;
}

export function pushConfigured(env) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

// Nur an bekannte Push-Dienste senden – sonst könnte jemand den Server Anfragen an beliebige Adressen schicken lassen.
const PUSH_HOSTS = [
  /(^|\.)push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function isAllowedEndpoint(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((re) => re.test(url.hostname));
}

/**
 * Schickt eine Benachrichtigung an ein Gerät. Gibt den HTTP-Status des Push-Dienstes zurück
 * (201 = angenommen; 404/410 = Adresse gilt nicht mehr → Abo löschen) oder 0 bei Netzwerkfehler.
 */
export async function sendPush(env, sub, message) {
  try {
    const body = await encrypt(JSON.stringify(message), sub.p256dh, sub.auth);
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "43200",
        Urgency: "normal",
        Authorization: await vapidAuthorization(env, sub.endpoint),
      },
      body,
    });
    return res.status;
  } catch (err) {
    console.error("Push fehlgeschlagen:", err);
    return 0;
  }
}
