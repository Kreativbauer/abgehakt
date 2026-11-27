// Abgehakt – Betrieb: Meldungen prüfen und Not-Werkzeug (kein Inline-Code, siehe CSP)
"use strict";

const $ = (id) => document.getElementById(id);
const DATETIME = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
const STATUS = { open: "offen – Admins haben noch nicht reagiert", admin_dismissed: "die Admins halten den Eintrag für in Ordnung" };

function show(id, text) {
  $(id).textContent = text || "";
  $(id).hidden = !text;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

// ---------- Angemeldet bleiben (optional mit Face ID / Fingerabdruck) ----------
//
// Mit Face ID: Ein Passkey nur für diese Seite liefert über die WebAuthn-Erweiterung „PRF“ ein Geheimnis,
// das nur nach Face ID / Fingerabdruck herauskommt. Daraus wird ein AES-Schlüssel abgeleitet, der den
// Betreiber-Schlüssel verschlüsselt. Auf dem Gerät liegt nur der verschlüsselte Schlüssel – ohne Face ID
// nutzlos. Der Server merkt davon nichts. Ohne Face ID: Schlüssel liegt im Speicher dieses Browsers.

const VAULT_KEY = "abgehakt.betrieb.vault";
const PRF_SALT = new TextEncoder().encode("abgehakt-betrieb-v1");
let operatorKey = "";   // entsperrter Schlüssel (nur im Arbeitsspeicher)
let keyConfirmed = false; // der eingegebene Schlüssel hat schon einmal funktioniert

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function readVault() {
  try {
    const v = JSON.parse(localStorage.getItem(VAULT_KEY));
    return v && (v.mode === "passkey" || v.mode === "plain") ? v : null;
  } catch {
    return null;
  }
}

function writeVault(v) {
  try {
    if (v) localStorage.setItem(VAULT_KEY, JSON.stringify(v));
    else localStorage.removeItem(VAULT_KEY);
    return true;
  } catch {
    return false;
  }
}

async function aesKeyFromPrf(prfSecret) {
  const base = await crypto.subtle.importKey("raw", prfSecret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("operator-key") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Face ID / Fingerabdruck abfragen und das PRF-Geheimnis des Passkeys holen. */
async function prfSecret(credentialId) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: credentialId }],
      userVerification: "required",
      extensions: { prf: { eval: { first: PRF_SALT } } },
    },
  });
  const first = assertion?.getClientExtensionResults()?.prf?.results?.first;
  if (!first) throw new Error("Dieses Gerät unterstützt das Sichern mit Face ID hier leider nicht.");
  return first;
}

async function rememberWithFaceId() {
  show("error-key", "");
  const key = $("input-key").value;
  if (!window.PublicKeyCredential || !navigator.credentials) {
    return show("error-key", "Dieser Browser unterstützt Face ID / Fingerabdruck hier nicht.");
  }
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: "Abgehakt Betrieb", id: location.hostname },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "Betrieb", displayName: "Abgehakt Betrieb" },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
        extensions: { prf: { eval: { first: PRF_SALT } } },
      },
    });
    const ext = cred.getClientExtensionResults()?.prf;
    if (ext && ext.enabled === false) throw new Error("Dieses Gerät unterstützt das Sichern mit Face ID hier leider nicht.");
    // Manche Geräte liefern das Geheimnis schon beim Anlegen, sonst einmal Face ID zur Bestätigung.
    const secret = ext?.results?.first || await prfSecret(cred.rawId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKeyFromPrf(secret), new TextEncoder().encode(key));
    if (!writeVault({ mode: "passkey", id: b64(cred.rawId), iv: b64(iv), ct: b64(ct) })) throw new Error("Speichern ist in diesem Browser nicht möglich.");
    operatorKey = key;
    renderKeyState();
  } catch (err) {
    show("error-key", err.name === "NotAllowedError" ? "Abgebrochen." : err.message || "Das hat nicht geklappt.");
  }
}

function rememberPlain() {
  show("error-key", "");
  if (!window.confirm("Den Schlüssel ohne Face ID auf diesem Gerät speichern? Wer dein entsperrtes Gerät hat, kann dann Klassen löschen.")) return;
  if (!writeVault({ mode: "plain", key: $("input-key").value })) return show("error-key", "Speichern ist in diesem Browser nicht möglich.");
  operatorKey = $("input-key").value;
  renderKeyState();
}

async function unlock() {
  show("error-key", "");
  const v = readVault();
  if (!v || v.mode !== "passkey") return renderKeyState();
  try {
    const secret = await prfSecret(unb64(v.id));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(v.iv) }, await aesKeyFromPrf(secret), unb64(v.ct));
    operatorKey = new TextDecoder().decode(plain);
    renderKeyState();
  } catch (err) {
    show("error-key", err.name === "NotAllowedError" ? "Abgebrochen." : err.message || "Entsperren hat nicht geklappt.");
  }
}

