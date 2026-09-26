import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./sw.js', import.meta.url), 'utf8');
async function install(failEssential = false) {
  const handlers = {}, saved = [], essential = []; let activated = false;
  const cache = {
    async addAll(requests) {
      essential.push(...requests.map(r => r.url));
      if (failEssential) throw new Error('Missing app module');
    },
    async put(url) { saved.push(url); },
  };
  vm.runInNewContext(source, {
    self: { addEventListener: (name, callback) => { handlers[name] = callback; }, skipWaiting: () => { activated = true; } },
    caches: { open: async () => cache }, Request: class { constructor(url) { this.url = url; } },
    fetch: async request => { if (request.url.endsWith('FoxitDingbats.pfb')) throw new Error('Font unavailable'); return { ok: true }; },
    AbortController, setTimeout, clearTimeout,
  });
  let pending; handlers.install({ waitUntil: p => { pending = p; } });
  try { await pending; } catch (error) { return { error, activated }; }
  return { activated, essential, saved };
}

test('one unavailable optional PDF font does not strand the offline shell', async () => {
  const result = await install();
  assert.equal(result.activated, true);
  assert.ok(result.essential.includes('./app.mjs'));
  assert.ok(result.essential.includes('./vendor/pdfjs/pdf.min.mjs'));
  assert.ok(!result.essential.some(url => url.endsWith('FoxitDingbats.pfb')));
  assert.ok(result.saved.some(url => url.endsWith('LiberationSans-Regular.ttf')));
});

test('a missing essential module still refuses an incomplete shell installation', async () => {
  const result = await install(true);
  assert.equal(result.activated, false);
  assert.match(result.error.message, /Missing app module/);
});
