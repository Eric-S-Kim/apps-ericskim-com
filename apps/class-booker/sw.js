const CACHE = 'class-booker-private-shell-20260924-email-layout';
const CORE = [
  './',
  './index.html',
  './app.mjs',
  './tickets.mjs',
  './delight.mjs',
  './styles.css',
  './manifest.json',
  './icon-any-192.png',
  './icon-any-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
];

// GitHub Pages sends max-age=600, so plain fetches can be answered from the browser's HTTP cache with the
// previous deploy for up to 10 minutes. Precache with 'reload' and revalidate every fetch ('no-cache' =
// a cheap ETag check) so a new deploy shows on the next open. index.html also loads app.mjs/styles.css with a
// ?v=<build> tag (bump it with CACHE), because Chrome's in-memory script cache can skip the service worker.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(CORE.map((url) => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    // A navigate-mode Request can't be re-issued with options, so revalidate via a fresh same-URL request.
    fetch(new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' }))
      .then((response) => {
        if (response.ok) {
          caches.open(CACHE).then((cache) => cache.put(request, response.clone())).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached
        || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
