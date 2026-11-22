/**
 * Invii programmati (Promozioni e Allenamenti dell'app Planner).
 * Ogni 10 minuti, dalle 8 alle 21: se sono passati almeno 20 minuti dall'ultimo gruppo,
 * manda il messaggio alle prossime 5 persone dei comandi con data di invio arrivata.
 * Mail con Gmail, SMS con IFTTT (Webhooks "invia_sms" → Android SMS), WhatsApp nella "Coda WhatsApp".
 * Proprietà dello script: IFTTT_KEY (chiave Webhooks di IFTTT).
 * Primo avvio: eseguire una volta "attiva" e consentire i permessi.
 *
 * Destinatari (campo "Destinatari" nella riga Promozioni):
 *   "Allievi"               → DATABASE RICHIESTE nel foglio Planner – Comandi
 *   "Giocatori allenamento" → DATABASE PROMOZIONI nel foglio Planner – Comandi
 *   "Tutti"                 → entrambi i database
 * Filtro INTERESSI: letto dalla colonna "Interessi" nella riga Promozioni;
 *   se vuoto o "tutto" non filtra; altrimenti esclude chi ha un interesse diverso.
 * Colonne DB: NOME(A) COGNOME(B) TELEFONO/WA(C) TELEGRAM(D) EMAIL(E)
 *             SPORT(F) LIVELLO(G) PROVENIENZA(H) INTERESSI(I) NOTE(J)
 */
const COMANDI_ID = '1z_BDwRZxgsJ74TkrINPsO0_qnoBT_U_eg4YOYBZ38XI';
const DB_PROMO   = 'DATABASE PROMOZIONI';
const DB_RICH    = 'DATABASE RICHIESTE';
const PER_GRUPPO = 5, PAUSA_MIN = 20, ORA_DA = 8, ORA_A = 21;
const FIRMA = '\n\nGianluca – Sport & Services';

function attiva() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'inviiProgrammati') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('inviiProgrammati').timeBased().everyMinutes(10).create();
  GmailApp.getAliases(); // permesso Gmail
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
    const oggi = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyyMMdd');
    const avvisi = [];
    let posti = PER_GRUPPO;
    [['Promozioni', destPromo_], ['Allenamenti', destAllen_]].forEach(function (x) {
      const sh = ss.getSheetByName(x[0]);
      const v = sh.getDataRange().getDisplayValues();
      const h = v[0];
      const c = function (n) { return h.indexOf(n); };
      for (let i = 1; i < v.length && posti > 0; i++) {
        const r = {}; h.forEach(function (n, j) { r[n] = v[i][j]; });
        const d = ymd_(r['Data invio']);
        if (!d || d > oggi || /fatto|errore/i.test(r['Stato'])) continue;
        let lista;
        try { lista = x[1](ss, r); } catch (e) { scrivi_(sh, i, c, 'Errore', '', String(e.message || e)); avvisi.push(x[0] + ' riga ' + (i + 1) + ': ' + (e.message || e)); continue; }
        const can = String(r['Canali']).toLowerCase();
        let fatti = Number(String(r['Inviati'] || '').split('/')[0]) || 0;
        const err = [];
        while (fatti < lista.length && posti > 0) {
          const p = lista[fatti];
          if (can.indexOf('mail') >= 0 && p.mail) { try { GmailApp.sendEmail(p.mail, p.oggetto, p.testo + FIRMA, { name: 'Sport & Services' }); } catch (e) { err.push(p.nome + ' (mail)'); } }
          if (can.indexOf('sms') >= 0 && p.tel) { try { sms_(p.tel, p.testo); } catch (e) { err.push(p.nome + ' (SMS)'); } }
          if (can.indexOf('whatsapp') >= 0 && p.tel) codaWa_(ss, x[0], p);
          fatti++; posti--;
        }
        const finito = fatti >= lista.length;
        const ora2 = Utilities.formatDate(new Date(), 'Europe/Rome', 'dd/MM HH:mm');
        const esito = (lista.length ? 'Ultimo gruppo ' + ora2 : 'Nessun destinatario trovato') + (err.length ? ' · non partiti: ' + err.join(', ') : '');
        scrivi_(sh, i, c, finito ? 'Fatto' : 'In corso', fatti + '/' + lista.length, esito);
        if (err.length) avvisi.push(x[0] + ' del ' + r['Data invio'] + ': non partiti ' + err.join(', '));
        if (!lista.length) avvisi.push(x[0] + ' del ' + r['Data invio'] + ': nessun destinatario trovato');
      }
    });
    if (posti < PER_GRUPPO) props.setProperty('ULTIMO_GRUPPO', String(Date.now()));
    if (avvisi.length) GmailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Invii programmati: da controllare', avvisi.join('\n'));
  } finally {
    lock.releaseLock();
  }
}

