// Abgehakt – App (kein Inline-Code, siehe CSP in public/_headers)
// Inhalte immer per textContent / DOM-API setzen, nie per innerHTML (siehe CLAUDE.md).
"use strict";

const STORE_KEY = "abgehakt.memberships"; // [{ token, classId, className, memberId, memberName, role }]
const ACTIVE_KEY = "abgehakt.active";     // classId der gerade gezeigten Klasse
const CACHE_PREFIX = "abgehakt.cache.";   // zuletzt geladene Aufgaben pro Klasse (für schnellen Start)
const ACCOUNT_KEY = "abgehakt.account";   // { token, email } – nur für Admins
const QUEUE_PREFIX = "abgehakt.queue.";   // offline gemachte Änderungen pro Klasse, werden nachgeschickt
const INSTALL_CODE_PREFIX = "abgehakt.installCode."; // Code für die Home-Bildschirm-App (nicht bei jedem Neuladen neu)
const INSTALL_KEY = "abgehakt.installHint"; // Zeitpunkt, bis zu dem der Installations-Hinweis ausgeblendet ist

const ROLE_LABELS = { admin: "Admin", editor: "Eintragende", member: "Mitglied" };

const $ = (id) => document.getElementById(id);

// ---------- Speicher auf dem Gerät ----------

function readJsonStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function loadMemberships() {
  const list = readJsonStorage(STORE_KEY, []);
  return Array.isArray(list) ? list.filter((m) => m && m.token && m.classId) : [];
}

function saveMemberships(list) {
  if (!writeJsonStorage(STORE_KEY, list)) {
    showNotice("Dein Browser erlaubt kein Speichern. Du bleibst deshalb nicht angemeldet.");
  }
}

function getActiveId() {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

function setActiveId(id) {
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* egal */ }
}

// Bittet den Browser, die Daten nicht automatisch zu löschen (wichtig für Safari).
function requestPersistence() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
}

// ---------- Server ----------

async function api(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  } catch {
    const err = new Error("Keine Verbindung. Bitte Internet prüfen und noch einmal versuchen.");
    err.offline = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Etwas ist schiefgelaufen. Bitte noch einmal versuchen.");
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

// ---------- Datum (immer lokale Kalendertage als 'YYYY-MM-DD') ----------

function toDateStr(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(s, n) {
  const d = fromDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function isWeekend(s) {
  const day = fromDateStr(s).getDay();
  return day === 0 || day === 6;
}

/** Nächster (dir = 1) bzw. vorheriger (dir = -1) Schultag – Wochenenden werden übersprungen. */
function stepSchoolDay(s, dir) {
  let d = addDays(s, dir);
  while (isWeekend(d)) d = addDays(d, dir);
  return d;
}

function today() {
  return toDateStr(new Date());
}

/** Standard-Tag: heute – am Wochenende der Montag danach. */
function defaultDay() {
  const t = today();
  return isWeekend(t) ? stepSchoolDay(t, 1) : t;
}

// ---------- Stundenplan: Unterrichtstage, A/B-Wochen ----------

const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr"];

/** Montag der Woche, in der der Tag liegt. */
function mondayOf(s) {
  const wd = fromDateStr(s).getDay(); // 0 = So
  return addDays(s, wd === 0 ? -6 : 1 - wd);
}

/** "a" oder "b" bei A/B-Wochen, sonst null. */
function weekType(s) {
  if (!state.abRef) return null;
  const weeks = Math.round((fromDateStr(mondayOf(s)) - fromDateStr(state.abRef)) / (7 * 86400000));
  return ((weeks % 2) + 2) % 2 === 0 ? "a" : "b";
}

/** Nächste Stunde eines Fachs nach dem Tag `base` (oder null, wenn kein Unterrichtstag eingetragen ist). */
function nextLesson(sub, base) {
  if (!sub || !(sub.daysA || []).length && !(state.abRef && (sub.daysB || []).length)) return null;
  for (let i = 1; i <= 21; i++) {
    const d = addDays(base, i);
    const days = weekType(d) === "b" ? sub.daysB || [] : sub.daysA || [];
    if (days.includes(fromDateStr(d).getDay())) return d;
  }
  return null;
}

const DATE_LONG = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "long" });
const DATE_SHORT = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat("de-DE", { weekday: "long" });
const DATE_FULL = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const DATETIME = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

function relativeDay(s) {
  const t = today();
  if (s === t) return "Heute";
  if (s === addDays(t, 1)) return "Morgen";
  if (s === addDays(t, 2)) return "Übermorgen";
  if (s === addDays(t, -1)) return "Gestern";
  return WEEKDAY.format(fromDateStr(s));
}

// ---------- Fachfarben (nach Notion) ----------

const SUBJECT_COLORS = [
  [/mathe|mathematik/i, "blue"],
  [/deutsch/i, "red"],
  [/englisch|english/i, "orange"],
  [/franz|spanisch|latein|russisch|italien/i, "pink"],
  [/bio/i, "green"],
  [/chemie/i, "purple"],
  [/physik|informatik|technik/i, "gray"],
  [/geschicht|politik|sozial|erdkunde|geo|wirtschaft|bwl|vwl/i, "brown"],
  [/kunst|musik|sport|religion|ethik|philosoph/i, "yellow"],
];
const COLOR_NAMES = ["blue", "red", "orange", "pink", "green", "purple", "brown", "yellow", "gray"];

function subjectColor(subject) {
  for (const [re, color] of SUBJECT_COLORS) if (re.test(subject)) return color;
  let h = 0;
  for (const ch of subject.toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return COLOR_NAMES[h % COLOR_NAMES.length];
}

// ---------- Kleine DOM-Helfer ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

function svgIcon(pathD, size = 16, strokeWidth = 2) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", pathD);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", strokeWidth);
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

const ICON_CHECK = "M5 12.5l4.5 4.5L19 7.5";
const ICON_LOCK = "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z";
const ICON_CALENDAR = "M5 6h14v14H5zM5 10h14M9 4v4M15 4v4";
const ICON_LINK = "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1";

// ---------- Links in Aufgaben ----------
//
// Nur http(s)-Adressen, höchstens 5 pro Aufgabe. Angezeigt im aufgeklappten Eintrag (nicht im Knopf selbst),
// mit dem Namen der Website, damit man sieht, wohin der Link führt. rel="noopener noreferrer" schützt
// das Heft vor der fremden Seite und verrät ihr nicht, woher man kommt.

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"]+/gi;

function findLinks(...texts) {
  const links = [];
  for (const text of texts) {
    for (const match of String(text || "").matchAll(URL_PATTERN)) {
      const raw = match[0].replace(/[.,;:!?)\]}'"\u2019\u201c\u201d]+$/, "");
      let url;
      try { url = new URL(raw); } catch { continue; }
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      if (!links.some((l) => l.href === url.href)) links.push(url);
      if (links.length >= 5) return links;
    }
  }
  return links;
}

/**
 * Text ohne Web-Adressen – für die Anzeige im Heft. Die Links stehen als Knöpfe im aufgeklappten
 * Eintrag; gespeichert bleibt der Text unverändert (beim Bearbeiten sind die Adressen noch da).
 */
