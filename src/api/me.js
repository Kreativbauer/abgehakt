// GET /api/me         → wer bin ich auf diesem Gerät, in welcher Klasse?
// GET /api/me/export  → „Meine Daten herunterladen“: alles, was zu dieser Person gespeichert ist
//                       (Auskunft nach Art. 15 DSGVO und Datenübertragbarkeit nach Art. 20 – ohne dass der
//                       Betreiber etwas davon sieht). Nur Daten dieser Person, nie die anderer.
import { json } from "../lib/http.js";
import { requireMember } from "../lib/auth.js";
import { kindOf, KIND_LABELS } from "./tasks.js";
import { REASONS } from "./reports.js";

export async function me(request, env) {
  const { member, classInfo } = await requireMember(request, env);
  return json({ class: classInfo, member });
}

const ROLES = { admin: "Admin", editor: "Eintragende", member: "Mitglied" };
const VISIBILITY = { none: "niemand", all: "alle in der Klasse", some: "ausgewählte Personen" };
const REPORT_STATUS = {
  open: "offen", admin_hidden: "Eintrag von Admins entfernt", admin_dismissed: "von Admins als in Ordnung markiert",
  op_dismissed: "vom Betreiber als in Ordnung markiert", op_hidden: "vom Betreiber ausgeblendet",
  op_warned: "vom Betreiber ausgeblendet, Admins verwarnt",
};

const when = (ms) => (ms ? new Date(ms).toISOString() : null);
const label = (row) => {
  const kind = kindOf(row);
  if (kind === "homework" || kind === "other") return row.title;
  return [KIND_LABELS[kind], row.title].filter(Boolean).join(" · ");
};
const parseIds = (s) => { try { return JSON.parse(s || "[]"); } catch { return []; } };

