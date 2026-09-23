// Network-first service worker: ALWAYS serve fresh code/data when online, so logic
// updates are never stale; fall back to cache only when offline. (A cache-first SW
// previously served a stale adapters.mjs and hid the reorder buttons.)
const CACHE = 'pantry-shelf-v13'; // build tag: bump with the ?v= in index.html + app.mjs (a test checks they agree)
const CORE = ['./', './index.html', './styles.css', './app.mjs', './adapters.mjs', './manifest.webmanifest', './icon.svg', './icon-any-192.png', './icon-any-512.png', './icon-maskable-192.png', './icon-maskable-512.png', './fonts/jost-latin.woff2'];

// GitHub Pages sends max-age=600, so a plain fetch can be answered from the browser's HTTP cache with the
// previous deploy for up to 10 minutes. Precache with 'reload' and revalidate our own files ('no-cache' =
// a cheap ETag check) so a new deploy shows on the next open (ported from Class Booker, apps-ericskim-com fef559d).
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(CORE.map((url) => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const own = new URL(request.url).origin === self.location.origin;
  // Our own files: revalidate (a navigate-mode Request can't be re-issued with options, so re-fetch by URL).
  // Other sites (product photos, the private shelf source) go out unchanged: re-issuing a no-cors image
  // request in cors mode would break it.
  const network = own ? fetch(new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' })) : fetch(request);
  e.respondWith(
    network
      .then((res) => {
        // Keep our own files and product photos for offline. Not the private shelf source: each sync has a
        // unique cache-busting URL (the cache only grew), and the app already keeps the shelf on the device.
        if (res.ok || res.type === 'opaque') {
          if (own || request.destination === 'image') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: own }).then((cached) => cached
        || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