function forget() {
  writeVault(null);
  operatorKey = "";
  keyConfirmed = false;
  $("input-key").value = "";
  opPush.checkedFor = ""; // Benachrichtigungen bleiben eingeschaltet, nur die Einstellungen sind ohne Schlüssel nicht zu sehen
  renderKeyState();
  renderOpPush();
}

function renderKeyState() {
  const v = readVault();
  if (v && v.mode === "plain") operatorKey = v.key;
  const unlocked = Boolean(v && operatorKey);
  $("key-entry").hidden = Boolean(v);
  $("key-locked").hidden = !(v && v.mode === "passkey" && !operatorKey);
  $("key-ready").hidden = !unlocked;
  $("key-ready-text").textContent = v && v.mode === "passkey"
    ? "Angemeldet – gesichert mit Face ID / Fingerabdruck."
    : "Angemeldet – Schlüssel auf diesem Gerät gespeichert (ohne Face ID).";
  $("remember-box").hidden = Boolean(v) || !keyConfirmed;
  // Benachrichtigungen erst prüfen, wenn ein Schlüssel feststeht (entsperrt, gemerkt oder schon bestätigt).
  if (operatorKey || keyConfirmed) refreshOpPush();
}

function currentKey() {
  return operatorKey || $("input-key").value;
}

async function call(path, { method = "GET", body } = {}) {
  const key = currentKey();
  if (!key) {
    throw new Error(readVault() ? "Bitte zuerst oben entsperren." : "Bitte zuerst den Betreiber-Schlüssel eingeben.");
  }
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new Error("Keine Verbindung.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 404 && !data.error ? "Das Werkzeug ist nicht eingerichtet." : data.error || "Fehler.");
  if (!operatorKey && !keyConfirmed) {
    // Schlüssel stimmt → jetzt „Angemeldet bleiben“ anbieten.
    keyConfirmed = true;
    renderKeyState();
  }
  return data;
}

// ---------- Meldungen ----------

const ACTIONS = [
  ["dismiss", "Ist in Ordnung", "button", null],
  ["hide", "Eintrag ausblenden", "button", "Diesen Eintrag für die Klasse ausblenden?"],
  ["warn", "Ausblenden + Admins verwarnen", "button", "Eintrag ausblenden und den Admins eine Verwarnung per E-Mail schicken?"],
  ["delete_class", "Klasse löschen", "button button-danger", "Die GANZE Klasse endgültig löschen – mit allen Mitgliedern und Aufgaben?"],
];

function renderReport(r) {
  const actions = el("div", { class: "invite-actions" });
  for (const [action, label, cls, confirmText] of ACTIONS) {
    actions.append(el("button", {
      class: `${cls} button-small`, type: "button", text: label,
      onclick: () => resolve(r, action, confirmText),
    }));
  }
  return el("li", { class: "card report" },
    el("p", { class: "report-reason", text: `${r.reasonLabel} · ${DATETIME.format(new Date(r.createdAt))}` }),
    el("p", { class: "hint", text: `Status: ${STATUS[r.status] || r.status}${r.taskDeleted ? " · Eintrag ist bereits gelöscht" : ""}` }),
    r.comment ? el("p", { class: "hint", text: `Begründung: „${r.comment}“` }) : null,
    el("div", { class: "report-snapshot" },
      r.subject ? el("p", { class: "eyebrow", text: r.subject }) : null,
      el("p", { class: "report-title", text: r.title }),
      r.details ? el("p", { class: "task-details", text: r.details }) : null,
      el("p", { class: "hint", text: `Eingetragen bzw. zuletzt geändert von: ${r.author || "unbekannt"}` }),
    ),
    el("p", { class: "hint", text: `Klasse ${r.classId} · ${r.classReports} ${r.classReports === 1 ? "Meldung" : "Meldungen"} insgesamt` }),
    actions,
  );
}

async function loadReports() {
  show("error-reports", "");
  try {
    const data = await call("/api/operator/reports");
    $("op-report-list").replaceChildren(...data.reports.map(renderReport));
    $("op-reports-empty").hidden = data.reports.length > 0;
  } catch (err) {
    show("error-reports", err.message);
  }
}

async function resolve(r, action, confirmText) {
  if (confirmText && !window.confirm(confirmText)) return;
  show("error-reports", "");
  show("result-reports", "");
  try {
    const data = await call(`/api/operator/reports/${r.id}`, { method: "POST", body: { action } });
    show("result-reports", data.result);
    await loadReports();
  } catch (err) {
    show("error-reports", err.message);
  }
}

$("button-load-reports").addEventListener("click", loadReports);

// ---------- Ideen und Fehler ----------

const KIND_ICON = { idee: "💡", fehler: "🐞", sonstiges: "💬" };

function renderFeedback(f) {
  return el("li", { class: "card feedback" },
    el("p", { class: "report-reason feedback-kind", text: `${KIND_ICON[f.kind] || ""} ${f.kindLabel} · ${DATETIME.format(new Date(f.createdAt))}` }),
    el("p", { class: "feedback-text", text: f.text }),
    el("p", { class: "hint", text: `Version ${f.appVersion} · ${f.platform}` }),
    el("div", { class: "invite-actions" },
      el("button", { class: "button button-small", type: "button", text: "Erledigt", onclick: () => doneFeedback(f) })),
  );
}

async function loadFeedback() {
  show("error-feedback", "");
  try {
    const data = await call("/api/operator/feedback");
    $("op-feedback-list").replaceChildren(...data.feedback.map(renderFeedback));
    $("op-feedback-empty").hidden = data.feedback.length > 0;
  } catch (err) {
    show("error-feedback", err.message);
  }
}

async function doneFeedback(f) {
  try {
    await call(`/api/operator/feedback/${f.id}`, { method: "POST", body: { action: "done" } });
    await loadFeedback();
  } catch (err) {
    show("error-feedback", err.message);
  }
}

$("button-load-feedback").addEventListener("click", loadFeedback);

// ---------- Person entfernen (Wunsch der Eltern / der Person) ----------

$("form-remove-member").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const target = $("input-remove-class").value.trim();
  const name = $("input-remove-name").value.trim();
  show("error-remove-member", "");
  show("result-remove-member", "");
  if (!target || !name) return show("error-remove-member", "Bitte Kennung und Namen eingeben.");
  if (!$("input-remove-confirm").checked) return show("error-remove-member", "Bitte bestätigen, dass die Person entfernt werden soll.");
  button.disabled = true;
  try {
    const data = await call("/api/operator/remove-member", { method: "POST", body: { target, name } });
    show("result-remove-member", data.result);
    $("input-remove-name").value = "";
    $("input-remove-confirm").checked = false;
  } catch (err) {
    show("error-remove-member", err.message);
  } finally {
    button.disabled = false;
  }
});

