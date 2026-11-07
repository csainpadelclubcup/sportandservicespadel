// Invia una mail a info@sportandservicespadel.it per ogni modulo ricevuto sul sito.
// Il database invia solo l'id del modulo appena salvato: la funzione rilegge il modulo
// con la chiave di servizio e manda la mail una sola volta (colonna "notificata").
import nodemailer from "npm:nodemailer@6.9.16";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  const URL = Deno.env.get("SUPABASE_URL")!, SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
  let id = "";
  try { id = String((await req.json()).id || ""); } catch (_) { /* */ }
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("id non valido", { status: 400 });
  const q = await fetch(`${URL}/rest/v1/iscrizioni?id=eq.${id}&notificata=eq.false&select=*`, { headers: H });
  const r = (await q.json())[0];
  if (!r) return new Response("niente da inviare");

  const quando = new Date(r.creato || Date.now()).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
  const coppie: [string, unknown][] = Array.isArray(r.dati) ? r.dati.map((x: { c: string; v: unknown }) => [x.c, x.v]) : Object.entries(r.dati || {});
  const righe = coppie.map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#5A6B80;vertical-align:top;border-bottom:1px solid #E3E8EE">${esc(k)}</td><td style="padding:6px 0;border-bottom:1px solid #E3E8EE"><b>${esc(v)}</b></td></tr>`).join("");
  const titolo = `${r.tipo || "Modulo"}${r.ente ? " (" + r.ente + ")" : ""}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;background:#F3F5F8;padding:20px">
<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">
<div style="background:#0B2545;color:#fff;padding:16px 22px;font-weight:bold;letter-spacing:1px">SPORT &amp; SERVICES PADEL · NUOVO MODULO</div>
<div style="padding:22px;color:#0B2545;font-size:15px;line-height:1.5">
<h2 style="margin:0 0 6px">${esc(titolo)}</h2>
<p style="margin:0 0 14px"><b>${esc(r.nome)} ${esc(r.cognome)}</b> · ${esc(r.email || "")} · ${esc(r.telefono || "")}<br><span style="color:#5A6B80">Ricevuto il ${esc(quando)}</span></p>
<table style="border-collapse:collapse;width:100%;font-size:14px">${righe}</table>
<p style="margin:18px 0 0;font-size:13px;color:#5A6B80">Ricorda: l’allievo deve inviare anche il modulo stampato e firmato. Tutti i moduli sono nella pagina “Moduli ricevuti” del sito.</p>
</div></div></div>`;

  const tx = nodemailer.createTransport({ host: "mail.flazio.com", port: 465, secure: true,
    auth: { user: "info@sportandservicespadel.it", pass: Deno.env.get("SMTP_PASS") ?? "" } });
  try {
    await tx.sendMail({
      from: '"Sport & Services Padel" <info@sportandservicespadel.it>',
      to: "info@sportandservicespadel.it",
      replyTo: r.email || undefined,
      subject: `Nuovo modulo: ${titolo} – ${r.nome} ${r.cognome}`,
      text: `Nuovo modulo da ${r.nome} ${r.cognome} (${r.email || ""} ${r.telefono || ""})\n\n` + coppie.map(([k, v]) => `${k}: ${v}`).join("\n"),
      html,
    });
    await fetch(`${URL}/rest/v1/iscrizioni?id=eq.${id}`, { method: "PATCH", headers: H, body: JSON.stringify({ notificata: true }) });
    return new Response("ok");
  } catch (e) {
    console.error(e);
    return new Response("errore invio: " + (e as Error).message, { status: 500 });
  }
});
