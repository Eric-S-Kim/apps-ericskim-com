import test from 'node:test';
import assert from 'node:assert/strict';
import { isCalendarTicketData, effectiveBooking, calendarLabel, calendarAction } from './calendar-tickets.mjs';
import { buildSchedule, buildAppSchedule, isClassBookerData, isShortcutImport, weekDays } from './app.mjs';

const classes = [{ id: 'dance', chip: 'W', tag: 'Movement', venue: 'Example Studio', when: 'Wednesdays 7-8:45 PM', action: 'Book class', url: 'https://example.com/' }];
const source = { sourceId: 'source-a', orderId: 'order-a', sender: 'Studio <studio@example.com>', subject: 'Your ticket', receivedAt: '2026-09-22T01:00:00Z', originalEmail: { format: 'text', body: 'Original synthetic ticket' }, artifacts: [{ kind: 'pdf', name: 'ticket.pdf', data: btoa('%PDF-1.7\nsynthetic fixture') }], coverageDates: ['2026-09-23'], quantity: 1, admission: 'ticket', lifecycle: 'active' };
const event = { id: 'event-a', title: 'Example evening', date: '2026-09-23', startTime: '19:00', endTime: '20:45', status: 'ready', checkedAt: '2026-09-23T23:00:00Z', sourceIds: ['source-a'], reason: '', classId: 'dance' };
const packet = (changes = {}) => ({ version: 1, revision: 100, checkedAt: '2026-09-24T01:00:00Z', windowStart: '2026-09-17', windowEnd: '2027-03-24', events: [event], sources: [source], invalidations: [], ...changes });
const app = calendarTickets => ({ version: 1, classes, calendarTickets });

test('calendar schema requires explicit admission, coverage, identity and complete checks for ready', () => {
  assert.ok(isCalendarTicketData(packet(), classes));
  for (const change of [{ orderId: null }, { quantity: null }, { quantity: 0 }, { admission: 'confirmation' }, { lifecycle: 'review' }, { lifecycle: 'cancelled' }, { artifacts: [] }, { coverageDates: [] }]) {
    assert.equal(isCalendarTicketData(packet({ sources: [{ ...source, ...change }] }), classes), false);
  }
  assert.equal(isCalendarTicketData(packet({ events: [{ ...event, checkedAt: null }] }), classes), false);
  assert.ok(isCalendarTicketData(packet({ events: [{ ...event, status: 'confirmation' }], sources: [{ ...source, orderId: null, quantity: null, admission: 'confirmation', artifacts: [], coverageDates: [] }] }), classes));
});

test('calendar schema rejects broken references, duplicates, impossible dates/times and unknown fields', () => {
  for (const change of [{ date: '2026-02-30' }, { date: '2027-04-01' }, { startTime: '25:00' }, { sourceIds: ['missing'] }, { sourceIds: ['source-a', 'source-a'] }, { classId: 'unknown' }, { checkedAt: '2026-09-23' }, { status: 'purchased' }, { url: 'https://example.com' }]) {
    assert.equal(isCalendarTicketData(packet({ events: [{ ...event, ...change }] }), classes), false);
  }
  assert.equal(isCalendarTicketData(packet({ sources: [source, source] }), classes), false);
  assert.equal(isCalendarTicketData(packet({ events: [event, event] }), classes), false);
  assert.equal(isCalendarTicketData(packet({ revision: 0 }), classes), false);
  assert.equal(isCalendarTicketData(packet({ windowEnd: '2026-09-17' }), classes), false);
  assert.equal(isCalendarTicketData(packet({ invalidations: [{ classId: 'dance', date: '2026-09-23', startTime: '29:00', reason: 'Removed' }] }), classes), false);
});