function withoutLinks(text) {
  return String(text || "")
    .replace(/:([ \t]*)(?=https?:\/\/)/gi, "$1")   // „bearbeiten: https://…“ → kein Doppelpunkt ohne Adresse dahinter
    // Adresse entfernen, Satzzeichen dahinter behalten (wie in findLinks() abgeschnitten)
    .replace(URL_PATTERN, (m) => (m.match(/[.,;:!?)\]}'"\u2019\u201c\u201d]+$/) || [""])[0])
    .replace(/\(\s*\)|\[\s*\]|<\s*>/g, "")   // leer gewordene Klammern
    .replace(/[ \t]+([.,;:!?])/g, "$1")         // Leerzeichen vor Satzzeichen
    .replace(/([:;,])[,;]+/g, "$1")              // „Blatt: , danach“ → „Blatt: danach“
    .replace(/[ \t]{2,}/g, " ")
    .split("\n").map((l) => l.trim()).filter((l, i, all) => l || (i > 0 && all[i - 1]))
    .join("\n")
    .replace(/^[\s.,;:!?-]+$/gm, "")             // Zeilen, in denen nur noch Satzzeichen stehen
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderLink(url) {
  const host = url.hostname.replace(/^www\./, "");
  const rest = (url.pathname + url.search).replace(/^\/$/, "");
  const short = rest.length > 32 ? `${rest.slice(0, 31)}…` : rest;
  return el("a", { class: "task-link", href: url.href, target: "_blank", rel: "noopener noreferrer nofollow ugc" },
    svgIcon(ICON_LINK, 14, 2),
    el("span", { class: "task-link-host", text: host }),
    short ? el("span", { class: "task-link-path", text: short }) : null);
}

// ---------- Ansichten ----------

const VIEWS = [
  "loading", "view-code", "view-name", "view-class", "view-task-form",
  "view-login", "view-login-code", "view-create-class", "view-invites",
  "view-members", "view-settings", "view-class-settings", "view-changelog", "view-report", "view-reports", "view-install", "view-feedback",
  "view-electives", "view-subjects", "view-deleted",
];

function currentView() {
  // Eine gerade ausblendende Seite zählt nicht mehr.
  return VIEWS.find((v) => !$(v).hidden && !$(v).classList.contains("view-leave")) || null;
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Blendet eine Seite aus, während die neue schon einblendet (Überblendung statt hartem Umschalten). */
function leaveView(el) {
  if (reducedMotion.matches) {
    el.hidden = true;
    return;
  }
  // Bleibt an ihrer Stelle liegen (absolut über der neuen Seite) und blendet aus.
  el.style.top = `${el.offsetTop - window.scrollY}px`;
  el.classList.add("view-leave");
  const done = () => {
    el.removeEventListener("animationend", done);
    clearTimeout(timer);
    // Wurde die Seite inzwischen wieder angezeigt, hat show() „view-leave“ schon entfernt.
    const stillLeaving = el.classList.contains("view-leave");
    el.classList.remove("view-leave");
    el.style.removeProperty("top");
    if (stillLeaving) el.hidden = true;
  };
  const timer = setTimeout(done, 400); // Sicherheitsnetz, falls animationend ausbleibt
  el.addEventListener("animationend", done);
}

// ---------- Zurück (Pfeil oben links, Zurück-Taste/-Geste auf Android) ----------
//
// Jede Unterseite kennt ihre „Elternseite“. Der Browser-Verlauf bekommt beim Verlassen des Hefts
// genau einen Eintrag, damit die Zurück-Taste des Handys hier landet statt die App zu schließen.

function backActionFor(view) {
  switch (view) {
    case "view-task-form": return closeTaskForm;
    case "view-members":
    case "view-settings":
    case "view-report":
      return backToHeft;
    case "view-invites": return openMembers;
    case "view-electives": return closeElectives;
    case "view-subjects": return openClassSettings;
    case "view-deleted": return openClassSettings;
    case "view-class-settings": return backToHeft;
    case "view-changelog": return () => (changelogReturn === "view-settings" ? openSettings() : backToHeft());
    case "view-reports": return () => (reportsReturn === "view-members" ? openMembers() : openClass(state.membership.classId));
    case "view-feedback": return closeFeedback;
    case "view-install": return () => closeInstallGuide(1);
    case "view-name": return () => startJoin(pendingCode ? pendingCode.code : "");
    case "view-login": return cancelCreateClass;
    case "view-login-code": return () => show("view-login");
    case "view-create-class": return cancelCreateClass;
    case "view-code": return loadMemberships().length ? () => openClass(getActiveId()) : null;
    default: return null; // Heft und „Lädt …“: oberste Ebene
  }
}

function backToHeft() {
  reportingTask = null;
  // Fächer geändert oder Eintrag wiederhergestellt → Aufgaben neu laden (neue Namen, Wahlfach-Filter).
  if (state.subjectsDirty) {
    state.subjectsDirty = false;
    openClass(state.membership.classId);
    return;
  }
  show("view-class");
  renderDay();
}

const nav = { inSub: false, goingBack: false, ignorePop: false };

function updateNav(view) {
  const hasBack = Boolean(backActionFor(view));
  $("button-nav-back").hidden = !hasBack;
  if (nav.goingBack) return;
  if (hasBack && !nav.inSub) {
    history.pushState({ abgehakt: "sub" }, "");
    nav.inSub = true;
  } else if (!hasBack && nav.inSub) {
    // Auf normalem Weg zurück ins Heft: überzähligen Verlaufseintrag wieder entfernen.
    nav.inSub = false;
    nav.ignorePop = true;
    history.back();
  }
}

function goBack() {
  if (nav.inSub) history.back(); // → popstate → runBack()
  else runBack();
}

function runBack() {
  const action = backActionFor(currentView());
  if (!action) return;
  nav.goingBack = true;
  try {
    action();
  } finally {
    nav.goingBack = false;
  }
  // Noch auf einer Unterseite? Dann wieder einen Eintrag für das nächste Zurück anlegen.
  if (backActionFor(currentView())) {
    history.pushState({ abgehakt: "sub" }, "");
    nav.inSub = true;
  }
  $("button-nav-back").hidden = !backActionFor(currentView());
}

window.addEventListener("popstate", () => {
  // Einladungslink bei offener App: Manche Browser melden das auch als popstate – das ist kein
  // „Zurück“, darum kümmert sich der hashchange-Handler.
  if (location.hash.includes("code=")) return;
  if (nav.ignorePop) {
    nav.ignorePop = false;
    return;
  }
  nav.inSub = false;
  runBack();
});

function show(id) {
  const el = $(id);
  if (!el.hidden && !el.classList.contains("view-leave")) return; // schon sichtbar: nicht nach oben springen
  const leaving = currentView();
  // Kommt die Seite gerade aus einer Ausblendung zurück: sofort wieder normal anzeigen.
  el.classList.remove("view-leave");
  el.style.removeProperty("top");
  for (const v of VIEWS) {
    if (v === id) continue;
    if (v === leaving) leaveView($(v));
    else if (!$(v).classList.contains("view-leave")) $(v).hidden = true;
  }
  el.hidden = false;
  window.scrollTo(0, 0);
  // Sanftes Einblenden (per CSS, entfällt bei „Bewegung reduzieren“)
  el.classList.remove("view-enter");
  void el.offsetWidth;
  el.classList.add("view-enter");
  updateNav(id);
}

/** Tag wechseln mit kurzem Gleiten in Blätterrichtung (‹ = von links, › = von rechts). */
function changeDay(day) {
  if (day === state.day) return;
  const dir = day > state.day ? "next" : "prev";
  state.day = day;
  renderDay();
  if (reducedMotion.matches) return;
  for (const id of ["events-section", "day-groups", "empty-day"]) {
    const box = $(id);
    box.classList.remove("day-next", "day-prev");
    void box.offsetWidth;
    box.classList.add(`day-${dir}`);
  }
}

function showNotice(text) {
  const n = $("notice");
  n.textContent = text || "";
  n.hidden = !text;
}

function showError(id, text) {
  const e = $(id);
  e.textContent = text || "";
  e.hidden = !text;
}

function formatCode(value) {
  const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

function renderSwitcher(list, activeId) {
  const select = $("switcher");
  select.replaceChildren();
  for (const m of list) {
    select.append(el("option", { value: m.classId, text: m.className, selected: m.classId === activeId }));
  }
  $("switcher-wrap").hidden = list.length < 2;
}

// ---------- Zustand der geöffneten Klasse ----------

const state = {
  openReports: 0,        // offene Meldungen (nur für Admins)
  subjects: [],          // Fächerliste der Klasse [{ id, name, elective }]
  mySubjects: [],        // gewählte Wahlfächer (IDs)
  electivesChosen: false,
  canManageSubjects: false,
  subjectsDirty: false,  // Fächer geändert → beim Zurück ins Heft neu laden
  abRef: null,           // A/B-Wochen: Montag einer A-Woche, sonst null
  membership: null,      // Eintrag aus loadMemberships()
  tasks: [],
  canPostForClass: false,
  day: defaultDay(),
  homeDay: null,         // Start-Tag beim letzten Öffnen (heute bzw. Montag) – für den Tageswechsel über Nacht
  expanded: new Set(),   // aufgeklappte Aufgaben (IDs)
  editingId: null,       // null = neue Aufgabe
  offline: false,
};

function cacheKey() {
  return CACHE_PREFIX + state.membership.classId;
}

function saveCache() {
  writeJsonStorage(cacheKey(), {
    tasks: state.tasks,
    canPostForClass: state.canPostForClass,
    subjects: state.subjects,
    mySubjects: state.mySubjects,
    electivesChosen: state.electivesChosen,
    canManageSubjects: state.canManageSubjects,
    abWeeksRef: state.abRef,
    savedAt: Date.now(),
  });
}

function applySubjectInfo(info) {
  state.subjects = Array.isArray(info.subjects) ? info.subjects : [];
  state.mySubjects = Array.isArray(info.mySubjects) ? info.mySubjects : [];
  state.electivesChosen = Boolean(info.electivesChosen);
  state.canManageSubjects = Boolean(info.canManageSubjects);
  // Eintragende für bestimmte Fächer: nur diese Fächer für Klassen-Einträge (null = alle).
  state.postSubjects = Array.isArray(info.postSubjects) ? info.postSubjects : null;
  state.abRef = typeof info.abWeeksRef === "string" ? info.abWeeksRef : null;
}

// ---------- Wahlfächer: welche Aufgaben sieht diese Person? ----------

function hasElectives() {
  return state.subjects.some((s) => s.elective);
}

function showAllKey() {
  return `abgehakt.showAll.${state.membership.classId}`;
}

/** „Alle Fächer zeigen“ – nur für Admins und Eintragende, pro Klasse auf dem Gerät gemerkt. */
function showAllSubjects() {
  return state.canManageSubjects && readJsonStorage(showAllKey(), false) === true;
}

/**
 * Sichtbar ist eine Aufgabe, wenn sie privat ist, kein Wahlfach betrifft, die Person noch keine
 * Wahlfächer gewählt hat, „Alle Fächer“ aktiv ist – oder die Person das Wahlfach hat.
 */
function isTaskVisible(task) {
  if (task.private || !task.elective || !state.electivesChosen || showAllSubjects()) return true;
  return state.mySubjects.includes(task.subjectId);
}

function renderSubjectFilter() {
  const electives = hasElectives();
  $("electives-hint").hidden = !(electives && !state.electivesChosen);
  const bar = $("subject-filter");
  bar.hidden = !(electives && state.electivesChosen && state.canManageSubjects);
  if (bar.hidden) return;
  const all = showAllSubjects();
  $("subject-filter-text").textContent = all ? "Du siehst alle Fächer." : "Du siehst nur deine Fächer.";
  $("button-toggle-all-subjects").textContent = all ? "Nur meine Fächer" : "Alle Fächer zeigen";
}

// ---------- Meine Wahlfächer ----------

let electivesReturn = "view-class";
let electivesAfterJoin = false;

function openElectives({ afterJoin = false, returnTo = "view-class" } = {}) {
  electivesAfterJoin = afterJoin;
  electivesReturn = returnTo;
  $("electives-eyebrow").textContent = afterJoin ? "Fast fertig" : state.membership.className;
  const mine = new Set(state.mySubjects);
  const electives = state.subjects.filter((x) => x.elective);
  $("elective-list").replaceChildren(el("legend", { class: "visually-hidden", text: "Wahlfächer" }),
    ...(electives.length ? electives.map((x) => el("label", { class: "checkbox" },
      el("input", { type: "checkbox", value: x.id, checked: mine.has(x.id) }),
      el("span", { text: x.name }))) : [el("p", { class: "hint", text: "Eure Klasse hat keine Wahlfächer." })]));
  $("button-electives-skip").textContent = afterJoin ? "Später" : "Abbrechen";
  showError("error-electives", "");
  showNotice("");
  show("view-electives");
}

function closeElectives() {
  if (electivesAfterJoin) {
    electivesAfterJoin = false;
    if (canOfferInstall()) return openInstallGuide({ afterJoin: true });
  }
  if (electivesReturn === "view-settings") return openSettings();
  backToHeft();
}

async function onElectivesSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const subjectIds = [...$("elective-list").querySelectorAll("input:checked")].map((i) => i.value);
  button.disabled = true;
  showError("error-electives", "");
  try {
    const res = await api("/api/me/subjects", { method: "PUT", body: { subjectIds }, token: state.membership.token });
    state.mySubjects = res.mySubjects;
    state.electivesChosen = true;
    saveCache();
    closeElectives();
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-electives", err.offline ? "Speichern geht nur mit Internet." : err.message);
  } finally {
    button.disabled = false;
  }
}

function toggleAllSubjects() {
  writeJsonStorage(showAllKey(), !showAllSubjects());
  renderDay();
}

// ---------- Fächer verwalten (Admins, Eintragende) ----------


function renderTimetableSettings() {
  const on = Boolean(state.abRef);
  $("input-ab-weeks").checked = on;
  $("ab-current").hidden = !on;
  const monday = mondayOf(defaultDay());
  $("ab-current-label").textContent = `Die Woche ab ${DATE_SHORT.format(fromDateStr(monday))} ist eine:`;
  const current = weekType(monday);
  for (const r of document.querySelectorAll('input[name="ab-current"]')) r.checked = r.value === current;
}

async function saveTimetable(abWeeks, currentWeek) {
  showError("error-subjects", "");
  try {
    const res = await api("/api/timetable", {
      method: "PUT",
      body: { abWeeks, currentWeek, monday: mondayOf(defaultDay()) },
      token: state.membership.token,
    });
    if (res.abWeeksRef && !state.abRef) {
      for (const sub of state.subjects) if (!(sub.daysB || []).length) sub.daysB = [...(sub.daysA || [])];
    }
    state.abRef = res.abWeeksRef;
    state.subjectsDirty = true;
    saveCache();
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-subjects", err.offline ? "Fächer verwalten geht nur mit Internet." : err.message);
  }
  renderSubjectAdmin();
}

function renderSubjectAdmin() {
  renderTimetableSettings();
  const list = state.subjects;
  $("subjects-empty").hidden = list.length > 0;
  $("subject-admin-list").hidden = !list.length;
  $("subject-admin-list").replaceChildren(...list.map((sub) => {
    const box = el("input", { type: "checkbox", checked: sub.elective });
    box.addEventListener("change", () => updateSubjectAdmin(sub, { elective: box.checked }));
    const weeks = state.abRef ? [["daysA", "A"], ["daysB", "B"]] : [["daysA", ""]];
    const dayRows = weeks.map(([key, label]) => el("div", { class: "weekdays", role: "group", "aria-label": `Unterrichtstage ${sub.name}${label ? ` (${label}-Woche)` : ""}` },
      label ? el("span", { class: "weekdays-label", text: label }) : null,
      ...WEEKDAY_LABELS.map((name, i) => {
        const input = el("input", { type: "checkbox", checked: (sub[key] || []).includes(i + 1) });
        input.addEventListener("change", () => {
          const days = new Set(sub[key] || []);
          if (input.checked) days.add(i + 1); else days.delete(i + 1);
          updateSubjectAdmin(sub, { [key]: [...days].sort() });
        });
        return el("label", { class: "day-chip" }, input, el("span", { text: name }));
      })));
    return el("li", { class: "member" },
      el("div", { class: "member-head" },
        el("span", { class: "member-name", text: sub.name }),
        sub.elective ? el("span", { class: "role-badge role-editor", text: "Wahlfach" }) : null),
      ...dayRows,
      el("div", { class: "member-actions" },
        el("label", { class: "checkbox subject-elective" }, box, el("span", { text: "Wahlfach" })),
        el("button", { class: "button button-small", type: "button", text: "Umbenennen", onclick: () => renameSubject(sub) }),
        el("button", { class: "button button-small button-danger", type: "button", text: "Entfernen", onclick: () => archiveSubjectAdmin(sub) })));
  }));
}

async function openSubjectsAdmin() {
  $("subjects-class-name").textContent = state.membership.className;
  $("input-subject-name").value = "";
  $("input-subject-elective").checked = false;
  showError("error-subjects", "");
  showNotice("");
  renderSubjectAdmin();
  show("view-subjects");
  try {
    applySubjectInfo(await api("/api/subjects", { token: state.membership.token }));
    saveCache();
    renderSubjectAdmin();
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-subjects", err.offline ? "Fächer verwalten geht nur mit Internet." : err.message);
  }
}

function sortSubjects() {
  state.subjects.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

async function onSubjectSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const name = $("input-subject-name").value.trim();
  if (!name) return showError("error-subjects", "Bitte einen Namen für das Fach eingeben.");
  button.disabled = true;
  showError("error-subjects", "");
  try {
    const res = await api("/api/subjects", {
      method: "POST",
      body: { name, elective: $("input-subject-elective").checked },
      token: state.membership.token,
    });
    state.subjects.push(res.subject);
    sortSubjects();
    state.subjectsDirty = true;
    saveCache();
    $("input-subject-name").value = "";
    $("input-subject-elective").checked = false;
    renderSubjectAdmin();
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-subjects", err.offline ? "Fächer verwalten geht nur mit Internet." : err.message);
  } finally {
    button.disabled = false;
  }
}

async function updateSubjectAdmin(sub, changes) {
  showError("error-subjects", "");
  try {
    const res = await api(`/api/subjects/${sub.id}`, { method: "PATCH", body: changes, token: state.membership.token });
    Object.assign(sub, res.subject);
    sortSubjects();
    state.subjectsDirty = true;
    saveCache();
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-subjects", err.offline ? "Fächer verwalten geht nur mit Internet." : err.message);
  }
  renderSubjectAdmin();
}

function renameSubject(sub) {
  const name = window.prompt(`Neuer Name für ${sub.name}:`, sub.name);
  if (name === null || !name.trim() || name.trim() === sub.name) return;
  updateSubjectAdmin(sub, { name });
}

async function archiveSubjectAdmin(sub) {
  if (!window.confirm(`„${sub.name}“ aus der Fächerliste entfernen? Bisherige Hausaufgaben bleiben erhalten und sind dann für alle sichtbar.`)) return;
  showError("error-subjects", "");
  try {
    await api(`/api/subjects/${sub.id}/archive`, { method: "POST", token: state.membership.token });
    state.subjects = state.subjects.filter((x) => x.id !== sub.id);
    state.subjectsDirty = true;
    saveCache();
    renderSubjectAdmin();
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-subjects", err.offline ? "Fächer verwalten geht nur mit Internet." : err.message);
  }
}

function renderSettingsSubjects() {
  const electives = state.subjects.filter((x) => x.elective);
  const mine = electives.filter((x) => state.mySubjects.includes(x.id)).map((x) => x.name);
  $("settings-electives-text").textContent = !electives.length
    ? "Eure Klasse hat keine Wahlfächer – du siehst alle Hausaufgaben."
    : !state.electivesChosen
      ? "Du hast deine Wahlfächer noch nicht gewählt und siehst deshalb alle Hausaufgaben."
      : mine.length ? `Deine Wahlfächer: ${mine.join(", ")}.` : "Du hast keine Wahlfächer gewählt.";
  $("button-my-electives").hidden = !electives.length;
}

function findTask(id) {
  return state.tasks.find((t) => t.id === id);
}

// ---------- Tagesansicht ----------

// ---------- Design: Standard, fertige Farben oder eigene Farbe (pro Gerät) ----------
// Aus einer Grundfarbe werden alle Farb-Variablen abgeleitet – für dunkel und hell passend (Akzent kräftig,
// Flächen nur leicht getönt). Gesetzt wird über CSSOM (style.setProperty), das erlaubt die CSP.
// „Standard“ entfernt alle Werte wieder – dann gilt style.css unverändert.
const THEME_KEY = "abgehakt.theme"; // { name: "pink" } oder { name: "custom", color: "#rrggbb" }
const THEMES = [
  ["standard", "Standard", "#5e6ad2"],
  ["pink", "Pink", "#e0479e"],
  ["rot", "Rot", "#e5484d"],
  ["orange", "Orange", "#e8772e"],
  ["gelb", "Gelb", "#d9a521"],
  ["gruen", "Grün", "#3fa66b"],
  ["tuerkis", "Türkis", "#1fa3a3"],
  ["blau", "Blau", "#3b82f6"],
  ["lila", "Lila", "#9b5de5"],
];
const THEME_VARS = ["--bg", "--surface", "--surface-hover", "--border", "--accent", "--accent-soft", "--accent-hover", "--link", "--on-accent", "--shot-shadow"];
const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");

function readTheme() {
  try {
    const t = JSON.parse(localStorage.getItem(THEME_KEY) || "null");
    if (t && (THEMES.some(([n]) => n === t.name) || (t.name === "custom" && /^#[0-9a-f]{6}$/i.test(t.color)))) return t;
    if (localStorage.getItem("abgehakt.pink") === "1") return { name: "pink" }; // früheres pinkes Design übernehmen
  } catch { /* kein Speicher → Standard */ }
  return { name: "standard" };
}

function themeColor(t) {
  return t.name === "custom" ? t.color : (THEMES.find(([n]) => n === t.name) || THEMES[0])[2];
}

function hexToHsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hsl = (h, s, l, a = 1) => `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%${a < 1 ? ` / ${a}` : ""})`;

/** Variablen für eine Grundfarbe; Graustufen bleiben grau (Sättigung wird nur begrenzt, nie erfunden). */
function themeVars(hex, dark) {
  const [h, s0, l0] = hexToHsl(hex);
  const s = clamp(s0, 0, 85), tint = Math.min(s, 40);
  const accentL = dark ? clamp(l0, 55, 68) : clamp(l0, 36, 48);
  const vars = dark ? {
    "--bg": hsl(h, tint * 0.45, 4.5), "--surface": hsl(h, tint * 0.4, 7.5), "--surface-hover": hsl(h, tint * 0.4, 10.5),
    "--border": hsl(h, tint * 0.35, 16), "--accent": hsl(h, s, accentL), "--accent-hover": hsl(h, s, accentL + 6),
    "--accent-soft": hsl(h, s, accentL, 0.18), "--shot-shadow": hsl(h, s, accentL, 0.2),
  } : {
    "--bg": hsl(h, tint * 1.6, 98.6), "--surface": hsl(h, tint * 1.3, 96.2), "--surface-hover": hsl(h, tint * 1.2, 93.6),
    "--border": hsl(h, tint * 1.0, 88), "--accent": hsl(h, s, accentL), "--accent-hover": hsl(h, s, accentL - 7),
    "--accent-soft": hsl(h, s, accentL, 0.11), "--shot-shadow": hsl(h, s, accentL, 0.14),
  };
  // Schrift auf farbigen Knöpfen: weiß – bei hellen Akzentfarben (z. B. Gelb, Türkis im Dunkeln) dunkel, damit lesbar.
  const lum = luminance(h, s, accentL);
  vars["--on-accent"] = 1.05 / (lum + 0.05) >= 3.3 ? "#fff" : "#111"; // weiß, solange gut lesbar (Kontrast ≥ 3,3)
  // Links: Kontrast zum Hintergrund mindestens 4,6 (WCAG AA) – im Dunkeln heller, im Hellen dunkler als die Akzentfarbe.
  const bgLum = dark ? luminance(h, tint * 0.45, 4.5) : luminance(h, tint * 1.6, 98.6);
  let linkL = accentL;
  const contrast = (l) => { const x = luminance(h, s, l); return (Math.max(x, bgLum) + 0.05) / (Math.min(x, bgLum) + 0.05); };
  while (contrast(linkL) < 4.6 && linkL > 5 && linkL < 95) linkL += dark ? 2 : -2;
  vars["--link"] = hsl(h, s, linkL);
  return vars;
}

/** Relative Helligkeit (WCAG) einer HSL-Farbe, 0 = schwarz, 1 = weiß. */
function luminance(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const [r, g, b] = [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function applyTheme() {
  const root = document.documentElement.style;
  const t = readTheme();
  if (t.name === "standard") {
    for (const v of THEME_VARS) root.removeProperty(v);
    return;
  }
  for (const [k, v] of Object.entries(themeVars(themeColor(t), darkScheme.matches))) root.setProperty(k, v);
}

function saveTheme(t) {
  try { localStorage.setItem(THEME_KEY, JSON.stringify(t)); localStorage.removeItem("abgehakt.pink"); } catch { /* egal */ }
  applyTheme();
  renderThemeCard();
}

function renderThemeCard() {
  const t = readTheme();
  $("theme-swatches").replaceChildren(...THEMES.map(([name, label, color]) => {
    const dot = el("span");
    dot.style.setProperty("--swatch", color);
    const b = el("button", { class: "theme-swatch", type: "button", "aria-pressed": String(t.name === name) }, dot, el("span", { text: label }));
    b.addEventListener("click", () => saveTheme({ name }));
    return b;
  }));
  $("input-theme-color").value = themeColor(t);
}

darkScheme.addEventListener("change", applyTheme);
applyTheme(); // gleich beim Start, damit nichts aufblitzt

// Testversion (Worker „abgehakt-test“, eigene Datenbank): deutlich kennzeichnen.
$("test-banner").hidden = !location.hostname.startsWith("abgehakt-test.");

function renderClassHeader() {
  renderWhatsNew();
  const m = state.membership;
  $("button-refresh").hidden = false;
  $("class-name").textContent = m.className;
  $("class-role").textContent = ROLE_LABELS[m.role] || "";
  $("member-name").textContent = m.memberName;
  document.title = `${m.className} – Abgehakt`;
  fitClassHead();
}

/** Passt der Klassenname nicht in eine Zeile neben „Mitglieder“ und Zahnrad, stehen die Knöpfe darunter. */
function fitClassHead() {
  const head = document.querySelector(".class-head");
  const name = $("class-name");
  if (!head || !name.offsetParent) return; // unsichtbar → beim nächsten Anzeigen
  head.classList.remove("is-stacked");
  const style = getComputedStyle(name);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3; // „normal“ ≈ 1,2–1,3
  head.classList.toggle("is-stacked", name.getBoundingClientRect().height > lineHeight * 1.5);
}

function updateSyncInfo() {
  const info = $("sync-info");
  const n = pendingCount();
  const parts = [];
  if (state.offline) parts.push("Offline – du siehst den zuletzt geladenen Stand.");
  if (n) parts.push(`${n} ${n === 1 ? "Änderung wird" : "Änderungen werden"} gesendet, sobald du online bist.`);
  info.textContent = parts.join(" ");
  info.hidden = parts.length === 0;
}

/** Tage von heute bis zum Abgabetag (Kalendertage, negativ = überfällig). */
function daysUntil(dueDate) {
  return Math.round((fromDateStr(dueDate) - fromDateStr(today())) / 86400000);
}

/** Kurzer Hinweis „bis wann“ für jede Aufgabe, mit Dringlichkeit für die Farbe. */
/**
 * „Heute“-Ansicht (bzw. am Wochenende der Montag, mit dem die App startet): relative Angaben
 * wie „morgen“ oder „in 3 Tagen“. Blättert man auf einen anderen Tag, steht nur das Datum da –
 * sonst würde dort „morgen“ stehen, obwohl vom gewählten Tag aus etwas anderes gemeint ist.
 */
function isHomeDay() {
  return state.day === defaultDay();
}

function dueInfo(dueDate) {
  const days = daysUntil(dueDate);
  const date = DATE_SHORT.format(fromDateStr(dueDate));
  if (!isHomeDay()) {
    // Farbe weiterhin nach echter Dringlichkeit, Text nur mit Datum.
    const level = days < 0 ? "overdue" : days === 0 ? "today" : days === 1 ? "soon" : "later";
    return { text: days < 0 ? `war fällig ${date}` : `bis ${date}`, level };
  }
  if (days < 0) return { text: `seit ${-days} ${days === -1 ? "Tag" : "Tagen"} fällig (${date})`, level: "overdue" };
  if (days === 0) return { text: "bis heute", level: "today" };
  if (days === 1) return { text: "bis morgen", level: "soon" };
  if (days === 2) return { text: `bis übermorgen · ${date}`, level: "later" };
  return { text: `bis ${date} · in ${days} Tagen`, level: "later" };
}

// ---------- Termine (Schulaufgaben, Kurzarbeiten …) ----------

const KIND_LABELS = {
  homework: "Hausaufgabe",
  exam: "Schulaufgabe",
  short_exam: "Kurzarbeit",
  test: "Test / Abfrage",
  presentation: "Referat / Abgabe",
  other: "Sonstiger Termin",
};

function isEvent(task) {
  return Boolean(task.kind) && task.kind !== "homework";
}

/** Bezeichnung eines Eintrags: der Text – bei Terminen die Art (+ Text, falls vorhanden). */
function taskLabel(task) {
  if (!isEvent(task)) return task.title;
  if (task.kind === "other") return task.title || "Termin"; // sonstiger Termin: der Text sagt, was es ist
  const kind = KIND_LABELS[task.kind] || "Termin";
  return task.title ? `${kind} · ${task.title}` : kind;
}

/** Wie dueInfo(), aber für Termine: „am …“ statt „bis …“. */
function eventInfo(dueDate) {
  const days = daysUntil(dueDate);
  const date = DATE_SHORT.format(fromDateStr(dueDate));
  const level = days < 0 ? "overdue" : days === 0 ? "today" : days <= 2 ? "soon" : "later";
  if (days < 0) return { text: `war am ${date}`, level };
  if (!isHomeDay()) return { text: `am ${date}`, level };
  if (days === 0) return { text: "heute", level };
  if (days === 1) return { text: `morgen · ${date}`, level };
  if (days === 2) return { text: `übermorgen · ${date}`, level };
  return { text: `am ${date} · in ${days} Tagen`, level };
}

function dueLabel(dueDate) {
  if (!isHomeDay()) return `Fällig ${DATE_LONG.format(fromDateStr(dueDate))}`;
  const rel = relativeDay(dueDate);
  const date = DATE_SHORT.format(fromDateStr(dueDate));
  if (["Heute", "Morgen", "Übermorgen", "Gestern"].includes(rel)) return `${rel} fällig · ${date}`;
  return `Fällig ${DATE_LONG.format(fromDateStr(dueDate))}`;
}

/**
 * Tagesansicht: alles, was ab diesem Tag noch ansteht – gruppiert nach Abgabetag.
 * Für vergangene Tage nur Aufgaben, die damals schon eingetragen waren.
 */
const KIND_FILTER_KEY = "abgehakt.kindFilter";
const EVENTS_AHEAD_DAYS = 7; // so weit voraus stehen Termine unter „Alles“

/** Gewählter Filter im Heft (pro Gerät gemerkt): "all", "homework" oder "events". */
function kindFilter() {
  const v = readJsonStorage(KIND_FILTER_KEY, "all");
  return ["all", "homework", "events"].includes(v) ? v : "all";
}

function renderDay() {
  fitClassHead();
  const day = state.day;
  const t = today();
  $("day-relative").textContent = relativeDay(day);
  $("day-label").setAttribute("aria-label", `Zurück zu heute (angezeigt: ${relativeDay(day) ? `${relativeDay(day)}, ` : ""}${DATE_LONG.format(fromDateStr(day))})`);
  const week = weekType(day);
  $("day-date").textContent = DATE_LONG.format(fromDateStr(day)) + (week ? ` · ${week.toUpperCase()}-Woche` : "");

  const visible = onlyNextOfSeries(state.tasks.filter((x) => isTaskVisible(x) && x.dueDate >= day
    && (day >= t || !x.createdAt || toDateStr(new Date(x.createdAt)) <= day)));

  // Filter „Alles · Hausaufgaben · Termine“ – nur sichtbar, wenn es Termine gibt.
  const anyEvents = state.tasks.some((x) => isEvent(x) && isTaskVisible(x));
  const filter = anyEvents ? kindFilter() : "all";
  $("kind-filter").hidden = !anyEvents;
  for (const b of $("kind-filter").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.filter === filter));

  // Termine stehen gesammelt oben, Hausaufgaben nach Abgabetag gruppiert darunter.
  const events = filter === "homework" ? [] : visible.filter(isEvent).sort((a, b) => a.dueDate.localeCompare(b.dueDate)
    || a.subject.localeCompare(b.subject, "de"));
  // Unter „Alles“ nur die Termine der nächsten Tage – der Rest steht unter „Termine“.
  const soon = filter === "events" ? events : events.filter((x) => x.dueDate <= addDays(day, EVENTS_AHEAD_DAYS));
  const later = events.length - soon.length;
  $("events-title").textContent = filter === "events" ? "Termine" : `Termine · nächste ${EVENTS_AHEAD_DAYS} Tage`;
  $("events-list").replaceChildren(...soon.map((x) => renderTask(x, true)));
  $("events-list").hidden = soon.length === 0;
  $("button-more-events").hidden = later === 0;
  $("button-more-events").textContent = soon.length
    ? `+ ${later} ${later === 1 ? "weiterer Termin" : "weitere Termine"} später`
    : `${later} ${later === 1 ? "Termin" : "Termine"} in mehr als ${EVENTS_AHEAD_DAYS} Tagen – anzeigen`;
  $("events-section").hidden = events.length === 0;
  const homework = filter === "events" ? [] : visible.filter((x) => !isEvent(x));

  const groups = new Map();
  for (const task of homework) {
    if (!groups.has(task.dueDate)) groups.set(task.dueDate, []);
    groups.get(task.dueDate).push(task);
  }
  const sections = [...groups.keys()].sort().map((dueDate) => {
    const tasks = groups.get(dueDate).sort((a, b) =>
      (a.status === "done") - (b.status === "done") || a.subject.localeCompare(b.subject, "de"));
    return el("section", { class: "task-section" },
      el("h2", { class: `section-title${dueDate === t ? " is-today" : ""}`, text: dueLabel(dueDate) }),
      el("ul", { class: "task-list" }, ...tasks.map((x) => renderTask(x, false))));
  });
  $("day-groups").replaceChildren(...sections);
  if (filter === "events") {
    $("empty-day").textContent = "Keine anstehenden Termine.";
    $("empty-day").hidden = events.length > 0;
  } else {
    $("empty-day").textContent = day < t ? "An diesem Tag stand nichts an." : "Keine offenen Hausaufgaben.";
    $("empty-day").hidden = homework.length > 0 || (filter === "all" && events.length > 0 && day < t);
  }

  // Nach dem Abgabetag verschwinden Aufgaben aus dem Heft – auch wenn sie nicht abgehakt sind (früher „Noch offen“).
  // Beim Zurückblättern auf ihren Tag sind sie weiter zu sehen.

  updateSyncInfo();
  renderSubjectFilter();
}

/**
 * Wiederkehrende Einträge: von jeder Reihe nur den nächsten zeigen (bei Hausaufgaben den nächsten noch nicht
 * abgehakten, sonst den ersten). Die späteren erscheinen, sobald der Tag erreicht ist.
 */
function onlyNextOfSeries(list) {
  const next = new Map();
  for (const x of [...list].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    if (!x.seriesId) continue;
    const cur = next.get(x.seriesId);
    if (!cur || (cur.status === "done" && !isEvent(cur) && x.status !== "done")) next.set(x.seriesId, x);
  }
  return list.filter((x) => !x.seriesId || next.get(x.seriesId) === x);
}

function renderTask(task, showDate) {
  const done = !isEvent(task) && task.status === "done";
  const expanded = state.expanded.has(task.id);

  const check = isEvent(task)
    // Termine kann man nicht abhaken – nur ein Kalender-Symbol an derselben Stelle.
    ? el("span", { class: "event-icon" }, svgIcon(ICON_CALENDAR, 18, 2))
    : el("button", {
    class: "check",
    type: "button",
    "aria-pressed": done ? "true" : "false",
    "aria-label": `${done ? "Wieder öffnen" : "Abhaken"}: ${taskLabel(task)}${task.subject ? ` (${task.subject})` : ""}`,
    onclick: () => toggleDone(task.id),
  }, svgIcon(ICON_CHECK, 16, 3));

  const meta = el("div", { class: "task-meta" });
  if (task.subject) meta.append(el("span", { class: `subject subject-${subjectColor(task.subject)}`, text: task.subject }));
  if (task.private) {
    meta.append(el("span", { class: "private-badge" }, svgIcon(ICON_LOCK, 12, 2), document.createTextNode("Nur für dich")));
  }
  const due = isEvent(task) ? eventInfo(task.dueDate) : dueInfo(task.dueDate);
  meta.append(el("span", { class: `due-badge due-${done ? "done" : due.level}`, text: due.text }));
  if (!isEvent(task) && task.doneBy && task.doneBy.length) meta.append(el("span", { class: "done-badge", text: `${task.doneBy.length} erledigt` }));
  const links = findLinks(task.title, task.details);
  const linkCount = links.length;
  // Adressen nicht als toten Text zeigen – sie stehen als Knöpfe im aufgeklappten Eintrag.
  const shownTitle = withoutLinks(taskLabel(task)) || (links[0] ? links[0].hostname.replace(/^www\./, "") : taskLabel(task));
  const shownDetails = withoutLinks(task.details);
  if (linkCount) meta.append(el("span", { class: "link-badge" }, svgIcon(ICON_LINK, 12, 2), document.createTextNode(linkCount === 1 ? "Link" : `${linkCount} Links`)));
  if (isLocalId(task.id)) meta.append(el("span", { class: "pending-badge", text: "wird gesendet …" }));
  if (task.seriesId) meta.append(el("span", { class: "series-badge", text: "↻ wiederkehrend" }));

  const body = el("button", {
    class: "task-main",
    type: "button",
    "aria-expanded": expanded ? "true" : "false",
    onclick: () => toggleExpanded(task.id),
  },
    meta.childElementCount ? meta : null,
    el("span", { class: `task-title${isEvent(task) ? " event-title" : ""}`, text: shownTitle }),
    shownDetails ? el("span", { class: "task-details", text: shownDetails }) : null,
    !expanded && task.note ? el("span", { class: "task-note-preview", text: `Notiz: ${task.note}` }) : null,
  );

  const popped = state.justToggled === task.id ? " just-toggled" : "";
  const li = el("li", { class: `task${done ? " is-done" : ""}${popped}`, "data-id": task.id }, check, el("div", { class: "task-content" }, body));
  if (expanded) li.querySelector(".task-content").append(renderTaskExtra(task));
  return li;
}

function renderTaskExtra(task) {
  const noteId = `note-${task.id}`;
  const note = el("textarea", { id: noteId, class: "input textarea note", rows: "2", maxlength: "1000", placeholder: "Nur du siehst diese Notiz." });
  note.value = task.note || "";
  const saved = el("span", { class: "hint note-status", "aria-live": "polite" });
  let timer = null;
  const save = async () => {
    clearTimeout(timer);
    if (note.value.trim() === (task.note || "")) return;
    saved.textContent = "Speichert …";
    const offlineSave = () => {
      task.note = note.value.trim();
      queueState(task.id, { note: task.note });
      saveCache();
      saved.textContent = "Auf dem Gerät gespeichert – wird gesendet, sobald du online bist";
      updateSyncInfo();
    };
    if (isLocalId(task.id) || pendingCount()) {
      offlineSave();
      if (!isLocalId(task.id)) flushQueue().then(updateSyncInfo);
      return;
    }
    try {
      const res = await api(`/api/tasks/${task.id}/state`, { method: "PUT", body: { note: note.value }, token: state.membership.token });
      task.note = res.note;
      saveCache();
      saved.textContent = "Gespeichert";
    } catch (err) {
      if (handleAuthError(err)) return;
      if (err.offline) offlineSave();
      else saved.textContent = err.message;
    }
  };
  note.addEventListener("input", () => {
    clearTimeout(timer);
    saved.textContent = "";
    timer = setTimeout(save, 1000);
  });
  note.addEventListener("blur", save);

  const doneBy = !isEvent(task) && task.doneBy && task.doneBy.length
    ? el("p", { class: "hint", text: `Erledigt von: ${task.doneBy.join(", ")}` })
    : null;

  const days = daysUntil(task.dueDate);
  const when = days === 0 ? "heute" : days === 1 ? "morgen" : days === 2 ? "übermorgen"
    : days > 0 ? `in ${days} Tagen` : `vor ${-days} ${days === -1 ? "Tag" : "Tagen"}`;
  const dueLine = el("p", { class: "hint", text: `${isEvent(task) ? "Termin" : "Abgabe"}: ${DATE_FULL.format(fromDateStr(task.dueDate))}${isHomeDay() ? ` (${when})` : ""}` });

  const changed = task.updatedByName
    ? el("p", { class: "hint", text: `Zuletzt geändert von ${task.updatedByName} · ${DATETIME.format(new Date(task.updatedAt))}` })
    : null;

  const actions = el("div", { class: "task-actions" });
  if (task.canEdit) actions.append(el("button", { class: "button button-small", type: "button", text: "Bearbeiten", onclick: () => openTaskForm(task) }));
  if (task.canDelete) actions.append(el("button", { class: "button button-small button-danger", type: "button", text: "Löschen", onclick: () => deleteTask(task) }));
  if (task.canDelete && laterInSeries(task).length) {
    actions.append(el("button", { class: "button button-small button-danger", type: "button", text: "Ab hier alle löschen", onclick: () => deleteTask(task, { following: true }) }));
  }
  if (!task.private && !isLocalId(task.id)) {
    actions.append(el("button", { class: "link-button report-link", type: "button", text: "Melden", onclick: () => openReportForm(task) }));
  }

  const links = findLinks(task.title, task.details);
  const linkBox = links.length ? el("div", { class: "task-links" }, ...links.map(renderLink)) : null;

  return el("div", { class: "task-extra" },
    linkBox,
    el("label", { for: noteId, class: "note-label", text: "Private Notiz" }),
    note,
    saved,
    dueLine,
    doneBy,
    changed,
    actions.childElementCount ? actions : null,
  );
}

function toggleExpanded(id) {
  if (state.expanded.has(id)) state.expanded.delete(id);
  else state.expanded.add(id);
  renderDay();
}


// ---------- Offline: Warteschlange ----------
//
// Abhaken, Notizen und neue Aufgaben funktionieren auch ohne Netz. Sie werden auf dem Gerät
// gespeichert und nachgeschickt, sobald wieder Verbindung besteht. Einträge:
//   { kind: "create", tempId, body, task }   neue Aufgabe (task = lokale Anzeige)
//   { kind: "state", taskId, status?, note? } Status/Notiz (pro Aufgabe zusammengefasst)

function loadQueue(classId) {
  const q = readJsonStorage(QUEUE_PREFIX + classId, []);
  return Array.isArray(q) ? q : [];
}

function saveQueue(classId, q) {
  if (q.length) writeJsonStorage(QUEUE_PREFIX + classId, q);
  else try { localStorage.removeItem(QUEUE_PREFIX + classId); } catch { /* egal */ }
}

function isLocalId(id) {
  return typeof id === "string" && id.startsWith("local-");
}

function queueState(taskId, fields) {
  const classId = state.membership.classId;
  const q = loadQueue(classId);
  const op = q.find((o) => o.kind === "state" && o.taskId === taskId);
  if (op) Object.assign(op, fields);
  else q.push({ kind: "state", taskId, ...fields });
  saveQueue(classId, q);
}

/** Wendet noch nicht gesendete Änderungen auf frisch geladene Aufgaben an. */
function applyQueue(tasks, q) {
  const list = tasks.slice();
  for (const op of q) {
    if (op.kind === "create" && !list.some((t) => t.id === op.tempId)) list.push(op.task);
  }
  for (const op of q) {
    if (op.kind !== "state") continue;
    const t = list.find((x) => x.id === op.taskId);
    if (!t) continue;
    if ("status" in op) t.status = op.status;
    if ("note" in op) t.note = op.note;
  }
  return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.subject.localeCompare(b.subject, "de"));
}

let flushing = null;

/** Schickt die Warteschlange einer Klasse ab. Bricht offline ab und versucht es später erneut. */
function flushQueue(m = state.membership) {
  if (!m) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    let q = loadQueue(m.classId);
    while (q.length) {
      const op = q[0];
      try {
        if (op.kind === "create") {
          const res = await api("/api/tasks", { method: "POST", body: op.body, token: m.token });
          // Spätere Einträge auf die echte ID umstellen.
          for (const o of q) if (o.kind === "state" && o.taskId === op.tempId) o.taskId = res.task.id;
          if (state.membership === m) {
            state.tasks = state.tasks.map((t) => (t.id === op.tempId ? { ...res.task, status: t.status, note: t.note } : t));
            if (state.expanded.delete(op.tempId)) state.expanded.add(res.task.id);
          }
        } else if (op.kind === "state" && !isLocalId(op.taskId)) {
          const body = {};
          if ("status" in op) body.status = op.status;
          if ("note" in op) body.note = op.note;
          await api(`/api/tasks/${op.taskId}/state`, { method: "PUT", body, token: m.token });
        }
      } catch (err) {
        if (err.offline || err.status === 429) break; // weiter warten (offline oder gerade zu viele Einträge)
        if (err.status === 401) {
          if (state.membership === m) handleAuthError(err);
          return;
        }
        // Z. B. Aufgabe inzwischen gelöscht: diesen Eintrag verwerfen, Rest weiter senden.
        showNotice(`Eine offline gemachte Änderung konnte nicht gespeichert werden: ${err.message}`);
        if (op.kind === "create") {
          q = q.filter((o) => o === op || o.taskId !== op.tempId);
          if (state.membership === m) state.tasks = state.tasks.filter((t) => t.id !== op.tempId);
        }
      }
      q.shift();
      saveQueue(m.classId, q);
    }
    if (state.membership === m) {
      saveCache();
      renderDay();
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

function pendingCount() {
  return state.membership ? loadQueue(state.membership.classId).length : 0;
}

// ---------- Aktionen ----------

async function toggleDone(id) {
  const task = findTask(id);
  if (!task) return;
  const before = task.status;
  task.status = before === "done" ? "open" : "done";
  state.justToggled = id; // kleiner „Plopp“ nur an dieser Aufgabe
  renderDay(); // sofort anzeigen, dann speichern
  state.justToggled = null;
  saveCache();
  if (isLocalId(id) || pendingCount()) {
    // Offline oder es wartet schon etwas: hinten anstellen, damit die Reihenfolge stimmt.
    queueState(id, { status: task.status });
    renderDay();
    if (!isLocalId(id)) flushQueue();
    return;
  }
  try {
    await api(`/api/tasks/${id}/state`, { method: "PUT", body: { status: task.status }, token: state.membership.token });
  } catch (err) {
    if (handleAuthError(err)) return;
    if (err.offline) {
      queueState(id, { status: task.status });
      state.offline = true;
      renderDay();
      return;
    }
    task.status = before;
    saveCache();
    renderDay();
    showNotice(err.message);
  }
}

/** Spätere Einträge derselben Reihe (wiederkehrend), die schon geladen sind. */
function laterInSeries(task) {
  if (!task.seriesId) return [];
  return state.tasks.filter((t) => t.seriesId === task.seriesId && t.dueDate > task.dueDate);
}

async function deleteTask(task, { following = false } = {}) {
  const what = task.private ? "Diese private Aufgabe" : "Diese Aufgabe für die ganze Klasse";
  const question = following
    ? `„${taskLabel(task)}“ am ${DATE_SHORT.format(fromDateStr(task.dueDate))} und alle späteren dieser Reihe (${laterInSeries(task).length + 1} Einträge) ${task.private ? "" : "für die ganze Klasse "}löschen?`
    : `${what} löschen?\n\n„${taskLabel(task)}“`;
  if (!window.confirm(question)) return;
  if (isLocalId(task.id)) {
    // Noch nicht gesendet: einfach aus der Warteschlange nehmen.
    const classId = state.membership.classId;
    saveQueue(classId, loadQueue(classId).filter((o) => o.tempId !== task.id && o.taskId !== task.id));
    state.tasks = state.tasks.filter((t) => t.id !== task.id);
    saveCache();
    renderDay();
    return;
  }
  try {
    await api(`/api/tasks/${task.id}${following ? "?following=1" : ""}`, { method: "DELETE", token: state.membership.token });
    const gone = new Set([task.id, ...(following ? laterInSeries(task).map((t) => t.id) : [])]);
    state.tasks = state.tasks.filter((t) => !gone.has(t.id));
    state.expanded.delete(task.id);
    saveCache();
    renderDay();
  } catch (err) {
    if (handleAuthError(err)) return;
    showNotice(err.offline ? "Löschen geht nur mit Internet. Bitte später noch einmal versuchen." : err.message);
  }
}

function subjectById(id) {
  return state.subjects.find((x) => x.id === id) || null;
}

/** Fach-Auswahl im Formular: Liste der Klasse, ggf. ein entferntes Fach, „+ Neues Fach …“. */
// ---------- Wiederkehrende Einträge (z. B. jeden Montag Abfrage) ----------
const MAX_REPEATS = 40;
const WEEKDAY_PLURAL = ["sonntags", "montags", "dienstags", "mittwochs", "donnerstags", "freitags", "samstags"];

/** Termine der Reihe wie auf dem Server: ab dem ersten Datum jede (2.) Woche bis einschließlich „bis“. */
/** Gewählte Wiederholung: 0 = nicht, 1 / 2 = jede (2.) Woche, "lessons" = jede Stunde laut Stundenplan. */
function repeatMode() {
  const v = $("input-repeat").value;
  return v === "lessons" ? v : Number(v);
}

/** Hat das Fach an diesem Tag laut Stundenplan Unterricht (A/B-Woche beachtet)? */
function hasLessonOn(sub, d) {
  const days = weekType(d) === "b" ? sub.daysB || [] : sub.daysA || [];
  return days.includes(fromDateStr(d).getDay());
}

/** Termine der Reihe wie auf dem Server (repeatDates in src/api/tasks.js). */
function repeatDatesFor(first, every, until, sub = null) {
  const dates = [];
  if (!first || !until) return dates;
  if (every === "lessons") {
    if (!sub) return dates;
    for (let d = first; d <= until && dates.length <= MAX_REPEATS; d = addDays(d, 1)) if (hasLessonOn(sub, d)) dates.push(d);
    return dates;
  }
  for (let d = first; d <= until && dates.length <= MAX_REPEATS; d = addDays(d, 7 * every)) dates.push(d);
  return dates;
}

/** Fach im Formular, falls eines aus der Liste gewählt ist. */
function chosenSubject() {
  return subjectById($("input-subject-select").value);
}

function updateRepeatFields() {
  const every = repeatMode();
  $("repeat-until-fields").hidden = !every;
  if (!every) return;
  const first = $("input-due").value;
  // Vorschlag für „Bis“: rund 8 Wochen; liegt „Bis“ vor dem ersten Termin, neu vorschlagen.
  if (first && (!$("input-repeat-until").value || $("input-repeat-until").value <= first)) {
    $("input-repeat-until").value = addDays(first, 7 * (every === 2 ? 2 : 1) * 7);
  }
  const sub = chosenSubject();
  const hint = $("repeat-hint");
  if (every === "lessons" && !(sub && ((sub.daysA || []).length || (sub.daysB || []).length))) {
    hint.textContent = sub
      ? `Für ${sub.name} ist noch kein Stundenplan eingetragen (Einstellungen → Klasse → Fächer).`
      : "Bitte zuerst ein Fach wählen – die Stunden kommen aus dem Stundenplan.";
    return;
  }
  const dates = repeatDatesFor(first, every, $("input-repeat-until").value, sub);
  const day = first ? WEEKDAY_PLURAL[fromDateStr(first).getDay()] : "";
  const how = every === "lessons" ? `in jeder ${sub.name}-Stunde` : `${every === 2 ? "alle 2 Wochen" : "jede Woche"} ${day}`;
  hint.textContent = dates.length > MAX_REPEATS
    ? `Höchstens ${MAX_REPEATS} Termine auf einmal – bitte ein früheres Datum wählen.`
    : `${dates.length} Einträge, ${how}${every === "lessons" && dates.length ? ` (ab ${DATE_SHORT.format(fromDateStr(dates[0]))})` : ""}. Ferien bitte danach einzeln löschen.`;
}

/** Eintrag für die Klasse (nicht „Nur für mich“) von jemandem, der nur bestimmte Fächer eintragen darf? */
function limitedToMySubjects(task) {
  if (!state.postSubjects) return false;
  return task ? !task.private : state.canPostForClass && !$("input-private").checked;
}

function fillSubjectSelect(task, keep = null) {
  const sel = $("input-subject-select");
  const limited = limitedToMySubjects(task);
  // Eintragende mit Fach-Liste: für die Klasse nur ihre Fächer, kein „Kein Fach“, kein neues Fach.
  const options = limited ? [] : [el("option", { value: "", text: "Kein Fach" })];
  for (const sub of state.subjects) {
    if (limited && !state.postSubjects.includes(sub.id)) continue;
    options.push(el("option", { value: sub.id, text: sub.elective ? `${sub.name} (Wahlfach)` : sub.name }));
  }
  const inList = task && task.subjectId && subjectById(task.subjectId);
  if (task && task.subject && !inList) {
    options.push(el("option", { value: "__keep__", text: `${task.subject} (nicht mehr in der Liste)` }));
  }
  if (state.canManageSubjects) options.push(el("option", { value: "__new__", text: "+ Neues Fach …" }));
  sel.replaceChildren(...options);
  sel.value = !task ? "" : inList ? task.subjectId : task.subject ? "__keep__" : "";
  if (keep !== null && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
  if (sel.selectedIndex < 0 && sel.options.length) sel.selectedIndex = 0;
  $("subject-scope-hint").hidden = !limited;
  $("new-subject-fields").hidden = true;
  $("input-new-subject").value = "";
  $("input-new-subject-elective").checked = false;
}

// ---------- Eingefügte Nachrichten (z. B. aus Teams) aufteilen ----------

const TITLE_MAX = 200;

/**
 * Teilt einen eingefügten, mehrzeiligen Text auf: erste sinnvolle Zeile = Aufgabe, Rest = Details.
 * Eine erste Zeile ohne Leerzeichen mit „_“ (Kurs-/Teamname wie „2627_WPF_Sp12_2_Dö“) wird übersprungen.
 */
function splitPastedText(text) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/[\u00a0\t]+/g, " ").split("\n").map((l) => l.trim());
  while (lines.length && !lines[0]) lines.shift();
  let dropped = "";
  if (lines.length > 1 && /^\S*_\S*$/.test(lines[0])) dropped = lines.shift();
  while (lines.length && !lines[0]) lines.shift();
  let title = lines.shift() || "";
  let rest = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if ([...title].length > TITLE_MAX) {
    // Zu lang für eine Zeile: am letzten Leerzeichen kürzen, der Rest wandert in die Details.
    const chars = [...title];
    let cut = chars.slice(0, TITLE_MAX - 1).join("").lastIndexOf(" ");
    if (cut < 40) cut = chars.slice(0, TITLE_MAX - 1).join("").length;
    rest = `…${title.slice(cut).trim()}${rest ? `\n\n${rest}` : ""}`;
    title = `${title.slice(0, cut).trim()} …`;
  }
  return { title, details: rest, dropped };
}

function onTitlePaste(event) {
  const text = event.clipboardData?.getData("text/plain") || "";
  const input = $("input-title");
  if (!text.includes("\n") && [...text].length <= TITLE_MAX) return; // normale Eingabe
  event.preventDefault();
  const details = $("input-details");
  const parts = splitPastedText(text);
  if (input.value.trim()) {
    // Feld war schon ausgefüllt: alles in die Details.
    const all = [parts.title, parts.details].filter(Boolean).join("\n\n");
    details.value = [details.value.trim(), all].filter(Boolean).join("\n\n");
  } else {
    input.value = parts.title;
    if (parts.details) details.value = [details.value.trim(), parts.details].filter(Boolean).join("\n\n");
  }
  details.value = details.value.slice(0, 2000);
  const hint = $("paste-hint");
  hint.textContent = parts.details || input.value !== parts.title
    ? "Eingefügter Text aufgeteilt – der Rest steht unter „Details“."
    : "";
  hint.hidden = !hint.textContent;
}

/** Beschriftungen je nach Art: Hausaufgabe hat eine Abgabe, ein Termin ein Datum. */
function updateKindFields() {
  const kind = $("input-kind").value;
  const homework = kind === "homework";
  const other = kind === "other"; // sonstiger Termin: eigener Text, z. B. Klassenfoto
  $("label-due").textContent = homework ? "Abgabe am" : "Termin am";
  $("task-form-title").textContent = `${homework ? "Aufgabe" : "Termin"} ${state.editingId ? "bearbeiten" : "eintragen"}`;
  $("title-fields").hidden = !homework && !other;
  $("label-title").textContent = other ? "Was ist es?" : "Was ist zu tun?";
  $("input-title").placeholder = other ? "z. B. Klassenfoto, Wandertag, Elternabend" : "z. B. S. 42 Nr. 3 und 4";
  $("label-details").textContent = homework || other ? "Details" : "Themen / Details";
  $("input-details").placeholder = homework ? "" : other ? "z. B. Treffpunkt, was mitbringen" : "z. B. Lineare Funktionen, S. 20–35";
}

let dueTouched = false; // Abgabe von Hand geändert → nicht mehr automatisch vorschlagen

/** Abgabetag nach Stundenplan vorschlagen: nächste Stunde des gewählten Fachs. */
function suggestDue() {
  const hint = $("due-hint");
  if (state.editingId || dueTouched) return;
  if ($("input-kind").value !== "homework") {
    hint.hidden = true; // Termine haben ein festes Datum – kein Vorschlag nach Stundenplan
    return;
  }
  const sub = subjectById($("input-subject-select").value);
  const next = nextLesson(sub, state.day);
  $("input-due").value = next || stepSchoolDay(state.day, 1);
  hint.hidden = !next;
  if (next) hint.textContent = `Nächste Stunde ${sub.name}: ${DATE_SHORT.format(fromDateStr(next))} – du kannst das Datum ändern.`;
  updateRepeatFields();
}

/**
 * Doppelte Einträge: Gibt es schon einen sichtbaren Eintrag derselben Art im selben Fach mit demselben Datum?
 * Nur ein Hinweis – wer trotzdem speichern will, tippt ein zweites Mal.
 */
function findDuplicates(body, subjectId, isPrivate) {
  const subject = subjectId ? subjectById(subjectId) : null;
  const sameSubject = (t) => (subjectId
    ? t.subjectId === subjectId || (!t.subjectId && subject && t.subject === subject.name) // ältere Einträge: über den Namen
    : !t.subjectId && !t.subject);
  // Sonstige Termine: nur gleich, wenn auch der Text gleich ist (Klassenfoto ≠ Wandertag).
  const sameText = (t) => body.kind !== "other" || t.title.trim().toLowerCase() === body.title.trim().toLowerCase();
  return state.tasks.filter((t) => t.dueDate === body.dueDate
    && Boolean(t.private) === Boolean(isPrivate) // private Aufgaben sind kein Duplikat eines Klassen-Eintrags
    && (t.kind || "homework") === body.kind
    && sameSubject(t)
    && sameText(t)
    && isTaskVisible(t));
}

let dupConfirmedFor = ""; // Eingaben, für die der Hinweis schon gezeigt wurde

function resetDuplicateHint() {
  dupConfirmedFor = "";
  $("dup-hint").hidden = true;
  $("button-task-save").textContent = "Speichern";
}

function openTaskForm(task = null) {
  state.editingId = task ? task.id : null;
  $("input-private").checked = false; // vor fillSubjectSelect(): Klassen-Eintrag ist der Standard
  resetDuplicateHint();
  $("input-kind").value = task && task.kind ? task.kind : "homework";
  fillSubjectSelect(task);
  $("input-title").value = task ? task.title : "";
  $("input-details").value = task ? task.details : "";
  if (task && isEvent(task) && task.kind !== "other" && task.title) {
    // Ältere Termine mit Text: Text in die Details übernehmen (das Feld gibt es bei Terminen nicht).
    $("input-details").value = [task.title, task.details].filter(Boolean).join("\n\n");
    $("input-title").value = "";
  }
  // Neue Aufgabe: Abgabe standardmäßig am nächsten Schultag nach dem angezeigten Tag.
  $("input-due").value = task ? task.dueDate : stepSchoolDay(state.day, 1);
  dueTouched = Boolean(task);
  updateKindFields();
  $("paste-hint").hidden = true;
  $("due-hint").hidden = true;
  $("input-repeat").value = "0";
  $("repeat-fields").hidden = Boolean(task); // nur beim Eintragen, Bearbeiten betrifft immer einen Eintrag
  updateRepeatFields();
  $("input-private").checked = false;
  // Privat/Klasse lässt sich nur beim Eintragen wählen – und nur mit Eintragsrecht.
  $("private-row").hidden = Boolean(task) || !state.canPostForClass;
  $("private-hint").hidden = Boolean(task) || state.canPostForClass;
  showError("error-task", "");
  showNotice("");
  show("view-task-form");
  (task ? $("input-title") : $("input-subject-select")).focus();
}

async function onTaskSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const body = {
    kind: $("input-kind").value,
    title: $("input-title").value,
    details: $("input-details").value,
    dueDate: $("input-due").value,
  };
  if (body.kind === "other") {
    if (!body.title.trim()) return showError("error-task", "Bitte eintragen, was für ein Termin es ist.");
  } else if (body.kind !== "homework") body.title = ""; // Termine: Art, Fach und Datum reichen
  else if (!body.title.trim()) return showError("error-task", "Bitte eintragen, was zu tun ist.");
  if (!body.dueDate) return showError("error-task", "Bitte ein Abgabedatum wählen.");
  const choice = $("input-subject-select").value;
  if (choice === "__new__" && !$("input-new-subject").value.trim()) {
    return showError("error-task", "Bitte einen Namen für das neue Fach eingeben.");
  }
  // Nur beim Eintragen: Gibt es das schon? Dann einmal nachfragen.
  if (!state.editingId && choice !== "__new__") {
    const isPrivate = !state.canPostForClass || $("input-private").checked;
    const signature = JSON.stringify([body.kind, choice, body.dueDate, body.kind === "other" ? body.title.trim() : "", isPrivate]);
    const dups = findDuplicates(body, choice === "__keep__" ? null : choice || null, isPrivate);
    if (dups.length && dupConfirmedFor !== signature) {
      dupConfirmedFor = signature;
      $("dup-list").replaceChildren(...dups.slice(0, 3).map((t) => el("li", {},
        el("strong", { text: [t.subject, taskLabel(t)].filter(Boolean).join(" · ") || "Eintrag" }),
        el("span", { class: "hint", text: ` – ${isEvent(t) ? "am" : "bis"} ${DATE_SHORT.format(fromDateStr(t.dueDate))}` }))));
      $("dup-hint").hidden = false;
      $("button-task-save").textContent = "Trotzdem speichern";
      showError("error-task", "");
      $("dup-hint").scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
  }

  const every = state.editingId ? 0 : repeatMode();
  if (every) {
    const until = $("input-repeat-until").value;
    if (!until || until <= body.dueDate) return showError("error-task", "Bitte bei „Bis“ ein Datum nach dem ersten Termin wählen.");
    const dates = repeatDatesFor(body.dueDate, every, until, chosenSubject());
    if (every === "lessons" && !dates.length) {
      return showError("error-task", "Für „Jede Stunde“ braucht das Fach einen Stundenplan mit einer Stunde in diesem Zeitraum.");
    }
    if (dates.length > MAX_REPEATS) return showError("error-task", `Höchstens ${MAX_REPEATS} Wiederholungen auf einmal.`);
    body.repeat = { every, until };
  }

  button.disabled = true;
  showError("error-task", "");

  // Fach bestimmen (bei „Neues Fach“ zuerst anlegen – das geht nur mit Internet).
  if (choice === "__new__") {
    try {
      const res = await api("/api/subjects", {
        method: "POST",
        body: { name: $("input-new-subject").value, elective: $("input-new-subject-elective").checked },
        token: state.membership.token,
      });
      state.subjects.push(res.subject);
      state.subjects.sort((a, b) => a.name.localeCompare(b.name, "de"));
      body.subjectId = res.subject.id;
    } catch (err) {
      button.disabled = false;
      if (handleAuthError(err)) return;
      return showError("error-task", err.offline ? "Ein neues Fach anlegen geht nur mit Internet." : err.message);
    }
  } else if (choice !== "__keep__") {
    body.subjectId = choice || null;
  }
  // Noch nicht gesendete Aufgabe bearbeiten: nur lokal ändern.
  if (state.editingId && isLocalId(state.editingId)) {
    const classId = state.membership.classId;
    const q = loadQueue(classId);
    const op = q.find((o) => o.kind === "create" && o.tempId === state.editingId);
    const local = findTask(state.editingId);
    if (op && local) {
      Object.assign(op.body, body);
      const sub = "subjectId" in body ? subjectById(body.subjectId) : null;
      Object.assign(local, { kind: body.kind, title: body.title.trim(), details: body.details.trim(), dueDate: body.dueDate });
      if ("subjectId" in body) Object.assign(local, { subjectId: sub ? sub.id : null, subject: sub ? sub.name : "", elective: Boolean(sub && sub.elective) });
      op.task = { ...local };
      saveQueue(classId, q);
      saveCache();
    }
    button.disabled = false;
    closeTaskForm();
    return;
  }

  try {
    const token = state.membership.token;
    let res;
    if (state.editingId) {
      res = await api(`/api/tasks/${state.editingId}`, { method: "PATCH", body, token });
      state.tasks = state.tasks.map((t) => (t.id === res.task.id ? res.task : t));
    } else {
      body.private = $("input-private").checked;
      res = await api("/api/tasks", { method: "POST", body, token });
      state.tasks.push(...(res.tasks || [res.task]));
    }
    state.tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.subject.localeCompare(b.subject, "de"));
    saveCache();
    // Liegt der Abgabetag vor dem angezeigten Tag, dorthin springen – sonst ist die Aufgabe schon sichtbar.
    state.day = dayToShow(res.task.dueDate);
    show("view-class");
    renderDay();
    noticeIfPast(res.task.dueDate);
  } catch (err) {
    if (handleAuthError(err)) return;
    if (err.offline && body.repeat) {
      button.disabled = false;
      return showError("error-task", "Wiederkehrende Einträge gehen nur mit Internet.");
    }
    if (err.offline && !state.editingId) {
      saveTaskOffline(body);
    } else {
      showError("error-task", err.offline ? "Bearbeiten geht nur mit Internet. Bitte später noch einmal versuchen." : err.message);
    }
  } finally {
    button.disabled = false;
  }
}

/** Neue Aufgabe ohne Netz: lokal anzeigen und später senden. */
function saveTaskOffline(body) {
  const tempId = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const sub = subjectById(body.subjectId);
  const task = {
    id: tempId,
    subject: sub ? sub.name : "",
    subjectId: sub ? sub.id : null,
    elective: Boolean(sub && sub.elective),
    kind: body.kind,
    title: body.title.trim(),
    details: body.details.trim(),
    dueDate: body.dueDate,
    private: Boolean(body.private) || !state.canPostForClass,
    updatedByName: state.membership.memberName,
    createdAt: now,
    updatedAt: now,
    status: "open",
    note: "",
    canEdit: true,
    canDelete: true,
    doneBy: [],
    pending: true,
  };
  const classId = state.membership.classId;
  const q = loadQueue(classId);
  q.push({ kind: "create", tempId, body: { ...body }, task: { ...task } });
  saveQueue(classId, q);
  state.tasks.push(task);
  state.tasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.subject.localeCompare(b.subject, "de"));
  state.offline = true;
  saveCache();
  state.day = dayToShow(task.dueDate);
  show("view-class");
  renderDay();
  noticeIfPast(task.dueDate);
}

/** Abgabetag schon vorbei → die Aufgabe steht nicht im Heft. Kurz sagen, damit niemand sie sucht. */
function noticeIfPast(dueDate) {
  if (dueDate < today()) showNotice("Gespeichert. Der Abgabetag ist schon vorbei – deshalb steht die Aufgabe nicht im Heft.");
}

/**
 * Nach dem Speichern: zum Abgabetag springen, falls er vor dem angezeigten Tag liegt – aber nie in die
 * Vergangenheit (dort erscheinen nur damals schon eingetragene Aufgaben).
 */
function dayToShow(dueDate) {
  if (dueDate >= state.day) return state.day;
  return dueDate >= today() ? dueDate : defaultDay();
}

function closeTaskForm() {
  state.editingId = null;
  show("view-class");
  renderDay();
}

/** 401 = entfernt oder abgemeldet: Klasse von diesem Gerät nehmen. Gibt true zurück, wenn behandelt. */
function handleAuthError(err) {
  if (err.status !== 401 || !state.membership) return false;
  const m = state.membership;
  const rest = loadMemberships().filter((x) => x.classId !== m.classId);
  saveMemberships(rest);
  // Auch Warteschlange (kann private Notizen enthalten) und „Alle Fächer zeigen“ dieser Klasse vom Gerät nehmen.
  for (const key of [CACHE_PREFIX + m.classId, QUEUE_PREFIX + m.classId, `abgehakt.showAll.${m.classId}`, INSTALL_CODE_PREFIX + m.classId]) {
    try { localStorage.removeItem(key); } catch { /* egal */ }
  }
  state.membership = null;
  showNotice(`${err.message} („${m.className}“)`);
  if (rest.length) openClass(rest[0].classId, { keepNotice: true });
  else startJoin();
  return true;
}

// ---------- Ablauf: Klasse öffnen ----------

async function openClass(classId, { keepNotice = false } = {}) {
  const list = loadMemberships();
  const m = list.find((x) => x.classId === classId) || list[0];
  if (!m) return startJoin();
  if (!keepNotice) showNotice("");

  const home = defaultDay();
  if (!state.membership || state.membership.classId !== m.classId) {
    state.day = home;
    state.expanded.clear();
  } else if (state.day === state.homeDay && home !== state.homeDay) {
    // Über Nacht offen gelassen: Wer nicht selbst geblättert hat, landet auf dem neuen Start-Tag (sonst „Gestern“).
    state.day = home;
  }
  state.homeDay = home;
  state.membership = m;
  setActiveId(m.classId);
  renderSwitcher(list, m.classId);
  renderClassHeader();

  // Sofort den gespeicherten Stand zeigen, dann beim Server nachladen.
  const cached = readJsonStorage(cacheKey(), null);
  state.tasks = applyQueue(cached && Array.isArray(cached.tasks) ? cached.tasks : [], loadQueue(m.classId));
  state.canPostForClass = cached ? Boolean(cached.canPostForClass) : m.role !== "member";
  applySubjectInfo(cached || {});
  state.offline = false;
  state.openReports = 0;
  $("reports-hint").hidden = true;
  show("view-class");
  renderDay();
  renderInstallHint();

  try {
    await flushQueue(m);
    if (state.membership !== m) return;
    const since = addDays(today(), -60);
    const res = await api(`/api/tasks?since=${since}`, { token: m.token });
    if (state.membership !== m) return; // inzwischen andere Klasse gewählt
    Object.assign(m, { className: res.class.name, memberName: res.member.name, role: res.member.role });
    saveMemberships(list);
    state.offline = false;
    state.tasks = applyQueue(res.tasks, loadQueue(m.classId));
    state.openReports = res.openReports || 0;
    state.canPostForClass = res.canPostForClass;
    applySubjectInfo(res);
    saveCache();
    renderSwitcher(list, m.classId);
    renderClassHeader();
    renderDay();
    renderReportsHint();
  } catch (err) {
    if (handleAuthError(err)) return;
    state.offline = true;
    renderDay();
  }
}

// ---------- Ablauf: Beitreten ----------

let pendingCode = null; // { code, kind, className, name }

function startJoin(prefill = "") {
  pendingCode = null;
  const inClass = loadMemberships().length > 0;
  $("button-refresh").hidden = !inClass;
  $("button-code-back").hidden = !inClass; // „Einer weiteren Klasse beitreten“: Abbrechen → zurück zum Heft
  $("standalone-hint").hidden = !(isStandalone() && loadMemberships().length === 0);
  showError("error-code", "");
  $("input-code").value = formatCode(prefill);
  document.title = "Klasse beitreten – Abgehakt";
  show("view-code");
  $("input-code").focus();
}

async function onCodeSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const code = $("input-code").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 8) {
    showError("error-code", "Ein Code hat 8 Zeichen, z. B. K7MP-4XQ2.");
    return;
  }

  button.disabled = true;
  showError("error-code", "");
  try {
    const info = await api("/api/code/check", { method: "POST", body: { code } });
    pendingCode = { code, ...info };
    $("join-class-name").textContent = info.className;
    const personal = info.kind === "personal";
    $("name-field").hidden = personal;
    $("personal-hint").hidden = !personal;
    $("personal-hint").textContent = personal ? `Du meldest dich als „${info.name}“ an.` : "";
    showError("error-name", "");
    show("view-name");
    if (!personal) $("input-name").focus();
  } catch (err) {
    showError("error-code", err.message);
  } finally {
    button.disabled = false;
  }
}

async function onNameSubmit(event) {
  event.preventDefault();
  if (!pendingCode) return startJoin();
  const button = event.submitter;
  const name = $("input-name").value.trim();
  if (pendingCode.kind === "invite" && !name) {
    showError("error-name", "Bitte einen Namen eingeben.");
    return;
  }
  if (!$("input-age").checked) {
    showError("error-name", "Bitte bestätige, dass du mindestens 16 Jahre alt bist oder deine Eltern einverstanden sind.");
    return;
  }

  button.disabled = true;
  showError("error-name", "");
  try {
    const res = await api("/api/join", { method: "POST", body: { code: pendingCode.code, name, ageConfirmed: true } });
    const entry = {
      token: res.token,
      classId: res.class.id,
      className: res.class.name,
      memberId: res.member.id,
      memberName: res.member.name,
      role: res.member.role,
    };
    // Ein Gerät, eine Person pro Klasse: alten Eintrag derselben Klasse ersetzen.
    const list = loadMemberships().filter((m) => m.classId !== entry.classId);
    list.push(entry);
    saveMemberships(list);
    requestPersistence();
    pendingCode = null;
    $("input-name").value = "";
    history.replaceState(null, "", "/app/");
    state.membership = null;
    await openClass(entry.classId);
    if (hasElectives() && !state.electivesChosen) openElectives({ afterJoin: true });
    else if (canOfferInstall()) openInstallGuide({ afterJoin: true });
  } catch (err) {
    showError("error-name", err.message);
    // Code inzwischen ungültig → zurück zu Schritt 1.
    if (err.status === 404 || err.status === 410) {
      showError("error-code", err.message);
      show("view-code");
    }
  } finally {
    button.disabled = false;
  }
}

// ---------- Admin: Anmeldung per E-Mail-Code ----------

function loadAccount() {
  const a = readJsonStorage(ACCOUNT_KEY, null);
  return a && a.token && a.email ? a : null;
}

function saveAccount(account) {
  writeJsonStorage(ACCOUNT_KEY, account);
}

function forgetAccount() {
  try { localStorage.removeItem(ACCOUNT_KEY); } catch { /* egal */ }
}

/** Fügt Klassen-Einträge hinzu bzw. ersetzt sie (eine Person pro Klasse und Gerät). */
function mergeMemberships(entries) {
  const ids = new Set(entries.map((e) => e.classId));
  const list = loadMemberships().filter((m) => !ids.has(m.classId)).concat(entries);
  saveMemberships(list);
  requestPersistence();
  return list;
}

let loginEmail = "";
let loginIntent = "create"; // "create" = Klasse anlegen, "login" = Admin-Klassen holen, "secure" = Admin-Rolle verknüpfen

const LOGIN_INTROS = {
  create: "Um eine Klasse anzulegen, brauchst du als Admin eine E-Mail-Adresse. Wir schicken dir einen Code – kein Passwort nötig. Mitglieder brauchen keine E-Mail.",
  login: "Gib die E-Mail-Adresse ein, mit der du deine Klasse angelegt oder deine Admin-Rechte abgesichert hast. Wir schicken dir einen Code – alle deine Admin-Klassen kommen dann auf dieses Gerät.",
  secure: "Gib deine E-Mail-Adresse ein. Danach kommst du auch nach einem Gerätewechsel wieder an deine Admin-Rechte.",
};

function showLogin(intent) {
  loginIntent = intent;
  $("login-intro").textContent = LOGIN_INTROS[intent];
  showError("error-login", "");
  show("view-login");
  $("input-email").focus();
}

/** Einstieg „Klasse anlegen“: angemeldet → Formular, sonst erst E-Mail-Code. */
function startCreateClass() {
  showNotice("");
  const account = loadAccount();
  if (account) return openCreateClass(account);
  showLogin("create");
}

/** „Du bist schon Admin? Mit E-Mail anmelden“ – holt alle Admin-Klassen auf dieses Gerät. */
function startAdminLogin() {
  showNotice("");
  showLogin("login");
}

async function onLoginSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const email = $("input-email").value.trim();
  if (!email.includes("@")) return showError("error-login", "Bitte eine gültige E-Mail-Adresse eingeben.");
  button.disabled = true;
  showError("error-login", "");
  try {
    const res = await api("/api/account/start", { method: "POST", body: { email } });
    loginEmail = email;
    $("login-email").textContent = email;
    $("input-login-code").value = res.testCode || "";
    // Testversion: Code kommt ohne E-Mail direkt hierher (siehe startLogin auf dem Server).
    $("login-test-code").hidden = !res.testCode;
    showError("error-login-code", "");
    show("view-login-code");
    $("input-login-code").focus();
  } catch (err) {
    showError("error-login", err.message);
  } finally {
    button.disabled = false;
  }
}

async function onLoginCodeSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const code = $("input-login-code").value.replace(/\D/g, "");
  if (code.length !== 6) return showError("error-login-code", "Der Code hat 6 Ziffern.");
  button.disabled = true;
  showError("error-login-code", "");
  try {
    const res = await api("/api/account/verify", { method: "POST", body: { email: loginEmail, code } });
    const account = { token: res.token, email: res.email };
    saveAccount(account);
    // Admin-Rollen, die schon auf diesem Gerät sind, mit dem Konto verknüpfen
    // (damit sie nach einem Gerätewechsel per E-Mail-Code wiederkommen).
    const linked = await linkAdminRoles(account);
    if (loginIntent === "login") {
      if (res.memberships.length) {
        mergeMemberships(res.memberships);
        state.membership = null;
        await openClass(res.memberships[0].classId);
        const n = res.memberships.length;
        if (n > 1) {
          const names = res.memberships.map((m) => `„${m.className}“`).join(", ");
          showNotice(`Angemeldet in ${n} Klassen: ${names}. Wechseln kannst du oben über die Klassen-Auswahl.`);
        }
      } else {
        openCreateClass(account);
        showNotice("Mit dieser E-Mail bist du noch in keiner Klasse Admin. Du kannst hier eine anlegen.");
      }
      return;
    }
    if (loginIntent === "secure") {
      if (res.memberships.length) mergeMemberships(res.memberships);
      await openClass(state.membership ? state.membership.classId : getActiveId(), { keepNotice: true });
      showLinkResult(linked);
      return;
    }
    openCreateClass(account);
    if (res.memberships.length) {
      mergeMemberships(res.memberships);
      const n = res.memberships.length;
      showNotice(`Deine ${n === 1 ? "Klasse ist" : `${n} Klassen sind`} jetzt auch auf diesem Gerät angemeldet. Mit „Abbrechen“ geht es zum Heft.`);
    }
  } catch (err) {
    showError("error-login-code", err.message);
  } finally {
    button.disabled = false;
  }
}

function openCreateClass(account) {
  $("account-email").textContent = account.email;
  showError("error-create-class", "");
  if (!$("input-admin-name").value && state.membership) $("input-admin-name").value = state.membership.memberName;
  show("view-create-class");
  $("input-class-name").focus();
}

async function onCreateClassSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const account = loadAccount();
  if (!account) return startCreateClass();
  const className = $("input-class-name").value.trim();
  const adminName = $("input-admin-name").value.trim();
  if (!className) return showError("error-create-class", "Bitte einen Namen für die Klasse eingeben.");
  if (!adminName) return showError("error-create-class", "Bitte deinen Namen eingeben.");
  if (!$("input-age-admin").checked) {
    return showError("error-create-class", "Bitte bestätige, dass du mindestens 16 Jahre alt bist oder deine Eltern einverstanden sind.");
  }
  button.disabled = true;
  showError("error-create-class", "");
  try {
    const res = await api("/api/classes", { method: "POST", body: { className, adminName, ageConfirmed: true }, token: account.token });
    mergeMemberships([res.membership]);
    $("input-class-name").value = "";
    state.membership = null;
    await openClass(res.membership.classId);
    openInvites();
  } catch (err) {
    if (err.status === 401) {
      forgetAccount();
      showError("error-create-class", "");
      show("view-login");
      showError("error-login", err.message);
    } else {
      showError("error-create-class", err.message);
    }
  } finally {
    button.disabled = false;
  }
}

