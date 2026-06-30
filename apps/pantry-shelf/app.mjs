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

// Each card is calm by default: 6 always-visible facts (image · name · variant · price ·
// status chip · Reorder). The other 7 (full price w/ asOf, status detail, seller, variant
// guards, why, other vendors, Verify/Hunt) live behind an MB3-style "Show details"
// disclosure — native <details>, no toggle JS. Hunt also surfaces inline only when sold out.
function cardHTML(item) {
  const vendor = pickVendor(item);
  const c = buildConfidenceCard(item, vendor);
  const status = (vendor && vendor.status) || 'unknown';
  const href = safeHref(c.teleportUrl);

  // --- Simple view (always visible) ---
  const img = safeHref(item.image)
    ? `<img class="thumb" src="${esc(item.image)}" alt="" referrerpolicy="no-referrer">`
    : `<div class="thumb thumb-empty">${esc((item.brand || item.name || '?').slice(0, 1))}</div>`;
  const priceChip = c.priceShort ? `<span class="price-short">${esc(c.priceShort)}</span>` : '';
  const statusChip = `<span class="chip ${esc(status)}">${esc(c.statusShort)}</span>`;
  const reorder = href
    ? `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener">Reorder →</a>`
    : `<button class="ghost" disabled>No verified vendor</button>`;
  // Hunt is contextual: shown inline ONLY when the item is actually sold out.
  const huntInline = status === 'sold_out'
    ? `<button class="ghost" data-hunt="${esc(item.id)}">Find it elsewhere</button>` : '';

  // --- Details (the other 7, collapsed) ---
  const guards = [
    (item.variant.mustMatch || []).length ? `must be: ${esc(item.variant.mustMatch.join(' · '))}` : '',
    (item.variant.mustNotMatch || []).length ? `never: ${esc(item.variant.mustNotMatch.join(' · '))}` : '',
  ].filter(Boolean).join(' — ');
  const detailRows = [
    c.priceText ? `<div class="row"><span class="k">Landed price</span><span class="v">${esc(c.priceText)}</span></div>` : '',
    c.statusLabel ? `<div class="row"><span class="k">Status</span><span class="v">${esc(c.statusLabel)}</span></div>` : '',
    c.sellerText ? `<div class="row"><span class="k">Seller</span><span class="v">${esc(c.sellerText)}</span></div>` : '',
    guards ? `<div class="row"><span class="k">Variant lock</span><span class="v">${guards}</span></div>` : '',
  ].join('');
  const why = c.why ? `<p class="why">${esc(c.why)}</p>` : '';
  const alts = (item.vendors || []).slice(1).map(v =>
    `<div class="alt">${esc(v.name)} — ${esc(v.status.replace('_', ' '))}${v.snapshot ? ` (as of ${esc(v.snapshot.asOf)})` : ''}</div>`).join('');
  const altBlock = alts ? `<div class="alts"><strong>Other vendors:</strong>${alts}</div>` : '';
  const detailActions =
    `<button class="ghost" data-verify="${esc(item.id)}">Verify live (ask Claude)</button>` +
    (status !== 'sold_out' ? `<button class="ghost" data-hunt="${esc(item.id)}">Hunt — sold out?</button>` : '');
  const chev = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 4 10 8 6 12"></polyline></svg>';

  return `
    <article class="card">
      <div class="head">
        ${img}
        <div class="head-text">
          <h2>${esc(c.title)}</h2>
          <span class="variant">${esc(c.variantLocked)}</span>
          <div class="simple-line">${priceChip}${statusChip}</div>
        </div>
      </div>
      <div class="actions">${reorder}${huntInline}</div>
      <details class="more">
        <summary>${chev}<span class="lbl-closed">Show details</span><span class="lbl-open">Hide details</span></summary>
        <div class="more-body">
          ${why}
          <div class="rows">${detailRows}</div>
          ${altBlock}
          <div class="actions detail-actions">${detailActions}</div>
        </div>
      </details>
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
