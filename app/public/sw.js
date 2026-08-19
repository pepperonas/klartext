/**
 * Service Worker — Offline-Betrieb für Modus A.
 *
 * Die App rechnet ohnehin vollständig im Browser; ohne Netz fehlt nur noch das
 * Ausliefern der Dateien. Genau das macht dieser Worker.
 *
 * ⚠️ Die Shell läuft NETWORK-FIRST, nicht cache-first. Bei einer Krypto-App ist
 *    ein hängengebliebener alter Stand keine Unbequemlichkeit, sondern ein
 *    Sicherheitsproblem: eine ausgelieferte Korrektur muss ankommen. Der Cache
 *    ist der Rückfall für den Flugmodus, nicht die erste Wahl.
 *
 * Die Assets unter /assets/ tragen einen Inhalts-Hash im Namen und sind damit
 * unveränderlich — die dürfen cache-first laufen.
 *
 * ⚠️ Bei JEDER Änderung an der Shell die Version hochzählen. Ohne das räumt
 *    `activate` den alten Cache nicht ab und `caches.match` findet ihn weiter.
 */

const VERSION = 'klartext-v1';
const SCHALE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (ereignis) => {
  ereignis.waitUntil(
    caches.open(VERSION)
      // Einzeln, damit ein fehlendes Symbol nicht die ganze Installation kippt.
      .then((cache) => Promise.all(SCHALE.map((pfad) => cache.add(pfad).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (ereignis) => {
  ereignis.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ereignis) => {
  const anfrage = ereignis.request;
  if (anfrage.method !== 'GET') return;

  const url = new URL(anfrage.url);
  // Nur die eigene Herkunft. klartext spricht mit niemandem sonst — und der
  // Service Worker soll das auch nicht anfangen.
  if (url.origin !== self.location.origin) return;

  // Gehashte Dateien sind unveränderlich: zuerst aus dem Cache.
  if (url.pathname.startsWith('/assets/')) {
    ereignis.respondWith(
      caches.match(anfrage).then((treffer) => treffer ?? holenUndAblegen(anfrage)),
    );
    return;
  }

  // Alles andere network-first, Cache nur als Rückfall.
  ereignis.respondWith(
    holenUndAblegen(anfrage).catch(() =>
      caches.match(anfrage).then((treffer) => treffer ?? caches.match('/index.html')).then(
        (treffer) => treffer ?? new Response('Offline und nichts im Zwischenspeicher.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
      ),
    ),
  );
});

function holenUndAblegen(anfrage) {
  return fetch(anfrage).then((antwort) => {
    if (antwort.ok && antwort.type === 'basic') {
      const kopie = antwort.clone();
      void caches.open(VERSION).then((cache) => cache.put(anfrage, kopie));
    }
    return antwort;
  });
}
