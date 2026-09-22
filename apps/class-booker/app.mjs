export const STORAGE_KEY = 'class-booker-data-v1';

const TEXT_LIMITS = {
  id: 80,
  chip: 4,
  tag: 40,
  venue: 100,
  when: 140,
  action: 40,
};

export function safeHttpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function validText(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

export function isClassBookerData(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.classes)) return false;
  if (value.classes.length < 1 || value.classes.length > 25) return false;

  const ids = new Set();
  return value.classes.every((item) => {
    if (!item || typeof item !== 'object') return false;
    if (!Object.entries(TEXT_LIMITS).every(([field, max]) => validText(item[field], max))) return false;
    if (!safeHttpsUrl(item.url) || ids.has(item.id)) return false;
    ids.add(item.id);
    return true;
  });
}

export function decodeDataPayload(encoded) {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function maybeImportFromHash() {
  const match = location.hash.match(/^#data=([^&]+)$/);
  if (!match) return;

  try {
    const data = decodeDataPayload(match[1]);
    if (!isClassBookerData(data)) throw new Error('invalid class data');
    if (confirm(`Load ${data.classes.length} private class shortcuts onto this device?`)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  } catch (error) {
    console.warn('Class shortcut import failed:', error);
  } finally {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

function readStoredData() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return isClassBookerData(data) ? data : null;
  } catch {
    return null;
  }
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Wednesdays 7-8:45 PM · 2 tickets" -> 3 (Date#getDay numbering); null when the text doesn't lead with a weekday.
export function parseWeekday(when) {
  const match = /^\s*(sun(?:days?)?|mon(?:days?)?|tue(?:s|sdays?)?|wed(?:s|nesdays?)?|thu(?:rs?|rsdays?)?|fri(?:days?)?|sat(?:urdays?)?)\.?(?=[\s,]|$)/i
    .exec(when || '');
  return match ? WEEKDAYS.indexOf(match[1].slice(0, 3).toLowerCase()) : null;
}

export function splitWhen(when) {
  const [first, ...rest] = when.split(/\s+·\s+/);
  const time = parseWeekday(when) === null ? first : first.replace(/^\s*[A-Za-z]+\.?,?\s*/, '');
  return { time: time.trim(), note: rest.join(' · ') };
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// Next-up = the soonest weekly class from today (today counts); ties and unparsed entries keep the saved order.
export function planClasses(classes, now = new Date()) {
  const today = startOfDay(now);
  const planned = classes.map((item, order) => {
    const weekday = parseWeekday(item.when);
    if (weekday === null) return { item, order, weekday, daysUntil: null, date: null };
    const daysUntil = (weekday - today.getDay() + 7) % 7;
    return { item, order, weekday, daysUntil, date: addDays(today, daysUntil) };
  });
  const dated = planned.filter((entry) => entry.daysUntil !== null);
  const next = dated.length
    ? dated.reduce((best, entry) => (entry.daysUntil < best.daysUntil ? entry : best))
    : planned[0];
  return { next, rest: planned.filter((entry) => entry !== next) };
}

// Monday-first week containing today, with the weekdays that hold a class marked.
export function weekStrip(classes, now = new Date()) {
  const today = startOfDay(now);
  const todayIndex = (today.getDay() + 6) % 7;
  const monday = addDays(today, -todayIndex);
  const classDays = new Set(classes.map((item) => parseWeekday(item.when)).filter((day) => day !== null));
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index);
    return { date, isToday: index === todayIndex, hasClass: classDays.has(date.getDay()) };
  });
}

function relativeLabel(daysUntil, weekday) {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return DAY_FULL[weekday];
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function arrowIcon(diagonal) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', diagonal ? 'M5 15 L15 5 M7 5 H15 V13' : 'M3 10 H16 M11 5 L16 10 L11 15');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function bookingLink(item, className) {
  const link = element('a', className);
  link.href = safeHttpsUrl(item.url);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function metaLine(item) {
  const { time, note } = splitWhen(item.when);
  return [item.tag, time, note].filter(Boolean).join(' · ');
}

function renderHero({ item, daysUntil, weekday, date }) {
  const hero = bookingLink(item, 'hero');
  const kicker = element('div', 'kicker');
  kicker.append(element('span', '', date
    ? `${relativeLabel(daysUntil, weekday)} · ${DAY_ABBR[weekday]} ${date.getDate()}`
    : item.tag));
  kicker.append(element('span', '', item.chip));

  const body = element('div', 'hero-body');
  body.append(element('h2', 'hero-venue', item.venue));
  body.append(element('div', 'hero-meta', metaLine(item)));

  const go = element('span', 'hero-go', item.action);
  go.append(arrowIcon(false));
  hero.append(kicker, body, go);
  return hero;
}

function renderRow({ item, weekday, date }) {
  const row = bookingLink(item, 'row');
  const when = element('div', 'row-when');
  when.append(element('span', 'row-day', date ? DAY_ABBR[weekday] : item.chip));
  if (date) when.append(element('span', 'row-date', String(date.getDate())));

  const main = element('div', 'row-main');
  main.append(element('div', 'row-venue', item.venue));
  main.append(element('div', 'row-meta', metaLine(item)));

  const go = element('span', 'row-go');
  go.append(arrowIcon(true));
  row.append(when, main, go);
  return row;
}

function renderWeek(classes, now) {
  const days = weekStrip(classes, now);
  const first = days[0].date;
  const last = days[6].date;
  const range = first.getMonth() === last.getMonth()
    ? `${MONTHS[first.getMonth()]} ${first.getDate()}–${last.getDate()}`
    : `${MONTHS[first.getMonth()]} ${first.getDate()}–${MONTHS[last.getMonth()]} ${last.getDate()}`;

  const head = element('div', 'week-head');
  head.append(element('h2', 'label', 'This week'), element('span', 'label', range));
  const strip = element('div', 'days');
  days.forEach(({ date, isToday, hasClass }) => {
    const day = element('div', `day${isToday ? ' today' : ''}${hasClass ? ' has' : ''}`);
    day.append(element('span', 'day-name', DAY_ABBR[date.getDay()][0]));
    day.append(element('span', 'day-num', String(date.getDate())));
    day.append(element('span', 'day-dot'));
    strip.append(day);
  });
  return [head, strip];
}

function render(data, now = new Date()) {
  const hero = document.getElementById('hero');
  const week = document.getElementById('week');
  const later = document.getElementById('later');
  const rows = document.getElementById('rows');
  const empty = document.getElementById('empty');
  document.getElementById('title').hidden = !data;
  hero.hidden = !data;
  hero.replaceChildren();
  week.replaceChildren();
  rows.replaceChildren();

  if (!data) {
    empty.hidden = false;
    week.hidden = true;
    later.hidden = true;
    return;
  }

  empty.hidden = true;
  const { next, rest } = planClasses(data.classes, now);
  hero.append(renderHero(next));

  const hasWeekdays = data.classes.some((item) => parseWeekday(item.when) !== null);
  week.hidden = !hasWeekdays;
  if (hasWeekdays) week.append(...renderWeek(data.classes, now));

  later.hidden = rest.length === 0;
  rest.forEach((entry) => rows.append(renderRow(entry)));
}

export async function main() {
  await maybeImportFromHash();
  render(readStoredData());
}

if (typeof document !== 'undefined') {
  const start = () => main().catch((error) => {
    console.error('Class Booker failed to start:', error);
    document.getElementById('empty').hidden = false;
  });
  start();
  window.addEventListener('hashchange', start);
}
