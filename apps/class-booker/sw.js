const CACHE = 'class-booker-private-shell-20260925-focus';
const CORE = [
  './',
  './index.html',
  './app.mjs',
  './tickets.mjs',
  './wallet.mjs',
  './calendar-tickets.mjs',
  './ticket-cache.mjs',
  './delight.mjs',
  './styles.css',
  './manifest.json',
  './vendor/pdfjs/wasm/jbig2_nowasm_fallback.js',
  './vendor/pdfjs/wasm/openjpeg_nowasm_fallback.js',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
  './vendor/pdfjs/standard_fonts/FoxitDingbats.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixed.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerif.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb',
  './vendor/pdfjs/standard_fonts/FoxitSymbol.pfb',
  './vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf',
  './vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf',
  './vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf',
  './vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf',
  './vendor/pdfjs/wasm/jbig2.wasm',
  './vendor/pdfjs/wasm/openjpeg.wasm',
  './vendor/pdfjs/wasm/qcms_bg.wasm',
  './icon-any-192.png',
  './icon-any-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
];
const OPTIONAL = CORE.filter(url => /\/pdfjs\/(standard_fonts|wasm)\//.test(url));
const ESSENTIAL = CORE.filter(url => !OPTIONAL.includes(url));

// GitHub Pages sends max-age=600, so plain fetches can be answered from the browser's HTTP cache with the
// previous deploy for up to 10 minutes. Precache with 'reload' and revalidate every fetch ('no-cache' =
// a cheap ETag check) so a new deploy shows on the next open. index.html also loads app.mjs/styles.css with a
// ?v=<build> tag (bump it with CACHE), because Chrome's in-memory script cache can skip the service worker.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then(async cache => {
      await cache.addAll(ESSENTIAL.map(url => new Request(url, { cache: 'reload' })));
      // Optional PDF support cannot prevent the whole wallet from opening offline.
      await Promise.allSettled(OPTIONAL.map(async url => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(new Request(url, { cache: 'reload', signal: controller.signal }));
          if (response.ok) await cache.put(url, response);
        } finally { clearTimeout(timeout); }
      }));
    })
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
