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

// A #data= setup link is validated and held until the owner taps Load in the page's own panel. It used to
// ask with window.confirm(), which Chrome can silently answer "Cancel" in a just-opened in-app browser
// (Gmail's), so imports failed with no sign on screen.
function takeImportFromHash() {
  const match = location.hash.match(/^#data=([^&]+)$/);
  if (!match) return null;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const data = decodeDataPayload(match[1]);
    if (!isClassBookerData(data)) throw new Error('invalid class data');
    return data;
  } catch (error) {
    console.warn('Class shortcut import failed:', error);
    return null;
  }
}

// Remote config (2026-09-22): the private class list is fetched on open from the owner's config service,
// so updates need no link or tap. The service URL and read key live only in this device's localStorage
// (installed once), never in this public repo. No key, offline, slow or invalid answer: keep the stored list.
export const REMOTE_KEY = 'ericsapps-remote-config-v1';
const REMOTE_NAME = 'class-booker';
const REMOTE_TIMEOUT_MS = 5000;

export function readRemoteSettings(raw) {
  try {
    const value = JSON.parse(raw || 'null');
    const base = value && safeHttpsUrl(value.url);
    if (!base || typeof value.key !== 'string' || value.key.length < 32) return null;
    return { base: base.endsWith('/') ? base : `${base}/`, key: value.key };
  } catch {
    return null;
  }
}