function cancelCreateClass() {
  showNotice("");
  if (state.membership) {
    show("view-class");
    renderDay();
  } else if (loadMemberships().length) {
    openClass(getActiveId());
  } else {
    startJoin();
  }
}

// ---------- Admin: Einladungscodes ----------

const DATE_ONLY = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long" });

function inviteLink(code) {
  return `${location.origin}/app/#code=${code}`;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const old = button.textContent;
    button.textContent = "Kopiert";
    setTimeout(() => { button.textContent = old; }, 1500);
  } catch {
    window.prompt("Zum Kopieren:", text);
  }
}

function renderInvite(invite) {
  const pretty = `${invite.code.slice(0, 4)}-${invite.code.slice(4)}`;
  const link = inviteLink(invite.code);
  const limits = [`gültig bis ${DATE_ONLY.format(new Date(invite.expiresAt))}`];
  limits.push(invite.maxUses ? `${invite.useCount} von ${invite.maxUses} Beitritten` : `${invite.useCount} beigetreten`);

  const actions = el("div", { class: "invite-actions" });
  if (navigator.share) {
    actions.append(el("button", {
      class: "button button-primary button-small", type: "button", text: "Teilen",
      onclick: () => navigator.share({
        title: "Abgehakt",
        text: `Tritt unserem Hausaufgabenheft „${state.membership.className}“ bei – Code: ${pretty}`,
        url: link,
      }).catch(() => {}),
    }));
  }
  const copy = el("button", { class: "button button-small", type: "button", text: "Link kopieren" });
  copy.addEventListener("click", () => copyText(link, copy));
  actions.append(copy, el("button", {
    class: "button button-small button-danger", type: "button", text: "Ungültig machen",
    onclick: () => revokeInvite(invite),
  }));

  return el("li", { class: "invite card" },
    el("p", { class: "invite-code", text: pretty }),
    el("p", { class: "hint", text: limits.join(" · ") }),
    el("p", { class: "invite-link", text: link }),
    actions,
  );
}

