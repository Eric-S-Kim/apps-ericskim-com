// Minimal offline shell: cache core files so the shelf opens without network.
// shelf.json is fetched no-store in app.mjs so snapshots stay fresh when online.
const CACHE = 'pantry-shelf-v2';
const CORE = ['./', './index.html', './styles.css', './app.mjs', './adapters.mjs', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  // Network-first for shelf data, cache-first for the app shell.
  if (request.url.endsWith('shelf.json')) {
    e.respondWith(fetch(request).catch(() => caches.match(request)));
  } else {
    e.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});
