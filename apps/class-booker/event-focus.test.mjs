import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAppSchedule, weekDays, visibleWeek } from './app.mjs';
import { effectiveBooking } from './calendar-tickets.mjs';

const classes = [{ id: 'weekly', chip: 'M', tag: 'Dance', venue: 'Example studio', when: 'Mondays 7-8 PM', action: 'Book class', url: 'https://example.com/' }];
const source = { sourceId: 'order-original', orderId: 'order-1', admission: 'confirmation', lifecycle: 'active', coverageDates: [], artifacts: [], checkedAt: '2026-09-25T20:00:00Z' };
const event = (date, changes = {}) => ({ id: `event-${date}`, title: 'Example retreat', date, startTime: '10:00', endTime: '18:00', status: 'confirmation', sourceIds: [source.sourceId], checkedAt: source.checkedAt, reason: '', ...changes });
const data = (events, sources = [source], invalidations = []) => ({ version: 1, classes, calendarTickets: { version: 1, revision: 10, windowStart: '2026-09-18', windowEnd: '2027-09-25', events, sources, invalidations } });
const at = (day, hour = 12) => new Date(2026, 8, day, hour);
const rows = schedule => schedule.occurrences.filter(o => o.event);

test('one consecutive retreat keeps its daily records and both purchases', () => {
  const second = { ...source, sourceId: 'second-original', orderId: 'order-2' };
  const days = [25, 26, 27].map(d => event(`2026-09-${d}`, { sourceIds: [source.sourceId, second.sourceId] }));
  const payload = data(days, [source, second]);
  const original = JSON.stringify(payload);
  const schedule = buildAppSchedule(payload, at(25, 20));
  assert.equal(rows(schedule).length, 1);
  const retreat = rows(schedule)[0];
  assert.deepEqual(retreat.events, days);
  assert.equal(retreat.rangeStart, '2026-09-25');
  assert.equal(retreat.rangeEnd, '2026-09-27');
  assert.equal(retreat.past, false);
  assert.deepEqual(effectiveBooking(payload, retreat).records, [source, second]);
  assert.equal(JSON.stringify(payload), original, 'grouping must not mutate cached source data');
  assert.equal(weekDays(schedule, 0).filter(d => d.classes.includes(retreat)).length, 3);
  assert.equal(rows(buildAppSchedule(payload, at(27, 19)))[0].past, true);
  assert.equal(visibleWeek(buildAppSchedule(payload, at(27, 19)), 0).filter(o => o.event).length, 0);
});

test('grouping never merges separate orders, separate classes, same-day sessions or nonconsecutive dates', () => {
  const other = { ...source, sourceId: 'different', orderId: 'order-2' };
  for (const events of [
    [event('2026-09-25'), event('2026-09-26', { sourceIds: ['different'] })],
    [event('2026-09-25', { classId: 'weekly' }), event('2026-09-26', { classId: 'weekly' })],
    [event('2026-09-25'), event('2026-09-25', { id: 'later-session', startTime: '19:00', endTime: '21:00' })],
    [event('2026-09-25'), event('2026-09-27')],
  ]) assert.equal(rows(buildAppSchedule(data(events, [source, other]), at(25))).length, 2);
  assert.equal(rows(buildAppSchedule(data([event('2026-09-25'), event('2026-09-26')], [{ ...source, orderId: null }]), at(25))).length, 2);
});

test('an overnight event stays active after midnight until its actual end', () => {
  const payload = data([event('2026-09-25', { startTime: '22:00', endTime: '02:00' })]);
  const active = buildAppSchedule(payload, at(26, 1));
  assert.equal(rows(active)[0].past, false);
  assert.ok(weekDays(active, 0).find(d => d.date.getDate() === 26).classes.includes(rows(active)[0]));
  assert.equal(rows(buildAppSchedule(payload, at(26, 2)))[0].past, true);
});

test('finished rows are absent from day selectors; future cancellation warnings remain', () => {
  const payload = data([event('2026-09-23'), event('2026-09-25', { status: 'cancelled' }), event('2026-09-26')]);
  const schedule = buildAppSchedule(payload, at(25));
  assert.equal(schedule.minWeek, 0);
  assert.equal(schedule.firstDate, '2026-09-25');
  assert.equal(weekDays(schedule, 0).flatMap(d => d.classes).filter(o => o.event).length, 2);
});

test('all-day entries stay through today; crossing a week retains an ongoing retreat', () => {
  assert.equal(rows(buildAppSchedule(data([event('2026-09-25', { startTime: null, endTime: null })]), at(25, 23)))[0].past, false);
  assert.equal(rows(buildAppSchedule(data([event('2026-09-25', { startTime: null, endTime: null })]), at(26)))[0].past, true);
  const payload = data([27, 28, 29].map(d => event(`2026-09-${d}`)));
  const schedule = buildAppSchedule(payload, at(28));
  assert.equal(rows(schedule).length, 1);
  assert.equal(rows(schedule)[0].week, 0);
  assert.equal(weekDays(schedule, 0).flatMap(d => d.classes).filter(o => o.events).length, 2);
});

test('mixed day status cannot promote a grouped booking to ready', () => {
  const ticket = { ...source, admission: 'ticket', coverageDates: ['2026-09-25', '2026-09-26'], quantity: 1 };
  const payload = data([event('2026-09-25', { status: 'ready' }), event('2026-09-26', { status: 'cancelled', reason: 'Second day cancelled' })], [ticket]);
  const grouped = rows(buildAppSchedule(payload, at(25)))[0];
  const booking = effectiveBooking(payload, grouped);
  assert.equal(booking.status, 'review');
  assert.equal(booking.ready, false);
  assert.match(booking.reason, /cancelled/i);
  assert.deepEqual(booking.records, [ticket]);
});

test('a multi-day event ends only when all daily sessions have ended', () => {
  const payload = data([event('2026-09-25', { startTime: '22:00', endTime: '03:00' }),
    event('2026-09-26', { startTime: '00:00', endTime: '01:00' })]);
  assert.equal(rows(buildAppSchedule(payload, at(26, 2)))[0].past, false);
  assert.equal(rows(buildAppSchedule(payload, at(26, 3)))[0].past, true);
});

test('day-specific credentials cannot become an undifferentiated multi-day wallet', () => {
  const oneDay = { ...source, coverageDates: ['2026-09-25'] };
  const payload = data([event('2026-09-25'), event('2026-09-26')], [oneDay]);
  assert.equal(rows(buildAppSchedule(payload, at(25))).length, 2);
});

test('the final overnight session of a grouped event remains on next week’s day selector', () => {
  const payload = data([event('2026-09-26'), event('2026-09-27', { startTime: '22:00', endTime: '02:00' })]);
  const schedule = buildAppSchedule(payload, at(28, 1));
  assert.equal(visibleWeek(schedule, 0).filter(o => o.events).length, 1);
  assert.equal(weekDays(schedule, 0)[0].classes.filter(o => o.events).length, 1);
});
