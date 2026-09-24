import test from 'node:test';
import assert from 'node:assert/strict';
import { isTicketData, bookingFor, validPdf, venueNow, freshTicketData } from './tickets.mjs';
import { isClassBookerData, buildSchedule } from './app.mjs';
const classes = [{ id: 'dance', chip: 'WED', tag: 'Dance', venue: 'Example studio', when: 'Wednesdays 7-8:45 PM', action: 'Book class', url: 'https://example.com/' }];
const b = { classId: 'dance', date: '2026-09-23', startTime: '19:00', timeZone: 'America/Vancouver', status: 'confirmed', sourceId: 'sample-1', sender: 'Studio <studio@example.com>', subject: 'Registration confirmed', receivedAt: '2026-09-22T01:00:00Z', confirmationText: 'Your registration is confirmed.', artifacts: [] };
const packet = rows => ({ version: 1, checkedAt: '2026-09-24T01:00:00Z', bookings: rows });
const occurrence = buildSchedule(classes, new Date(2026, 8, 23, 18)).occurrences[0];

test('confirmation is not a ready gate ticket', () => {
  const data = packet([b]);
  assert.ok(isTicketData(data, classes));
  assert.equal(bookingFor(data, occurrence).ready, false);
  assert.equal(bookingFor(data, occurrence).status, 'confirmed');
});
test('only exact class/date/time matches; previous week never transfers', () => {
  for (const change of [{ classId: 'other' }, { date: '2026-09-16' }, { startTime: '18:00' }]) {
    assert.equal(bookingFor(packet([{ ...b, ...change }]), occurrence), null);
  }
});
test('calendar, HTML and corrupt PDF data cannot become a ticket', () => {
  for (const a of [{ kind: 'calendar', name: 'cal.ics', data: btoa('BEGIN:VCALENDAR') },
    { kind: 'pdf', name: 'x.pdf', data: btoa('<script>bad</script>') },
    { kind: 'pdf', name: 'x.pdf', data: '%not-base64' }]) {
    assert.equal(validPdf(a), false);
    assert.equal(isTicketData(packet([{ ...b, artifacts: [a] }]), classes), false);
  }
});
test('real PDF bytes enable entry; repeated copies dedupe but distinct files remain', () => {
  const a = { kind: 'pdf', name: 'Ticket.pdf', data: btoa('%PDF-1.7\nsynthetic fixture') };
  const other = { ...a, data: btoa('%PDF-1.7\nsecond synthetic fixture') };
  const data = packet([{ ...b, artifacts: [a] }, { ...b, sourceId: 'sample-2', artifacts: [a, other] }]);
  assert.ok(isTicketData(data, classes));
  const out = bookingFor(data, occurrence);
  assert.ok(out.ready); assert.equal(out.artifacts.length, 2);
});
test('cancellation overrides old confirmation; only a newer booking restores it', () => {
  const cancelled = { ...b, status: 'cancelled', sourceId: 'cancel-1', receivedAt: '2026-09-23T02:00:00Z' };
  assert.equal(bookingFor(packet([b, cancelled]), occurrence).status, 'cancelled');
  const newer = { ...b, sourceId: 'new-1', receivedAt: '2026-09-23T03:00:00Z' };
  assert.equal(bookingFor(packet([b, cancelled, newer]), occurrence).records.length, 1);
});
test('malformed dates, duplicates, foreign classes and excessive data fail closed without throwing', () => {
  for (const change of [{ date: '2026-99-01' }, { date: '2026-02-30' }, { classId: 'foreign' }, { startTime: '29:00' },
    { status: 'maybe' }, { timeZone: 'UTC' }, { confirmationText: '' }, { receivedAt: 'invalid' }]) {
    assert.equal(isTicketData(packet([{ ...b, ...change }]), classes), false);
  }
  assert.equal(isTicketData(packet([b, b]), classes), false);
  assert.equal(isClassBookerData({ version: 1, classes: [null], tickets: packet([b]) }), false);
});
test('venue day remains Vancouver while the device may be traveling', () => {
  const date = venueNow(new Date('2026-09-24T01:00:00Z'));
  assert.equal(date.getDate(), 23); assert.equal(date.getHours(), 18);
});
test('stale or future evidence cannot advertise a freshly ready ticket', () => {
  assert.equal(freshTicketData(packet([]), new Date('2026-09-24T02:00:00Z')), true);
  assert.equal(freshTicketData(packet([]), new Date('2026-09-24T08:00:00Z')), false);
  assert.equal(freshTicketData(packet([]), new Date('2026-09-23T01:00:00Z')), false);
});