async function fetchRemoteData() {
  let settings = null;
  try { settings = readRemoteSettings(localStorage.getItem(REMOTE_KEY)); } catch { /* storage blocked */ }
  if (!settings || typeof fetch !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const response = await fetch(`${settings.base}v1/${REMOTE_NAME}`, {
      headers: { Authorization: `Bearer ${settings.key}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    return isClassBookerData(data) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let remoteInFlight = null;
function syncRemote() {
  if (remoteInFlight) return remoteInFlight;
  remoteInFlight = fetchRemoteData().then((data) => {
    if (!data || view.pending) return;
    const next = JSON.stringify(data);
    if (next === JSON.stringify(view.data)) return;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* still show it this session */ }
    Object.assign(view, { data, key: null, week: null });
    render();
  }).finally(() => { remoteInFlight = null; });
  return remoteInFlight;
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
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKS_AHEAD = 1; // this week + next week; studios rarely open booking further out
const DEFAULT_CLASS_MINUTES = 120;
const DAY_MS = 86400000;

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

const RANGE = /(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?m\.?)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i;
const SINGLE = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i;

function toMinutes(hour, minute, meridiem) {
  return (Number(hour) % 12 + (meridiem.toLowerCase() === 'p' ? 12 : 0)) * 60 + Number(minute || 0);
}

// "7-8:45 PM" -> { start: 1140, end: 1245 } (minutes after midnight); a lone "7 PM" gets a 2-hour class; null if no clock time.
export function parseTimes(text) {
  const range = RANGE.exec(text || '');
  if (range) {
    const endMeridiem = range[6];
    let startMeridiem = range[3];
    if (!startMeridiem) {
      const flips = Number(range[1]) % 12 > Number(range[4]) % 12; // "11-12:30 PM" starts in the morning
      startMeridiem = flips ? (endMeridiem.toLowerCase() === 'p' ? 'a' : 'p') : endMeridiem;
    }
    const start = toMinutes(range[1], range[2], startMeridiem);
    let end = toMinutes(range[4], range[5], endMeridiem);
    if (end <= start) end += 24 * 60;
    return { start, end };
  }
  const single = SINGLE.exec(text || '');
  if (!single) return null;
  const start = toMinutes(single[1], single[2], single[3]);
  return { start, end: start + DEFAULT_CLASS_MINUTES };
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Every dated class occurrence from this Monday through the end of next week, in time order. A class is
// "past" once its day is gone or today's end time has passed; "soonest" marks each class's next real date.
export function buildSchedule(classes, now = new Date(), weeksAhead = WEEKS_AHEAD) {
  const today = startOfDay(now);
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const occurrences = [];
  const undated = [];

  classes.forEach((item, order) => {
    const weekday = parseWeekday(item.when);
    if (weekday === null) {
      undated.push({ item, order });
      return;
    }
    const times = parseTimes(item.when);
    for (let week = 0; week <= weeksAhead; week += 1) {
      const date = addDays(monday, week * 7 + (weekday + 6) % 7);
      const dayDiff = Math.round((date - today) / DAY_MS);
      const past = dayDiff < 0 || (dayDiff === 0 && times !== null && nowMinutes >= times.end);
      occurrences.push({ key: `${item.id}@${dateKey(date)}`, item, order, date, week, weekday, dayDiff, times, past });
    }
  });

  occurrences.sort((a, b) => a.date - b.date
    || (a.times ? a.times.start : 0) - (b.times ? b.times.start : 0)
    || a.order - b.order);
  const seen = new Set();
  occurrences.forEach((occurrence) => {
    occurrence.soonest = !occurrence.past && !seen.has(occurrence.item.id);
    if (occurrence.soonest) seen.add(occurrence.item.id);
  });
  return { occurrences, undated, monday, today };
}

// A shortcut URL may carry a {date} placeholder (raw or percent-encoded) where the studio's page accepts a
// class date, e.g. ".../free-movement-studio#123456-{date}". It is filled with the chosen class's YYYY-MM-DD;
// with no date the placeholder is dropped, and the studio page falls back to its own default.
const DATE_TOKEN = /\{date\}|%7Bdate%7D/gi;

export function hasDateSlot(url) {
  return typeof url === 'string' && /\{date\}|%7Bdate%7D/i.test(url);
}

export function bookingUrl(url, date) {
  const safe = safeHttpsUrl(url);
  if (!safe) return null;
  return safe.replace(DATE_TOKEN, date ? dateKey(date) : '');
}

export function nextOccurrence(schedule) {
  return schedule.occurrences.find((occurrence) => !occurrence.past) || null;
}

export function weekDays(schedule, week) {
  const start = addDays(schedule.monday, week * 7);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const key = dateKey(date);
    const classes = schedule.occurrences.filter((occurrence) => !occurrence.past && dateKey(occurrence.date) === key);
    return { date, classes, isToday: key === dateKey(schedule.today), isPast: date < schedule.today };
  });
}

export function dayLabel(date, today) {
  const diff = Math.round((startOfDay(date) - startOfDay(today)) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff >= 2 && diff <= 6) return DAY_FULL[date.getDay()];
  if (diff >= 7 && diff <= 13) return `Next ${DAY_FULL[date.getDay()]}`;
  return `${DAY_ABBR[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

// ---------- view ----------
// Selection lives in memory only (the URL hash is reserved for the #data= setup import).
const view = { data: null, key: null, week: null, signature: '', pending: null, importError: false };

// "7-8:45 PM" -> "7–8:45 PM" for display only.
function prettyTime(time) {
  return time.replace(/(\d)\s*-\s*(\d)/g, '$1–$2');
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(kind) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', {
    arrow: 'M3 10 H16 M11 5 L16 10 L11 15',
    out: 'M5 15 L15 5 M7 5 H15 V13',
    prev: 'M12 4 L6 10 L12 16',
    next: 'M8 4 L14 10 L8 16',
  }[kind]);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function studioLink(item, className, label, date = null) {
  const link = element('a', className);
  link.href = bookingUrl(item.url, date);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${label} (opens the studio site)`);
  return link;
}

function spokenDate(date) {
  return `${DAY_FULL[date.getDay()]} ${MONTHS_FULL[date.getMonth()]} ${date.getDate()}`;
}

function renderCard(occurrence) {
  const { item, date, soonest } = occurrence;
  const { time, note } = splitWhen(item.when);
  const card = element('div', 'hero');
  // Headline carries the relative day ("Tomorrow"); the kicker carries the calendar date and time.
  card.append(element('div', 'kicker', `${DAY_ABBR[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()} · ${prettyTime(time)}`));
  const body = element('div', 'hero-body');
  body.append(element('h2', 'hero-venue', item.venue));
  // The title carries the class type now (Eric 2026-09-22: 'cleaner'); only a shortcut's own note shows below it.
  if (note) body.append(element('div', 'hero-meta', note));

  // The studio link can't pre-select a date, so a later date says what to pick instead of promising a booking.
  const direct = soonest || hasDateSlot(item.url);
  const label = direct ? item.action : `Open schedule · pick ${DAY_ABBR[date.getDay()]} ${date.getDate()}`;
  const go = studioLink(item, 'hero-go', `${label}, ${item.venue}, ${spokenDate(date)}`, date);
  go.append(element('span', '', label), icon(direct ? 'arrow' : 'out'));
  card.append(body, go);
  return card;
}

function renderUndatedCard(item) {
  const card = element('div', 'hero');
  card.append(element('div', 'kicker', item.tag));
  const body = element('div', 'hero-body');
  body.append(element('h2', 'hero-venue', item.venue));
  body.append(element('div', 'hero-meta', item.when));
  const go = studioLink(item, 'hero-go', `${item.action}, ${item.venue}`);
  go.append(element('span', '', item.action), icon('arrow'));
  card.append(body, go);
  return card;
}

function renderRestCard(week) {
  const card = element('div', 'hero quiet');
  const body = element('div', 'hero-body');
  body.append(element('h2', 'hero-venue', 'Nothing left this week'));
  card.append(body);
  if (week < WEEKS_AHEAD) {
    const next = element('button', 'hero-go');
    next.type = 'button';
    next.append(element('span', '', 'See next week'), icon('arrow'));
    next.addEventListener('click', () => goToWeek(week + 1));
    card.append(next);
  }
  return card;
}

function renderWeek(schedule, week, selected) {
  const days = weekDays(schedule, week);
  const first = days[0].date;
  const last = days[6].date;
  const range = first.getMonth() === last.getMonth()
    ? `${MONTHS[first.getMonth()]} ${first.getDate()}–${last.getDate()}`
    : `${MONTHS[first.getMonth()]} ${first.getDate()} – ${MONTHS[last.getMonth()]} ${last.getDate()}`;

  const head = element('div', 'week-head');
  const title = element('div', 'week-title');
  title.append(element('h2', 'label strong', week === 0 ? 'This week' : 'Next week'), element('span', 'label', range));
  const nav = element('div', 'week-nav');
  [['prev', week - 1, 'Previous week'], ['next', week + 1, 'Next week']].forEach(([kind, target, label]) => {
    const button = element('button', 'nav-btn');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.disabled = target < 0 || target > WEEKS_AHEAD;
    button.append(icon(kind));
    button.addEventListener('click', () => goToWeek(target));
    nav.append(button);
  });
  head.append(title, nav);

  const strip = element('div', 'days');
  days.forEach(({ date, classes, isToday, isPast }) => {
    const bookable = classes.length > 0;
    const isSelected = bookable && selected && classes.some((occurrence) => occurrence.key === selected.key);
    const state = `${isToday ? ' today' : ''}${isPast ? ' past' : ''}${bookable ? ' has' : ''}${isSelected ? ' selected' : ''}`;
    const day = element(bookable ? 'button' : 'div', `day${state}`);
    if (bookable) {
      day.type = 'button';
      day.setAttribute('aria-pressed', String(Boolean(isSelected)));
      day.setAttribute('aria-label', `${spokenDate(date)}${isToday ? ', today' : ''}: ${classes.map((c) => c.item.venue).join(', ')}`);
      day.addEventListener('click', () => select(classes[0]));
    } else {
      day.setAttribute('aria-hidden', 'true');
    }
    day.append(element('span', 'day-name', DAY_ABBR[date.getDay()][0]));
    day.append(element('span', 'day-num', String(date.getDate())));
    day.append(element('span', 'day-dot'));
    strip.append(day);
  });
  return [head, strip];
}

function renderRow(occurrence, isCurrent) {
  const { item, date } = occurrence;
  const { time } = splitWhen(item.when);
  const row = element('div', `row${isCurrent ? ' current' : ''}`);
  const pick = element('button', 'row-select');
  pick.type = 'button';
  pick.setAttribute('aria-label', `Show ${item.venue}, ${spokenDate(date)}`);
  if (isCurrent) pick.setAttribute('aria-current', 'true');
  const when = element('span', 'row-when');
  when.append(element('span', 'row-day', DAY_ABBR[date.getDay()]), element('span', 'row-date', String(date.getDate())));
  const main = element('span', 'row-main');
  main.append(element('span', 'row-venue', item.venue), element('span', 'row-meta', prettyTime(time)));
  pick.append(when, main);
  pick.addEventListener('click', () => select(occurrence));
  const go = studioLink(item, 'row-go', `${item.action}, ${item.venue}, ${spokenDate(date)}`, date);
  go.append(icon('out'));
  row.append(pick, go);
  return row;
}

function renderUndatedRow(item) {
  const row = element('div', 'row');
  const link = studioLink(item, 'row-select', `${item.action}, ${item.venue}`);
  const when = element('span', 'row-when');
  when.append(element('span', 'row-day', item.chip));
  const main = element('span', 'row-main');
  main.append(element('span', 'row-venue', item.venue), element('span', 'row-meta', [item.tag, item.when].join(' · ')));
  link.append(when, main);
  const go = element('span', 'row-go');
  go.setAttribute('aria-hidden', 'true');
  go.append(icon('out'));
  row.append(link, go);
  return row;
}

function select(occurrence) {
  view.key = occurrence.key;
  view.week = occurrence.week;
  render();
}

function goToWeek(week) {
  if (week < 0 || week > WEEKS_AHEAD) return;
  const schedule = buildSchedule(view.data.classes);
  const first = schedule.occurrences.find((occurrence) => occurrence.week === week && !occurrence.past);
  view.key = first ? first.key : null;
  view.week = week;
  render();
}

function resetView() {
  view.key = null;
  view.week = null;
  render();
}

function resolveView(schedule) {
  const next = nextOccurrence(schedule);
  let selected = view.key
    ? schedule.occurrences.find((occurrence) => occurrence.key === view.key && !occurrence.past) || null
    : null;
  if (view.key && !selected) {
    view.key = null; // the chosen class has ended; fall back to what's next
    view.week = null;
  }
  if (!view.key && view.week === null) selected = next;
  const week = view.week !== null ? view.week : (selected ? selected.week : 0);
  const isHome = selected === next && (!next || week === next.week);
  return { next, selected, week, isHome };
}

function renderImportPanel(pending) {
  const panel = element('div', 'import');
  const count = pending.classes.length;
  panel.append(element('h2', 'import-title', `Load ${count} class${count === 1 ? '' : 'es'}?`));
  const list = element('ul', 'import-list');
  pending.classes.forEach((item) => list.append(element('li', '', item.venue)));
  panel.append(list);
  if (view.importError) panel.append(element('p', 'import-error', 'Couldn’t save on this device. Check that Chrome allows site data, then try again.'));
  const actions = element('div', 'import-actions');
  const load = element('button', 'import-go', 'Load classes');
  load.type = 'button';
  load.addEventListener('click', () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
    } catch (error) {
      console.warn('Could not save class shortcuts:', error);
      view.importError = true;
      render();
      return;
    }
    Object.assign(view, { data: pending, pending: null, importError: false, key: null, week: null });
    render();
  });
  const cancel = element('button', 'import-cancel', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => {
    Object.assign(view, { pending: null, importError: false });
    render();
  });
  actions.append(load, cancel);
  panel.append(actions);
  return panel;
}

function render(now = new Date()) {
  const importSection = document.getElementById('import');
  importSection.replaceChildren();
  importSection.hidden = !view.pending;
  if (view.pending) importSection.append(renderImportPanel(view.pending));

  const title = document.getElementById('title');
  const hero = document.getElementById('hero');
  const weekSection = document.getElementById('week');
  const later = document.getElementById('later');
  const rows = document.getElementById('rows');
  const anytime = document.getElementById('anytime');
  const anytimeRows = document.getElementById('anytime-rows');
  const reset = document.getElementById('reset');
  const empty = document.getElementById('empty');
  [hero, weekSection, rows, anytimeRows].forEach((node) => node.replaceChildren());

  const data = view.data;
  empty.hidden = Boolean(data) || Boolean(view.pending);
  if (!data) {
    [title, hero, weekSection, later, anytime, reset].forEach((node) => { node.hidden = true; });
    return;
  }

  const schedule = buildSchedule(data.classes, now);
  const { selected, week, isHome } = resolveView(schedule);
  const hasDated = schedule.occurrences.length > 0;
  view.signature = signature(schedule);

  hero.hidden = false;
  reset.hidden = isHome || !hasDated;
  title.hidden = !hasDated || !selected; // the rest card already says the week is done
  weekSection.hidden = !hasDated;

  if (!hasDated) {
    hero.append(renderUndatedCard(schedule.undated[0].item));
  } else {
    if (selected) title.textContent = dayLabel(selected.date, schedule.today);
    hero.append(selected ? renderCard(selected) : renderRestCard(week));
    weekSection.append(...renderWeek(schedule, week, selected));
  }

  // Every class still ahead in the viewed week, including the one on the card (highlighted).
  const inWeek = schedule.occurrences.filter((occurrence) => occurrence.week === week && !occurrence.past);
  later.hidden = !hasDated || inWeek.length === 0;
  document.getElementById('later-label').textContent = week === 0 ? 'Classes this week' : 'Classes next week';
  inWeek.forEach((occurrence) => rows.append(renderRow(occurrence, occurrence === selected)));

  const undated = hasDated ? schedule.undated : schedule.undated.slice(1);
  anytime.hidden = undated.length === 0;
  undated.forEach(({ item }) => anytimeRows.append(renderUndatedRow(item)));
}

// Redraw only when time actually changed what's on screen (a new day, or a class ending).
function signature(schedule) {
  return `${dateKey(schedule.today)}|${schedule.occurrences.map((occurrence) => (occurrence.past ? 1 : 0)).join('')}`;
}

function refreshIfStale() {
  if (!view.data) return;
  if (signature(buildSchedule(view.data.classes)) !== view.signature) render();
}

export async function main() {
  const pending = takeImportFromHash();
  if (pending) Object.assign(view, { pending, importError: false });
  view.data = readStoredData();
  view.key = null;
  view.week = null;
  render();
  syncRemote();
}

if (typeof document !== 'undefined') {
  const start = () => main().catch((error) => {
    console.error('Class Booker failed to start:', error);
    document.getElementById('empty').hidden = false;
  });
  start();
  window.addEventListener('hashchange', start);
  document.getElementById('reset').addEventListener('click', resetView);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshIfStale();
      syncRemote();
    }
  });
  setInterval(refreshIfStale, 60000);
}