async function loadInvites() {
  showError("error-invites", "");
  try {
    const res = await api("/api/invites", { token: state.membership.token });
    $("invite-list").replaceChildren(...res.invites.map(renderInvite));
    $("invites-empty").hidden = res.invites.length > 0;
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-invites", err.message);
  }
}

function openInvites() {
  if (!state.membership || state.membership.role !== "admin") return;
  $("invites-class-name").textContent = state.membership.className;
  $("invite-list").replaceChildren();
  $("invites-empty").hidden = true;
  showNotice("");
  show("view-invites");
  loadInvites();
}

async function onInviteSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const maxRaw = $("input-invite-max").value.trim();
  button.disabled = true;
  showError("error-invites", "");
  try {
    await api("/api/invites", {
      method: "POST",
      body: { days: Number($("input-invite-days").value), maxUses: maxRaw ? Number(maxRaw) : null },
      token: state.membership.token,
    });
    $("input-invite-max").value = "";
    await loadInvites();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-invites", err.message);
  } finally {
    button.disabled = false;
  }
}

async function revokeInvite(invite) {
  if (!window.confirm("Diesen Code ungültig machen? Wer schon beigetreten ist, bleibt in der Klasse.")) return;
  try {
    await api(`/api/invites/${invite.code}/revoke`, { method: "POST", token: state.membership.token });
    await loadInvites();
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-invites", err.message);
  }
}

