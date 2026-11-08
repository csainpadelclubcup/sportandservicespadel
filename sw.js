/* App Sport & Services: il sito installabile sul telefono.
   Pagine sempre prese dalla rete (così si vede sempre l'ultima versione);
   la copia salvata serve solo quando manca la connessione. */
const CACHE = 'ss-app-v1';
const OFFLINE = ['/Main.dc.html', '/App.html', '/app/icona-192.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(OFFLINE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return; // Supabase e servizi esterni: non toccati
  e.respondWith(
    fetch(r).then(res => {
      if (res.ok && (r.mode === 'navigate' || /\.(css|js)$/.test(new URL(r.url).pathname))) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(r, copia)); }
      return res;
    }).catch(() => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match('/Main.dc.html') : Response.error())))
  );
});
