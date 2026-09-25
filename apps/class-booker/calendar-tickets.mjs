import { bookingFor, freshTicketData, validPdf } from './tickets.mjs?v=20260924-calendar';

export const PAYLOAD_LIMIT = 3500000;
const bytes = value => new TextEncoder().encode(value).length;
const plain = (value, max, empty = false) => typeof value === 'string' && (empty || value.trim().length > 0)
  && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const fields = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value)
  && required.every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => required.includes(k) || optional.includes(k));
const unique = values => new Set(values).size === values.length;
const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validInstant(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function validSource(s) {
  return fields(s, ['sourceId', 'orderId', 'sender', 'subject', 'receivedAt', 'originalEmail', 'artifacts', 'coverageDates', 'quantity', 'admission', 'lifecycle'])
    && plain(s.sourceId, 100) && (s.orderId === null || plain(s.orderId, 200)) && plain(s.sender, 300) && plain(s.subject, 500)
    && validInstant(s.receivedAt) && fields(s.originalEmail, ['format', 'body'])
    && ['html', 'text'].includes(s.originalEmail.format) && plain(s.originalEmail.body, 120000) && bytes(s.originalEmail.body) <= 120000
    && Array.isArray(s.artifacts) && s.artifacts.length <= 8
    && s.artifacts.every(a => fields(a, ['kind', 'name', 'data']) && validPdf(a))
    && Array.isArray(s.coverageDates) && s.coverageDates.length <= 31 && unique(s.coverageDates) && s.coverageDates.every(validDate)
    && (s.quantity === null || Number.isSafeInteger(s.quantity) && s.quantity > 0 && s.quantity <= 100)
    && ['ticket', 'confirmation', 'acknowledgement'].includes(s.admission) && ['active', 'cancelled', 'review'].includes(s.lifecycle);
}

export function isCalendarTicketData(data, classes) {
  if (!fields(data, ['version', 'revision', 'checkedAt', 'windowStart', 'windowEnd', 'events', 'sources', 'invalidations']) || !payloadFits(data)
    || data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision <= 0 || !validInstant(data.checkedAt)
    || !validDate(data.windowStart) || !validDate(data.windowEnd) || data.windowStart >= data.windowEnd
    || (Date.parse(data.windowEnd) - Date.parse(data.windowStart)) / 86400000 > 400
    || !Array.isArray(data.events) || data.events.length > 500 || !Array.isArray(data.sources) || data.sources.length > 100
    || !Array.isArray(data.invalidations) || data.invalidations.length > 500 || !data.sources.every(validSource)
    || !unique(data.sources.map(s => s.sourceId))) return false;
  const classIds = new Set(classes.filter(Boolean).map(c => c.id));
  const sources = new Map(data.sources.map(s => [s.sourceId, s]));
  if (!data.invalidations.every(i => fields(i, ['classId', 'date', 'startTime', 'reason']) && classIds.has(i.classId)
    && validDate(i.date) && time(i.startTime) && plain(i.reason, 300))) return false;
  return unique(data.events.map(e => e?.id)) && data.events.every(e => {
    if (!fields(e, ['id', 'title', 'date', 'startTime', 'endTime', 'status', 'checkedAt', 'sourceIds', 'reason'], ['classId'])
      || !plain(e.id, 100) || !plain(e.title, 200) || !validDate(e.date) || e.date < data.windowStart || e.date >= data.windowEnd
      || !(e.startTime === null && e.endTime === null || time(e.startTime) && time(e.endTime))
      || !['missing', 'confirmation', 'ready', 'review', 'cancelled', 'stale'].includes(e.status)
      || !(e.checkedAt === null || validInstant(e.checkedAt) && Date.parse(e.checkedAt) <= Date.parse(data.checkedAt))
      || !Array.isArray(e.sourceIds) || e.sourceIds.length > 20 || !unique(e.sourceIds) || !e.sourceIds.every(id => sources.has(id))
      || !plain(e.reason, 300, true) || e.classId !== undefined && !classIds.has(e.classId)) return false;
    if (e.status === 'confirmation' && !e.sourceIds.length) return false;
    return e.status !== 'ready' || e.checkedAt !== null && e.sourceIds.some(id => {
      const s = sources.get(id);
      return s.lifecycle === 'active' && s.admission === 'ticket' && s.orderId !== null && s.quantity > 0
        && s.coverageDates.includes(e.date) && s.artifacts.length > 0;
    });
  });
}

export function payloadFits(data) {
  try { return bytes(JSON.stringify(data)) <= PAYLOAD_LIMIT; } catch { return false; }
}

export const localDateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOf = occurrence => occurrence.times ? `${String(Math.floor(occurrence.times.start / 60)).padStart(2, '0')}:${String(occurrence.times.start % 60).padStart(2, '0')}` : null;
const sameOccurrence = (record, occurrence) => record.classId === occurrence.item?.id && record.date === localDateKey(occurrence.date)
  && (record.startTime === null || record.startTime === startOf(occurrence));

// All rows and heroes pass here. A calendar decision never falls back to a legacy ready ticket.
export function effectiveBooking(data, occurrence) {
  const calendar = data.calendarTickets;
  const invalidation = calendar?.invalidations.find(i => occurrence.event
    ? i.classId === occurrence.event.classId && i.date === occurrence.event.date && i.startTime === occurrence.event.startTime
    : sameOccurrence(i, occurrence));
  const event = occurrence.event || calendar?.events.find(e => sameOccurrence(e, occurrence));
  if (invalidation) {
    const records = event ? event.sourceIds.map(id => calendar.sources.find(s => s.sourceId === id))
      : bookingFor(data.tickets, occurrence)?.records || [];
    return { calendar: true, records, status: 'cancelled', checkedAt: null, reason: invalidation.reason,
      ready: false, artifacts: records.flatMap(s => s.artifacts || []) };
  }
  if (event) {
    const sources = new Map(calendar.sources.map(s => [s.sourceId, s]));
    const records = event.sourceIds.map(id => sources.get(id));
    const eligible = records.filter(s => s.lifecycle === 'active' && s.admission === 'ticket' && s.orderId && s.quantity > 0 && s.coverageDates.includes(event.date));
    const artifacts = (event.status === 'ready' ? eligible : records).flatMap(s => s.artifacts);
    const seen = new Set();
    return { calendar: true, records, status: event.status, checkedAt: event.checkedAt, reason: event.reason,
      ready: event.status === 'ready', artifacts: artifacts.filter(a => !seen.has(a.data) && seen.add(a.data)) };
  }
  const legacy = bookingFor(data.tickets, occurrence);
  return legacy && { ...legacy, checkedAt: data.tickets.checkedAt };
}

export function calendarLabel(booking, now = new Date(), verified = true) {
  const fresh = verified && freshTicketData(booking, now);
  return ({ ready: fresh ? 'Ticket ready' : 'Saved ticket · check for changes', confirmation: fresh ? 'Confirmation found' : 'Saved confirmation · check for changes',
    missing: 'Ticket not found', review: 'Needs review', cancelled: 'Cancelled or removed', stale: 'Check for changes' })[booking.status];
}

export function calendarAction(booking) {
  if (!booking?.records.length) return null;
  return booking.ready ? 'Show ticket' : booking.status === 'confirmation' ? 'View confirmation' : 'View original';
}
