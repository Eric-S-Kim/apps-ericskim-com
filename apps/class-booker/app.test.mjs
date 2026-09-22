import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeDataPayload, isClassBookerData, parseWeekday, planClasses, safeHttpsUrl, splitWhen, weekStrip,
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
  assert.equal(parseWeekday('Check the schedule'), null);
  assert.equal(parseWeekday('Monthly jam'), null);
  assert.equal(parseWeekday('Saturated colour class'), null);
  assert.equal(parseWeekday('Tues 6 PM'), 2);
});

test('splits the time from the note', () => {
  assert.deepEqual(splitWhen('Wednesdays 7-8:45 PM · 2 tickets'), { time: '7-8:45 PM', note: '2 tickets' });
  assert.deepEqual(splitWhen('Check the schedule'), { time: 'Check the schedule', note: '' });
});

const week = [
  { ...valid.classes[0], id: 'wed', when: 'Wednesdays 7-8:45 PM · 2 tickets' },
  { ...valid.classes[0], id: 'mon', when: 'Mondays 7-8:30 PM · 2 tickets' },
  { ...valid.classes[0], id: 'thu', when: 'Thursdays 6-7:15 PM · $25 drop-in' },
];

test('picks the soonest class as next up and keeps saved order for the rest', () => {
  const tuesday = new Date(2026, 8, 22, 12);
  const { next, rest } = planClasses(week, tuesday);
  assert.equal(next.item.id, 'wed');
  assert.equal(next.daysUntil, 1);
  assert.deepEqual(rest.map((entry) => entry.item.id), ['mon', 'thu']);
  assert.equal(rest[0].date.getDate(), 28);
});

test('a class today is next up', () => {
  const monday = new Date(2026, 8, 21, 9);
  assert.equal(planClasses(week, monday).next.item.id, 'mon');
  assert.equal(planClasses(week, monday).next.daysUntil, 0);
});

test('falls back to the first saved class when no weekday is readable', () => {
  const { next, rest } = planClasses([valid.classes[0]], new Date(2026, 8, 22));
  assert.equal(next.item.id, 'example');
  assert.equal(next.date, null);
  assert.equal(rest.length, 0);
});

test('week strip runs Monday to Sunday and marks class days', () => {
  const days = weekStrip(week, new Date(2026, 8, 22));
  assert.deepEqual(days.map((day) => day.date.getDate()), [21, 22, 23, 24, 25, 26, 27]);
  assert.deepEqual(days.map((day) => day.hasClass), [true, false, true, true, false, false, false]);
  assert.equal(days.findIndex((day) => day.isToday), 1);
});
