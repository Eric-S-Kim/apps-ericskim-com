PDF.js 6.3.289, from the official `pdfjs-dist` npm distribution.

The minified renderer, worker, standard fonts and image decoders are copied without modification. PDF scripting is not enabled. `manifest.json` pins every copied file by SHA-256; the service worker caches runtime assets for offline viewing. License files are retained beside the relevant assets.

Upstream: https://github.com/mozilla/pdf.js
API: https://mozilla.github.io/pdf.js/examples/
Package integrity: `sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==`
