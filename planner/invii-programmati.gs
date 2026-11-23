/**
 * Invii programmati (Promozioni e Richieste dell'app Planner).
 * Ogni 10 minuti, dalle 9 alle 22: se sono passati almeno 30 minuti dall'ultimo gruppo,
 * manda il messaggio alle prossime 3 persone (nell'ordine del database) dei comandi
 * con giorno e ora di invio arrivati. Alle 22 si ferma e riprende il giorno dopo alle 9.
 * Mail con Gmail (con la locandina allegata), SMS con IFTTT (Webhooks "invia_sms" → Android SMS),
 * WhatsApp nella "Coda WhatsApp" (colonna Allegato con il link della locandina).
 * Proprietà dello script: IFTTT_KEY (chiave Webhooks di IFTTT).
 * Primo avvio: eseguire una volta "attiva" e consentire i permessi.
 *
 * PROMOZIONI (foglio "Promozioni"): Destinatari =
 *   "Database Promozioni" → DATABASE PROMOZIONI
 *   "Database Richieste"  → DATABASE RICHIESTE
 *   "Tutti"               → entrambi (senza doppioni)
 *   Filtri Sport e Livello: vuoto = tutti; chi nel database ha "tutti" riceve sempre.
 *
 * RICHIESTE (foglio "Allenamenti"): sempre al DATABASE RICHIESTE, filtri Sport e Livello.
 *   Tipo: allenamento (giorno e ora) / corso1 / corso2 / lezioni / partite. Nessun link.
 *
 * Colonne DB: NOME(A) COGNOME(B) TELEFONO/WA(C) TELEGRAM(D) EMAIL(E)
 *             SPORT(F) LIVELLO(G) PROVENIENZA(H) INTERESSI(I) NOTE(J)
 */
const COMANDI_ID = '1z_BDwRZxgsJ74TkrINPsO0_qnoBT_U_eg4YOYBZ38XI';
const DB_PROMO   = 'DATABASE PROMOZIONI';
const DB_RICH    = 'DATABASE RICHIESTE';
const PER_GRUPPO = 3, PAUSA_MIN = 30, ORA_DA = 9, ORA_A = 22;
const FIRMA = '\n\nGianluca – Sport & Services';
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const TESTI_RICH = {
  allenamento: 'Ciao {nome}, fammi sapere se {giorno} alle {ora} puoi giocare.',
  corso1: 'Ciao {nome}, fammi sapere se in questa settimana hai preferenze particolari e se nel giorno dell\'allenamento vuoi restare dopo per match. Scrivimi anche giorni e fascia oraria in questa settimana in cui vorresti fare match.',
  corso2: 'Ciao {nome}, scrivimi quando puoi giocare questa settimana ed eventualmente se vuoi restare dopo per match.',
  lezioni: 'Ciao {nome}, scrivimi se questa settimana vuoi giocare ed in caso indicami anche fascia oraria in cui sei disponibile.',
  partite: 'Ciao {nome}, fammi sapere se questa settimana vuoi giocare, in caso affermativo scrivimi anche fascia oraria.'
};

function attiva() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'inviiProgrammati') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('inviiProgrammati').timeBased().everyMinutes(10).create();
  GmailApp.getAliases(); // permesso Gmail
  UrlFetchApp.getRequest('https://example.com'); // permesso per scaricare le locandine
  Logger.log('Invii programmati attivi: controllo ogni 10 minuti.');
}