// ---------- Mitglieder ----------

const members = { list: [], settings: null };

function renderCodeCard(title, code, expiresAt, note) {
  const pretty = `${code.slice(0, 4)}-${code.slice(4)}`;
  const link = inviteLink(code);
  const actions = el("div", { class: "invite-actions" });
  if (navigator.share) {
    actions.append(el("button", {
      class: "button button-primary button-small", type: "button", text: "Teilen",
      onclick: () => navigator.share({ title: "Abgehakt", text: `Dein persönlicher Code für „${state.membership.className}“: ${pretty}`, url: link }).catch(() => {}),
    }));
  }
  const copy = el("button", { class: "button button-small", type: "button", text: "Link kopieren" });
  copy.addEventListener("click", () => copyText(link, copy));
  actions.append(copy);
  return el("div", { class: "invite card personal-code" },
    el("p", { class: "eyebrow", text: title }),
    el("p", { class: "invite-code", text: pretty }),
    el("p", { class: "hint", text: `${note} · gültig bis ${DATE_ONLY.format(new Date(expiresAt))}` }),
    el("p", { class: "invite-link", text: link }),
    actions,
  );
}

function renderMember(m, isAdmin) {
  const roleLabel = ROLE_LABELS[m.role];
  const head = el("div", { class: "member-head" },
    el("span", { class: "member-name", text: m.isMe ? `${m.name} (du)` : m.name }),
    m.role !== "member" ? el("span", { class: `role-badge role-${m.role}`, text: roleLabel }) : null,
    m.role === "editor" && m.editorSubjects && m.editorSubjects.length
      ? el("span", { class: "hint", text: m.editorSubjects.map((id) => subjectById(id)?.name).filter(Boolean).join(", ") || "Fächer entfernt" })
      : null,
    isAdmin && m.joined === false ? el("span", { class: "hint", text: "noch nicht beigetreten" }) : null,
  );
  const li = el("li", { class: "member" }, head);
  if (!isAdmin || m.isMe) return li;

  const select = el("select", { class: "input input-small", "aria-label": `Rolle von ${m.name}` });
  for (const [value, label] of Object.entries(ROLE_LABELS)) {
    select.append(el("option", { value, text: label, selected: value === m.role }));
  }
  select.addEventListener("change", () => changeRole(m, select));

  const scopeButton = m.role === "editor"
    ? el("button", { class: "button button-small", type: "button", text: "Fächer", onclick: () => toggleEditorSubjects(m, li) })
    : null;
  li.append(el("div", { class: "member-actions" },
    select,
    scopeButton,
    el("button", { class: "button button-small", type: "button", text: "Umbenennen", onclick: () => renameOther(m) }),
    el("button", { class: "button button-small", type: "button", text: "Persönlicher Code", onclick: () => personalCode(m) }),
    el("button", { class: "button button-small button-danger", type: "button", text: "Entfernen", onclick: () => removeMember(m) }),
  ));
  return li;
}

/** Admin: für welche Fächer darf diese*r Eintragende eintragen? Keine Auswahl = alle Fächer. */
function toggleEditorSubjects(m, li) {
  const open = li.querySelector(".editor-subjects");
  if (open) return open.remove();
  const chosen = new Set(m.editorSubjects || []);
  // Nur Fächer, die die Person selbst hat: Pflichtfächer und ihre Wahlfächer (noch nichts gewählt → alle).
  const own = state.subjects.filter((s) => !s.elective || !Array.isArray(m.electives) || m.electives.includes(s.id));
  const boxes = own.map((s) => el("label", { class: "toggle" },
    el("input", { type: "checkbox", value: s.id, checked: chosen.has(s.id) }),
    el("span", { text: s.name })));
  const error = el("p", { class: "error", role: "alert", hidden: true });
  const save = el("button", { class: "button button-primary button-small", type: "button", text: "Speichern" });
  save.addEventListener("click", async () => {
    const ids = [...li.querySelectorAll(".editor-subjects input:checked")].map((i) => i.value);
    save.disabled = true;
    try {
      const res = await api(`/api/members/${m.id}`, { method: "PATCH", body: { editorSubjects: ids }, token: state.membership.token });
      m.editorSubjects = res.member.editorSubjects || [];
      renderMembers();
    } catch (err) {
      save.disabled = false;
      if (handleAuthError(err)) return;
      error.textContent = err.offline ? "Das geht nur mit Internet." : err.message;
      error.hidden = false;
    }
  });
  li.append(el("div", { class: "editor-subjects card" },
    el("p", { class: "hint", text: own.length
      ? `Für welche Fächer darf ${m.name} für die Klasse eintragen? Zur Auswahl stehen nur Fächer, die ${m.name} selbst hat. Nichts angehakt = alle Fächer.`
      : "Eure Klasse hat noch keine Fächer – lege sie unter Einstellungen → Klasse → Fächer an." }),
    ...boxes, error, el("div", { class: "invite-actions" }, save)));
}

