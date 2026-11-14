/* TEF Trainer service worker — NETWORK-FIRST for everything.
   Audio (assets/co, assets/tts) is never precached and never runtime-cached here;
   the app fetches listening audio as Blobs itself. */
const CACHE = 'tef-trainer-v41';
const SHELL = ['./', 'index.html', 'styles.css?v=30', 'app.js?v=30', 'manifest.webmanifest'];

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
  // Handle only our own origin. Cross-origin requests (translation popups,
  // external media, extension-injected audio) go straight to the network —
  // re-issuing them here, or answering a failed one with index.html, breaks
  // their playback silently (an audio element handed an HTML document just
  // stays mute).
  if (url.origin !== self.location.origin) return;
  const isAudio = url.pathname.includes('/assets/co/') || url.pathname.includes('/assets/tts/');
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (!isAudio && res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => {
        if (hit) return hit;
        // The HTML shell fallback is for page navigations only — never
        // answer an audio or data request with a document.
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      }))
  );
});