function inviiProgrammati() {
  const ora = Number(Utilities.formatDate(new Date(), 'Europe/Rome', 'H'));
  if (ora < ORA_DA || ora >= ORA_A) return;
  const props = PropertiesService.getScriptProperties();
  if (Date.now() - Number(props.getProperty('ULTIMO_GRUPPO') || 0) < (PAUSA_MIN - 1) * 60000) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const ss = SpreadsheetApp.openById(COMANDI_ID);
    const adesso = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyyMMddHHmm');
    const avvisi = [];
    let posti = PER_GRUPPO;
    [['Promozioni', destPromo_], ['Allenamenti', destRich_]].forEach(function (x) {
      const sh = ss.getSheetByName(x[0]);
      const v = sh.getDataRange().getDisplayValues();
      const h = v[0];
      const c = function (n) { return h.indexOf(n); };
      for (let i = 1; i < v.length && posti > 0; i++) {
        const r = {}; h.forEach(function (n, j) { r[n] = v[i][j]; });
        const d = ymd_(r['Data invio']);
        if (!d || d + hm_(r['Ora invio']) > adesso || /fatto|errore/i.test(r['Stato'])) continue;
        let lista, file = null;
        try {
          lista = x[1](ss, r);
          if (r['Allegato']) file = allegato_(r['Allegato']);
        } catch (e) { scrivi_(sh, i, c, 'Errore', '', String(e.message || e)); avvisi.push(x[0] + ' riga ' + (i + 1) + ': ' + (e.message || e)); continue; }
        const can = String(r['Canali']).toLowerCase();
        let fatti = Number(String(r['Inviati'] || '').split('/')[0]) || 0;
        const err = [];
        while (fatti < lista.length && posti > 0) {
          const p = lista[fatti];
          if (can.indexOf('mail') >= 0 && p.mail) {
            try {
              const opz = { name: 'Sport & Services' };
              if (file) opz.attachments = [file];
              GmailApp.sendEmail(p.mail, p.oggetto, p.testo + FIRMA, opz);
            } catch (e) { err.push(p.nome + ' (mail)'); }
          }
          if (can.indexOf('sms') >= 0 && p.tel) { try { sms_(p.tel, p.testo); } catch (e) { err.push(p.nome + ' (SMS)'); } }
          if (can.indexOf('whatsapp') >= 0 && p.tel) codaWa_(ss, x[0] === 'Allenamenti' ? 'Richieste' : x[0], p, r['Allegato'] || '');
          fatti++; posti--;
        }
        const finito = fatti >= lista.length;
        const ora2 = Utilities.formatDate(new Date(), 'Europe/Rome', 'dd/MM HH:mm');
        const esito = (lista.length ? 'Ultimo gruppo ' + ora2 : 'Nessun destinatario trovato') + (err.length ? ' · non partiti: ' + err.join(', ') : '');
        scrivi_(sh, i, c, finito ? 'Fatto' : 'In corso', fatti + '/' + lista.length, esito);
        const nomeCmd = x[0] === 'Allenamenti' ? 'Richiesta' : 'Promozione';
        if (err.length) avvisi.push(nomeCmd + ' del ' + r['Data invio'] + ': non partiti ' + err.join(', '));
        if (!lista.length) avvisi.push(nomeCmd + ' del ' + r['Data invio'] + ': nessun destinatario trovato');
      }
    });
    if (posti < PER_GRUPPO) props.setProperty('ULTIMO_GRUPPO', String(Date.now()));
    if (avvisi.length) GmailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Invii programmati: da controllare', avvisi.join('\n'));
  } finally {
    lock.releaseLock();
  }
}

// Ritorna array di {nome, tel, mail, oggetto, testo} senza doppioni (stesso telefono o mail).
function destinatari_(righe, filtroSport, filtroLiv, testoDi, oggetto) {
  const out = [], visti = {};
  righe.forEach(function (g) {
    const nome = String(g[0] || '').trim();
    if (!nome) return;
    if (!okFiltro_(filtroSport, g[5]) || !okFiltro_(filtroLiv, g[6])) return;
    const tel = tel_(g[2]), mail = String(g[4] || '').trim();
    const key = tel || mail.toLowerCase();
    if (!key || visti[key]) return;
    visti[key] = true;
    out.push({ nome: primo_(nome), tel: tel, mail: mail, oggetto: oggetto, testo: testoDi(primo_(nome)) });
  });
  return out;
}

