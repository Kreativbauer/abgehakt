// E-Mail-Versand über Resend – nur an Admins: Anmeldecodes und Warnungen vor der Löschung.
// Schlüssel: Cloudflare-Secret RESEND_API_KEY. Absender: Variable EMAIL_FROM in wrangler.jsonc.
// Lokal (DEV_MODE=1 in .dev.vars, ohne Schlüssel) wird die E-Mail nur in der Konsole ausgegeben.
import { ApiError } from "./http.js";

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function layout(innerHtml) {
  return `<!doctype html><html lang="de"><body style="margin:0;padding:24px;background:#08090a;color:#f7f8f8;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:440px;margin:0 auto;padding:24px;border:1px solid #23252a;border-radius:12px;background:#0f1011">
${innerHtml}
</div></body></html>`;
}

/** Schickt eine E-Mail. Wirft ApiError, wenn der Versand nicht klappt. */
async function sendEmail(env, { to, subject, text, html }) {
  if (!env.RESEND_API_KEY) {
    if (env.DEV_MODE === "1") {
      console.log(`[DEV] E-Mail an ${to} – ${subject}\n${text}`);
      return;
    }
    console.error("RESEND_API_KEY fehlt – E-Mail-Versand nicht eingerichtet.");
    throw new ApiError(503, "E-Mail-Versand ist noch nicht eingerichtet.");
  }

  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM || "Abgehakt <onboarding@resend.dev>", to: [to], subject, text, html }),
    });
  } catch (err) {
    console.error("Resend nicht erreichbar:", err);
    throw new ApiError(502, "Die E-Mail konnte gerade nicht verschickt werden. Bitte gleich noch einmal versuchen.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Resend-Fehler ${res.status}: ${body.slice(0, 500)}`);
    // 403 im Testmodus: Resend schickt ohne eigene Domain nur an die Konto-Adresse.
    throw new ApiError(502, res.status === 403
      ? "An diese Adresse kann Abgehakt gerade noch keine E-Mails schicken (Testbetrieb)."
      : "Die E-Mail konnte gerade nicht verschickt werden. Bitte gleich noch einmal versuchen.");
  }
}

export async function sendLoginCode(env, email, code) {
  const pretty = `${code.slice(0, 3)} ${code.slice(3)}`;
  const text = [
    "Hallo,",
    "",
    `dein Anmeldecode für Abgehakt lautet: ${pretty}`,
    "",
    "Er ist 10 Minuten gültig. Wenn du dich nicht anmelden wolltest, kannst du diese E-Mail einfach ignorieren.",
    "",
    "Abgehakt – das Hausaufgabenheft für deine Klasse",
  ].join("\n");
  const html = layout(`<p style="margin:0 0 16px;font-size:15px">Dein Anmeldecode für <strong>Abgehakt</strong>:</p>
<p style="margin:0 0 16px;font-size:32px;font-weight:600;letter-spacing:6px;font-family:Menlo,Consolas,monospace">${pretty}</p>
<p style="margin:0;color:#8a8f98;font-size:13px;line-height:1.5">Der Code ist 10 Minuten gültig. Wenn du dich nicht anmelden wolltest, kannst du diese E-Mail ignorieren.</p>`);
  await sendEmail(env, { to: email, subject: `Dein Anmeldecode: ${pretty}`, text, html });
}

/** Warnung an einen Admin: Die Klasse wird wegen Inaktivität bald gelöscht. */
export async function sendDeletionWarning(env, email, className, deleteAt, appUrl) {
  const date = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" })
    .format(new Date(deleteAt));
  const text = [
    "Hallo,",
    "",
    `deine Klasse „${className}“ bei Abgehakt wurde seit fast einem Jahr nicht mehr genutzt.`,
    `Ohne Nutzung wird sie am ${date} automatisch gelöscht – mit allen Hausaufgaben, Mitgliedern, Häkchen und Notizen.`,
    "",
    "Wenn die Klasse erhalten bleiben soll, öffne sie einfach einmal in der App (oder ein anderes Mitglied tut es):",
    appUrl,
    "",
    "Wenn sie nicht mehr gebraucht wird, musst du nichts tun.",
    "",
    "Abgehakt – das Hausaufgabenheft für deine Klasse",
  ].join("\n");
  const html = layout(`<p style="margin:0 0 12px;font-size:15px;line-height:1.5">Deine Klasse <strong>„${escapeHtml(className)}“</strong> wurde seit fast einem Jahr nicht mehr genutzt.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">Ohne Nutzung wird sie am <strong>${date}</strong> automatisch gelöscht – mit allen Hausaufgaben, Mitgliedern, Häkchen und Notizen.</p>
<p style="margin:0 0 20px"><a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#5e6ad2;color:#fff;text-decoration:none;font-weight:500">Klasse öffnen und behalten</a></p>
<p style="margin:0;color:#8a8f98;font-size:13px;line-height:1.5">Wenn die Klasse nicht mehr gebraucht wird, musst du nichts tun.</p>`);
  await sendEmail(env, { to: email, subject: `„${className}“ wird am ${date} gelöscht`, text, html });
}

/** Verwarnung an einen Admin nach einer bestätigten Meldung (vom Betreiber ausgelöst). */
export async function sendReportWarning(env, email, className, taskTitle, appUrl) {
  const text = [
    "Hallo,",
    "",
    `zu deiner Klasse „${className}“ bei Abgehakt ist eine Meldung eingegangen. Der gemeldete Eintrag`,
    `„${taskTitle}“ verstößt gegen die Regeln und wurde ausgeblendet.`,
    "",
    "Bitte achtet als Admins darauf, dass keine beleidigenden oder rechtswidrigen Inhalte eingetragen werden.",
    "Bei weiteren Verstößen kann die Klasse gelöscht werden.",
    "",
    appUrl,
    "",
    "Abgehakt – das Hausaufgabenheft für deine Klasse",
  ].join("\n");
  const html = layout(`<p style="margin:0 0 12px;font-size:15px;line-height:1.5">Zu deiner Klasse <strong>„${escapeHtml(className)}“</strong> ist eine Meldung eingegangen. Der Eintrag <strong>„${escapeHtml(taskTitle)}“</strong> verstößt gegen die Regeln und wurde ausgeblendet.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">Bitte achtet als Admins darauf, dass keine beleidigenden oder rechtswidrigen Inhalte eingetragen werden. Bei weiteren Verstößen kann die Klasse gelöscht werden.</p>`);
  await sendEmail(env, { to: email, subject: `Meldung zu „${className}“`, text, html });
}