// Legge righe dai database in base al campo Destinatari.
// Ritorna array di {nome, tel, mail, oggetto, testo}.
function destPromo_(ss, r) {
  const testo = String(r['Messaggio'] || '').trim();
  if (!testo) throw new Error('messaggio vuoto');
  const filtroSport    = norm_(r['Sport / Club']);
  const filtroLiv      = norm_(r['Livello']);
  const filtroInteressi = norm_(r['Interessi'] || '');
  const dest = String(r['Destinatari'] || '').trim().toLowerCase();
  const usaRich  = dest === 'allievi' || dest === 'tutti';
  const usaPromo = dest === 'giocatori allenamento' || dest === 'tutti';
  const out = [];
  const visti = {}; // evita duplicati se stesso contatto è in entrambi i DB
  function aggiungi(nome, tel, mail) {
    const key = tel || mail;
    if (!key || visti[key]) return;
    visti[key] = true;
    out.push({ nome: primo_(nome), tel: tel_(tel), mail: String(mail || '').trim(), oggetto: 'Sport & Services', testo: personal_(testo, nome) });
  }
  if (usaRich) {
    const righe = dbRighe_(ss, DB_RICH);
    righe.forEach(function (g) {
      // col: 0=NOME 1=COGNOME 2=TEL 3=TEL 4=EMAIL 5=SPORT 6=LIVELLO 7=PROV 8=INTERESSI
      const nomeCompleto = (g[0] + ' ' + g[1]).trim();
      if (!nomeCompleto) return;
      if (!okFiltro_(filtroSport, g[5])) return;
      if (!okFiltro_(filtroLiv, g[6])) return;
      if (!okInteressi_(filtroInteressi, g[8])) return;
      aggiungi(nomeCompleto, g[2], g[4]);
    });
  }
  if (usaPromo) {
    const righe = dbRighe_(ss, DB_PROMO);
    righe.forEach(function (g) {
      const nomeCompleto = (g[0] + ' ' + g[1]).trim();
      if (!nomeCompleto) return;
      if (!okFiltro_(filtroSport, g[5])) return;
      if (!okFiltro_(filtroLiv, g[6])) return;
      if (!okInteressi_(filtroInteressi, g[8])) return;
      aggiungi(nomeCompleto, g[2], g[4]);
    });
  }
  if (!usaRich && !usaPromo) throw new Error('Destinatari non riconosciuto: ' + r['Destinatari']);
  return out;
}

function destAllen_(ss, r) {
  const club = norm_(r['Club']), liv = norm_(r['Livello']);
  const out = [];
  dbRighe_(ss, DB_PROMO).forEach(function (g) {
    const nomeCompleto = (g[0] + ' ' + g[1]).trim();
    if (!nomeCompleto) return;
    if (!okFiltro_(club, g[7])) return; // filtra per PROVENIENZA=club
    if (!okFiltro_(liv, g[6])) return;
    const t = 'Ciao ' + primo_(nomeCompleto) + ', sto organizzando un allenamento ' + r['Data allenamento'] + (r['Ora'] ? ' alle ' + r['Ora'] : '') +
              (r['Club'] ? ' al ' + r['Club'] : '') + '.' + (r['Indicazioni'] ? ' ' + r['Indicazioni'] : '') + ' Ci sei? Rispondimi qui.';
    out.push({ nome: primo_(nomeCompleto), tel: tel_(g[2]), mail: '', oggetto: 'Allenamento ' + r['Data allenamento'], testo: t });
  });
  return out;
}

function dbRighe_(ss, sheetName) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 10).getDisplayValues();
}

function okFiltro_(filtro, val) { return !filtro || String(val || '').trim().toLowerCase() === filtro; }
function okInteressi_(filtro, val) {
  if (!filtro || filtro === 'tutto') return true;
  const v = String(val || '').trim().toLowerCase();
  return !v || v === 'tutto' || v === filtro;
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

function codaWa_(ss, origine, p) {
  ss.getSheetByName('Coda WhatsApp').appendRow([Utilities.formatDate(new Date(), 'Europe/Rome', 'dd/MM/yyyy HH:mm'), origine, p.nome, p.tel, p.testo, 'Da inviare', '']);
}

function scrivi_(sh, i, c, stato, inviati, esito) {
  sh.getRange(i + 1, c('Stato') + 1).setValue(stato);
  if (inviati !== '') sh.getRange(i + 1, c('Inviati') + 1).setNumberFormat('@').setValue(inviati);
  sh.getRange(i + 1, c('Esito') + 1).setValue(esito);
}

function norm_(x) { const s = String(x || '').trim().toLowerCase(); return s === 'tutti' || s === 'tutte' ? '' : s; }
function primo_(nome) { return String(nome).trim().split(/\s+/)[0]; }
function personal_(testo, nome) { return testo.replace(/\{nome\}/gi, primo_(nome)); }
function tel_(t) {
  let s = String(t || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.indexOf('+') === 0) return s;
  if (s.indexOf('00') === 0) return '+' + s.slice(2);
  if (s.indexOf('39') === 0 && s.length >= 11) return '+' + s;
  return '+39' + s;
}
function ymd_(d) {
  const m = String(d || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[3] + ('0' + m[2]).slice(-2) + ('0' + m[1]).slice(-2) : '';
}