// ---------- Notbremse: Klasse direkt löschen ----------

$("form-operator").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const target = $("input-target").value.trim();
  show("error-operator", "");
  show("result-operator", "");
  if (!target) return show("error-operator", "Bitte Kennung oder Code eingeben.");
  if (!$("input-confirm").checked) return show("error-operator", "Bitte bestätigen, dass die Klasse endgültig gelöscht werden soll.");

  button.disabled = true;
  try {
    const data = await call("/api/operator/delete-class", { method: "POST", body: { target } });
    const d = data.deleted;
    show("result-operator", `Gelöscht: 1 Klasse mit ${d.members} ${d.members === 1 ? "Person" : "Personen"} und ${d.tasks} ${d.tasks === 1 ? "Aufgabe" : "Aufgaben"}.`);
    $("input-target").value = "";
    $("input-confirm").checked = false;
  } catch (err) {
    show("error-operator", err.message);
  } finally {
    button.disabled = false;
  }
});

// ---------- Anmeldung ----------

$("button-remember-faceid").addEventListener("click", rememberWithFaceId);
$("button-remember-plain").addEventListener("click", rememberPlain);
$("button-unlock").addEventListener("click", unlock);
$("button-forget").addEventListener("click", forget);
$("input-key").addEventListener("input", () => { keyConfirmed = false; renderKeyState(); });

// ---------- Benachrichtigungen für den Betreiber ----------
// Eigener Service Worker nur für /betrieb (public/betrieb-sw.js). iPhone/iPad: nur als App auf dem Home-Bildschirm.

const opPush = { registration: null, subscription: null, publicKey: null, settings: null, checkedFor: "" };

function opPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(b64url) {
  let t = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
}

