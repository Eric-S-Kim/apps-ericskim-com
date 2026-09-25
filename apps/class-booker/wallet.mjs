// Optional ownership and page identities travel only in the authenticated snapshot.
const label = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 80 && !/[\x00-\x1f]/.test(v);
const identity = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 100 && !/[\x00-\x1f]/.test(v);
const fields = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));

export function validWallet(s) {
  const w = s.wallet;
  if (!fields(w, ['orderKey', 'ownerLabel', 'ownerBasis', 'admissions']) || !identity(w.orderKey)
    || !(w.ownerLabel === null || label(w.ownerLabel))
    || !['order', 'recipient', 'forwarder', 'unknown'].includes(w.ownerBasis)
    || (w.ownerLabel === null) !== (w.ownerBasis === 'unknown')
    || !Array.isArray(w.admissions) || w.admissions.length > 100
    || w.admissions.length && (s.admission !== 'ticket' || !s.orderId || w.admissions.length !== s.quantity)) return false;
  const ids = new Set(), pages = new Set();
  return w.admissions.every(a => {
    if (!fields(a, ['id', 'artifactIndex', 'page', 'holder']) || !identity(a.id) || ids.has(a.id)
      || !Number.isInteger(a.artifactIndex) || a.artifactIndex < 0 || a.artifactIndex >= s.artifacts.length
      || !Number.isInteger(a.page) || a.page < 1 || a.page > 100 || !(a.holder === null || label(a.holder))) return false;
    const position = `${a.artifactIndex}:${a.page}`;
    if (pages.has(position)) return false;
    ids.add(a.id); pages.add(position); return true;
  });
}

export function ownership(source) {
  const w = source.wallet;
  if (!w?.ownerLabel) return 'Owner not identified';
  return `${({ order: 'Bought by', recipient: 'Sent to', forwarder: 'Shared by' })[w.ownerBasis]} ${w.ownerLabel}`;
}

export function walletCards(booking) {
  const groups = new Map();
  const records = booking.records.length ? booking.records : [{ sourceId: 'original', artifacts: booking.artifacts }];
  for (const s of records) {
    const key = s.wallet?.orderKey || s.sourceId;
    if (!groups.has(key)) groups.set(key, { key, sources: [], admissions: new Map(), conflict: false });
    const g = groups.get(key); g.sources.push(s);
    for (const ticket of s.wallet?.admissions || []) {
      const entry = { source: s, ticket, artifact: s.artifacts[ticket.artifactIndex], page: ticket.page };
      const prior = g.admissions.get(ticket.id);
      if (prior && (prior.artifact.data !== entry.artifact.data || prior.page !== entry.page || prior.ticket.holder !== ticket.holder)) g.conflict = true;
      else if (!prior) g.admissions.set(ticket.id, entry);
    }
  }
  // One issuer credential cannot count twice even if the received order metadata disagrees.
  const seen = new Map();
  for (const g of groups.values()) for (const id of g.admissions.keys()) {
    if (seen.has(id)) { g.conflict = true; seen.get(id).conflict = true; } else seen.set(id, g);
  }
  const cards = [];
  for (const g of groups.values()) {
    const orders = new Set(g.sources.filter(s => s.wallet?.ownerBasis === 'order').map(s => s.wallet.ownerLabel));
    const editions = new Set(g.sources.filter(s => s.wallet?.admissions.length)
      .map(s => s.wallet.admissions.map(a => a.id).sort().join('|')));
    if (orders.size > 1 || editions.size > 1) g.conflict = true;
    g.source = g.sources.find(s => s.wallet?.ownerBasis === 'order') || g.sources[0];
    g.cancelled = g.sources.some(s => s.lifecycle === 'cancelled');
    g.review = g.conflict || g.sources.some(s => s.lifecycle === 'review');
    const admissionCards = !g.cancelled && !g.review ? [...g.admissions.values()] : [];
    const originals = [];
    const bytes = new Set();
    if (!admissionCards.length && !g.cancelled && !g.review) for (const source of g.sources) for (const artifact of source.artifacts) {
      if (!bytes.has(artifact.data)) { bytes.add(artifact.data); originals.push({ source, artifact, page: 1 }); }
    }
    const entries = admissionCards.length ? admissionCards : originals.length ? originals : [{ source: g.source }];
    entries.forEach((entry, i) => cards.push({ ...entry, group: g, groupIndex: i, groupCount: entries.length }));
  }
  return cards;
}

