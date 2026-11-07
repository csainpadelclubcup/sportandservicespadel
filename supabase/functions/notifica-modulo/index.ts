// Invia una mail a info@sportandservicespadel.it per ogni modulo ricevuto sul sito.
// La chiamata arriva dal database (tabella iscrizioni) con un'intestazione segreta.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  if (req.headers.get("x-segreto") !== Deno.env.get("WEBHOOK_SECRET")) return new Response("non autorizzato", { status: 401 });
  const { record: r } = await req.json();
  if (!r) return new Response("nessun dato", { status: 400 });

  const quando = new Date(r.creato || Date.now()).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
  const righe = Object.entries(r.dati || {}).map(([k, v]) =>
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

  const client = new SMTPClient({
    connection: { hostname: "mail.flazio.com", port: 465, tls: true,
      auth: { username: "info@sportandservicespadel.it", password: Deno.env.get("SMTP_PASS") ?? "" } },
  });
  try {
    await client.send({
      from: "Sport & Services Padel <info@sportandservicespadel.it>",
      to: "info@sportandservicespadel.it",
      replyTo: r.email || undefined,
      subject: `Nuovo modulo: ${titolo} – ${r.nome} ${r.cognome}`,
      content: `Nuovo modulo da ${r.nome} ${r.cognome} (${r.email || ""} ${r.telefono || ""}). Apri la mail in formato HTML per i dettagli.`,
      html,
    });
    await client.close();
    return new Response("ok");
  } catch (e) {
    try { await client.close(); } catch (_) { /* */ }
    console.error(e);
    return new Response("errore invio: " + (e as Error).message, { status: 500 });
  }
});
