/**
 * Richieste dal sito (moduli Attività) → Planner.
 * Ogni 10 minuti legge le mail "Richiesta …" inviate da info@sportandservicespadel.it,
 * le scrive nel foglio "RICHIESTE SITO" e, se il giorno è già nel planner,
 * le inserisce nel "PLANNER ATTIVITA'" con la nota "RICHIESTA SITO – da confermare".
 * Per attivarlo: eseguire una volta la funzione "installa" e consentire l'accesso.
 */
const PLANNER = "PLANNER ATTIVITA'";
const REGISTRO = 'RICHIESTE SITO';
const ETICHETTA = 'Planner-inserita';
const COLORE = { Tennis: '#F6B26B', Padel: '#FFE599' }; // arancione tennis, giallo padel

function installa() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'leggiRichieste') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('leggiRichieste').timeBased().everyMinutes(10).create();
  leggiRichieste();
}

function leggiRichieste() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    const ss = SpreadsheetApp.openById('1bPhAiRhNm2f2ggXXfdMze2GtkSlMy__5vRJ-exjXS9I');
    const reg = registro_(ss);
    const giaViste = {};
    reg.getRange(2, 11, Math.max(reg.getLastRow() - 1, 1), 1).getValues().forEach(function (r) { if (r[0]) giaViste[r[0]] = true; });
    const lab = GmailApp.getUserLabelByName(ETICHETTA) || GmailApp.createLabel(ETICHETTA);
    const threads = GmailApp.search('from:info@sportandservicespadel.it subject:Richiesta -label:' + ETICHETTA + ' newer_than:30d', 0, 50);
    threads.forEach(function (th) {
      let fatto = true;
      th.getMessages().forEach(function (m) {
        const riga = (m.getPlainBody().match(/PLANNER\|[^\r\n]+/) || [])[0];
        if (!riga) return;
        const p = riga.split('|'); // PLANNER|giorno|ora|sport|richiesta|nome|tel|superficie|id
        const r = { giorno: p[1], ora: p[2], sport: p[3], tipo: p[4], nome: p[5], tel: p[6], sup: p[7], id: p[8], ricevuta: m.getDate() };
        if (/^PROVA /.test(r.nome)) return; // mail di prova del sito
        const esito = nelPlanner_(ss, r);
        if (!giaViste[r.id]) {
          reg.appendRow([r.ricevuta, dataIt_(r.giorno), r.ora, r.sport, r.tipo, r.nome, r.tel, r.sup, 'Da confermare (WhatsApp/SMS)', esito.testo, r.id]);
          reg.getRange(reg.getLastRow(), 1, 1, 11).setBackground(COLORE[r.sport] || null);
          giaViste[r.id] = true;
        } else if (esito.ok) {
          aggiornaEsito_(reg, r.id, esito.testo);
        }
        if (!esito.finito) fatto = false;
      });
      if (fatto) th.addLabel(lab);
    });
  } finally {
    lock.releaseLock();
  }
}

// Inserisce la richiesta nel blocco del giorno. Restituisce {ok, finito, testo}.
function nelPlanner_(ss, r) {
  const sh = ss.getSheetByName(PLANNER);
  const oggi = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd');
  if (r.giorno < oggi) return { ok: false, finito: true, testo: 'Giorno passato: non inserita' };
  const g = r.giorno.split('-'), dmy = g[2] + '/' + g[1] + '/' + g[0];
  const v = sh.getRange(1, 1, sh.getLastRow(), 8).getDisplayValues();
  let inizio = -1;
  for (let i = 0; i < v.length; i++) if (v[i][1].indexOf(dmy) >= 0) { inizio = i; break; }
  if (inizio < 0) return { ok: false, finito: false, testo: 'In attesa: il giorno non è ancora nel planner' };
  let fine = v.length;
  for (let i = inizio + 1; i < v.length; i++) if (v[i][0].trim() || /\d{2}\/\d{2}\/\d{4}/.test(v[i][1])) { fine = i; break; }
  for (let i = inizio + 1; i < fine; i++) if (v[i].join('|').indexOf(r.id.slice(0, 8)) >= 0) return { ok: true, finito: true, testo: 'Nel planner' };
  const ora = (r.ora.split(/[–-]/)[0] || '').trim();
  const etic = 'Ore ' + ora;
  let riga = -1;
  for (let i = inizio + 1; i < fine; i++) {
    if (v[i][1].trim() === etic && !v[i].slice(2, 7).join('').trim()) { riga = i + 1; break; }
  }
  if (riga < 0) {
    let dopo = inizio + 1;
    for (let i = inizio + 1; i < fine; i++) { const t = (v[i][1].match(/(\d{1,2}:\d{2})/) || [])[1]; if (t && pad_(t) <= pad_(ora)) dopo = i + 1; }
    sh.insertRowAfter(dopo);
    riga = dopo + 1;
    sh.getRange(riga, 2).setValue(etic);
  }
  sh.getRange(riga, 3).setValue(r.nome);
  sh.getRange(riga, 8).setValue('RICHIESTA SITO – da confermare · ' + r.sport + ' · ' + r.tipo + ' · ' + r.ora + ' · ' + r.sup + ' · ' + r.tel + ' · rif ' + r.id.slice(0, 8));
  sh.getRange(riga, 3, 1, 6).setBackground(COLORE[r.sport] || null);
  return { ok: true, finito: true, testo: 'Nel planner' };
}

function registro_(ss) {
  let sh = ss.getSheetByName(REGISTRO);
  if (!sh) {
    sh = ss.insertSheet(REGISTRO);
    sh.appendRow(['Ricevuta', 'Giorno', 'Orario', 'Sport', 'Richiesta', 'Nome', 'Cellulare', 'Superficie', 'Stato', 'Planner', 'ID']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 11).setFontWeight('bold').setBackground('#0B2545').setFontColor('#FFFFFF');
  }
  return sh;
}
function aggiornaEsito_(reg, id, testo) {
  const ids = reg.getRange(2, 11, Math.max(reg.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === id) { reg.getRange(i + 2, 10).setValue(testo); return; }
}
function dataIt_(s) { const g = s.split('-'); return g[2] + '/' + g[1] + '/' + g[0]; }
function pad_(t) { const x = t.split(':'); return ('0' + x[0]).slice(-2) + ':' + x[1]; }
