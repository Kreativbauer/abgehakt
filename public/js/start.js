// Abgehakt – Startseite, Impressum, Datenschutz (kein Inline-Code, siehe CSP in public/_headers)
"use strict";

// Wer schon in einer Klasse ist, kommt mit einem Tipp direkt zum eigenen Heft.
try {
  const list = JSON.parse(localStorage.getItem("abgehakt.memberships") || "[]");
  if (Array.isArray(list) && list.length > 0) {
    const main = document.getElementById("open-app");
    if (main) main.textContent = "Zum Hausaufgabenheft";
    const top = document.getElementById("open-app-top");
    if (top) top.textContent = "Mein Heft";
    // Impressum/Datenschutz: Logo führt ins eigene Heft statt zur Startseite.
    const brand = document.getElementById("brand-home");
    if (brand) brand.href = "/app/";
  }
} catch {
  // Speicher nicht verfügbar – Startseite funktioniert trotzdem.
}

// Service Worker auch auf der Startseite anmelden (App-Hülle wird für offline gespeichert).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