function renderMembers() {
  const isAdmin = state.membership.role === "admin";
  $("members-count").textContent = `${members.list.length} ${members.list.length === 1 ? "Person" : "Personen"}`;
  $("member-list").replaceChildren(...members.list.map((m) => renderMember(m, isAdmin)));
  $("admin-tools").hidden = !isAdmin;
  $("reports-count").textContent = state.openReports ? String(state.openReports) : "";
  $("reports-count").hidden = !state.openReports;
  $("secure-hint").hidden = !(isAdmin && members.settings && members.settings.linkedToEmail === false);
}

async function loadMembers() {
  showError("error-members", "");
  try {
    const res = await api("/api/members", { token: state.membership.token });
    members.list = res.members;
    members.settings = res.settings;
    const me = res.members.find((m) => m.isMe);
    if (me && me.role !== state.membership.role) {
      // Rolle hat sich geändert (z. B. zum Admin ernannt): Gerät aktualisieren.
      state.membership.role = me.role;
      saveMemberships(loadMemberships().map((x) => (x.classId === state.membership.classId ? { ...x, role: me.role } : x)));
      renderClassHeader();
    }
    return true;
  } catch (err) {
    if (handleAuthError(err)) return false;
    showError("error-members", err.message);
    return false;
  }
}

async function openMembers() {
  $("members-class-name").textContent = state.membership.className;
  $("member-list").replaceChildren();
  $("personal-code-box").replaceChildren();
  $("form-add-member").hidden = true;
  $("admin-tools").hidden = true;
  $("secure-hint").hidden = true;
  $("members-count").textContent = "";
  showNotice("");
  show("view-members");
  if (await loadMembers()) renderMembers();
}

async function changeRole(m, select) {
  const role = select.value;
  if (role === "admin" && !window.confirm(`${m.name} zum Admin machen? Admins können Mitglieder entfernen und Rechte vergeben.`)) {
    select.value = m.role;
    return;
  }
  showError("error-members", "");
  try {
    await api(`/api/members/${m.id}`, { method: "PATCH", body: { role }, token: state.membership.token });
    m.role = role;
    // Neu geladen, damit bei Eintragenden gleich ihre Wahlfächer da sind („Fächer“ zeigt nur Fächer, die sie haben).
    if (!(await loadMembers())) return;
    renderMembers();
  } catch (err) {
    if (handleAuthError(err)) return;
    select.value = m.role;
    showError("error-members", err.message);
  }
}

async function renameOther(m) {
  const name = window.prompt(`Neuer Name für ${m.name}:`, m.name);
  if (name === null || name.trim() === m.name) return;
  showError("error-members", "");
  try {
    const res = await api(`/api/members/${m.id}`, { method: "PATCH", body: { name }, token: state.membership.token });
    m.name = res.member.name;
    renderMembers();
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-members", err.message);
  }
}