function destPromo_(ss, r) {
  const testo = String(r['Messaggio'] || '').trim();
  if (!testo) throw new Error('messaggio vuoto');
  const dest = String(r['Destinatari'] || '').trim().toLowerCase();
  let righe;
  if (dest === 'database promozioni') righe = dbRighe_(ss, DB_PROMO);
  else if (dest === 'database richieste') righe = dbRighe_(ss, DB_RICH);
  else if (dest === 'tutti') righe = dbRighe_(ss, DB_PROMO).concat(dbRighe_(ss, DB_RICH));
  else throw new Error('Destinatari non riconosciuto: ' + r['Destinatari']);
  return destinatari_(righe, norm_(r['Sport']), norm_(r['Livello']),
    function (nome) { return testo.replace(/\{nome\}/gi, nome); }, 'Sport & Services');
}

function destRich_(ss, r) {
  const tipo = String(r['Tipo'] || '').trim().toLowerCase();
  const base = TESTI_RICH[tipo];
  if (!base) throw new Error('Tipo di richiesta non riconosciuto: ' + r['Tipo']);
  if (tipo === 'allenamento' && (!r['Giorno'] || !r['Ora'])) throw new Error('per l\'allenamento servono giorno e ora');
  const frase = String(r['Frase in più'] || '').trim();
  const t = base.replace('{giorno}', giorno_(r['Giorno'])).replace('{ora}', String(r['Ora'] || '').trim()) + (frase ? ' ' + frase : '');
  return destinatari_(dbRighe_(ss, DB_RICH), norm_(r['Sport']), norm_(r['Livello']),
    function (nome) { return t.replace('{nome}', nome); }, 'Sport & Services');
}

function dbRighe_(ss, sheetName) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 10).getDisplayValues();
}

// filtro vuoto = tutti; chi nel database ha "tutti" (o vuoto) va bene per ogni filtro
function okFiltro_(filtro, val) {
  const v = String(val || '').trim().toLowerCase();
  return !filtro || !v || v === 'tutti' || v === filtro;
}

// Scarica la locandina dal link salvato dall'app (archivio "locandine" del sito).
function allegato_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('locandina non trovata');
  const nome = decodeURIComponent(String(url).split('/').pop()).replace(/^\d+_/, '');
  return res.getBlob().setName(nome);
}

function sms_(tel, testo) {
  const key = PropertiesService.getScriptProperties().getProperty('IFTTT_KEY');
  if (!key) throw new Error('manca IFTTT_KEY');
  const res = UrlFetchApp.fetch('https://maker.ifttt.com/trigger/invia_sms/with/key/' + key, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ value1: tel, value2: testo })
  });
  if (res.getResponseCode() !== 200) throw new Error('IFTTT ' + res.getResponseCode());
}

function codaWa_(ss, origine, p, allegato) {
  ss.getSheetByName('Coda WhatsApp').appendRow([Utilities.formatDate(new Date(), 'Europe/Rome', 'dd/MM/yyyy HH:mm'), origine, p.nome, p.tel, p.testo, 'Da inviare', '', allegato]);
}

function scrivi_(sh, i, c, stato, inviati, esito) {
  sh.getRange(i + 1, c('Stato') + 1).setValue(stato);
  if (inviati !== '') sh.getRange(i + 1, c('Inviati') + 1).setNumberFormat('@').setValue(inviati);
  sh.getRange(i + 1, c('Esito') + 1).setValue(esito);
}

function norm_(x) { const s = String(x || '').trim().toLowerCase(); return s === 'tutti' || s === 'tutte' ? '' : s; }
function primo_(nome) { return String(nome).trim().split(/\s+/)[0]; }
function giorno_(d) {
  const m = String(d || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return String(d || '');
  const dt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return GIORNI[dt.getDay()] + ' ' + ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2);
}
function tel_(t) {
  let s = String(t || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.indexOf('+') === 0) return s;
  if (s.indexOf('00') === 0) return '+' + s.slice(2);
  if (s.indexOf('39') === 0 && s.length >= 11) return '+' + s;
  return '+39' + s;
}
// ora di invio "9:00" / "09:00" / "09:00:00" → "0900"; vuota = subito
function hm_(t) {
  const m = String(t || '').match(/(\d{1,2})[:.](\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + m[2] : '0000';
}
function ymd_(d) {
  const m = String(d || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[3] + ('0' + m[2]).slice(-2) + ('0' + m[1]).slice(-2) : '';
}
