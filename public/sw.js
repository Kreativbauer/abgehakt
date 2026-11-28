// Abgehakt – Service Worker: macht die App offline nutzbar.
// VERSION muss zu package.json passen (prüft `npm run check`). Neue Version = neuer Cache.
const VERSION = "0.36.4";
const CACHE = `abgehakt-${VERSION}`;

// App-Hülle: wird beim Installieren vorab gespeichert.
const PRECACHE = [
  "/",
  "/app/",
  `/css/style.css?v=${VERSION}`,
  `/js/changelog.js?v=${VERSION}`,
  `/js/app.js?v=${VERSION}`,
  `/js/start.js?v=${VERSION}`,
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/badge-96.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("abgehakt-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Daten (API) nie aus dem Cache – darum kümmert sich die App selbst.
  if (url.pathname.startsWith("/api/")) return;

  // Wichtig: Antworten werden hier NICHT nebenbei in den Cache kopiert (kein res.clone() + put).
  // Beim Versionswechsel löscht der neue Service Worker den alten Cache; ein gleichzeitig laufendes
  // Kopieren kann in Safari die geteilte Antwort abbrechen – dann kommt z. B. das CSS nur halb an.
  // Der Cache wird stattdessen einmal pro Version beim Installieren vollständig befüllt (PRECACHE).

  // Seiten: erst Netz (immer aktuell), offline die gespeicherte Hülle.
  if (req.mode === "navigate") {
    const shell = url.pathname.startsWith("/app") ? "/app/" : "/";
    event.respondWith(fetch(req).catch(() => caches.match(shell).then((hit) => hit || Response.error())));
    return;
  }

  // Styles, Skripte, Bilder: aus dem Cache dieser Version (über ?v= versioniert), sonst direkt aus dem Netz.
  event.respondWith(
    caches.match(req)
      .then((hit) => hit || fetch(req))
      .catch(() => fetch(req)),
  );
});

// Benachrichtigungen (Web Push, verschickt vom Server – siehe src/jobs/notify.js).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(self.registration.showNotification(data.title || "Abgehakt", {
    body: data.body || "",
    tag: data.tag,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png", // einfarbig (weiß auf durchsichtig) – Android zeigt es in der Statusleiste
    data: { url: data.url || "/app/" },
  }));
});

// Antippen öffnet das Heft (oder holt ein offenes Fenster nach vorn).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/app/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.location.origin + "/app"));
      if (open) return open.focus();
      return self.clients.openWindow(target);
    }),
  );
});
