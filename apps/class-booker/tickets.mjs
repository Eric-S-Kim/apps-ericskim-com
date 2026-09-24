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

export function showBooking(booking, venue, checkedAt, offline) {
  const previous = document.querySelector('.ticket-dialog');
  if (previous) previous.close();
  const dialog = el('dialog', 'ticket-dialog');
  const head = el('div', 'ticket-head');
  const close = el('button', 'ticket-close', 'Close'); close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  head.append(el('h2', '', booking.ready ? 'Your ticket' : 'Your confirmation'), close);
  dialog.append(head, el('h3', '', venue));
  const when = new Date(checkedAt).toLocaleString(undefined, { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  dialog.append(el('p', 'ticket-source', `${offline ? 'Saved copy · ' : ''}Email checked ${when} (Vancouver)`));
  const urls = [];
  booking.artifacts.forEach((a, i) => {
    const bytes = Uint8Array.from(atob(a.data), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); urls.push(url);
    const link = el('a', 'hero-go', booking.artifacts.length > 1 ? `Open ticket PDF ${i + 1}` : 'Open ticket PDF');
    link.href = url; link.target = '_blank'; link.rel = 'noopener';
    dialog.append(link);
  });
  for (const b of booking.records) {
    const detail = el('details', 'ticket-email');
    detail.open = !booking.ready;
    detail.append(el('summary', '', 'Email confirmation'));
    detail.append(el('p', 'ticket-source', b.sender), el('h4', '', b.subject), el('p', 'ticket-copy', b.confirmationText));
    dialog.append(detail);
  }
  dialog.addEventListener('close', () => { urls.forEach(URL.revokeObjectURL); dialog.remove(); }, { once: true });
  document.body.append(dialog); dialog.showModal();
  // Synchronous to the tap: mobile browsers can open the original PDF without a blocked async popup.
  if (urls.length === 1) window.open(urls[0], '_blank', 'noopener');
}
