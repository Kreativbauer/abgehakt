// Abgehakt – „Was ist neu“: Neuerungen für die Nutzerinnen und Nutzer (kein Inline-Code, siehe CSP)
//
// Neueste Version zuerst. Ein Eintrag gehört zu jeder Version mit neuer Funktion (MINOR, z. B. 0.26.0);
// reine Fehlerbehebungen (PATCH) bekommen keinen. `npm run check` prüft, dass x.y.0 hier steht.
// Texte in Alltagssprache, kurz, aus Sicht der Person, die die App benutzt.
"use strict";

const CHANGELOG = [
  {
    version: "0.37.0",
    items: [
      "Neu in den Einstellungen: „Alle meine Daten löschen“. Du trittst damit aus allen Klassen auf diesem Gerät aus, ein Admin-Konto mit E-Mail wird mit gelöscht, und auf dem Gerät bleibt nichts von Abgehakt zurück.",
    ],
  },
  {
    version: "0.36.0",
    items: [
      "Wiederholen geht jetzt auch „Jede Stunde (laut Stundenplan)“ – z. B. eine mögliche Abfrage in jeder Mathe-Stunde, auch wenn Mathe mehrmals pro Woche ist.",
    ],
  },
  {
    version: "0.35.0",
    items: [
      "Wiederkehrende Einträge: Beim Eintragen „Wiederholen“ wählen – z. B. jeden Montag eine Mathe-Abfrage bis zu einem Datum.",
      "Jeder Termin lässt sich danach einzeln ändern oder löschen, mit „Ab hier alle löschen“ auch die ganze Reihe.",
    ],
  },
  {
    version: "0.34.0",
    items: [
      "Wähle deine Farbe: unter Einstellungen → Design gibt es Pink, Blau, Grün und mehr – oder du suchst dir eine eigene Farbe aus.",
      "Admins können Eintragende auf bestimmte Fächer festlegen, zum Beispiel nur Italienisch oder Mathe und Spanisch.",
    ],
  },
  {
    version: "0.33.0",
    items: [
      "Kleine Überraschung im Design – nicht für alle sichtbar.",
    ],
  },
  {
    version: "0.32.0",
    items: [
      "Neu in den Einstellungen: „Meine Daten“ – lade alles herunter, was Abgehakt zu dir gespeichert hat.",
    ],
  },
  {
    version: "0.31.0",
    items: [
      "Abgehakt hat jetzt auch ein helles Design. Es richtet sich nach deinem Handy: Ist dort der helle Modus an, ist Abgehakt hell, sonst dunkel.",
    ],
  },
  {
    version: "0.30.0",
    items: [
      "Die Anleitung zum Installieren als App findest du jetzt jederzeit unter Einstellungen → Als App installieren.",
    ],
  },
  {
    version: "0.29.0",
    items: [
      "Ist der Abgabetag vorbei, verschwindet eine Hausaufgabe aus dem Heft – auch wenn du sie nicht abgehakt hast. Beim Zurückblättern auf ihren Tag siehst du sie weiterhin.",
    ],
  },
  {
    version: "0.28.0",
    items: [
      "Neue Art „Sonstiger Termin“: für alles, was keine Prüfung ist – zum Beispiel Klassenfoto, Wandertag oder Elternabend. Du schreibst dazu, was es ist; ein Fach ist freiwillig.",
    ],
  },
  {
    version: "0.27.0",
    items: [
      "Steht eine Aufgabe schon drin, fragt Abgehakt beim Eintragen kurz nach – so gibt es nichts doppelt.",
      "Admins können gelöschte Einträge der letzten 30 Tage wiederherstellen: Einstellungen → Klasse → Zuletzt gelöscht.",
      "Admins können sich benachrichtigen lassen, wenn jemand einen Eintrag meldet (Einstellungen → Benachrichtigungen).",
    ],
  },
  {
    version: "0.26.0",
    items: [
      "Benachrichtigungen: Abgehakt erinnert dich am Vorabend an Offenes und an anstehende Termine – auf Wunsch auch an neue Einträge.",
      "Einschalten und Uhrzeit wählen unter Einstellungen → Benachrichtigungen. Auf dem iPhone nur, wenn Abgehakt auf dem Home-Bildschirm liegt.",
    ],
  },
  {
    version: "0.25.0",
    items: [
      "Nach einem Update mit neuen Funktionen zeigt Abgehakt kurz, was neu ist.",
      "Alle Neuerungen findest du unter Einstellungen → Was ist neu.",
    ],
  },
  {
    version: "0.24.0",
    items: [
      "Die Einstellungen öffnest du jetzt mit dem Zahnrad oben im Heft – getrennt in „Für mich“ und „Klasse“.",
    ],
  },
  {
    version: "0.22.0",
    items: [
      "Unter „Alles“ stehen nur die Termine der nächsten 7 Tage, alle weiteren unter „Termine“.",
    ],
  },
  {
    version: "0.21.0",
    items: [
      "Links in Hausaufgaben lassen sich öffnen: Eintrag antippen, dann auf den Link.",
      "Termine haben ein Kalender-Symbol statt eines Hakens.",
    ],
  },
  {
    version: "0.20.0",
    items: [
      "Neuer Filter im Heft: Alles · Hausaufgaben · Termine.",
      "Für Termine reichen Art, Fach und Datum – Themen kannst du optional dazuschreiben.",
    ],
  },
  {
    version: "0.19.0",
    items: [
      "Schulaufgaben, Kurzarbeiten, Tests und Referate eintragen – sie stehen gesammelt oben im Heft.",
    ],
  },
  {
    version: "0.18.0",
    items: [
      "Eine kopierte Nachricht (z. B. aus Teams) wird beim Einfügen automatisch in Aufgabe und Details aufgeteilt.",
    ],
  },
  {
    version: "0.17.0",
    items: [
      "Stundenplan: Beim Eintragen schlägt Abgehakt die nächste Stunde des Fachs als Abgabetag vor.",
    ],
  },
  {
    version: "0.16.0",
    items: [
      "Fächerliste und Wahlfächer: Du siehst nur Hausaufgaben aus den Fächern, die du hast.",
    ],
  },
  {
    version: "0.15.0",
    label: "Bis Version 0.15",
    items: [
      "Die Grundlagen: gemeinsames Heft, eigene Häkchen und Notizen, private Aufgaben, offline nutzbar, mehrere Klassen und Geräte.",
    ],
  },
];