export async function exportMyData(request, env) {
  const { member, classInfo } = await requireMember(request, env);
  const db = env.DB;
  const id = member.id;

  const [m, devices, codes, states, own, created, reports, pushes, edited, deleted, madeCodes] = await Promise.all([
    db.prepare("SELECT * FROM members WHERE id = ?").bind(id).first(),
    db.prepare("SELECT created_at, last_seen_at, revoked_at FROM devices WHERE member_id = ? ORDER BY created_at").bind(id).all(),
    db.prepare(`SELECT created_at, expires_at, use_count, revoked_at FROM join_codes
                 WHERE member_id = ? AND kind = 'personal' ORDER BY created_at`).bind(id).all(),
    db.prepare(`SELECT s.status, s.note, s.updated_at, t.kind, t.other_event, t.title, t.subject, t.due_date
                  FROM task_states s JOIN tasks t ON t.id = s.task_id
                 WHERE s.member_id = ? ORDER BY t.due_date`).bind(id).all(),
    db.prepare(`SELECT kind, other_event, title, details, subject, due_date, created_at, updated_at, deleted_at
                  FROM tasks WHERE owner_member_id = ? ORDER BY due_date`).bind(id).all(),
    db.prepare(`SELECT kind, other_event, title, details, subject, due_date, created_at, deleted_at
                  FROM tasks WHERE created_by = ? AND owner_member_id IS NULL ORDER BY due_date`).bind(id).all(),
    db.prepare(`SELECT reason, comment, snapshot_title, snapshot_subject, created_at, status
                  FROM reports WHERE reporter_member_id = ? ORDER BY created_at`).bind(id).all(),
    db.prepare(`SELECT endpoint, remind_hour, notify_reminder, notify_events, notify_new, notify_reports, created_at
                  FROM push_subscriptions WHERE member_id = ? ORDER BY created_at`).bind(id).all(),
    // Klassen-Einträge anderer, die du zuletzt bearbeitet hast
    db.prepare(`SELECT kind, other_event, title, subject, due_date, updated_at
                  FROM tasks WHERE updated_by = ?1 AND created_by != ?1 AND owner_member_id IS NULL ORDER BY due_date`).bind(id).all(),
    // Klassen-Einträge, die du gelöscht hast
    db.prepare(`SELECT kind, other_event, title, subject, due_date, deleted_at
                  FROM tasks WHERE deleted_by = ?1 AND owner_member_id IS NULL ORDER BY deleted_at`).bind(id).all(),
    // Codes, die du erzeugt hast (Einladungen, persönliche Codes)
    db.prepare(`SELECT kind, created_at, expires_at, use_count, revoked_at, member_id = ?1 AS self
                  FROM join_codes WHERE created_by = ?1 ORDER BY created_at`).bind(id).all(),
  ]);
  const account = m.account_id
    ? await db.prepare("SELECT email, created_at, last_login_at FROM accounts WHERE id = ?").bind(m.account_id).first()
    : null;
  const sessions = m.account_id
    ? (await db.prepare("SELECT created_at, last_seen_at, revoked_at FROM account_sessions WHERE account_id = ? ORDER BY created_at")
      .bind(m.account_id).all()).results
    : [];

  // Namen statt interner Kennungen: für wen der Status freigegeben ist, welche Wahlfächer gewählt sind.
  const viewerIds = parseIds(m.status_viewers);
  const electiveIds = parseIds(m.elective_ids);
  const editorIds = m.role === "editor" ? parseIds(m.editor_subject_ids) : [];
  const editorSubjects = editorIds.length
    ? (await db.prepare("SELECT name FROM subjects WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(editorIds)).all()).results.map((r) => r.name)
    : [];
  const viewers = viewerIds.length
    ? (await db.prepare("SELECT name FROM members WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(viewerIds)).all()).results.map((r) => r.name)
    : [];
  const electives = electiveIds.length
    ? (await db.prepare("SELECT name FROM subjects WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(electiveIds)).all()).results.map((r) => r.name)
    : [];

  const data = {
    hinweis: "Alles, was Abgehakt zu dir in dieser Klasse gespeichert hat. Ideen und Fehlermeldungen sind anonym gespeichert und keiner Person zugeordnet – sie stehen deshalb nicht hier.",
    erstelltAm: when(Date.now()),
    klasse: { name: classInfo.name, kennung: classInfo.id },
    person: {
      name: m.name,
      rolle: ROLES[m.role] || m.role,
      ...(m.role === "editor" ? { eintragenFuer: editorSubjects.length ? editorSubjects : "alle Fächer" } : {}),
      beigetretenAm: when(m.created_at),
      altersbestaetigungAm: when(m.age_confirmed_at),
      erledigtSichtbarFuer: VISIBILITY[m.status_visibility] || m.status_visibility,
      ausgewaehltePersonen: viewers,
      wahlfaecher: electives,
      wahlfaecherGewaehltAm: when(m.electives_chosen_at),
    },
    adminKonto: account ? {
      email: account.email, angelegtAm: when(account.created_at), letzteAnmeldung: when(account.last_login_at),
      anmeldungen: sessions.map((s) => ({ angemeldetAm: when(s.created_at), zuletztGenutzt: when(s.last_seen_at), abgemeldetAm: when(s.revoked_at) })),
    } : null,
    geraete: devices.results.map((d) => ({ angemeldetAm: when(d.created_at), zuletztGenutzt: when(d.last_seen_at), abgemeldetAm: when(d.revoked_at) })),
    persoenlicheCodes: codes.results.map((c) => ({ erstelltAm: when(c.created_at), gueltigBis: when(c.expires_at), genutzt: c.use_count > 0, ungueltigSeit: when(c.revoked_at) })),
    haekchenUndNotizen: states.results.map((s) => ({
      eintrag: label(s), fach: s.subject, faellig: s.due_date, erledigt: s.status === "done", notiz: s.note, geaendertAm: when(s.updated_at),
    })),
    privateAufgaben: own.results.map((t) => ({
      eintrag: label(t), fach: t.subject, details: t.details, faellig: t.due_date, erstelltAm: when(t.created_at), geloeschtAm: when(t.deleted_at),
    })),
    vonDirEingetrageneKlassenEintraege: created.results.map((t) => ({
      eintrag: label(t), fach: t.subject, details: t.details, faellig: t.due_date, erstelltAm: when(t.created_at), geloeschtAm: when(t.deleted_at),
    })),
    vonDirBearbeiteteKlassenEintraege: edited.results.map((t) => ({
      eintrag: label(t), fach: t.subject, faellig: t.due_date, geaendertAm: when(t.updated_at),
    })),
    vonDirGeloeschteKlassenEintraege: deleted.results.map((t) => ({
      eintrag: label(t), fach: t.subject, faellig: t.due_date, geloeschtAm: when(t.deleted_at),
    })),
    vonDirErzeugteCodes: madeCodes.results.map((c) => ({
      art: c.kind === "invite" ? "Einladung für die Klasse" : c.self ? "Persönlicher Code für dich" : "Persönlicher Code für eine andere Person",
      erstelltAm: when(c.created_at), gueltigBis: when(c.expires_at), genutzt: c.use_count, ungueltigSeit: when(c.revoked_at),
    })),
    deineMeldungen: reports.results.map((r) => ({
      grund: REASONS[r.reason] || r.reason, begruendung: r.comment, eintrag: r.snapshot_title, fach: r.snapshot_subject,
      gemeldetAm: when(r.created_at), stand: REPORT_STATUS[r.status] || r.status,
    })),
    benachrichtigungen: pushes.results.map((p) => ({
      pushDienst: (() => { try { return new URL(p.endpoint).hostname; } catch { return ""; } })(),
      uhrzeit: `${p.remind_hour} Uhr`, erinnerungAmVorabend: Boolean(p.notify_reminder), termine: Boolean(p.notify_events),
      neueEintraege: Boolean(p.notify_new), meldungen: Boolean(p.notify_reports), eingeschaltetAm: when(p.created_at),
    })),
  };
  return json(data); // die App macht daraus die Datei zum Herunterladen

}
