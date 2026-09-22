import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSchedule, dayLabel, pruneBooked, decodeDataPayload, isClassBookerData, nextOccurrence, parseTimes, parseWeekday,
  safeHttpsUrl, splitWhen, weekDays,
} from './app.mjs';

const valid = {
  version: 1,
  classes: [{
    id: 'example',
    chip: 'M',
    tag: 'Movement',
    venue: 'Example Studio',
    when: 'Check the schedule',
    action: 'Open booking',
    url: 'https://example.com/book',
  }],
};

test('accepts a valid private class payload', () => {
  assert.equal(isClassBookerData(valid), true);
});

test('rejects unsafe URLs and duplicate ids', () => {
  assert.equal(isClassBookerData({ ...valid, classes: [{ ...valid.classes[0], url: 'javascript:alert(1)' }] }), false);
  assert.equal(isClassBookerData({ ...valid, classes: [valid.classes[0], valid.classes[0]] }), false);
  assert.equal(safeHttpsUrl('http://example.com'), null);
});

test('rejects empty and oversized payloads', () => {
  assert.equal(isClassBookerData({ version: 1, classes: [] }), false);
  assert.equal(isClassBookerData({ version: 1, classes: Array.from({ length: 26 }, (_, index) => ({ ...valid.classes[0], id: String(index) })) }), false);
});

test('decodes base64url setup data', () => {
  const encoded = Buffer.from(JSON.stringify(valid)).toString('base64url');
  assert.deepEqual(decodeDataPayload(encoded), valid);
});

test('reads the weekday that leads the when text', () => {
  assert.equal(parseWeekday('Wednesdays 7-8:45 PM · 2 tickets'), 3);
  assert.equal(parseWeekday('Thu 6-7:15 PM · $25 drop-in'), 4);
  assert.equal(parseWeekday('Tues 6 PM'), 2);
  assert.equal(parseWeekday('Check the schedule'), null);
  assert.equal(parseWeekday('Monthly jam'), null);
  assert.equal(parseWeekday('Saturated colour class'), null);
});

test('splits the time from the note', () => {
  assert.deepEqual(splitWhen('Wednesdays 7-8:45 PM · 2 tickets'), { time: '7-8:45 PM', note: '2 tickets' });
  assert.deepEqual(splitWhen('Check the schedule'), { time: 'Check the schedule', note: '' });
});

test('reads class start and end times', () => {
  assert.deepEqual(parseTimes('Wednesdays 7-8:45 PM · 2 tickets'), { start: 19 * 60, end: 20 * 60 + 45 });
  assert.deepEqual(parseTimes('Sat 11-12:30 PM'), { start: 11 * 60, end: 12 * 60 + 30 });
  assert.deepEqual(parseTimes('Sun 10:15am–11:30am'), { start: 10 * 60 + 15, end: 11 * 60 + 30 });
  assert.deepEqual(parseTimes('Fri 10 PM-12 AM'), { start: 22 * 60, end: 24 * 60 });
  assert.deepEqual(parseTimes('Tues 6 PM · $20'), { start: 18 * 60, end: 20 * 60 });
  assert.equal(parseTimes('Thursdays · $25 drop-in'), null);
});

const week = [
  { ...valid.classes[0], id: 'wed', venue: 'Harbour', when: 'Wednesdays 7-8:45 PM · 2 tickets' },
  { ...valid.classes[0], id: 'mon', venue: 'Kin', when: 'Mondays 7-8:30 PM · 2 tickets' },
  { ...valid.classes[0], id: 'thu', venue: 'Northside', when: 'Thursdays 6-7:15 PM · $25 drop-in' },
];
const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute); // September 2026; the 21st is a Monday

test('next up is the soonest class that has not ended', () => {
  assert.equal(nextOccurrence(buildSchedule(week, at(22, 12))).key, 'wed@2026-09-23');
  assert.equal(nextOccurrence(buildSchedule(week, at(23, 18))).key, 'wed@2026-09-23'); // before it starts: today
  assert.equal(nextOccurrence(buildSchedule(week, at(23, 22, 30))).key, 'thu@2026-09-24'); // after it ends: rolls on
  assert.equal(nextOccurrence(buildSchedule(week, at(27, 12))).key, 'mon@2026-09-28'); // Sunday: next week's Monday
});

test('occurrences run in date order and mark each class\'s real next date', () => {
  const schedule = buildSchedule(week, at(22, 12));
  const upcoming = schedule.occurrences.filter((occurrence) => !occurrence.past);
  assert.deepEqual(upcoming.map((occurrence) => occurrence.key),
    ['wed@2026-09-23', 'thu@2026-09-24', 'mon@2026-09-28', 'wed@2026-09-30', 'thu@2026-10-01']);
  assert.deepEqual(upcoming.filter((occurrence) => occurrence.soonest).map((occurrence) => occurrence.item.id), ['wed', 'thu', 'mon']);
  assert.equal(schedule.occurrences.find((occurrence) => occurrence.key === 'mon@2026-09-21').past, true);
});

test('two classes on one day order by start time', () => {
  const sameDay = [...week, { ...valid.classes[0], id: 'yoga', when: 'Wed 5:30-6:30 PM' }];
  const upcoming = buildSchedule(sameDay, at(22, 12)).occurrences.filter((occurrence) => !occurrence.past);
  assert.deepEqual(upcoming.slice(0, 2).map((occurrence) => occurrence.item.id), ['yoga', 'wed']);
});

test('undated classes are kept apart from the calendar', () => {
  const schedule = buildSchedule([...week, valid.classes[0]], at(22, 12));
  assert.deepEqual(schedule.undated.map(({ item }) => item.id), ['example']);
  assert.equal(schedule.occurrences.some((occurrence) => occurrence.item.id === 'example'), false);
});

test('week days mark today, past days and bookable days', () => {
  const schedule = buildSchedule(week, at(22, 12));
  const thisWeek = weekDays(schedule, 0);
  assert.deepEqual(thisWeek.map((day) => day.date.getDate()), [21, 22, 23, 24, 25, 26, 27]);
  assert.deepEqual(thisWeek.map((day) => day.classes.length), [0, 0, 1, 1, 0, 0, 0]); // Monday's class is over
  assert.deepEqual(thisWeek.map((day) => day.isPast), [true, false, false, false, false, false, false]);
  assert.equal(thisWeek.findIndex((day) => day.isToday), 1);
  assert.deepEqual(weekDays(schedule, 1).map((day) => day.classes.length), [1, 0, 1, 1, 0, 0, 0]);
});

test('day labels never repeat the weekday', () => {
  const today = at(22, 12);
  assert.equal(dayLabel(at(22, 0), today), 'Today');
  assert.equal(dayLabel(at(23, 0), today), 'Tomorrow');
  assert.equal(dayLabel(at(24, 0), today), 'Thursday');
  assert.equal(dayLabel(at(30, 0), today), 'Next Wednesday');
});

test('booked marks drop past dates and junk', () => {
  const kept = pruneBooked(['wed@2026-09-23', 'mon@2026-09-21', 'thu@2026-09-22', 'nonsense', 42], at(22, 12));
  assert.deepEqual(kept, ['wed@2026-09-23', 'thu@2026-09-22']);
});
