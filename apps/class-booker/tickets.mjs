import { createWallet, ownership } from './wallet.mjs?v=20260925-wallet';
// Credentials arrive only in authenticated private config; this module contains no ticket data.
const text = (s, n) => typeof s === 'string' && s.length > 0 && s.length <= n;
const statuses = new Set(['confirmed', 'reserved', 'purchased', 'cancelled']);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function validPdf(a) {
  if (!a || a.kind !== 'pdf' || !text(a.name, 100) || !text(a.data, 1400000)) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(a.data) || a.data.length % 4) return false;
  try { return atob(a.data.slice(0, 12)).startsWith('%PDF-'); } catch { return false; }
}

export function isTicketData(data, classes) {
  if (!data || data.version !== 1 || !Number.isFinite(Date.parse(data.checkedAt))) return false;
  if (!Array.isArray(data.bookings) || data.bookings.length > 50) return false;
  const ids = new Set(classes.filter(c => c && typeof c.id === 'string').map(c => c.id));
  const seen = new Set();
  let size = 0;
  return data.bookings.every(b => {
    if (!b || !ids.has(b.classId) || !datePattern.test(b.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.startTime)) return false;
    if (b.timeZone !== 'America/Vancouver' || !statuses.has(b.status) || !text(b.sourceId, 100) || seen.has(b.sourceId)) return false;
    if (!text(b.subject, 500) || !text(b.sender, 300) || !text(b.confirmationText, 18000)) return false;
    if (b.originalEmail !== undefined) {
      const original = b.originalEmail;
      if (!original || !['html', 'text'].includes(original.format) || !text(original.body, 120000)) return false;
      const bytes = new TextEncoder().encode(original.body).length;
      if (bytes > 120000) return false;
      size += bytes;
    }
    if (!Number.isFinite(Date.parse(b.receivedAt)) || !Array.isArray(b.artifacts) || b.artifacts.length > 8) return false;
    const parsed = new Date(`${b.date}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== b.date) return false;
    seen.add(b.sourceId);
    for (const a of b.artifacts) {
      if (!validPdf(a)) return false;
      size += a.data.length;
    }
    return size <= 3500000;
  });
}

export function venueNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

export function bookingFor(data, occurrence) {
  if (!data || !occurrence.times) return null;
  const d = occurrence.date;
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const minutes = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const matches = data.bookings.filter(b => b.classId === occurrence.item.id && b.date === day
    && minutes(b.startTime) === occurrence.times.start).sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  if (!matches.length) return null;
  // A cancellation makes the occurrence uncertain until a newer authoritative confirmation appears.
  const cutoff = matches.findIndex(b => b.status === 'cancelled');
  if (cutoff === 0) return { records: [matches[0]], status: 'cancelled', artifacts: [], ready: false };
  const records = cutoff < 0 ? matches : matches.slice(0, cutoff);
  const artifacts = [];
  const seen = new Set();
  for (const b of records) for (const a of b.artifacts) {
    if (!seen.has(a.data)) { artifacts.push(a); seen.add(a.data); }
  }
  return { records, status: records.some(b => b.status === 'purchased') ? 'purchased' : records[0].status,
    artifacts, ready: artifacts.length > 0 };
}

export function bookingLabel(booking) {
  return ({ purchased: 'Purchased', reserved: 'Reserved', confirmed: 'Registration confirmed', cancelled: 'Cancelled' })[booking.status];
}

export function freshTicketData(data, now = new Date()) {
  const age = now.getTime() - Date.parse(data?.checkedAt);
  return age >= -300000 && age < 6 * 60 * 60 * 1000;
}

export function ticketIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ width: '20', height: '20', viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M4 5h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4V5Z M15 5v3m0 3v2m0 3v3');
  p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.7');
  svg.append(p); return svg;
}

const el = (tag, cls, value) => {
  const n = document.createElement(tag); n.className = cls;
  if (value !== undefined) n.textContent = value;
  return n;
};

// MB3's original-email pattern: sanitized source HTML plus an independent script-free sandbox.
// The CSP also constrains a malformed payload. Source HTML is never inserted into the app DOM.
const frameHead = '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src https: data:; font-src https: data:; form-action \'none\'; base-uri \'none\'">'
  + '<base target="_blank"><style>html,body{margin:0;-webkit-text-size-adjust:100%;text-size-adjust:100%}body{background:white;color:#222;font:13px Arial,Helvetica,sans-serif}</style>';

function originalFrame(body) {
  const viewport = el('div', 'ticket-original-viewport');
  const frame = el('iframe', 'ticket-original');
  frame.title = 'Original confirmation email';
  frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  frame.referrerPolicy = 'no-referrer';
  frame.srcdoc = frameHead + body;
  viewport.append(frame);
  const zoom = el('button', 'ticket-zoom', 'Original size');
  zoom.type = 'button'; zoom.hidden = true; zoom.setAttribute('aria-pressed', 'false');
  let fitted = true;
  const fit = () => {
    if (!frame.isConnected || !viewport.clientWidth) return;
    const doc = frame.contentDocument;
    if (!doc?.body) return;
    const root = doc.documentElement, available = viewport.clientWidth;
    frame.style.transform = '';
    frame.style.height = '0px';
    frame.style.width = `${available}px`;
    // Give the email its natural viewport, then scale the finished frame. CSS zoom inside
    // a narrow iframe can trigger text inflation and change the source's line wrapping.
    let width = available;
    for (let pass = 0; pass < 2; pass++) {
      width = Math.max(width, root.scrollWidth, doc.body.scrollWidth);
      frame.style.width = `${width}px`;
    }
    const height = Math.min(Math.max(root.scrollHeight, doc.body.scrollHeight) + 2, 20000);
    const scale = fitted ? Math.min(1, available / width) : 1;
    frame.style.height = `${height}px`;
    frame.style.transform = `scale(${scale})`;
    viewport.style.height = `${Math.ceil(height * scale) + (fitted ? 0 : 18)}px`;
    viewport.style.overflowX = fitted ? 'hidden' : 'auto';
    zoom.hidden = width <= available + 1;
  };
  zoom.addEventListener('click', () => {
    fitted = !fitted;
    zoom.textContent = fitted ? 'Original size' : 'Fit to screen';
    zoom.setAttribute('aria-pressed', String(!fitted));
    fit();
    viewport.scrollLeft = 0;
  });
  frame.addEventListener('load', () => {
    fit();
    frame.contentDocument?.querySelectorAll('img').forEach(img => {
      if (!img.complete) { img.addEventListener('load', fit, { once: true }); img.addEventListener('error', fit, { once: true }); }
    });
  });
  return { frame, fit, zoom, viewport };
}

let activeWallet = null;

export function invalidateOpenBooking(revision) {
  if (activeWallet && revision > activeWallet.revision) activeWallet.invalidate();
}

export function showBooking(booking, venue, checkedAt, offline, revision = 0) {
  const previous = document.querySelector('.ticket-dialog');
  if (previous) previous.close();
  const dialog = el('dialog', 'ticket-dialog');
  const head = el('div', 'ticket-head');
  const close = el('button', 'ticket-close', 'Close'); close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  head.append(el('h2', '', 'Event wallet'), close);
  dialog.append(head, el('h3', '', venue));
  if (checkedAt) {
    const when = new Date(checkedAt).toLocaleString(undefined, { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    dialog.append(el('p', 'ticket-source', `${offline ? 'Saved copy · ' : ''}Email checked ${when} (Vancouver)`));
  }
  const wallet = createWallet(booking, (records, parent, originalLink) => {
    const observers = [];
    const seen = new Set();
    for (const b of records) {
      const detail = el('details', 'ticket-email');
      detail.open = !b.artifacts.length && !['cancelled', 'review'].includes(b.lifecycle);
      detail.append(el('summary', '', `${ownership(b)} · Original records`));
      if (b.lifecycle === 'cancelled') detail.append(el('p', 'wallet-warning', 'Cancelled — do not use for entry.'));
      for (const a of b.artifacts) if (!seen.has(a.data)) { detail.append(originalLink(a)); seen.add(a.data); }
      if (b.sender) detail.append(el('p', 'ticket-source', b.sender));
      if (b.subject) detail.append(el('h4', '', b.subject));
      const mount = () => {
        if (!detail.open || detail.querySelector('.ticket-original, .ticket-copy')) return;
        if (b.originalEmail?.format === 'html') {
          const { fit, zoom, viewport } = originalFrame(b.originalEmail.body);
          detail.append(zoom, viewport);
          let lastWidth = 0;
          const observer = new ResizeObserver(entries => {
            const width = entries[0].contentRect.width;
            if (width !== lastWidth) { lastWidth = width; requestAnimationFrame(fit); }
          });
          observer.observe(detail); observers.push(observer);
        } else if (b.originalEmail?.body || b.confirmationText) {
          detail.append(el('p', 'ticket-copy', b.originalEmail?.body || b.confirmationText));
        }
      };
      detail.addEventListener('toggle', mount);
      parent.append(detail); mount();
    }
    return () => observers.forEach(o => o.disconnect());
  });
  dialog.append(wallet.root);
  const session = { revision, invalidate: () => {
    wallet.destroy();
    wallet.root.replaceChildren(el('p', 'wallet-warning', 'Tickets updated. Close and reopen this event to view the latest records.'));
  } };
  activeWallet = session;
  dialog.addEventListener('close', () => { wallet.destroy(); if (activeWallet === session) activeWallet = null; dialog.remove(); }, { once: true });
  document.body.append(dialog); dialog.showModal(); wallet.start();
}
