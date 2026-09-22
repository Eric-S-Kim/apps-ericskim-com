// Living Pantry Shelf — PWA "cockpit". Renders the shelf from shelf.json and wires
// the honest confidence card + the hand-off-to-Claude buttons. All real logic lives
// in adapters.mjs (shared with the tests); this file is just rendering + events.

import {
  buildConfidenceCard,
  pickVendor,
  buildVerifyPrompt,
  groupItems,
  freshnessShort,
  ageDays,
  snapshotStatusShort,
  isShelfPayload,
  isTrustedShelfFetchUrl,
} from './adapters.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Only ever emit https hrefs — neutralizes javascript:/data: even if shelf.json is tampered with.
const safeHref = (u) => (typeof u === 'string' && /^https:\/\//i.test(u)) ? u : null;

function huntPrompt(item) {
  const label = (item.variant && item.variant.label) || '';
  const not = ((item.variant && item.variant.mustNotMatch) || []).join(' / ');
  const spec = [label, not ? `must NOT be ${not}` : ''].filter(Boolean).join(', ');
  return `"${item.name}"${spec ? ` (${spec})` : ''} looks sold out at my saved vendors. ` +
    `Run the reputable-source hunt across stores that ship to Vancouver, Canada, and report the cheapest in-stock AUTHORIZED option. ` +
    `If it's discontinued for good, then (and only then) suggest a close alternative` +
    (item.why ? ` that fits: ${item.why}` : '.');
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
// its age · one action). The other 7 (full price w/ asOf, status detail, seller, variant
// guards, why, other vendors, Verify/Hunt) live behind an MB3-style "Show details"
// disclosure — native <details>, no toggle JS. Hunt also surfaces inline only when sold out.
function cardHTML(item) {
  const vendor = pickVendor(item);
  const c = buildConfidenceCard(item, vendor);
  const status = (vendor && vendor.status) || 'unknown';
  const href = safeHref(c.teleportUrl);

  // --- Simple view (always visible): image · name · variant · price + its age · one action ---
  const letter = esc((item.brand || item.name || '?').slice(0, 1));
  const img = safeHref(item.image)
    ? `<img class="thumb" src="${esc(item.image)}" alt="" referrerpolicy="no-referrer" data-letter="${letter}">`
    : `<div class="thumb thumb-empty">${letter}</div>`;
  const snap = (vendor && vendor.snapshot) || null;
  const fresh = esc(freshnessShort(status, snap));
  // A snapshot older than 30 days is shown quieter: it is a memory, not today's price.
  const stale = snap && (ageDays(snap.asOf) ?? 999) > 30 ? ' stale' : '';
  const priceLine = status === 'sold_out'
    ? `<span class="soldout">Sold out</span><span class="fresh">${[fresh.replace(/^Sold out ?/, ''), c.priceShort ? `was ${esc(c.priceShort)}` : ''].filter(Boolean).join(' · ')}</span>`
    : `${c.priceShort ? `<span class="price${stale}">${esc(c.priceShort)}</span>` : ''}<span class="fresh">${fresh}</span>`;
  const arrow = '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 10 H16 M11 5 L16 10 L11 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const store = c.vendorName && c.vendorName !== '—' ? c.vendorName : '';
  const storeShort = store && store.length <= 18 ? store : '';
  // One primary action per card, never a dead end: Reorder (names the store), the hunt when
  // sold out, or — no usable store link — a Verify hand-off to Claude.
  const primary = status === 'sold_out'
    ? `<button class="ghost" data-hunt="${esc(item.id)}">Find it elsewhere ${arrow}</button>`
    : href
      ? `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`Reorder ${c.title}${store ? ` at ${store}` : ''}`)}">Reorder${storeShort ? ` at ${esc(storeShort)}` : ''} ${arrow}</a>`
      : `<button class="ghost" data-verify="${esc(item.id)}">Ask Claude to find a store ${arrow}</button>`;

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
  // Every store except the featured one (which may not be first), with readable status words.
  const alts = (item.vendors || []).filter(v => v !== vendor).map(v =>
    `<div class="alt">${esc(v.name)} — ${esc(snapshotStatusShort(v.status))}${v.snapshot ? ` (as of ${esc(v.snapshot.asOf)})` : ''}</div>`).join('');
  const altBlock = alts ? `<div class="alts"><strong>Other vendors:</strong>${alts}</div>` : '';
  const detailActions =
    `<button class="ghost" data-verify="${esc(item.id)}">Ask Claude to verify stock &amp; price</button>` +
    (status !== 'sold_out' ? `<button class="ghost" data-hunt="${esc(item.id)}">Ask Claude to find it elsewhere</button>` : '');
  const chev = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 4 10 8 6 12"></polyline></svg>';

  return `
    <article class="card">
      <div class="head">
        ${img}
        <div class="head-text">
          <h2>${esc(c.title)}</h2>
          <p class="variant">${esc(c.variantLocked)}</p>
          <div class="price-line">${priceLine}</div>
        </div>
      </div>
      <div class="actions">${primary}</div>
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

// One collapsible category section, collapsed by default — the calm "open to a few
// headers, tap the one you want" layout. Same native <details> disclosure as the cards.
function groupSectionHTML(g) {
  const chev = '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7 5 L12 10 L7 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const wave = '<svg class="g-wave" viewBox="0 0 96 10" aria-hidden="true"><polyline points="' +
    Array.from({ length: 33 }, (_, i) => `${i * 3},${(5 + 3.5 * Math.sin((i * 3) / 7)).toFixed(1)}`).join(' ') +
    '" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  const n = g.items.length;
  return `
    <details class="group">
      <summary>
        <span class="g-name">${esc(g.group)}</span>
        ${wave}
        <span class="g-count">${n}<span class="sr-only"> item${n === 1 ? '' : 's'}</span></span>
        <span class="g-chev">${chev}</span>
      </summary>
      <div class="group-body">${g.items.map(cardHTML).join('')}</div>
    </details>`;
}

// --- Shelf data: lives ONLY in this device's localStorage (never on the public server). ---
// The hosted app ships with a generic demo shelf.json. Your real shelf arrives via a private
// one-tap "#data=" link or remembered "#fetch=" gist source. The source URL is stored only on
// this device, so future pantry edits can sync without publishing private data into the app.
const LS_KEY = 'pantry-shelf-data-v1';
const LS_SOURCE_KEY = 'pantry-shelf-source-v1';

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

function cacheBustedUrl(url) {
  const u = new URL(url);
  u.searchParams.set('_pantrySync', String(Date.now()));
  return u.toString();
}

async function fetchShelfFromSource(url) {
  if (!isTrustedShelfFetchUrl(url)) throw new Error('untrusted fetch url');
  const res = await fetch(cacheBustedUrl(url), { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const data = await res.json();
  if (!isShelfPayload(data)) throw new Error('not a shelf');
  return data;
}

async function maybeImportFromHash() {
  const hash = location.hash || '';
  const dataM = hash.match(/[#&]data=([^&]+)/);
  const fetchM = hash.match(/[#&]fetch=([^&]+)/);
  if (!dataM && !fetchM) return;
  try {
    let data = null;
    let sourceUrl = null;
    if (dataM) {
      data = JSON.parse(b64urlDecode(dataM[1]));
    } else {
      sourceUrl = decodeURIComponent(fetchM[1]);
      data = await fetchShelfFromSource(sourceUrl);
    }
    if (!isShelfPayload(data)) throw new Error('not a shelf');
    if (confirm(`Load your shelf (${data.items.length} items) onto THIS device? It stays only here.`)) {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      if (sourceUrl) localStorage.setItem(LS_SOURCE_KEY, sourceUrl);
    }
  } catch (e) {
    console.warn('Shelf import failed:', e);
  }
  history.replaceState(null, '', location.pathname + location.search); // drop the hash; no re-import on refresh
}

async function getShelf() {
  await maybeImportFromHash();
  const sourceUrl = localStorage.getItem(LS_SOURCE_KEY);
  if (sourceUrl) {
    if (isTrustedShelfFetchUrl(sourceUrl)) {
      try {
        const shelf = await fetchShelfFromSource(sourceUrl);
        localStorage.setItem(LS_KEY, JSON.stringify(shelf));
        return { shelf, source: 'device' };
      } catch (e) {
        console.warn('Shelf sync failed; falling back to saved shelf:', e);
      }
    } else {
      localStorage.removeItem(LS_SOURCE_KEY);
    }
  }
  const raw = localStorage.getItem(LS_KEY);
  if (raw) {
    try { return { shelf: JSON.parse(raw), source: 'device' }; } catch {}
  }
  const res = await fetch('./shelf.json', { cache: 'no-store' });
  return { shelf: await res.json(), source: 'demo' };
}

document.addEventListener('error', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLImageElement) || !el.classList.contains('thumb')) return;
  const tile = document.createElement('div');
  tile.className = 'thumb thumb-empty';
  tile.textContent = el.dataset.letter || '?';
  el.replaceWith(tile);
}, true);

async function main() {
  const { shelf, source } = await getShelf();
  const items = shelf.items || [];
  document.getElementById('shelf').innerHTML = groupItems(items).map(groupSectionHTML).join('');
  const banner = document.getElementById('banner');
  if (banner) banner.style.display = source === 'demo' ? 'block' : 'none';

  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  document.getElementById('shelf').addEventListener('click', (e) => {
    // closest(): a tap can land on the arrow icon inside a button, not the button itself.
    const btn = e.target.closest('[data-verify],[data-hunt]');
    if (!btn) return;
    const v = btn.getAttribute('data-verify');
    const h = btn.getAttribute('data-hunt');
    if (v) copy(buildVerifyPrompt(byId[v], pickVendor(byId[v])), 'Verify prompt');
    if (h) copy(huntPrompt(byId[h]), 'Hunt prompt');
  });
}

main().catch(err => {
  document.getElementById('shelf').innerHTML =
    `<div class="card error-card"><strong>Could not load the shelf.</strong><br>${esc(err.message)}</div>`;
});
