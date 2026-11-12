// Sblocco della scheda tecnica con codice via mail.
// azione "richiedi": cerca le schede che hanno lo stesso nome, cognome e data di nascita
//   del profilo di chi chiede e manda un codice di 6 cifre alla mail scritta NELLA SCHEDA.
// azione "verifica": se il codice è giusto, la scheda viene aperta a quell'account.
import nodemailer from "npm:nodemailer@6.9.16";

const URL = Deno.env.get("SUPABASE_URL")!, SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const mask = (m: string) => { const [a, d] = m.split("@"); return (a.slice(0, 2) + "*".repeat(Math.max(a.length - 2, 3))) + "@" + d; };
const rest = (p: string, o: RequestInit = {}) => fetch(`${URL}/rest/v1/${p}`, { ...o, headers: { ...H, ...(o.headers || {}) } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let b: { azione?: string; codice?: string } = {};
  try { b = await req.json(); } catch (_) { /* */ }

  // chi è l'utente (dal suo token)
  const ut = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: SK, Authorization: req.headers.get("Authorization") || "" } });
  if (!ut.ok) return out({ errore: "accesso" }, 401);
  const uid = (await ut.json()).id as string;

  if (b.azione === "richiedi") {
    const p = (await (await rest(`profili?id=eq.${uid}&select=nome,cognome,data_nascita`)).json())[0];
    if (!p || !p.nome || !p.cognome) return out({ errore: "manca_nome" });
    if (!p.data_nascita) return out({ errore: "manca_data" });
    // massimo una richiesta al minuto
    const prec = (await (await rest(`schede_codici?user_id=eq.${uid}&select=creato`)).json())[0];
    if (prec && Date.now() - new Date(prec.creato).getTime() < 60000) return out({ errore: "attendi" });

    const [y, m, g] = String(p.data_nascita).split("-");
    const nascita = `${g}/${m}/${y}`;
    const a = norm(`${p.nome} ${p.cognome}`), c = norm(`${p.cognome} ${p.nome}`);
    const tutte = await (await rest("schede?select=id,nome,email,dati")).json();
    const trovate = (tutte as { id: string; nome: string; email: string; dati: { anagrafica?: Record<string, string> } }[])
      .filter((s) => (norm(s.nome) === a || norm(s.nome) === c) && String(s.dati?.anagrafica?.["Data di nascita"] || "").trim() === nascita);
    if (!trovate.length) return out({ trovata: false });
    const mail = [...new Set(trovate.map((s) => String(s.email || s.dati?.anagrafica?.["Email"] || "").trim().toLowerCase()).filter(Boolean))];
    if (!mail.length) return out({ errore: "senza_mail" });

    const codice = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    const row = { user_id: uid, hash: await sha(codice + uid), scheda_ids: trovate.map((s) => s.id), scade: new Date(Date.now() + 15 * 60000).toISOString(), tentativi: 0, creato: new Date().toISOString() };
    await rest("schede_codici?on_conflict=user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(row) });

    const tx = nodemailer.createTransport({ host: "mail.flazio.com", port: 465, secure: true, auth: { user: "info@sportandservicespadel.it", pass: Deno.env.get("SMTP_PASS") ?? "" } });
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;background:#F3F5F8;padding:20px"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">
<div style="background:#0B2545;color:#fff;padding:16px 22px;font-weight:bold;letter-spacing:1px">SPORT &amp; SERVICES PADEL</div>
<div style="padding:22px;color:#0B2545;font-size:16px;line-height:1.5"><p style="margin:0 0 10px">Il tuo codice per aprire la scheda tecnica:</p>
<p style="font-size:34px;letter-spacing:8px;font-weight:bold;margin:8px 0 14px">${codice}</p>
<p style="margin:0;font-size:14px;color:#5A6B80">Vale 15 minuti. Scrivilo nella pagina del sito dove hai chiesto la scheda. Se non l'hai chiesto tu, ignora questa mail.</p></div></div></div>`;
    try {
      await tx.sendMail({ from: '"Sport & Services Padel" <info@sportandservicespadel.it>', to: mail.join(", "), subject: "Il tuo codice per la scheda tecnica", text: `Il tuo codice per aprire la scheda tecnica: ${codice}\nVale 15 minuti. Se non l'hai chiesto tu, ignora questa mail.`, html });
    } catch (e) { console.error(e); return out({ errore: "invio" }, 500); }
    return out({ trovata: true, mail: mail.map(mask) });
  }

  if (b.azione === "verifica") {
    const r = (await (await rest(`schede_codici?user_id=eq.${uid}&select=*`)).json())[0];
    if (!r || new Date(r.scade).getTime() < Date.now()) return out({ ok: false, errore: "scaduto" });
    if (r.tentativi >= 5) return out({ ok: false, errore: "troppi" });
    if (r.hash !== await sha(String(b.codice || "").trim() + uid)) {
      await rest(`schede_codici?user_id=eq.${uid}`, { method: "PATCH", body: JSON.stringify({ tentativi: r.tentativi + 1 }) });
      return out({ ok: false, errore: "errato" });
    }
    await rest("schede_accessi?on_conflict=user_id,scheda_id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify(r.scheda_ids.map((id: string) => ({ user_id: uid, scheda_id: id }))) });
    await rest(`schede_codici?user_id=eq.${uid}`, { method: "DELETE" });
    return out({ ok: true });
  }
  return out({ errore: "richiesta" }, 400);
});