async function personalCode(m) {
  if (m.joined && !window.confirm(`Neuen persönlichen Code für ${m.name} erzeugen? Damit kann sich ${m.name} auf einem neuen Gerät wieder anmelden – die bisherigen Geräte werden dabei abgemeldet.`)) return;
  showError("error-members", "");
  try {
    const res = await api(`/api/members/${m.id}/code`, { method: "POST", token: state.membership.token });
    $("personal-code-box").replaceChildren(renderCodeCard(`Persönlicher Code für ${m.name}`, res.code.code, res.code.expiresAt,
      m.joined ? "nur einmal nutzbar · meldet die bisherigen Geräte ab" : "nur einmal nutzbar"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-members", err.message);
  }
}

async function removeMember(m) {
  if (!window.confirm(`${m.name} aus der Klasse entfernen? ${m.name} verliert sofort den Zugang auf allen Geräten.`)) return;
  showError("error-members", "");
  try {
    await api(`/api/members/${m.id}/remove`, { method: "POST", token: state.membership.token });
    members.list = members.list.filter((x) => x.id !== m.id);
    renderMembers();
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-members", err.message);
  }
}

async function onAddMemberSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const name = $("input-member-name").value.trim();
  if (!name) return showError("error-add-member", "Bitte einen Namen eingeben.");
  button.disabled = true;
  showError("error-add-member", "");
  try {
    const res = await api("/api/members", { method: "POST", body: { name }, token: state.membership.token });
    members.list.push(res.member);
    $("input-member-name").value = "";
    $("form-add-member").hidden = true;
    $("personal-code-box").replaceChildren(renderCodeCard(`Persönlicher Code für ${res.member.name}`, res.code.code, res.code.expiresAt, "nur einmal nutzbar"));
    renderMembers();
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-add-member", err.message);
  } finally {
    button.disabled = false;
  }
}

/**
 * Admin-Rollen auf diesem Gerät mit dem Konto verknüpfen (damit sie nach einem Gerätewechsel per E-Mail-Code
 * wiederkommen). Ergebnis pro Klasse: true = verknüpft, false = nicht möglich (z. B. schon mit einer anderen
 * E-Mail verknüpft), null = Fehler (offline …).
 */
async function linkAdminRoles(account) {
  const result = new Map();
  await Promise.all(loadMemberships().filter((m) => m.role === "admin").map(async (m) => {
    try {
      const res = await api("/api/account/link", { method: "POST", body: { memberToken: m.token }, token: account.token });
      result.set(m.classId, Boolean(res.linked));
    } catch {
      result.set(m.classId, null);
    }
  }));
  return result;
}

/** Meldung nach „Mit E-Mail absichern“ – nur „abgesichert“, wenn es für diese Klasse wirklich geklappt hat. */
function showLinkResult(linked) {
  const ok = state.membership ? linked.get(state.membership.classId) : null;
  if (ok === true) showNotice("Abgesichert: Deine Admin-Rechte sind jetzt mit deiner E-Mail verknüpft.");
  else if (ok === false) showNotice("Das hat nicht geklappt: Deine Admin-Rolle in dieser Klasse ist schon mit einer anderen E-Mail-Adresse verknüpft.");
  else showNotice("Das Absichern hat gerade nicht geklappt. Bitte mit Internet noch einmal versuchen.");
}

function startSecure() {
  const account = loadAccount();
  if (account) {
    // Schon angemeldet: direkt verknüpfen.
    linkAdminRoles(account).then(async (linked) => {
      await openMembers();
      showLinkResult(linked);
    });
    return;
  }
  showLogin("secure");
}

// ---------- Einstellungen ----------

function renderViewerList() {
  const box = $("viewer-list");
  const selected = new Set(members.settings.viewers);
  const others = members.list.filter((m) => !m.isMe);
  box.replaceChildren(el("legend", { class: "visually-hidden", text: "Personen auswählen" }),
    ...(others.length ? others.map((m) => el("label", { class: "checkbox" },
      el("input", { type: "checkbox", value: m.id, checked: selected.has(m.id) }),
      el("span", { text: m.name }))) : [el("p", { class: "hint", text: "Noch niemand sonst in der Klasse." })]));
}

function updateViewerVisibility() {
  const value = document.querySelector('input[name="visibility"]:checked')?.value;
  $("viewer-list").hidden = value !== "some";
}

async function openSettings() {
  $("settings-class-name").textContent = state.membership.className;
  $("settings-saved").textContent = "";
  $("rename-saved").textContent = "";
  showError("error-rename", "");
  $("input-rename").value = state.membership.memberName;
  renderSettingsSubjects();
  openPushSettings();
  renderInstallCard();
  renderThemeCard();
  $("own-code-box").replaceChildren();
  $("mydata-done").textContent = "";
  showError("error-mydata", "");
  $("button-own-code").textContent = "Code erzeugen";
  showError("error-own-code", "");
  showError("error-settings", "");
  showError("error-leave", "");
  showNotice("");
  markSettingsTab("me");
  show("view-settings");
  if (!(await loadMembers())) return;
  for (const r of document.querySelectorAll('input[name="visibility"]')) r.checked = r.value === members.settings.visibility;
  renderViewerList();
  updateViewerVisibility();
}

/** „Meine Daten herunterladen“: alles, was zu dieser Person gespeichert ist, als Datei (Auskunft nach DSGVO). */
async function downloadMyData() {
  const button = $("button-mydata");
  button.disabled = true;
  showError("error-mydata", "");
  $("mydata-done").textContent = "";
  try {
    const data = await api("/api/me/export", { token: state.membership.token });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: `abgehakt-meine-daten-${today()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    $("mydata-done").textContent = "Die Datei „abgehakt-meine-daten“ ist heruntergeladen (bei den Downloads bzw. in „Dateien“).";
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-mydata", err.offline ? "Das geht nur mit Internet." : err.message);
  } finally {
    button.disabled = false;
  }
}

function markSettingsTab(active) {
  for (const tab of document.querySelectorAll(".settings-tabs button")) {
    if (tab.dataset.tab === active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
}

/** Klasseneinstellungen: Name, Fächer und Stundenplan, Kennung, Klasse löschen – betreffen alle. */
function openClassSettings() {
  const m = state.membership;
  const isAdmin = m.role === "admin";
  $("class-settings-name").textContent = m.className;
  $("form-class-admin").hidden = !isAdmin;
  $("delete-class-zone").hidden = !isAdmin;
  $("deleted-zone").hidden = !isAdmin;
  $("subjects-zone").hidden = !state.canManageSubjects;
  $("class-settings-readonly").hidden = isAdmin;
  $("class-settings-readonly").textContent = state.canManageSubjects
    ? "Fächer und Stundenplan pflegen Admins und Eintragende, alles andere nur Admins."
    : "Ändern können das nur Admins.";
  $("input-class-rename").value = m.className;
  $("class-rename-saved").textContent = "";
  showError("error-class-admin", "");
  showError("error-delete-class", "");
  $("class-id").textContent = m.classId;
  showNotice("");
  markSettingsTab("class");
  show("view-class-settings");
}

// ---------- Zuletzt gelöscht (Admins) ----------

function renderDeletedCard(t) {
  const button = el("button", { class: "button button-primary button-small", type: "button", text: "Wiederherstellen" });
  button.addEventListener("click", () => restoreDeleted(t, button));
  const when = DATETIME.format(new Date(t.deletedAt));
  return el("li", { class: "card report" },
    el("div", { class: "report-snapshot" },
      t.subject ? el("p", { class: "eyebrow", text: t.subject }) : null,
      el("p", { class: "report-title", text: taskLabel(t) || "Eintrag" }),
      t.details ? el("p", { class: "task-details", text: t.details }) : null,
      el("p", { class: "hint", text: `${isEvent(t) ? "am" : "bis"} ${DATE_SHORT.format(fromDateStr(t.dueDate))}` }),
    ),
    el("p", { class: "hint", text: `Gelöscht ${when}${t.deletedBy ? ` von ${t.deletedBy}` : ""}` }),
    el("div", { class: "invite-actions" }, button),
  );
}

async function loadDeleted() {
  showError("error-deleted", "");
  try {
    const res = await api("/api/tasks/deleted", { token: state.membership.token });
    $("deleted-list").replaceChildren(...res.tasks.map(renderDeletedCard));
    $("deleted-empty").hidden = res.tasks.length > 0;
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-deleted", err.offline ? "Gelöschte Einträge lassen sich nur mit Internet ansehen." : err.message);
  }
}

function openDeleted() {
  $("deleted-class-name").textContent = state.membership.className;
  $("deleted-list").replaceChildren();
  $("deleted-empty").hidden = true;
  $("deleted-restored").hidden = true;
  showNotice("");
  show("view-deleted");
  loadDeleted();
}

async function restoreDeleted(t, button) {
  button.disabled = true;
  showError("error-deleted", "");
  try {
    await api(`/api/tasks/${t.id}/restore`, { method: "POST", token: state.membership.token });
    const restored = $("deleted-restored");
    restored.textContent = `„${taskLabel(t) || "Eintrag"}“ ist wieder im Heft.`;
    restored.hidden = false;
    state.subjectsDirty = true; // beim Zurück ins Heft Aufgaben neu laden
    await loadDeleted();
  } catch (err) {
    button.disabled = false;
    if (handleAuthError(err)) return;
    showError("error-deleted", err.offline ? "Wiederherstellen geht nur mit Internet." : err.message);
  }
}

async function onVisibilitySubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const visibility = document.querySelector('input[name="visibility"]:checked')?.value || "none";
  const viewers = [...$("viewer-list").querySelectorAll("input:checked")].map((i) => i.value);
  if (visibility === "some" && !viewers.length) return showError("error-settings", "Bitte mindestens eine Person auswählen.");
  button.disabled = true;
  showError("error-settings", "");
  try {
    const res = await api("/api/me/settings", { method: "PUT", body: { visibility, viewers }, token: state.membership.token });
    members.settings = { ...members.settings, ...res.settings };
    $("settings-saved").textContent = "Gespeichert.";
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-settings", err.message);
  } finally {
    button.disabled = false;
  }
}

async function onRenameSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const name = $("input-rename").value.trim();
  if (!name) return showError("error-rename", "Bitte einen Namen eingeben.");
  button.disabled = true;
  showError("error-rename", "");
  $("rename-saved").textContent = "";
  try {
    const res = await api("/api/me/name", { method: "PUT", body: { name }, token: state.membership.token });
    state.membership.memberName = res.name;
    saveMemberships(loadMemberships().map((x) => (x.classId === state.membership.classId ? { ...x, memberName: res.name } : x)));
    $("input-rename").value = res.name;
    renderClassHeader();
    $("rename-saved").textContent = "Gespeichert.";
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-rename", err.message);
  } finally {
    button.disabled = false;
  }
}

async function onClassRenameSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const name = $("input-class-rename").value.trim();
  if (!name) return showError("error-class-admin", "Bitte einen Namen für die Klasse eingeben.");
  button.disabled = true;
  showError("error-class-admin", "");
  $("class-rename-saved").textContent = "";
  try {
    const res = await api("/api/class", { method: "PATCH", body: { name }, token: state.membership.token });
    state.membership.className = res.name;
    saveMemberships(loadMemberships().map((x) => (x.classId === state.membership.classId ? { ...x, className: res.name } : x)));
    renderSwitcher(loadMemberships(), state.membership.classId);
    renderClassHeader();
    $("class-settings-name").textContent = res.name;
    $("class-rename-saved").textContent = "Gespeichert.";
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-class-admin", err.message);
  } finally {
    button.disabled = false;
  }
}

async function deleteOwnClass() {
  const m = state.membership;
  const typed = window.prompt(`Klasse „${m.className}“ endgültig löschen? Alle Hausaufgaben, Mitglieder, Häkchen und Notizen sind dann weg.\n\nZur Bestätigung den Namen der Klasse eintippen:`);
  if (typed === null) return;
  showError("error-delete-class", "");
  try {
    await api("/api/class/delete", { method: "POST", body: { confirmName: typed }, token: m.token });
    handleAuthError({ status: 401, message: "Die Klasse wurde gelöscht." });
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-delete-class", err.message);
  }
}

async function createOwnCode() {
  const button = $("button-own-code");
  button.disabled = true;
  showError("error-own-code", "");
  try {
    const res = await api("/api/me/code", { method: "POST", token: state.membership.token });
    $("own-code-box").replaceChildren(renderCodeCard("Dein Code für ein weiteres Gerät", res.code.code, res.code.expiresAt, "nur einmal nutzbar"));
    button.textContent = "Neuen Code erzeugen";
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-own-code", err.message);
  } finally {
    button.disabled = false;
  }
}

async function leaveClass() {
  const m = state.membership;
  if (!window.confirm(`„${m.className}“ wirklich verlassen?\n\nDeine Häkchen, Notizen und privaten Aufgaben werden gelöscht. Zurück kommst du nur mit einem neuen Code.`)) return;
  showError("error-leave", "");
  try {
    await api("/api/me/leave", { method: "POST", token: m.token });
    handleAuthError({ status: 401, message: "Du hast die Klasse verlassen." });
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-leave", err.message);
  }
}

// ---------- Melden ----------

let reportingTask = null;

function openReportForm(task) {
  reportingTask = task;
  $("report-task-subject").textContent = task.subject || "";
  $("report-task-title").textContent = taskLabel(task);
  for (const r of document.querySelectorAll('input[name="reason"]')) r.checked = false;
  $("input-report-comment").value = "";
  showError("error-report", "");
  showNotice("");
  show("view-report");
}

async function onReportSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const reason = document.querySelector('input[name="reason"]:checked')?.value;
  if (!reason) return showError("error-report", "Bitte einen Grund auswählen.");
  button.disabled = true;
  showError("error-report", "");
  try {
    await api(`/api/tasks/${reportingTask.id}/report`, {
      method: "POST", body: { reason, comment: $("input-report-comment").value }, token: state.membership.token,
    });
    reportingTask = null;
    show("view-class");
    renderDay();
    showNotice("Danke für deine Meldung. Die Admins deiner Klasse kümmern sich darum.");
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-report", err.offline ? "Melden geht nur mit Internet." : err.message);
  } finally {
    button.disabled = false;
  }
}

// ---------- Meldungen prüfen (Admins) ----------

function renderReportsHint() {
  const n = state.membership && state.membership.role === "admin" ? state.openReports : 0;
  $("reports-hint").hidden = !n;
  $("reports-hint-text").textContent = n === 1
    ? "Ein Eintrag wurde gemeldet. Bitte prüfe ihn."
    : `${n} Einträge wurden gemeldet. Bitte prüfe sie.`;
}

function renderReportCard(r) {
  const date = DATETIME.format(new Date(r.createdAt));
  const snapshot = el("div", { class: "report-snapshot" },
    r.subject ? el("p", { class: "eyebrow", text: r.subject }) : null,
    el("p", { class: "report-title", text: r.title }),
    r.details ? el("p", { class: "task-details", text: r.details }) : null,
    el("p", { class: "hint", text: `Eingetragen bzw. zuletzt geändert von ${r.author || "unbekannt"}` }),
  );
  return el("li", { class: "card report" },
    el("p", { class: "report-reason", text: `${r.reasonLabel} · gemeldet ${date}` }),
    r.comment ? el("p", { class: "hint", text: `„${r.comment}“` }) : null,
    snapshot,
    el("div", { class: "invite-actions" },
      el("button", { class: "button button-danger button-small", type: "button", text: "Eintrag entfernen", onclick: () => resolveReport(r, "hide") }),
      el("button", { class: "button button-small", type: "button", text: "Ist in Ordnung", onclick: () => resolveReport(r, "dismiss") }),
    ),
  );
}

async function loadReports() {
  showError("error-reports", "");
  try {
    const res = await api("/api/reports", { token: state.membership.token });
    $("report-list").replaceChildren(...res.reports.map(renderReportCard));
    $("reports-empty").hidden = res.reports.length > 0;
    state.openReports = res.reports.length;
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-reports", err.message);
  }
}

let reportsReturn = "view-class";

function openReports() {
  reportsReturn = $("view-members").hidden ? "view-class" : "view-members";
  $("reports-class-name").textContent = state.membership.className;
  $("report-list").replaceChildren();
  $("reports-empty").hidden = true;
  showNotice("");
  show("view-reports");
  loadReports();
}

async function resolveReport(r, action) {
  if (action === "hide" && !window.confirm(`„${r.title}“ für die ganze Klasse entfernen?`)) return;
  showError("error-reports", "");
  try {
    await api(`/api/reports/${r.id}`, { method: "POST", body: { action }, token: state.membership.token });
    await loadReports();
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-reports", err.message);
  }
}

// ---------- Idee oder Fehler ----------

let feedbackReturn = "view-class";

function openFeedback() {
  feedbackReturn = $("view-settings").hidden ? "view-class" : "view-settings";
  for (const r of document.querySelectorAll('input[name="feedback-kind"]')) r.checked = false;
  $("input-feedback").value = "";
  showError("error-feedback", "");
  showNotice("");
  show("view-feedback");
}

function closeFeedback() {
  if (feedbackReturn === "view-settings") openSettings();
  else { show("view-class"); renderDay(); }
}

async function onFeedbackSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  const kind = document.querySelector('input[name="feedback-kind"]:checked')?.value;
  const text = $("input-feedback").value.trim();
  if (!kind) return showError("error-feedback", "Bitte auswählen, worum es geht.");
  if (text.length < 5) return showError("error-feedback", "Bitte beschreibe kurz deine Idee oder den Fehler.");
  button.disabled = true;
  showError("error-feedback", "");
  try {
    await api("/api/feedback", { method: "POST", body: { kind, text }, token: state.membership.token });
    closeFeedback();
    showNotice("Danke! Deine Nachricht ist angekommen.");
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-feedback", err.offline ? "Abschicken geht nur mit Internet." : err.message);
  } finally {
    button.disabled = false;
  }
}

// ---------- Aktualisieren (Knopf oben rechts, nach unten ziehen) ----------

let refreshing = false;

function currentAppVersion() {
  const m = (document.querySelector(".footer .status")?.textContent || "").match(/Version (\S+)/);
  return m ? m[1] : "";
}

/**
 * Neue App-Version: den neuen Service Worker holen und abwarten, bis er fertig installiert und
 * aktiv ist – erst dann neu laden (sonst lädt die Seite mitten im Wechsel, Dateien können fehlen).
 * Wartet höchstens 6 Sekunden.
 */
async function installUpdate() {
  if (!navigator.serviceWorker) return;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (!reg) return;
  await reg.update().catch(() => {});
  const worker = reg.installing || reg.waiting;
  if (!worker) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 6000);
    const check = () => {
      if (worker.state === "activated" || worker.state === "redundant") {
        clearTimeout(timer);
        resolve();
      }
    };
    worker.addEventListener("statechange", check);
    check();
  });
}

/**
 * Lädt neu: Offline-Änderungen senden, Daten der aktuellen Ansicht neu holen. Gibt es eine neue
 * App-Version, wird die Seite neu geladen (so kommt ein Update an, ohne die App zu schließen).
 */
// ---------- Benachrichtigungen (Web Push) ----------
//
// Pro Klasse und Gerät einschaltbar (Einstellungen → Für mich). Verschickt werden sie vom Server
// (src/jobs/notify.js), angezeigt vom Service Worker (public/sw.js). Auf dem iPhone/iPad nur, wenn
// Abgehakt auf dem Home-Bildschirm liegt.

const PUSH_HINT_KEY = "abgehakt.pushHintDone";
let pushPublicKey;                                   // undefined = noch nicht geladen, null = nicht eingerichtet
const push = { endpoint: null, keys: null, settings: null };

function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function loadPushKey() {
  if (pushPublicKey !== undefined || !state.membership) return pushPublicKey ?? null;
  try {
    const res = await api("/api/push/key", { token: state.membership.token });
    pushPublicKey = res.publicKey || null;
  } catch {
    return null; // offline – beim nächsten Mal erneut versuchen
  }
  return pushPublicKey;
}

function swReady() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Abgehakt ist noch nicht ganz geladen. Bitte gleich noch einmal versuchen.")), 6000)),
  ]);
}

function base64UrlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function sameServerKey(subscription, key) {
  const current = subscription.options && subscription.options.applicationServerKey;
  if (!current) return true;
  const a = new Uint8Array(current);
  const b = base64UrlToBytes(key);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Abo dieses Geräts für die geöffnete Klasse vom Server holen. */
async function refreshPushState() {
  push.endpoint = null;
  push.settings = null;
  if (!pushSupported() || Notification.permission !== "granted") return;
  try {
    const reg = await swReady();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const j = sub.toJSON();
    push.endpoint = j.endpoint;
    push.keys = j.keys;
    const res = await api("/api/push/subscription/status", { method: "POST", body: { endpoint: j.endpoint }, token: state.membership.token });
    push.settings = res.subscription;
  } catch (err) {
    handleAuthError(err);
  }
}

function renderPushCard() {
  const supported = pushSupported();
  const iosNeedsInstall = !supported && isIos() && !isStandalone();
  const blocked = supported && Notification.permission === "denied";
  const on = Boolean(push.settings);
  let status;
  if (iosNeedsInstall) status = "Auf iPhone und iPad gehen Benachrichtigungen nur, wenn Abgehakt auf dem Home-Bildschirm liegt.";
  else if (!supported) status = "Dieser Browser unterstützt keine Benachrichtigungen.";
  else if (pushPublicKey === null) status = "Benachrichtigungen sind noch nicht eingerichtet.";
  else if (blocked) status = "Benachrichtigungen sind für Abgehakt blockiert. Du kannst sie in den Einstellungen deines Browsers bzw. Handys erlauben.";
  else if (on) status = "An – auf diesem Gerät, für diese Klasse.";
  else status = "Aus. Abgehakt erinnert dich am Vorabend an Offenes und an Termine – wenn du willst, auch an neue Einträge.";
  $("push-status").textContent = status;
  $("button-push-install").hidden = !iosNeedsInstall;
  const usable = supported && pushPublicKey !== null && !blocked;
  $("button-push-on").hidden = !usable || on;
  $("button-push-off").hidden = !usable || !on;
  $("button-push-test").hidden = !usable || !on;
  $("push-options").hidden = !usable || !on;
  if (on) {
    $("push-reminder").checked = push.settings.reminder;
    $("push-events").checked = push.settings.events;
    $("push-new").checked = push.settings.newEntries;
    $("push-reports").checked = push.settings.reports !== false;
    $("push-hour").value = String(push.settings.remindHour);
  }
  $("push-reports-row").hidden = state.membership.role !== "admin";
}

async function openPushSettings() {
  $("push-saved").textContent = "";
  showError("error-push", "");
  renderPushCard();
  await loadPushKey();
  await refreshPushState();
  renderPushCard();
}

async function enablePush({ fromHint = false } = {}) {
  showError("error-push", "");
  writeJsonStorage(PUSH_HINT_KEY, true);
  $("push-hint").hidden = true;
  const key = await loadPushKey();
  if (!key) {
    renderPushCard();
    return showError("error-push", pushPublicKey === null ? "Benachrichtigungen sind noch nicht eingerichtet." : "Einschalten geht nur mit Internet.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    renderPushCard();
    if (fromHint) showNotice("Ohne deine Erlaubnis kann Abgehakt keine Benachrichtigungen schicken. Du kannst sie später unter „Einstellungen → Für mich → Benachrichtigungen“ einschalten.");
    return;
  }
  try {
    const reg = await swReady();
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameServerKey(sub, key)) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) });
    const j = sub.toJSON();
    const res = await api("/api/push/subscription", {
      method: "PUT",
      body: { endpoint: j.endpoint, keys: j.keys },
      token: state.membership.token,
    });
    push.endpoint = j.endpoint;
    push.keys = j.keys;
    push.settings = res.subscription;
    if (fromHint) showNotice("Erinnerungen sind an. Uhrzeit und Arten stellst du unter „Einstellungen → Für mich → Benachrichtigungen“ ein.");
  } catch (err) {
    if (handleAuthError(err)) return;
    const message = err.offline ? "Einschalten geht nur mit Internet." : err.message || "Das hat gerade nicht geklappt.";
    if (fromHint) showNotice(message);
    else showError("error-push", message);
  }
  renderPushCard();
}

async function savePushOptions() {
  if (!push.endpoint || !push.settings) return;
  $("push-saved").textContent = "";
  showError("error-push", "");
  try {
    const res = await api("/api/push/subscription", {
      method: "PUT",
      body: {
        endpoint: push.endpoint,
        keys: push.keys,
        reminder: $("push-reminder").checked,
        events: $("push-events").checked,
        newEntries: $("push-new").checked,
        reports: $("push-reports").checked,
        remindHour: Number($("push-hour").value),
      },
      token: state.membership.token,
    });
    push.settings = res.subscription;
    $("push-saved").textContent = "Gespeichert.";
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-push", err.offline ? "Speichern geht nur mit Internet." : err.message);
    renderPushCard();
  }
}

async function disablePush() {
  showError("error-push", "");
  try {
    await api("/api/push/subscription/delete", { method: "POST", body: { endpoint: push.endpoint }, token: state.membership.token });
    push.settings = null;
    $("push-saved").textContent = "";
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-push", err.offline ? "Ausschalten geht nur mit Internet." : err.message);
  }
  renderPushCard();
}

async function sendTestPush() {
  showError("error-push", "");
  $("push-saved").textContent = "";
  try {
    await api("/api/push/test", { method: "POST", body: { endpoint: push.endpoint }, token: state.membership.token });
    $("push-saved").textContent = "Test geschickt – kommt gleich an.";
  } catch (err) {
    if (handleAuthError(err)) return;
    if (err.status === 410) push.settings = null;
    showError("error-push", err.offline ? "Geht nur mit Internet." : err.message);
    renderPushCard();
  }
}

/** Einmaliger Hinweis im Heft – nur, wenn nichts anderes oben steht und noch nie gefragt wurde. */
async function renderPushHint() {
  const hint = $("push-hint");
  hint.hidden = true;
  if (!state.membership || !pushSupported() || Notification.permission !== "default") return;
  if (readJsonStorage(PUSH_HINT_KEY, false)) return;
  if (!(await loadPushKey())) return;
  hint.hidden = !($("whats-new").hidden && $("install-hint").hidden);
}

// Offline-Änderungen: solange die App offen und sichtbar ist und noch etwas wartet, alle 30 Sekunden erneut
// senden – falls das Signal „wieder online“ nicht ankommt (kommt auf dem iPhone vor). Kein Hintergrund.
setInterval(() => {
  if (document.visibilityState === "visible" && navigator.onLine && state.membership && pendingCount()) {
    flushQueue().then(updateSyncInfo);
  }
}, 30000);

// ---------- Was ist neu ----------
//
// Nach einem Update mit neuer Funktion erscheint oben im Heft einmalig „Neu in Abgehakt“ (alle Einträge seit der
// zuletzt gesehenen Version). Neue Nutzerinnen und Nutzer sehen das nicht – für sie ist alles neu.

const SEEN_VERSION_KEY = "abgehakt.seenVersion";
let changelogReturn = "view-class";

function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function changelogEntries() {
  return typeof CHANGELOG !== "undefined" && Array.isArray(CHANGELOG) ? CHANGELOG : [];
}

function markChangelogSeen() {
  writeJsonStorage(SEEN_VERSION_KEY, currentAppVersion());
}

/** Einträge, die diese Person noch nicht gesehen hat (neueste zuerst). */
function unseenChangelog() {
  const current = currentAppVersion();
  const entries = changelogEntries().filter((e) => compareVersions(e.version, current) <= 0);
  const seen = readJsonStorage(SEEN_VERSION_KEY, null);
  // Erstes Mal mit dieser Funktion: nur die neueste Neuerung zeigen, nicht die ganze Vorgeschichte.
  if (!seen) return entries.slice(0, 1);
  return entries.filter((e) => compareVersions(e.version, seen) > 0);
}

function renderWhatsNew() {
  const box = $("whats-new");
  const entries = unseenChangelog();
  box.hidden = !entries.length;
  if (!entries.length) return;
  $("whats-new-title").textContent = entries.length === 1
    ? `Neu in Abgehakt ${entries[0].version}`
    : "Neu in Abgehakt";
  $("whats-new-list").replaceChildren(...entries.flatMap((e) => e.items).map((t) => el("li", { text: t })));
}

function openChangelog(returnTo) {
  changelogReturn = returnTo;
  markChangelogSeen();
  $("whats-new").hidden = true;
  $("changelog-version").textContent = `Version ${currentAppVersion()}`;
  $("changelog-list").replaceChildren(...changelogEntries().map((e) => el("section", { class: "card changelog-entry" },
    el("h2", { class: "section-title", text: e.label || `Version ${e.version}` }),
    el("ul", { class: "whats-new-list" }, ...e.items.map((t) => el("li", { text: t }))))));
  showNotice("");
  show("view-changelog");
}

async function refreshApp() {
  if (refreshing) return;
  refreshing = true;
  const started = Date.now();
  const button = $("button-refresh");
  button.classList.add("is-spinning");
  document.body.classList.add("is-refreshing");
  try {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = await res.json();
      if (data.version && data.version !== currentAppVersion()) {
        await installUpdate();
        location.reload();
        return;
      }
    } catch {
      // offline – unten zeigt die App den gespeicherten Stand
    }
    if (!state.membership) return;
    if (!$("view-members").hidden) await openMembers();
    else if (!$("view-reports").hidden) await loadReports();
    else if (!$("view-settings").hidden) await openSettings();
    else if (!$("view-class-settings").hidden) openClassSettings();
    else await openClass(state.membership.classId, { keepNotice: true });
  } finally {
    // Mindestens 600 ms drehen lassen – sonst blitzt die Anzeige nur kurz auf.
    const rest = 600 - (Date.now() - started);
    if (rest > 0) await new Promise((r) => setTimeout(r, rest));
    refreshing = false;
    button.classList.remove("is-spinning");
    document.body.classList.remove("is-refreshing");
  }
}

/**
 * Nach unten ziehen am oberen Rand (nur im Heft) – wie in anderen Apps.
 * Flüssig: Bewegung nur einmal pro Bildschirm-Frame (requestAnimationFrame), nur `transform`/
 * `opacity` (läuft auf der Grafikkarte), Widerstand wie ein Gummiband, weiches Zurückgleiten per CSS.
 */
function setupPullToRefresh() {
  const indicator = $("pull-indicator");
  const MAX = 110;        // weiter geht es nicht
  const THRESHOLD = 64;   // ab hier wird beim Loslassen aktualisiert
  let startY = null;
  let pull = 0;
  let frame = 0;

  const draw = () => {
    frame = 0;
    indicator.style.transform = `translate3d(0, ${pull - 48}px, 0) rotate(${pull * 3}deg)`;
    indicator.style.opacity = String(Math.min(1, pull / 40));
    indicator.classList.toggle("is-ready", pull >= THRESHOLD);
  };

  const release = (go) => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    startY = null;
    pull = 0;
    if (go) document.body.classList.add("is-refreshing"); // Endposition per CSS, mit Übergang
    indicator.classList.remove("is-pulling", "is-ready");
    indicator.style.removeProperty("transform");
    indicator.style.removeProperty("opacity");
  };

  window.addEventListener("touchstart", (e) => {
    if (refreshing || window.scrollY > 0 || $("view-class").hidden || e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) { pull = 0; } else {
      // Gummiband: anfangs direkt, dann immer schwerer
      pull = MAX * (1 - Math.exp(-dy / (MAX * 1.6)));
    }
    if (pull > 2) indicator.classList.add("is-pulling");
    if (!frame) frame = requestAnimationFrame(draw);
  }, { passive: true });

  window.addEventListener("touchend", () => {
    if (startY === null) return;
    const go = pull >= THRESHOLD;
    release(go);
    if (go) refreshApp();
  });
  window.addEventListener("touchcancel", () => release(false));
}

// ---------- Installieren (Home-Bildschirm) ----------

let installPrompt = null; // Android/Chrome: Ereignis für „App installieren“

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

const ICON_SHARE = "M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1";
const ICON_PLUS = "M4 4h16v16H4zM12 8v8M8 12h8";
const ICON_MENU = "M12 6h.01M12 12h.01M12 18h.01";

/** Welche Anleitung passt? Unterscheidet iPhone-Browser, iPad, In-App-Browser, Android, Computer. */
function installPlatform() {
  const ua = navigator.userAgent;
  if (isIos()) {
    if (/Instagram|FBAN|FBAV|Snapchat|Line\//.test(ua)) return "ios-inapp";
    if (/CriOS/.test(ua)) return "ios-chrome";
    if (/FxiOS/.test(ua)) return "ios-firefox";
    if (/EdgiOS|OPiOS|DuckDuckGo/.test(ua)) return "ios-other";
    return /iPad/.test(ua) || navigator.platform === "MacIntel" ? "ios-safari-ipad" : "ios-safari";
  }
  if (/Android/.test(ua)) return /SamsungBrowser/.test(ua) ? "android-samsung" : "android";
  return "desktop";
}

/**
 * Code zum Wiederanmelden nötig: Auf dem iPhone hat die Home-Bildschirm-App einen eigenen Speicher;
 * aus Samsung Internet geht es weiter in Chrome (anderer Browser = anderer Speicher).
 */
function needsTransferCode(platform) {
  return (platform.startsWith("ios-") && platform !== "ios-inapp") || platform === "android-samsung";
}

/**
 * Samsung Internet baut beim Installieren ein Android-Paket mit alter Zielversion – Google Play Protect
 * blockiert es dann als „unsichere App“. Deshalb dort nicht direkt installieren, sondern in Chrome weiter.
 */
function installsViaChrome() {
  return installPlatform() === "android-samsung";
}

/**
 * Kopiert den Anmelde-Link (mit persönlichem Code) und öffnet Chrome per Android-Intent. Chrome lädt die Seite
 * dabei nicht selbst (getestet mit Samsung Internet) – man fügt den Link in die Adressleiste ein und ist angemeldet.
 */
function chromeLink(code) {
  const a = el("a", { class: "button button-primary button-small", text: "Link kopieren und Chrome öffnen" });
  a.href = `intent://${location.host}/app/#Intent;scheme=https;action=android.intent.action.VIEW;`
    + "category=android.intent.category.BROWSABLE;package=com.android.chrome;end";
  if (code) {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      try { await navigator.clipboard.writeText(inviteLink(code)); } catch { /* dann eben den Code eintippen */ }
      location.href = a.href;
    });
  }
  return a;
}

function installSteps(platform) {
  const homeStep = [ICON_PLUS, "Wähle „Zum Home-Bildschirm“ (eventuell etwas nach unten scrollen) und tippe auf „Hinzufügen“."];
  const openStep = [null, "Öffne Abgehakt vom Home-Bildschirm und gib dort den Code unten ein – fertig."];
  switch (platform) {
    case "ios-safari":
      return [[ICON_SHARE, "Tippe auf „Teilen“ (Quadrat mit Pfeil nach oben) – unten in der Leiste oder im Menü „…“."], homeStep, openStep];
    case "ios-safari-ipad":
      return [[ICON_SHARE, "Tippe oben rechts auf „Teilen“ (Quadrat mit Pfeil nach oben)."], homeStep, openStep];
    case "ios-chrome":
      return [[ICON_SHARE, "Tippe oben rechts in der Adressleiste auf „Teilen“ (Quadrat mit Pfeil nach oben)."], homeStep, openStep];
    case "ios-firefox":
      return [[ICON_MENU, "Tippe unten rechts auf das Menü (☰) und dann auf „Teilen“."], homeStep, openStep];
    case "ios-other":
      return [[ICON_SHARE, "Öffne das Teilen-Menü deines Browsers. Findest du dort „Zum Home-Bildschirm“ nicht, öffne diese Seite in Safari."], homeStep, openStep];
    case "ios-inapp":
      return [[ICON_MENU, "Diese Seite ist in einer anderen App geöffnet. Tippe auf „…“ und wähle „In Safari öffnen“ – dort geht es weiter."]];
    case "android-samsung":
      return [
        [null, "Installiere Abgehakt über Google Chrome – aus Samsung Internet heraus würde Android die App fälschlich als unsicher blockieren."],
        [null, "Tippe unten auf „Link kopieren und Chrome öffnen“."],
        [null, "Tippe in Chrome oben in die Adressleiste und füge den Link ein – du bist dann direkt angemeldet."],
        [ICON_MENU, "Tippe in Chrome oben rechts auf das Menü (⋮) und wähle „App installieren“."],
      ];
    case "android":
      return installPrompt
        ? [[ICON_PLUS, "Tippe unten auf „Jetzt installieren“ und bestätige."]]
        : [[ICON_MENU, "Tippe oben rechts auf das Menü (⋮)."], [ICON_PLUS, "Wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“."]];
    default:
      return [[ICON_PLUS, "Klicke unten auf „Jetzt installieren“ und bestätige."]];
  }
}

