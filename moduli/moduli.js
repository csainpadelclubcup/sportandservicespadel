/* Moduli online A.S.D. Sport & Services: copia dei dati tra le pagine, Stampa, Scarica PDF, Invia */
(function () {
  var SB = 'https://hbmmlnyfiesmmbmxkmcp.supabase.co';
  var KEY = 'sb_publishable_TYJtDyl4jTCrVNPYCJ-B4w_00i41uID';
  var FIELDS = 'input:not([type=hidden]):not([type=button]), textarea, select';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function toast(t, ms) { var x = $('#toast'); if (!x) return; x.textContent = t; x.classList.add('show'); clearTimeout(x._t); x._t = setTimeout(function () { x.classList.remove('show'); }, ms || 3200); }
  window.toast = toast;

  // i campi con lo stesso data-k si compilano insieme in tutte le pagine
  document.addEventListener('input', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-k');
    if (!k) return;
    $$('[data-k="' + k + '"]').forEach(function (el) { if (el !== e.target && el.type !== 'radio' && el.type !== 'checkbox') el.value = e.target.value; });
  });

  // adatta i fogli A4 alla larghezza dello schermo
  function fit() {
    var vw = Math.min(window.innerWidth, document.documentElement.clientWidth);
    var w = Math.min(vw - 16, 794);
    var z = w / 794;
    // su smartphone (≤760px) il foglio si adatta da solo con il CSS; lo zoom serve solo per tablet e schermi medi
    $$('.page').forEach(function (p) { p.style.zoom = (vw > 760 && z < 1) ? z : ''; });
  }
  window.addEventListener('resize', fit);
  document.addEventListener('DOMContentLoaded', fit);

  function visibili() { return $$('.page').filter(function (p) { return !p.hidden; }); }

  // --- PDF
  function clonaCampi(doc) {
    var orig = $$('.page input, .page textarea, .page select');
    var copy = Array.prototype.slice.call(doc.querySelectorAll('.page input, .page textarea, .page select'));
    copy.forEach(function (c, i) {
      var o = orig[i]; if (!o) return;
      if (o.type === 'radio' || o.type === 'checkbox') { c.checked = o.checked; return; }
      var cs = getComputedStyle(o), d = doc.createElement('div');
      ['font-family', 'font-size', 'font-weight', 'color', 'text-transform', 'padding-top', 'padding-left', 'padding-right', 'border-bottom', 'border-top', 'border-left', 'border-right', 'border-radius', 'text-align'].forEach(function (p) { d.style.setProperty(p, cs.getPropertyValue(p)); });
      d.style.boxSizing = 'border-box'; d.style.width = o.offsetWidth + 'px'; d.style.height = o.offsetHeight + 'px'; d.style.overflow = 'hidden';
      d.style.whiteSpace = o.tagName === 'TEXTAREA' ? 'pre-wrap' : 'nowrap';
      d.style.lineHeight = o.tagName === 'TEXTAREA' ? cs.lineHeight : (o.offsetHeight - 6) + 'px';
      var v = o.tagName === 'SELECT' ? (o.value ? o.options[o.selectedIndex].text : '') : o.value;
      d.textContent = v || ''; c.parentNode.replaceChild(d, c);
    });
  }
  window.scaricaPDF = async function () {
    var L = $('#loader'); if (L) L.style.display = 'flex';
    document.body.classList.add('capturing');
    var zs = $$('.page').map(function (p) { var z = p.style.zoom; p.style.zoom = ''; return z; });
    try {
      var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      var pg = visibili();
      for (var i = 0; i < pg.length; i++) {
        var c = await html2canvas(pg[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff', onclone: clonaCampi });
        if (i) pdf.addPage();
        pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
      }
      pdf.save((document.body.dataset.file || 'Modulo_Sport_and_Services') + '.pdf');
    } catch (e) { console.error(e); alert('Non è stato possibile creare il PDF: usa il pulsante Stampa e scegli "Salva come PDF".'); }
    $$('.page').forEach(function (p, i) { p.style.zoom = zs[i]; });
    document.body.classList.remove('capturing');
    if (L) L.style.display = 'none';
  };

  // --- raccolta dati
  function etichetta(el) {
    var f = el.closest('.f'); var l = f && $('.lbl', f);
    if (l && l.innerText.trim()) return l.innerText.trim();
    var lab = el.closest('label'); if (lab) return lab.innerText.trim();
    return el.name || el.getAttribute('data-k') || el.placeholder || 'campo';
  }
  function raccogli() {
    var out = [], visti = {};
    function add(k, v) { if (visti[k]) return; visti[k] = 1; out.push({ c: k, v: v }); }
    visibili().forEach(function (p) {
      var sez = p.getAttribute('data-nome') || 'Modulo';
      $$(FIELDS, p).forEach(function (el) {
        if (el.closest('[data-noinvio]')) return;
        if (el.type === 'radio') { if (el.checked) { var g = el.closest('.f'); var n = (g && $('.lbl', g) && $('.lbl', g).innerText.trim()) || el.name; add(sez + ' · ' + n, el.value); } return; }
        if (el.type === 'checkbox') { add(sez + ' · ' + (el.classList.contains('consenso') ? 'Consenso privacy' : etichetta(el)), el.checked ? 'sì' : 'no'); return; }
        var v = el.tagName === 'SELECT' ? (el.value ? el.options[el.selectedIndex].text : '') : el.value.trim();
        if (v) add(sez + ' · ' + etichetta(el), v);
      });
    });
    return out;
  }
  function val(k) { var el = $('[data-k="' + k + '"]'); return el ? el.value.trim() : ''; }

  window.inviaModulo = async function (btn) {
    var nome = val('nome'), cognome = val('cognome'), email = val('email'), tel = val('telefono');
    if (!nome || !cognome) { toast('Compila almeno nome e cognome.'); return; }
    if (!email && !tel) { toast('Inserisci un’email o un telefono per essere ricontattato.'); return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Controlla l’indirizzo email.'); return; }
    var cons = $$('.consenso').filter(function (c) { return c.offsetParent !== null; });
    if (cons.length && !cons.some(function (c) { return c.checked; })) { toast('Per inviare devi accettare l’informativa privacy.'); cons[0].scrollIntoView({ block: 'center' }); return; }
    if (btn) btn.disabled = true;
    var body = {
      tipo: document.body.dataset.modulo || 'Modulo',
      ente: (document.querySelector('input[name=ente]:checked') || {}).value || document.body.dataset.ente || null,
      nome: nome, cognome: cognome, email: email || null, telefono: tel || null,
      dati: raccogli()
    };
    try {
      var r = await fetch(SB + '/rest/v1/iscrizioni', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(r.status);
      toast('Modulo inviato, grazie! Ora stampalo, firmalo e invialo a info@sportandservicespadel.it', 6000);
    } catch (e) { toast('Invio non riuscito: controlla la connessione e riprova.'); }
    if (btn) btn.disabled = false;
  };
})();
