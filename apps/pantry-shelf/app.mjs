// Living Pantry Shelf — PWA "cockpit". Renders the shelf from shelf.json and wires
// the honest confidence card + the hand-off-to-Claude buttons. All real logic lives
// in adapters.mjs (shared with the tests); this file is just rendering + events.

import { buildConfidenceCard, pickVendor, buildVerifyPrompt } from './adapters.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Only ever emit https hrefs — neutralizes javascript:/data: even if shelf.json is tampered with.
const safeHref = (u) => (typeof u === 'string' && /^https:\/\//i.test(u)) ? u : null;

function huntPrompt(item) {
  const not = (item.variant.mustNotMatch || []).join(' / ');
  return `"${item.name}" (${item.variant.label}${not ? `, must NOT be ${not}` : ''}) looks sold out at my saved vendors. ` +
    `Run the reputable-source hunt across stores that ship to Vancouver, Canada, and report the cheapest in-stock AUTHORIZED option. ` +
    `If it's discontinued for good, then (and only then) suggest a clean/mineral alternative that fits: ${esc(item.why)}`;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(`${label} copied — paste into a Claude session.`); }
  catch { window.prompt(`${label} — copy this into Claude:`, text); }
}

function cardHTML(item) {
  const vendor = pickVendor(item);
  const c = buildConfidenceCard(item, vendor);
  const breakdown = c.priceBreakdown
    ? `<div class="breakdown">item ${c.priceBreakdown.item} + import ${c.priceBreakdown.importFees} + ship ${c.priceBreakdown.shipping} (customs prepaid)</div>` : '';
  const rows = [
    c.priceText ? `<div class="row"><span class="k">Landed price</span><span class="v">${esc(c.priceText)}${breakdown}</span></div>` : '',
    c.sellerText ? `<div class="row"><span class="k">Seller</span><span class="v">${esc(c.sellerText)}</span></div>` : '',
    c.etaText ? `<div class="row"><span class="k">Arrives</span><span class="v">${esc(c.etaText)}</span></div>` : '',
  ].join('');
  const href = safeHref(c.teleportUrl);
  const reorder = href
    ? `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener">${esc(c.teleportLabel)} →</a>`
    : `<button class="ghost" disabled>No verified in-stock vendor</button>`;
  const status = (vendor && vendor.status) || 'unknown';
  const alts = (item.vendors || []).slice(1).map(v =>
    `<div class="alt">${esc(v.name)} — ${esc(v.status.replace('_', ' '))}${v.snapshot ? ` (as of ${esc(v.snapshot.asOf)})` : ''}</div>`).join('');
  const img = safeHref(item.image)
    ? `<img class="thumb" src="${esc(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<div class="thumb thumb-empty">${esc((item.brand || item.name || '?').slice(0, 1))}</div>`;
  return `
    <article class="card">
      <div class="head">
        ${img}
        <div class="head-text">
          <h2>${esc(c.title)}</h2>
          <span class="variant">🔒 ${esc(c.variantLocked)}</span>
        </div>
      </div>
      <p class="why">${esc(c.why)}</p>
      <div class="status ${status}">${esc(c.statusLabel)}</div>
      <div class="rows">${rows || '<div class="row"><span class="k">No snapshot yet</span><span class="v">tap Verify</span></div>'}</div>
      <div class="actions">
        ${reorder}
        <button class="ghost" data-verify="${esc(item.id)}">Verify live (ask Claude)</button>
        <button class="ghost" data-hunt="${esc(item.id)}">Hunt — sold out?</button>
      </div>
      ${alts ? `<div class="alts"><strong>Other vendors:</strong>${alts}</div>` : ''}
    </article>`;
}

// --- Shelf data: lives ONLY in this device's localStorage (never on the public server). ---
// The hosted app ships with a generic demo shelf.json. Your real shelf arrives via a private
// one-tap "#data=" link that imports into localStorage on YOUR phone, never transmitted back.
const LS_KEY = 'pantry-shelf-data-v1';

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

async function maybeImportFromHash() {
  const hash = location.hash || '';
  const dataM = hash.match(/[#&]data=([^&]+)/);
  const fetchM = hash.match(/[#&]fetch=([^&]+)/);
  if (!dataM && !fetchM) return;
  try {
    let data = null;
    if (dataM) {
      data = JSON.parse(b64urlDecode(dataM[1]));
    } else {
      const url = decodeURIComponent(fetchM[1]);
      // Only allow fetching the transfer file from GitHub gist raw (no arbitrary SSRF target).
      if (!/^https:\/\/gist\.githubusercontent\.com\//.test(url)) throw new Error('untrusted fetch url');
      const res = await fetch(url, { cache: 'no-store' });
      data = await res.json();
    }
    if (!data || !Array.isArray(data.items)) throw new Error('not a shelf');
    if (confirm(`Load your shelf (${data.items.length} items) onto THIS device? It stays only here.`)) {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    }
  } catch (e) {
    console.warn('Shelf import failed:', e);
  }
  history.replaceState(null, '', location.pathname + location.search); // drop the hash; no re-import on refresh
}

async function getShelf() {
  await maybeImportFromHash();
  const raw = localStorage.getItem(LS_KEY);
  if (raw) {
    try { return { shelf: JSON.parse(raw), source: 'device' }; } catch {}
  }
  const res = await fetch('./shelf.json', { cache: 'no-store' });
  return { shelf: await res.json(), source: 'demo' };
}

async function main() {
  const { shelf, source } = await getShelf();
  const items = shelf.items || [];
  document.getElementById('shelf').innerHTML = items.map(cardHTML).join('');
  document.getElementById('count').textContent =
    `${items.length} item${items.length === 1 ? '' : 's'} · for ${(shelf.household || []).join(' & ')}`;
  const banner = document.getElementById('banner');
  if (banner) banner.style.display = source === 'demo' ? 'block' : 'none';

  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  document.getElementById('shelf').addEventListener('click', (e) => {
    const v = e.target.getAttribute('data-verify');
    const h = e.target.getAttribute('data-hunt');
    if (v) copy(buildVerifyPrompt(byId[v], pickVendor(byId[v])), 'Verify prompt');
    if (h) copy(huntPrompt(byId[h]), 'Hunt prompt');
  });
}

main().catch(err => {
  document.getElementById('shelf').innerHTML =
    `<div class="card"><strong>Could not load the shelf.</strong><br>${esc(err.message)}</div>`;
});