test('calendar event and tombstone override legacy ready through one resolver', () => {
  const legacy = { version: 1, checkedAt: '2026-09-24T01:00:00Z', bookings: [{ classId: 'dance', date: event.date, startTime: event.startTime, timeZone: 'America/Vancouver', status: 'purchased', sourceId: 'old', sender: source.sender, subject: source.subject, receivedAt: source.receivedAt, confirmationText: 'Confirmed', artifacts: source.artifacts }] };
  const occurrence = buildSchedule(classes, new Date(2026, 8, 23, 18)).occurrences[0];
  const data = { ...app(packet({ events: [{ ...event, status: 'review', reason: 'Session changed' }] })), tickets: legacy };
  assert.equal(effectiveBooking(data, occurrence).status, 'review');
  data.calendarTickets = packet({ events: [], invalidations: [{ classId: 'dance', date: event.date, startTime: event.startTime, reason: 'Removed' }] });
  assert.equal(effectiveBooking(data, occurrence).status, 'cancelled');
  assert.equal(effectiveBooking(data, occurrence).ready, false);
  data.calendarTickets = packet({ invalidations: [{ classId: 'dance', date: event.date, startTime: event.startTime, reason: 'Removed' }] });
  assert.equal(effectiveBooking(data, { event, item: { id: 'dance' } }).status, 'cancelled');
});

test('freshness is per event and actions cannot invent a missing original', () => {
  const occurrence = { event, item: { id: 'dance' } };
  const booking = effectiveBooking(app(packet()), occurrence);
  assert.equal(calendarLabel(booking, new Date('2026-09-24T00:00:00Z')), 'Ticket ready');
  assert.equal(calendarLabel(booking, new Date('2026-09-24T08:00:00Z')), 'Saved ticket · check for changes');
  assert.equal(calendarAction(booking), 'Show ticket');
  assert.equal(calendarAction({ ...booking, status: 'review', ready: false }), 'View original');
  assert.equal(calendarAction({ ...booking, records: [], status: 'missing' }), null);
});

test('future events navigate entire window without inventing recurring availability', () => {
  const distant = { ...event, id: 'future', date: '2027-02-13', classId: undefined, sourceIds: [], status: 'missing', checkedAt: null };
  delete distant.classId;
  const data = app(packet({ events: [distant], sources: [] }));
  const schedule = buildAppSchedule(data, new Date(2026, 8, 24, 12));
  assert.equal(schedule.occurrences.filter(o => !o.event).length, 2);
  assert.equal(schedule.occurrences.filter(o => o.event).length, 1);
  const future = schedule.occurrences.find(o => o.event);
  assert.ok(future.week > 10);
  assert.ok(schedule.maxWeek >= future.week);
  assert.equal(weekDays(schedule, future.week).flatMap(d => d.classes).length, 1);
});

test('calendar sources dedupe across days and suppress matching shortcut only', () => {
  const tomorrow = { ...event, id: 'day-2', date: '2026-09-24', status: 'confirmation' };
  const data = app(packet({ events: [event, tomorrow] }));
  assert.ok(isClassBookerData(data));
  assert.equal(buildAppSchedule(data, new Date(2026, 8, 23, 18)).occurrences.filter(o => o.date.getDate() === 23).length, 1);
  assert.equal(effectiveBooking(data, { event: tomorrow }).records[0], source);
});

test('combined UTF-8 budget rejects legacy plus calendar overflow; setup imports reject evidence', () => {
  const bigSources = Array.from({ length: 30 }, (_, i) => ({ ...source, sourceId: `s-${i}`, originalEmail: { format: 'text', body: '字'.repeat(39000) } }));
  const oversized = app(packet({ events: [], sources: bigSources }));
  assert.equal(isClassBookerData(oversized), false);
  const calendarTickets = packet({ events: [], sources: bigSources.slice(0, 29) });
  assert.ok(isClassBookerData(app(calendarTickets)));
  const legacy = { version: 1, checkedAt: packet().checkedAt, bookings: [{ classId: 'dance', date: event.date, startTime: event.startTime,
    timeZone: 'America/Vancouver', status: 'confirmed', sourceId: 'legacy', sender: source.sender, subject: source.subject,
    receivedAt: source.receivedAt, confirmationText: 'Confirmed', artifacts: [], originalEmail: { format: 'text', body: '字'.repeat(39000) } }] };
  assert.equal(isClassBookerData({ ...app(calendarTickets), tickets: legacy }), false);
  assert.equal(isShortcutImport(app(packet())), false);
  assert.equal(isShortcutImport({ version: 1, classes, tickets: {} }), false);
  assert.ok(isShortcutImport({ version: 1, classes }));
});