const node = (tag, cls, text) => {
  const n = document.createElement(tag); n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
let pdfModule;
const renderer = () => pdfModule ||= import('./vendor/pdfjs/pdf.min.mjs').then(pdf => {
  pdf.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  return pdf;
}).catch(error => { pdfModule = null; throw error; });

export function createWallet(booking, renderOriginal) {
  const root = node('section', 'wallet');
  root.setAttribute('aria-label', 'Event ticket wallet');
  const cards = walletCards(booking);
  const purchases = node('div', 'wallet-purchases');
  const title = node('h4', 'wallet-title');
  const owner = node('p', 'ticket-source');
  const warning = node('p', 'wallet-warning'); warning.setAttribute('role', 'status');
  const stage = node('div', 'wallet-stage');
  const nav = node('div', 'wallet-nav');
  const back = node('button', '', 'Previous ticket'), next = node('button', '', 'Next ticket');
  const position = node('span', 'wallet-position'); position.setAttribute('aria-live', 'polite');
  for (const b of [back, next]) b.type = 'button';
  nav.append(back, position, next);
  const originals = node('div', 'wallet-originals');
  root.append(purchases, title, owner, warning, nav, stage, originals);
  let index = 0, generation = 0, dead = false, loading = null, cleanupOriginal = () => {}, urls = [];
  const groupButtons = new Map();
  const release = () => {
    generation++; stage.replaceChildren(); cleanupOriginal(); originals.replaceChildren();
    if (loading) { loading.destroy().catch(() => {}); loading = null; }
    urls.forEach(URL.revokeObjectURL); urls = [];
  };
  const originalLink = artifact => {
    const bytes = Uint8Array.from(atob(artifact.data), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); urls.push(url);
    const a = node('a', 'wallet-pdf', 'Open original PDF');
    a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a;
  };
  const draw = async (card, pageNumber, stamp) => {
    const status = node('p', 'ticket-source', 'Loading original ticket…');
    stage.replaceChildren(status);
    try {
      const pdf = await renderer();
      if (dead || stamp !== generation) return;
      const task = pdf.getDocument({ data: Uint8Array.from(atob(card.artifact.data), c => c.charCodeAt(0)),
        isEvalSupported: false, useSystemFonts: true, stopAtErrors: true,
        standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href,
        wasmUrl: new URL('./vendor/pdfjs/wasm/', import.meta.url).href });
      loading = task;
      const doc = await task.promise;
      if (dead || stamp !== generation) return;
      if (doc.numPages > 100 || pageNumber > doc.numPages) throw new Error('Unsupported page count');
      const page = await doc.getPage(pageNumber);
      if (dead || stamp !== generation) return;
      const natural = page.getViewport({ scale: 1 });
      const width = Math.max(260, Math.min(stage.clientWidth, 760));
      const scale = Math.min(width / natural.width * Math.min(devicePixelRatio || 1, 3), Math.sqrt(4000000 / (natural.width * natural.height)));
      const viewport = page.getViewport({ scale });
      const canvas = node('canvas', 'wallet-page');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute('aria-label', `Original PDF page ${pageNumber}`);
      // Detached canvas: an old render can never paint into the newly selected ticket.
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      if (dead || stamp !== generation) return;
      stage.replaceChildren(canvas);
      if (!card.ticket && doc.numPages > 1) {
        const pages = node('div', 'wallet-nav');
        const prev = node('button', '', 'Previous page'), after = node('button', '', 'Next page');
        prev.type = after.type = 'button'; prev.disabled = pageNumber === 1; after.disabled = pageNumber === doc.numPages;
        const turn = n => { release(); cleanupOriginal = renderOriginal(card.group.sources, originals, originalLink); draw(card, n, generation); };
        prev.onclick = () => turn(pageNumber - 1); after.onclick = () => turn(pageNumber + 1);
        pages.append(prev, node('span', '', `Page ${pageNumber} of ${doc.numPages}`), after); stage.append(pages);
      }
    } catch {
      if (!dead && stamp === generation) stage.replaceChildren(node('p', 'wallet-warning', 'Preview unavailable. Open the original PDF below.'));
    }
  };
  const show = n => {
    if (dead || !cards.length) return;
    index = Math.max(0, Math.min(cards.length - 1, n)); release();
    const c = cards[index], g = c.group;
    const kind = c.ticket ? `Ticket ${c.groupIndex + 1} of ${c.groupCount}` : c.artifact ? 'Original document' : 'Confirmation';
    title.textContent = c.ticket?.holder ? `${c.ticket.holder} · ${kind}` : `${g.source.wallet?.ownerLabel || 'Booking'} · ${kind}`;
    owner.textContent = ownership(g.source) + (g.source.orderId ? ` · Order ${g.source.orderId}` : '');
    warning.textContent = g.cancelled ? 'This order was cancelled. Original records are retained below.'
      : g.review ? 'Conflicting or changed tickets. Check the original records before entry.'
      : booking.calendar && !booking.ready || booking.reason?.startsWith('Saved record')
        ? (booking.reason || 'Admission is not verified. Original record shown.') : '';
    warning.hidden = !warning.textContent;
    position.textContent = `${index + 1} / ${cards.length}`;
    back.disabled = index === 0; next.disabled = index === cards.length - 1; nav.hidden = cards.length < 2;
    for (const [key, button] of groupButtons) button.setAttribute('aria-pressed', String(key === g.key));
    cleanupOriginal = renderOriginal(g.sources, originals, originalLink);
    if (c.artifact) void draw(c, c.page, generation);
  };
  cards.forEach((c, i) => {
    if (groupButtons.has(c.group.key)) return;
    const name = c.group.source.wallet?.ownerLabel || 'Booking';
    const sameOwner = [...new Set(cards.filter(other => (other.group.source.wallet?.ownerLabel || 'Booking') === name).map(other => other.group.key))].length > 1;
    const b = node('button', '', `${name}${sameOwner && c.group.source.orderId ? ' · ' + c.group.source.orderId : ''}`);
    b.type = 'button'; b.onclick = () => show(i); groupButtons.set(c.group.key, b); purchases.append(b);
  });
  purchases.hidden = groupButtons.size < 2;
  back.onclick = () => show(index - 1); next.onclick = () => show(index + 1);
  root.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); show(index + (event.key === 'ArrowLeft' ? -1 : 1)); }
  });
  let touch = null;
  stage.addEventListener('touchstart', e => { touch = e.touches.length === 1 ? [e.touches[0].clientX, e.touches[0].clientY] : null; }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (!touch || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touch[0], dy = e.changedTouches[0].clientY - touch[1]; touch = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) show(index + (dx < 0 ? 1 : -1));
  }, { passive: true });
  return { root, start: () => show(0), destroy: () => { dead = true; release(); } };
}
