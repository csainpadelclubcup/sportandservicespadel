// Invia a Gianluca una mail per ogni richiesta dei moduli "Attività" (lezione, corso, allenamento, partita).
// Il database invia solo l'id: la funzione rilegge la richiesta con la chiave di servizio
// e manda la mail una sola volta (colonna "notificata").
import nodemailer from "npm:nodemailer@6.9.16";

const A = "gianluca.micarelli@gmail.com";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const MOD: Record<string, string> = { lezione: "Lezione privata", corso: "Corso", allenamento: "Allenamento", partita: "Partita", torneo: "Torneo" };

Deno.serve(async (req) => {
  const URL = Deno.env.get("SUPABASE_URL")!, SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
  let id = "";
  try { id = String((await req.json()).id || ""); } catch (_) { /* */ }
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("id non valido", { status: 400 });
  const q = await fetch(`${URL}/rest/v1/richieste?id=eq.${id}&notificata=eq.false&select=*`, { headers: H });
  const r = (await q.json())[0];
  if (!r) return new Response("niente da inviare");

  const sport = r.sport === "padel" ? "Padel" : "Tennis";
  const modulo = MOD[r.modulo] || r.modulo;
  const formula = (r.dati || []).find((x: { c: string }) => x.c === "Formula")?.v;
  const dato = (k: string) => (r.dati || []).find((x: { c: string }) => x.c === k)?.v;
  const torneo = r.modulo === "torneo";
  const giornoData = new Date(r.giorno + "T12:00:00Z").toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" });
  // per i tornei al posto di giorno e ora si mostrano periodo e tipo di torneo
  const giorno = torneo ? String(dato("Periodo") || giornoData) : giornoData;
  const ora = torneo ? String(dato("Tipo di torneo") || "") : `${String(r.ora_da || "").slice(0, 5)}–${String(r.ora_a || "").slice(0, 5)}`;
  const quando = new Date(r.creato || Date.now()).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
  const coppie: [string, unknown][] = (r.dati || []).map((x: { c: string; v: unknown }) => [x.c, x.v]);
  const righe = coppie.map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#5A6B80;vertical-align:top;border-bottom:1px solid #E3E8EE">${esc(k)}</td><td style="padding:6px 0;border-bottom:1px solid #E3E8EE"><b>${esc(v)}</b></td></tr>`).join("");
  const titolo = `${modulo}${formula ? " " + String(formula).toLowerCase() : ""} · ${sport}`;
  // riga fissa, utile per aggiornare il planner in automatico
  // i tornei non entrano nel planner delle lezioni (nessuna riga PLANNER)
  const planner = torneo ? "" : `PLANNER|${r.giorno}|${ora}|${sport}|${modulo}${formula ? " " + formula : ""}|${r.nome} ${r.cognome}|${r.telefono || ""}|${r.superficie || ""}|${r.id}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;background:#F3F5F8;padding:20px">
<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">
<div style="background:#0B2545;color:#fff;padding:16px 22px;font-weight:bold;letter-spacing:1px">SPORT &amp; SERVICES · NUOVA RICHIESTA ATTIVITÀ</div>
<div style="padding:22px;color:#0B2545;font-size:15px;line-height:1.5">
<h2 style="margin:0 0 6px">${esc(titolo)}</h2>
<p style="margin:0 0 6px;font-size:17px"><b>${esc(giorno)} · ${esc(ora)}</b> · ${esc(r.superficie || "")}</p>
<p style="margin:0 0 14px"><b>${esc(r.nome)} ${esc(r.cognome)}</b> · ${esc(r.email || "")} · ${esc(r.telefono || "")}<br><span style="color:#5A6B80">Ricevuta il ${esc(quando)}</span></p>
<table style="border-collapse:collapse;width:100%;font-size:14px">${righe}</table>
<p style="margin:18px 0 0;font-size:11px;color:#9AA7B6">${esc(planner)}</p>
</div></div></div>`;

  const tx = nodemailer.createTransport({ host: "mail.flazio.com", port: 465, secure: true,
    auth: { user: "info@sportandservicespadel.it", pass: Deno.env.get("SMTP_PASS") ?? "" } });
  try {
    await tx.sendMail({
      from: '"Sport & Services – Attività" <info@sportandservicespadel.it>',
      to: A,
      replyTo: r.email || undefined,
      subject: `Richiesta ${titolo} – ${r.nome} ${r.cognome} – ${giorno} ${ora}`,
      text: `${titolo}\n${giorno} ${ora} · ${r.superficie || ""}\n${r.nome} ${r.cognome} (${r.email || ""} ${r.telefono || ""})\n\n` + coppie.map(([k, v]) => `${k}: ${v}`).join("\n") + `\n\n${planner}`,
      html,
    });
    await fetch(`${URL}/rest/v1/richieste?id=eq.${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ notificata: true }) });
    return new Response("ok");
  } catch (e) {
    console.error(e);
    return new Response("errore invio: " + (e as Error).message, { status: 500 });
  }
});
