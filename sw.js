/* TEF Trainer service worker — NETWORK-FIRST for everything.
   Audio (assets/co, assets/tts) is never precached and never runtime-cached here;
   the app fetches listening audio as Blobs itself. */
const CACHE = 'tef-trainer-v19';
const SHELL = ['./', 'index.html', 'styles.css?v=19', 'app.js?v=19', 'manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isAudio = url.pathname.includes('/assets/co/') || url.pathname.includes('/assets/tts/');
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (!isAudio && res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
