// Abgehakt · Betrieb – Service Worker nur für /betrieb: zeigt Benachrichtigungen für den Betreiber an.
// Kein Offline-Modus, kein Cache (die Seite soll immer frisch vom Server kommen).
// Getrennt vom Service Worker der App (sw.js), damit die Benachrichtigungen beim Antippen /betrieb öffnen
// und die Abos von Betrieb und App nichts miteinander zu tun haben.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(self.registration.showNotification(data.title || "Abgehakt · Betrieb", {
    body: data.body || "",
    tag: data.tag,
    icon: "/icons/betrieb-192.png",
    badge: "/icons/badge-96.png",
    data: { url: "/betrieb" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).pathname.startsWith("/betrieb"));
      if (open) return open.focus();
      return self.clients.openWindow("/betrieb");
    }),
  );
});