/** Soll Installieren überhaupt angeboten werden? */
function canOfferInstall() {
  if (isStandalone()) return false;
  const platform = installPlatform();
  return platform !== "desktop" || Boolean(installPrompt);
}

function hideInstallHintFor(days) {
  writeJsonStorage(INSTALL_KEY, Date.now() + days * 24 * 60 * 60 * 1000);
  $("install-hint").hidden = true;
}

function renderInstallHint() {
  const hint = $("install-hint");
  const hiddenUntil = Number(readJsonStorage(INSTALL_KEY, 0)) || 0;
  if (!canOfferInstall() || Date.now() < hiddenUntil) {
    hint.hidden = true;
    renderPushHint();
    return;
  }
  const direct = Boolean(installPrompt) && !installsViaChrome();
  $("button-install").hidden = !direct;
  $("button-install-guide").hidden = direct;
  $("install-text").textContent = installsViaChrome()
    ? "Nutze Abgehakt als App: Sie startet direkt in deinem Heft und funktioniert auch ohne Internet. Das geht am besten über Google Chrome – die Anleitung zeigt, wie."
    : direct
      ? "Installiere Abgehakt als App: Sie startet direkt in deinem Heft und funktioniert auch ohne Internet."
      : "Leg Abgehakt auf deinen Home-Bildschirm – dann startet es wie eine App, du bleibst angemeldet und es geht auch ohne Internet.";
  hint.hidden = false;
  renderPushHint();
}

let installCode = null; // einmal erzeugter Code für die Home-Bildschirm-App (pro Klasse, auch über Neuladen gemerkt)

/** Ist der gemerkte Code noch einlösbar? (Schon in der installierten App benutzt → nein.) Offline: im Zweifel ja. */
async function installCodeStillValid(code) {
  try {
    await api("/api/code/check", { method: "POST", body: { code: code.code } });
    return true;
  } catch (err) {
    return !(err.status >= 400 && err.status < 500 && err.status !== 429);
  }
}

async function renderInstallCode({ fresh = false } = {}) {
  const box = $("install-code-box");
  box.replaceChildren();
  showError("error-install", "");
  const m = state.membership;
  try {
    if (!installCode || installCode.classId !== m.classId) installCode = readJsonStorage(INSTALL_CODE_PREFIX + m.classId, null);
    // Ein neuer Code macht ältere ungültig – deshalb nur, wenn keiner da ist, er bald abläuft, schon eingelöst wurde
    // oder ausdrücklich ein neuer gewünscht ist.
    const usable = installCode && installCode.classId === m.classId && installCode.expiresAt > Date.now() + 60 * 60 * 1000;
    if (fresh || !usable || !(await installCodeStillValid(installCode))) {
      const res = await api("/api/me/code", { method: "POST", token: m.token });
      installCode = { classId: m.classId, ...res.code };
      writeJsonStorage(INSTALL_CODE_PREFIX + m.classId, installCode);
    }
    const pretty = `${installCode.code.slice(0, 4)}-${installCode.code.slice(4)}`;
    const copy = el("button", { class: "button button-small", type: "button", text: "Code kopieren" });
    copy.addEventListener("click", () => copyText(pretty, copy));
    const renew = el("button", { class: "button button-small", type: "button", text: "Neuen Code erzeugen" });
    renew.addEventListener("click", () => {
      if (window.confirm("Neuen Code erzeugen? Der bisherige Code gilt dann nicht mehr.")) renderInstallCode({ fresh: true });
    });
    box.append(el("div", { class: "invite card personal-code" },
      el("p", { class: "eyebrow", text: `Dein Code für die App · ${m.className}` }),
      el("p", { class: "invite-code", text: pretty }),
      el("p", { class: "hint", text: `Nur für dich, einmal nutzbar, gültig bis ${DATE_ONLY.format(new Date(installCode.expiresAt))}. Am besten jetzt kopieren oder merken.` }),
      el("div", { class: "invite-actions" }, copy, ...(installsViaChrome() ? [chromeLink(installCode.code)] : []), renew),
    ));
  } catch (err) {
    if (handleAuthError(err)) return;
    showError("error-install", "Der Code konnte gerade nicht erzeugt werden. Du kannst ihn später unter „Einstellungen → Für mich → Weiteres Gerät anmelden“ erzeugen.");
    if (installsViaChrome()) box.append(el("div", { class: "invite-actions" }, chromeLink()));
  }
}

/** Schritt-für-Schritt-Anleitung (nach dem Beitreten oder über „Anleitung“ im Hinweis). */
function openInstallGuide({ afterJoin = false, returnTo = "view-class" } = {}) {
  installReturn = returnTo;
  const platform = installPlatform();
  $("install-eyebrow").textContent = afterJoin ? "Fast fertig" : "Anleitung";
  $("install-steps").replaceChildren(...installSteps(platform).map(([icon, text]) =>
    el("li", {}, icon ? el("span", { class: "install-icon" }, svgIcon(icon, 18, 2)) : el("span", { class: "install-icon" }), el("span", { text }))));
  const direct = Boolean(installPrompt) && !installsViaChrome();
  $("button-install-now").hidden = !direct;
  $("button-install-done").hidden = direct;
  $("button-install-skip").textContent = afterJoin ? "Später" : "Schließen";
  $("button-install-done").textContent = returnTo === "view-settings" ? "Fertig" : "Weiter zum Heft";
  $("install-code-box").replaceChildren();
  showError("error-install", "");
  showNotice("");
  show("view-install");
  if (needsTransferCode(platform)) renderInstallCode();
}

/** Einstellungen → „Als App installieren“: die Anleitung jederzeit wieder öffnen. */
function renderInstallCard() {
  const text = $("install-card-text");
  const button = $("button-install-again");
  if (isStandalone()) {
    text.textContent = "Abgehakt läuft auf diesem Gerät schon als App.";
    button.hidden = true;
  } else if (!canOfferInstall()) {
    text.textContent = "In diesem Browser lässt sich Abgehakt nicht installieren. Auf dem Handy geht es – oder am Computer z. B. mit Chrome oder Edge.";
    button.hidden = true;
  } else {
    text.textContent = "Leg Abgehakt auf deinen Home-Bildschirm – dann startet es wie eine App und geht auch ohne Internet.";
    button.hidden = false;
  }
}

let installReturn = "view-class"; // wohin „Schließen“ in der Anleitung führt

function closeInstallGuide(hideDays) {
  if (installReturn === "view-settings") {
    installReturn = "view-class";
    return openSettings(); // aus den Einstellungen geöffnet → dorthin zurück, Hinweis im Heft unverändert
  }
  if (hideDays) hideInstallHintFor(hideDays);
  show("view-class");
  renderDay();
  renderInstallHint();
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  if (state.membership) renderInstallHint();
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  $("install-hint").hidden = true;
});

// ---------- Start ----------

/**
 * Holt den Code aus „#code=…“ und entfernt ihn sofort aus der Adresse. So landet keine Adresse mit
 * Code im Verlauf – sonst würde „Zurück“ den Einladungslink später erneut auslösen.
 */
function takeCodeFromUrl() {
  const c = codeFromUrl();
  if (c) history.replaceState(history.state, "", "/app/");
  return c;
}

function codeFromUrl() {
  return new URLSearchParams(location.hash.slice(1)).get("code") || "";
}

/**
 * Sicherheitsnetz: Ist das Design (CSS) nicht oder nur halb angekommen, einmal neu laden.
 * Erkennung über eine Variable, die ganz am Ende von style.css steht. Höchstens ein Versuch pro Sitzung.
 */
function stylesLoaded() {
  return getComputedStyle(document.documentElement).getPropertyValue("--css-complete").trim() === "1";
}

function healMissingStyles() {
  if (stylesLoaded()) {
    try { sessionStorage.removeItem("abgehakt.cssRetry"); } catch { /* egal */ }
    return false;
  }
  let tried = false;
  try { tried = sessionStorage.getItem("abgehakt.cssRetry") === "1"; } catch { /* egal */ }
  if (tried) return false;
  try { sessionStorage.setItem("abgehakt.cssRetry", "1"); } catch { /* egal */ }
  location.reload();
  return true;
}

function init() {
  // Wer Abgehakt zum ersten Mal öffnet, bekommt keine „Neu in …“-Hinweise – für ihn ist alles neu.
  if (!loadMemberships().length && !readJsonStorage(SEEN_VERSION_KEY, null)) markChangelogSeen();
  if (healMissingStyles()) return;
  $("form-code").addEventListener("submit", onCodeSubmit);
  $("form-name").addEventListener("submit", onNameSubmit);
  $("form-task").addEventListener("submit", onTaskSubmit);
  $("button-back").addEventListener("click", () => startJoin(pendingCode ? pendingCode.code : ""));
  $("button-code-back").addEventListener("click", () => {
    if (location.hash) history.replaceState(null, "", "/app/");
    showNotice("");
    openClass(getActiveId());
  });
  $("button-join-more").addEventListener("click", () => startJoin());
  $("button-add").addEventListener("click", () => openTaskForm());
  $("button-task-cancel").addEventListener("click", closeTaskForm);
  $("switcher").addEventListener("change", (e) => openClass(e.target.value));
  $("button-to-login").addEventListener("click", startCreateClass);
  $("button-new-class").addEventListener("click", startCreateClass);
  $("form-login").addEventListener("submit", onLoginSubmit);
  $("form-login-code").addEventListener("submit", onLoginCodeSubmit);
  $("form-create-class").addEventListener("submit", onCreateClassSubmit);
  $("button-login-back").addEventListener("click", cancelCreateClass);
  $("button-login-other").addEventListener("click", () => { show("view-login"); $("input-email").focus(); });
  $("button-create-cancel").addEventListener("click", cancelCreateClass);
  $("button-invites").addEventListener("click", openInvites);
  $("button-invites-back").addEventListener("click", openMembers);
  $("button-members").addEventListener("click", openMembers);
  $("button-members-back").addEventListener("click", () => { show("view-class"); renderDay(); });
  $("button-settings").addEventListener("click", openSettings);
  $("button-settings-back").addEventListener("click", () => { show("view-class"); renderDay(); });
  $("button-add-member").addEventListener("click", () => {
    $("form-add-member").hidden = false;
    showError("error-add-member", "");
    $("input-member-name").focus();
  });
  $("button-add-member-cancel").addEventListener("click", () => { $("form-add-member").hidden = true; });
  $("form-add-member").addEventListener("submit", onAddMemberSubmit);
  $("button-secure").addEventListener("click", startSecure);
  $("form-visibility").addEventListener("submit", onVisibilitySubmit);
  $("form-visibility").addEventListener("change", (e) => { if (e.target.name === "visibility") updateViewerVisibility(); });
  $("button-leave").addEventListener("click", leaveClass);
  $("button-own-code").addEventListener("click", createOwnCode);
  $("button-choose-electives").addEventListener("click", () => openElectives());
  $("button-toggle-all-subjects").addEventListener("click", toggleAllSubjects);
  $("form-electives").addEventListener("submit", onElectivesSubmit);
  $("button-electives-skip").addEventListener("click", goBack);
  $("form-subject").addEventListener("submit", onSubjectSubmit);
  $("input-subject-select").addEventListener("change", () => {
    const isNew = $("input-subject-select").value === "__new__";
    $("new-subject-fields").hidden = !isNew;
    if (isNew) $("input-new-subject").focus();
    suggestDue();
    updateRepeatFields();
  });
  $("input-title").addEventListener("paste", onTitlePaste);
  let fitTimer = null;
  window.addEventListener("resize", () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitClassHead, 150); });
  $("button-whats-new-ok").addEventListener("click", () => { markChangelogSeen(); $("whats-new").hidden = true; renderPushHint(); });
  $("button-push-hint-on").addEventListener("click", () => enablePush({ fromHint: true }));
  $("button-push-hint-no").addEventListener("click", () => { writeJsonStorage(PUSH_HINT_KEY, true); $("push-hint").hidden = true; });
  $("button-push-on").addEventListener("click", () => enablePush());
  $("button-push-off").addEventListener("click", disablePush);
  $("button-push-test").addEventListener("click", sendTestPush);
  $("button-push-install").addEventListener("click", () => openInstallGuide({ returnTo: "view-settings" }));
  $("button-mydata").addEventListener("click", downloadMyData);
  $("input-theme-color").addEventListener("change", () => saveTheme({ name: "custom", color: $("input-theme-color").value.toLowerCase() }));
  $("button-install-again").addEventListener("click", () => openInstallGuide({ returnTo: "view-settings" }));
  for (const id of ["push-reminder", "push-events", "push-new", "push-reports", "push-hour"]) $(id).addEventListener("change", savePushOptions);
  $("button-whats-new-all").addEventListener("click", () => openChangelog("view-class"));
  $("button-changelog").addEventListener("click", () => openChangelog("view-settings"));
  $("button-changelog-back").addEventListener("click", goBack);
  $("button-more-events").addEventListener("click", () => {
    writeJsonStorage(KIND_FILTER_KEY, "events");
    renderDay();
    $("kind-filter").scrollIntoView({ block: "start", behavior: reducedMotion.matches ? "auto" : "smooth" });
  });
  for (const b of $("kind-filter").querySelectorAll("button")) {
    b.addEventListener("click", () => { writeJsonStorage(KIND_FILTER_KEY, b.dataset.filter); renderDay(); });
  }
  $("input-kind").addEventListener("change", () => { updateKindFields(); suggestDue(); });
  // „Nur für mich“ an/aus: Eintragende mit Fach-Liste sehen für sich selbst alle Fächer, für die Klasse nur ihre.
  $("input-private").addEventListener("change", () => {
    if (state.postSubjects && !state.editingId) fillSubjectSelect(null, $("input-subject-select").value);
  });
  $("input-due").addEventListener("input", () => { dueTouched = true; $("due-hint").hidden = true; updateRepeatFields(); });
  $("input-repeat").addEventListener("change", updateRepeatFields);
  $("input-repeat-until").addEventListener("input", updateRepeatFields);
  // Andere Art, anderes Fach oder anderes Datum → der Hinweis „Gibt es schon?“ passt nicht mehr.
  for (const id of ["input-kind", "input-subject-select", "input-due"]) {
    $(id).addEventListener("change", () => { if (!$("dup-hint").hidden) resetDuplicateHint(); });
  }
  $("input-ab-weeks").addEventListener("change", () => saveTimetable($("input-ab-weeks").checked, "a"));
  for (const r of document.querySelectorAll('input[name="ab-current"]')) {
    r.addEventListener("change", () => saveTimetable(true, r.value));
  }
  $("button-my-electives").addEventListener("click", () => openElectives({ returnTo: "view-settings" }));
  $("button-manage-subjects").addEventListener("click", openSubjectsAdmin);
  $("button-open-deleted").addEventListener("click", openDeleted);
  $("button-deleted-back").addEventListener("click", goBack);
  // Reiter „Für mich · Klasse“ oben in beiden Einstellungsseiten
  for (const tab of document.querySelectorAll(".settings-tabs button")) {
    tab.addEventListener("click", () => (tab.dataset.tab === "class" ? openClassSettings() : openSettings()));
  }
  $("button-class-settings-back").addEventListener("click", goBack);
  $("form-report").addEventListener("submit", onReportSubmit);
  $("button-feedback").addEventListener("click", openFeedback);
  $("button-feedback-footer").addEventListener("click", openFeedback);
  $("button-feedback-cancel").addEventListener("click", closeFeedback);
  $("form-feedback").addEventListener("submit", onFeedbackSubmit);
  $("form-feedback").addEventListener("change", () => showError("error-feedback", ""));
  $("button-report-cancel").addEventListener("click", () => { reportingTask = null; show("view-class"); renderDay(); });
  $("button-open-reports").addEventListener("click", openReports);
  $("button-reports-back").addEventListener("click", () => {
    if (reportsReturn === "view-members") openMembers();
    else openClass(state.membership.classId);
  });
  $("button-reports-menu").addEventListener("click", openReports);
  $("button-refresh").addEventListener("click", refreshApp);
  $("button-nav-back").addEventListener("click", goBack);
  setupPullToRefresh();

  $("button-install").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    renderInstallHint();
  });
  $("button-install-later").addEventListener("click", () => hideInstallHintFor(14)); // 14 Tage Ruhe
  $("button-install-guide").addEventListener("click", () => openInstallGuide());
  $("button-install-skip").addEventListener("click", () => closeInstallGuide(1));
  $("button-install-done").addEventListener("click", () => closeInstallGuide(3));
  $("button-install-now").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    closeInstallGuide(choice && choice.outcome === "accepted" ? 0 : 1);
  });

  // Wieder online: Warteschlange senden und neu laden.
  window.addEventListener("online", () => {
    if (state.membership && !$("view-class").hidden) openClass(state.membership.classId, { keepNotice: true });
    else if (state.membership) flushQueue();
  });
  window.addEventListener("offline", () => {
    state.offline = true;
    if (state.membership && !$("view-class").hidden) updateSyncInfo();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* ohne Offline-Modus weiter */ });
  }

  // „Abgehakt“ oben: in einer Klasse zurück zum eigenen Heft (heute), sonst zur Startseite.
  $("brand").addEventListener("click", (e) => {
    if (!loadMemberships().length) return;
    e.preventDefault();
    if (location.hash) history.replaceState(null, "", "/app/");
    state.day = defaultDay();
    state.expanded.clear();
    showNotice("");
    $("view-class").hidden = true; // damit show() wieder nach oben scrollt
    openClass(state.membership ? state.membership.classId : getActiveId());
  });
  $("form-rename").addEventListener("submit", onRenameSubmit);
  $("form-class-admin").addEventListener("submit", onClassRenameSubmit);
  $("button-delete-class").addEventListener("click", deleteOwnClass);
  $("button-admin-login").addEventListener("click", startAdminLogin);
  $("form-invite").addEventListener("submit", onInviteSubmit);
  $("input-login-code").addEventListener("input", (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
    const formatted = digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
    if (formatted !== e.target.value) e.target.value = formatted;
  });
  $("day-prev").addEventListener("click", () => changeDay(stepSchoolDay(state.day, -1)));
  $("day-next").addEventListener("click", () => changeDay(stepSchoolDay(state.day, 1)));
  $("day-label").addEventListener("click", () => changeDay(defaultDay()));
  $("input-code").addEventListener("input", (e) => {
    const formatted = formatCode(e.target.value);
    if (formatted !== e.target.value) e.target.value = formatted;
  });

  // Einladungslink geöffnet, während die App schon offen ist.
  window.addEventListener("hashchange", () => {
    const c = takeCodeFromUrl();
    if (c) startJoin(c);
  });

  // Zurück in die App (z. B. am nächsten Tag): Stand neu laden.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.membership && !$("view-class").hidden) {
      openClass(state.membership.classId, { keepNotice: true });
    }
  });

  // Direktlink von der Startseite: „Heft für deine Klasse anlegen“
  if (location.hash === "#klasse-anlegen") {
    history.replaceState(history.state, "", "/app/");
    startCreateClass();
    return;
  }

  const code = takeCodeFromUrl();
  if (code) startJoin(code);
  else if (loadMemberships().length) openClass(getActiveId());
  else startJoin();
}

init();