function renderOpPush() {
  const supported = opPushSupported();
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const on = Boolean(opPush.settings);
  let status;
  if (!supported) {
    status = ios && !standalone
      ? "Auf iPhone und iPad gehen Benachrichtigungen nur, wenn „Betrieb“ auf dem Home-Bildschirm liegt (Teilen → Zum Home-Bildschirm)."
      : "Dieser Browser unterstützt keine Benachrichtigungen.";
  } else if (!opPush.checkedFor) status = "Zum Einrichten zuerst oben anmelden bzw. entsperren (der Schlüssel muss einmal funktioniert haben, z. B. über „Meldungen laden“).";
  else if (opPush.publicKey === null) status = "Benachrichtigungen sind auf dem Server noch nicht eingerichtet.";
  else if (Notification.permission === "denied") status = "Benachrichtigungen sind für diese Seite blockiert – in den Einstellungen des Browsers bzw. Handys erlauben.";
  else if (on) status = "An – auf diesem Gerät.";
  else status = "Aus. Auf Wunsch meldet sich dieses Gerät bei neuen Ideen und Fehlern und bei Meldungen, die Admins für in Ordnung halten.";
  $("op-push-status").textContent = status;
  const usable = supported && Boolean(opPush.checkedFor) && Boolean(opPush.publicKey) && Notification.permission !== "denied";
  $("button-op-push-on").hidden = !usable || on;
  $("button-op-push-off").hidden = !usable || !on;
  $("button-op-push-test").hidden = !usable || !on;
  $("op-push-options").hidden = !usable || !on;
  if (on) {
    $("op-push-feedback").checked = opPush.settings.feedback;
    $("op-push-reports").checked = opPush.settings.reports;
    $("op-push-classes").checked = opPush.settings.classes;
  }
}

async function refreshOpPush() {
  const key = currentKey();
  if (!opPushSupported() || !key || opPush.checkedFor === key) return renderOpPush();
  try {
    opPush.registration = await navigator.serviceWorker.register("/betrieb-sw.js", { scope: "/betrieb" });
    opPush.subscription = await opPush.registration.pushManager.getSubscription();
    const data = await call("/api/operator/push/status", { method: "POST", body: { endpoint: opPush.subscription ? opPush.subscription.endpoint : null } });
    opPush.publicKey = data.publicKey;
    opPush.settings = data.subscription;
    opPush.checkedFor = key;
    show("error-op-push", "");
  } catch (err) {
    show("error-op-push", err.message);
  }
  renderOpPush();
}

function subscriptionBody(sub) {
  const j = sub.toJSON();
  return {
    endpoint: j.endpoint,
    keys: j.keys,
    feedback: $("op-push-feedback").checked,
    reports: $("op-push-reports").checked,
    classes: $("op-push-classes").checked,
  };
}

async function enableOpPush() {
  show("error-op-push", "");
  const button = $("button-op-push-on");
  button.disabled = true;
  try {
    if (await Notification.requestPermission() !== "granted") throw new Error("Benachrichtigungen wurden nicht erlaubt.");
    const reg = opPush.registration || await navigator.serviceWorker.register("/betrieb-sw.js", { scope: "/betrieb" });
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(opPush.publicKey) });
    opPush.subscription = sub;
    // Standard beim Einschalten: Ideen/Fehler und Meldungen an, neue Klassen aus.
    $("op-push-feedback").checked = true;
    $("op-push-reports").checked = true;
    $("op-push-classes").checked = false;
    const data = await call("/api/operator/push", { method: "PUT", body: subscriptionBody(sub) });
    opPush.settings = data.subscription;
  } catch (err) {
    show("error-op-push", err.message || "Einschalten hat nicht geklappt.");
  } finally {
    button.disabled = false;
    renderOpPush();
  }
}

async function saveOpPush() {
  if (!opPush.subscription || !opPush.settings) return;
  show("error-op-push", "");
  $("op-push-saved").textContent = "";
  try {
    const data = await call("/api/operator/push", { method: "PUT", body: subscriptionBody(opPush.subscription) });
    opPush.settings = data.subscription;
    $("op-push-saved").textContent = "Gespeichert.";
  } catch (err) {
    show("error-op-push", err.message);
    renderOpPush();
  }
}

async function disableOpPush() {
  show("error-op-push", "");
  try {
    if (opPush.subscription) {
      await call("/api/operator/push/delete", { method: "POST", body: { endpoint: opPush.subscription.endpoint } });
      await opPush.subscription.unsubscribe().catch(() => {});
    }
    opPush.subscription = null;
    opPush.settings = null;
  } catch (err) {
    show("error-op-push", err.message);
  }
  renderOpPush();
}

async function testOpPush() {
  show("error-op-push", "");
  $("op-push-saved").textContent = "";
  try {
    await call("/api/operator/push/test", { method: "POST", body: { endpoint: opPush.subscription.endpoint } });
    $("op-push-saved").textContent = "Test verschickt – kommt gleich an.";
  } catch (err) {
    show("error-op-push", err.message);
  }
}

$("button-op-push-on").addEventListener("click", enableOpPush);
$("button-op-push-off").addEventListener("click", disableOpPush);
$("button-op-push-test").addEventListener("click", testOpPush);
for (const id of ["op-push-feedback", "op-push-reports", "op-push-classes"]) $(id).addEventListener("change", saveOpPush);

// Start (erst hier, damit alle Teile oben schon bereitstehen).
renderKeyState();
refreshOpPush();
