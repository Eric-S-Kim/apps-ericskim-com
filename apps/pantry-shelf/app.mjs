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
  parseHash,
  itemLink,
} from './adapters.mjs?v=13'; // build tag: bump with sw.js CACHE + index.html (a test checks they agree)

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

async function copy(text, label, done = `${label} copied — paste into a Claude session.`) {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch { window.prompt(`${label} — copy this:`, text); }
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
    (status !== 'sold_out' ? `<button class="ghost" data-hunt="${esc(item.id)}">Ask Claude to find it elsewhere</button>` : '') +
    `<button class="ghost" data-link="${esc(item.id)}">Copy link to this item</button>`;
  const chev = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 4 10 8 6 12"></polyline></svg>';

  return `
    <article class="card" data-item="${esc(item.id)}">
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

// A setup link (#data= / #fetch=) is validated and HELD until the owner taps Load in the
// page's own panel. It used to ask with window.confirm(), which Chrome can silently answer
// "Cancel" in a just-opened in-app browser (Gmail's), so a load could fail with no sign.
const view = { pending: null, importError: false, source: null };

async function takeImport(intent) {
  history.replaceState(null, '', location.pathname + location.search); // drop the hash; no re-import on refresh
  try {
    let data = null;
    let sourceUrl = null;
    if (intent.kind === 'data') {
      data = JSON.parse(b64urlDecode(intent.value));
    } else {
      sourceUrl = intent.value;
      data = await fetchShelfFromSource(sourceUrl);
    }
    if (!isShelfPayload(data)) throw new Error('not a shelf');
    return { data, sourceUrl };
  } catch (e) {
    console.warn('Shelf import failed:', e);
    toast('That shelf link didn’t load. Your shelf is unchanged.');
    return null;
  }
}

function renderImportPanel() {
  const box = document.getElementById('import');
  const p = view.pending;
  box.hidden = !p;
  showBanner();
  if (!p) { box.innerHTML = ''; return; }
  const n = p.data.items.length;
  const groups = groupItems(p.data.items).map((g) => `<li>${esc(g.group)} · ${g.items.length}</li>`).join('');
  box.innerHTML = `
    <h2 class="import-title">Load your shelf (${n} item${n === 1 ? '' : 's'}) onto this phone?</h2>
    <ul class="import-list">${groups}</ul>
    ${view.importError ? '<p class="import-error">Couldn’t save on this phone. Check that Chrome allows site data, then try again.</p>' : ''}
    <div class="import-actions">
      <button type="button" data-import="load">Load shelf</button>
      <button type="button" class="ghost" data-import="cancel">Cancel</button>
    </div>`;
}

function acceptImport() {
  const p = view.pending;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p.data));
    if (p.sourceUrl) localStorage.setItem(LS_SOURCE_KEY, p.sourceUrl);
  } catch (e) {
    console.warn('Could not save the shelf:', e);
    view.importError = true;
    renderImportPanel();
    return;
  }
  Object.assign(view, { pending: null, importError: false });
  renderImportPanel();
  renderShelf(p.data, 'device');
  toast('Shelf loaded.');
}

async function getShelf() {
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

let byId = {};

function renderShelf(shelf, source) {
  const items = shelf.items || [];
  byId = Object.fromEntries(items.map(i => [i.id, i]));
  document.getElementById('shelf').innerHTML = groupItems(items).map(groupSectionHTML).join('');
  view.source = source;
  showBanner();
}

// The demo hint shows only on the demo shelf, and not while the Load panel is already asking.
function showBanner() {
  const banner = document.getElementById('banner');
  if (banner) banner.style.display = view.source === 'demo' && !view.pending ? 'block' : 'none';
}

// #item=<id> (a saved link or an NFC sticker): open just that item's section and bring its
// card into view. Every other section stays as it was (closed by default).
function jumpToItem(id) {
  history.replaceState(null, '', location.pathname + location.search); // a second tap of the same link still jumps
  const card = [...document.querySelectorAll('article[data-item]')].find((a) => a.dataset.item === id);
  if (!card) { toast('That item isn’t on this shelf anymore.'); return; }
  const group = card.closest('details.group');
  if (group) group.open = true;
  card.scrollIntoView({ block: 'center' });
  card.classList.remove('flash');
  void card.offsetWidth; // restart the highlight if the same card is jumped to twice
  card.classList.add('flash');
  clearTimeout(jumpToItem._t); jumpToItem._t = setTimeout(() => card.classList.remove('flash'), 1800);
}

async function handleHash() {
  const intent = parseHash(location.hash);
  if (!intent) return;
  if (intent.kind === 'item') { jumpToItem(intent.value); return; }
  const pending = await takeImport(intent);
  if (pending) {
    Object.assign(view, { pending, importError: false });
    renderImportPanel();
    document.getElementById('import').scrollIntoView({ block: 'start' });
  }
}

async function main() {
  const { shelf, source } = await getShelf();
  renderShelf(shelf, source);

  document.addEventListener('click', (e) => {
    // closest(): a tap can land on the arrow icon inside a button, not the button itself.
    const btn = e.target.closest('[data-verify],[data-hunt],[data-link],[data-import]');
    if (!btn) return;
    const v = btn.getAttribute('data-verify');
    const h = btn.getAttribute('data-hunt');
    const l = btn.getAttribute('data-link');
    const imp = btn.getAttribute('data-import');
    if (v) copy(buildVerifyPrompt(byId[v], pickVendor(byId[v])), 'Verify prompt');
    if (h) copy(huntPrompt(byId[h]), 'Hunt prompt');
    if (l) copy(itemLink(location.href, l), 'Item link', 'Item link copied.');
    if (imp === 'load' && view.pending) acceptImport();
    if (imp === 'cancel') { Object.assign(view, { pending: null, importError: false }); renderImportPanel(); }
  });

  // An NFC tap or saved link while the app is already open only changes the hash.
  window.addEventListener('hashchange', () => { handleHash(); });
  await handleHash();
}

main().catch(err => {
  document.getElementById('shelf').innerHTML =
    `<div class="card error-card"><strong>Could not load the shelf.</strong><br>${esc(err.message)}</div>`;
});
