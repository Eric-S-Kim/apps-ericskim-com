import { isTicketData, bookingLabel, ticketIcon, showBooking, invalidateOpenBooking, venueNow, freshTicketData } from './tickets.mjs?v=20260925-wallet';
import { isCalendarTicketData, payloadFits, effectiveBooking, calendarLabel, calendarAction, PAYLOAD_LIMIT } from './calendar-tickets.mjs?v=20260925-wallet';
import { createTicketCache, acceptsSnapshot, revisionOf, shortcutOnly, readRevisionFloor, persistRevisionFloor } from './ticket-cache.mjs?v=20260925-wallet';
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
  if (!payloadFits(value)) return false;
  if (value.tickets !== undefined && !isTicketData(value.tickets, value.classes)) return false;
  if (value.calendarTickets !== undefined && !isCalendarTicketData(value.calendarTickets, value.classes)) return false;

  const ids = new Set();
  return value.classes.every((item) => {
    if (!item || typeof item !== 'object') return false;
    if (!Object.entries(TEXT_LIMITS).every(([field, max]) => validText(item[field], max))) return false;
    if (!safeHttpsUrl(item.url) || ids.has(item.id)) return false;
    ids.add(item.id);
    return true;
  });
}

export function isShortcutImport(data) {
  return data?.tickets === undefined && data?.calendarTickets === undefined && isClassBookerData(data);
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
    if (!isShortcutImport(data)) throw new Error('invalid class shortcut import');
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

// A tile in another person's store (2026-09-23, Jung's Apps) opens this page with #remote=<base64url
// {"url","key"}>. Her phone's copy of this page has its own storage that her store's pairing never
// reaches, and a link opened from email lands in Safari, not here. Accepted for a first setup, or for
// the same service with a new key; never a different service, so a stray link cannot repoint a copy.
export function remoteFromHash(hash, storedRaw) {
  const match = String(hash || '').match(/^#remote=([A-Za-z0-9_-]{16,2000})$/);
  if (!match) return null;
  let next = null;
  try { next = readRemoteSettings(JSON.stringify(decodeDataPayload(match[1]))); } catch { return null; }
  if (!next) return null;
  const current = readRemoteSettings(storedRaw);
  if (current && current.base !== next.base) return null;
  return JSON.stringify({ url: next.base, key: next.key });
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
    if (Number(response.headers.get('content-length')) > PAYLOAD_LIMIT) return null;
    const body = await response.text();
    if (new TextEncoder().encode(body).length > PAYLOAD_LIMIT) return null;
    const data = JSON.parse(body);
    return isClassBookerData(data) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let remoteInFlight = null;
const ticketCache = createTicketCache();
let revisionFloor = 0;
function rememberRevision(revision) {
  invalidateOpenBooking(revision);
  revisionFloor = Math.max(revisionFloor, revision);
  try { revisionFloor = persistRevisionFloor(localStorage, revision, revisionFloor); return true; } catch { return false; }
}

function syncRemote() {
  if (remoteInFlight) return remoteInFlight;
  remoteInFlight = fetchRemoteData().then(async (data) => {
    if (view.pending) return;
    if (!data) { view.syncError = true; render(); return; }
    if (!acceptsSnapshot(data, view.data, revisionFloor)) { view.syncError = true; render(); return; }
    // The watermark is written before displaying a newly observed decision, including a cancellation.
    const watermark = rememberRevision(revisionOf(data));
    if (revisionOf(data) < revisionFloor) {
      Object.assign(view, { data: shortcutOnly(view.data || data), storageError: true, syncError: true, durable: false });
      render(); return;
    }
    try {
      const saved = await ticketCache.save(data, revisionFloor);
      try { revisionFloor = readRevisionFloor(localStorage, revisionFloor); } catch { /* IDB still protects committed revisions */ }
      if (!saved.data || !isClassBookerData(saved.data) || revisionOf(saved.data) < revisionFloor) throw new Error('Invalid saved originals');
      Object.assign(view, { data: saved.data, durable: true, storageError: false, syncError: !saved.accepted });
    } catch {
      // A failed durable write must not leave an old ticket labelled ready. If even the watermark
      // cannot be stored, hide originals rather than allow a cold restart to replay an accepted state.
      Object.assign(view, { data: watermark && revisionOf(data) >= revisionFloor ? data : shortcutOnly(data), durable: false, storageError: true, syncError: true });
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcutOnly(data))); } catch { /* alert covers storage failure */ }
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
export function buildSchedule(classes, now = venueNow(), weeksAhead = WEEKS_AHEAD) {
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

const dateFromKey = key => new Date(`${key}T12:00:00`);
const clockMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
function calendarTime(event) {
  if (!event.startTime) return 'All day';
  const label = value => {
    const hour = Number(value.slice(0, 2));
    return `${hour % 12 || 12}${value.slice(3) === '00' ? '' : `:${value.slice(3)}`} ${hour >= 12 ? 'PM' : 'AM'}`;
  };
  return `${label(event.startTime)}–${label(event.endTime)}`;
}

export function buildAppSchedule(data, now = venueNow()) {
  const schedule = buildSchedule(data.classes, now);
  schedule.minWeek = 0;
  schedule.maxWeek = WEEKS_AHEAD;
  schedule.firstDate = dateKey(schedule.monday);
  schedule.lastDate = dateKey(addDays(schedule.monday, (WEEKS_AHEAD + 1) * 7 - 1));
  const calendar = data.calendarTickets;
  if (!calendar) return schedule;
  const weekOf = date => Math.floor(Math.round((startOfDay(date) - schedule.monday) / DAY_MS) / 7);
  schedule.minWeek = Math.min(0, weekOf(dateFromKey(calendar.windowStart)));
  schedule.maxWeek = Math.max(WEEKS_AHEAD, weekOf(addDays(dateFromKey(calendar.windowEnd), -1)));
  schedule.firstDate = calendar.windowStart;
  schedule.lastDate = dateKey(addDays(dateFromKey(calendar.windowEnd), -1));
  schedule.occurrences = schedule.occurrences.filter(o => !calendar.events.some(e => e.classId === o.item.id
    && e.date === dateKey(o.date) && (e.startTime === null || o.times?.start === clockMinutes(e.startTime))));
  calendar.events.forEach((event, order) => {
    const date = startOfDay(dateFromKey(event.date));
    const dayDiff = Math.round((date - schedule.today) / DAY_MS);
    const times = event.startTime ? { start: clockMinutes(event.startTime), end: clockMinutes(event.endTime) } : null;
    if (times && times.end <= times.start) times.end += 1440;
    const past = dayDiff < 0 || dayDiff === 0 && times !== null && now.getHours() * 60 + now.getMinutes() >= times.end;
    schedule.occurrences.push({ key: `calendar@${event.id}`, event, item: { id: event.classId || event.id, venue: event.title, when: calendarTime(event) },
      date, times, week: weekOf(date), order, dayDiff, past, soonest: false });
  });
  schedule.occurrences.sort((a, b) => a.date - b.date || (a.times?.start || 0) - (b.times?.start || 0) || a.order - b.order);
  return schedule;
}

export function weekForDate(schedule, key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)
    || key < schedule.firstDate || key > schedule.lastDate) return null;
  const date = dateFromKey(key);
  if (Number.isNaN(date.getTime()) || dateKey(date) !== key) return null;
  return Math.floor(Math.round((startOfDay(date) - schedule.monday) / DAY_MS) / 7);
}

export function weekDays(schedule, week) {
  const start = addDays(schedule.monday, week * 7);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const key = dateKey(date);
    const classes = schedule.occurrences.filter((occurrence) => (!occurrence.past || occurrence.event) && dateKey(occurrence.date) === key);
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
const view = { data: null, key: null, week: null, signature: '', pending: null, importError: false,
  durable: false, storageError: false, syncError: false };

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

function bookingState(booking) {
  if (booking.calendar) return calendarLabel(booking, new Date(), !view.syncError && !view.storageError);
  return booking.ready ? (!view.syncError && freshTicketData(booking) ? 'Ticket ready' : 'Saved ticket · check for changes') : bookingLabel(booking);
}

function originalAction(booking) {
  return booking.calendar ? calendarAction(booking) : booking.records?.length ? (booking.ready ? 'Show ticket' : 'View confirmation') : null;
}

function bookingKnowledgeMissing() {
  return view.storageError && revisionFloor > revisionOf(view.data);
}

function openOriginal(booking, venue) {
  if (revisionOf(view.data) < revisionFloor) return;
  showBooking({ ...booking, reason: freshTicketData(booking) && !view.syncError ? booking.reason : 'Saved record · check for changes. ' + (booking.reason || '') }, venue, booking.checkedAt, !navigator.onLine && view.durable, revisionOf(view.data));
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
  const booking = effectiveBooking(view.data, occurrence);
  if (booking) {
    body.append(element('div', 'booking-state', bookingState(booking)));
    if (booking.reason) body.append(element('div', 'hero-meta', booking.reason));
    card.append(body);
    const action = originalAction(booking);
    if (action) {
      const show = element('button', 'hero-go', action);
      show.type = 'button';
      show.addEventListener('click', () => openOriginal(booking, item.venue));
      card.append(show);
    }
    return card;
  }

  if (bookingKnowledgeMissing()) {
    body.append(element('div', 'hero-meta', 'Reconnect to check this booking.'));
    card.append(body);
    return card;
  }
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
  if (bookingKnowledgeMissing()) {
    body.append(element('div', 'hero-meta', 'Reconnect to check your bookings.'));
    card.append(body); return card;
  }
  const go = studioLink(item, 'hero-go', `${item.action}, ${item.venue}`);
  go.append(element('span', '', item.action), icon('arrow'));
  card.append(body, go);
  return card;
}

function renderRestCard(week, schedule) {
  const card = element('div', 'hero quiet');
  const body = element('div', 'hero-body');
  body.append(element('h2', 'hero-venue', 'No events this week'));
  card.append(body);
  const nextEvent = schedule.occurrences.find(o => o.week > week && !o.past);
  if (nextEvent) {
    const next = element('button', 'hero-go');
    next.type = 'button';
    next.append(element('span', '', 'See next event'), icon('arrow'));
    next.addEventListener('click', () => select(nextEvent));
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
  title.append(element('h2', 'label strong', week === 0 ? 'This week' : week === 1 ? 'Next week' : String(first.getFullYear())), element('span', 'label', range));
  const nav = element('div', 'week-nav');
  [['prev', week - 1, 'Previous week'], ['next', week + 1, 'Next week']].forEach(([kind, target, label]) => {
    const button = element('button', 'nav-btn');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.disabled = target < schedule.minWeek || target > schedule.maxWeek;
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
  const jump = element('label', 'date-jump');
  jump.append(element('span', '', 'Jump to date'));
  const input = element('input', 'date-input');
  input.type = 'date';
  input.min = schedule.firstDate;
  input.max = schedule.lastDate;
  const currentDate = dateKey(selected?.date || first);
  input.value = currentDate < input.min ? input.min : currentDate > input.max ? input.max : currentDate;
  input.addEventListener('change', () => {
    const target = weekForDate(schedule, input.value);
    if (target === null) { input.reportValidity(); return; }
    const event = schedule.occurrences.find(o => dateKey(o.date) === input.value && (!o.past || o.event));
    if (event) select(event); else goToWeek(target);
  });
  jump.append(input);
  return [head, strip, jump];
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
  const booking = effectiveBooking(view.data, occurrence);
  if (booking) main.append(element('span', 'row-booking', bookingState(booking)));
  pick.append(when, main);
  pick.addEventListener('click', () => select(occurrence));
  row.append(pick);
  const action = booking && originalAction(booking);
  if (booking && !action) return row;
  if (!booking && bookingKnowledgeMissing()) return row;
  const go = booking ? element('button', 'row-go') : studioLink(item, 'row-go', `${item.action}, ${item.venue}, ${spokenDate(date)}`, date);
  if (booking) {
    go.type = 'button';
    go.setAttribute('aria-label', `${action}, ${item.venue}`);
    go.append(booking.ready ? ticketIcon() : icon('out'));
    go.addEventListener('click', () => openOriginal(booking, item.venue));
  } else go.append(icon('out'));
  row.append(go);
  return row;
}

function renderUndatedRow(item) {
  const row = element('div', 'row');
  const link = bookingKnowledgeMissing() ? element('div', 'row-select') : studioLink(item, 'row-select', `${item.action}, ${item.venue}`);
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
  const schedule = buildAppSchedule(view.data);
  if (week < schedule.minWeek || week > schedule.maxWeek) return;
  const first = schedule.occurrences.find((occurrence) => occurrence.week === week && (!occurrence.past || occurrence.event));
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
    ? schedule.occurrences.find((occurrence) => occurrence.key === view.key && (!occurrence.past || occurrence.event || effectiveBooking(view.data, occurrence))) || null
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
  if (view.importError) panel.append(element('p', 'import-error', typeof view.importError === 'string' ? view.importError
    : 'Couldn’t save on this device. Check that Chrome allows site data, then try again.'));
  const actions = element('div', 'import-actions');
  const load = element('button', 'import-go', 'Load classes');
  load.type = 'button';
  load.addEventListener('click', async () => {
    // A shortcut import can change its own list without discarding a newer ticket decision.
    const next = { ...view.data, ...pending };
    if (!isClassBookerData(next)) {
      view.importError = 'This setup conflicts with your saved tickets. Your current classes and tickets have been kept.';
      render(); return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
    } catch (error) {
      console.warn('Could not save class shortcuts:', error);
      view.importError = true;
      render();
      return;
    }
    try {
      try { revisionFloor = readRevisionFloor(localStorage, revisionFloor); } catch { /* cache also checks its revision */ }
      const saved = await ticketCache.save(next, revisionFloor);
      try { revisionFloor = readRevisionFloor(localStorage, revisionFloor); } catch { /* IDB still protects committed revisions */ }
      if (!saved.data || revisionOf(saved.data) < revisionFloor) throw new Error('Saved originals are older than an observed decision');
      if (!saved.accepted) {
        if (saved.data && isClassBookerData(saved.data) && revisionOf(saved.data) >= revisionFloor) {
          Object.assign(view, { data: saved.data, durable: true, storageError: false, importError: true });
          rememberRevision(revisionOf(saved.data));
          render(); return;
        }
        throw new Error('A newer ticket snapshot exists');
      }
      Object.assign(view, { data: saved.data, durable: true, storageError: false });
    } catch {
      Object.assign(view, { data: shortcutOnly(next), durable: false, storageError: true, importError: true });
      render(); return;
    }
    Object.assign(view, { pending: null, importError: false, key: null, week: null });
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

function render(now = venueNow()) {
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
  const notice = document.getElementById('sync-notice');
  const hasOriginals = Boolean(data?.tickets || data?.calendarTickets);
  const calendarStale = data?.calendarTickets && !freshTicketData(data.calendarTickets);
  notice.hidden = !view.storageError && !calendarStale && !(view.syncError && hasOriginals);
  notice.textContent = view.storageError
    ? 'Originals could not be saved on this device. A connection is needed; reload before you leave.'
    : calendarStale ? 'The calendar has not been checked recently. Check for changes before entry.'
      : 'Updates are unavailable. Check for changes before entry.';
  empty.hidden = Boolean(data) || Boolean(view.pending);
  if (!data) {
    [title, hero, weekSection, later, anytime, reset].forEach((node) => { node.hidden = true; });
    return;
  }

  const schedule = buildAppSchedule(data, now);
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
    hero.append(selected ? renderCard(selected) : renderRestCard(week, schedule));
    weekSection.append(...renderWeek(schedule, week, selected));
  }

  // Keep calendar events and evidenced bookings accessible after they end.
  const inWeek = schedule.occurrences.filter((occurrence) => {
    if (occurrence.week !== week) return false;
    if (!occurrence.past) return true;
    return occurrence.event || effectiveBooking(view.data, occurrence);
  });
  later.hidden = !hasDated || inWeek.length === 0;
  document.getElementById('later-label').textContent = week === 0 ? 'This week' : week === 1 ? 'Next week' : 'Events';
  inWeek.forEach((occurrence) => rows.append(renderRow(occurrence, occurrence === selected)));

  const undated = hasDated ? schedule.undated : schedule.undated.slice(1);
  anytime.hidden = undated.length === 0;
  undated.forEach(({ item }) => anytimeRows.append(renderUndatedRow(item)));
}

// Redraw only when time actually changed what's on screen (a new day, or a class ending).
function signature(schedule) {
  return `${dateKey(schedule.today)}|${schedule.occurrences.map(o => `${o.past ? 1 : 0}${freshTicketData(o.event) ? 1 : 0}`).join('')}|${freshTicketData(view.data?.tickets)}|${freshTicketData(view.data?.calendarTickets)}`;
}

function refreshIfStale() {
  if (!view.data) return;
  if (signature(buildAppSchedule(view.data)) !== view.signature) render();
}

export async function main() {
  if (location.hash.startsWith('#remote=')) {
    let stored = null;
    try { stored = localStorage.getItem(REMOTE_KEY); } catch { /* storage blocked */ }
    const remote = remoteFromHash(location.hash, stored);
    history.replaceState(null, '', location.pathname + location.search);
    if (remote) {
      try { localStorage.setItem(REMOTE_KEY, remote); } catch { /* storage blocked */ }
    }
  }
  const pending = takeImportFromHash();
  if (pending) Object.assign(view, { pending, importError: false });
  const local = readStoredData();
  try { revisionFloor = readRevisionFloor(localStorage, revisionFloor); } catch { /* IndexedDB still verifies its own revision */ }
  view.data = shortcutOnly(local);
  view.durable = false;
  view.storageError = false;
  try {
    let saved = await ticketCache.read();
    // Migrate the old small localStorage payload once; subsequent writes contain shortcuts only.
    if (!saved && local && (local.tickets || local.calendarTickets) && revisionOf(local) >= revisionFloor) {
      saved = (await ticketCache.save(local, revisionFloor)).data;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcutOnly(local))); } catch { /* durable IDB is authoritative */ }
    }
    if (saved && isClassBookerData(saved) && revisionOf(saved) >= revisionFloor) {
      view.data = saved;
      view.durable = true;
      rememberRevision(revisionOf(saved));
      if (revisionOf(saved) < revisionFloor) {
        view.data = shortcutOnly(local || saved); view.durable = false; view.storageError = true;
      }
    } else if (saved || revisionFloor > 0) view.storageError = true;
  } catch { view.storageError = true; }
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
  window.addEventListener('focus', () => { refreshIfStale(); syncRemote(); });
  window.addEventListener('online', syncRemote);
  window.addEventListener('storage', () => {
    try {
      revisionFloor = readRevisionFloor(localStorage, revisionFloor); invalidateOpenBooking(revisionFloor);
      if (revisionOf(view.data) < revisionFloor) {
        Object.assign(view, { data: shortcutOnly(view.data), storageError: true, durable: false, syncError: true });
        render(); syncRemote();
      }
    } catch { /* online refresh still verifies */ }
  });
  window.addEventListener('offline', () => { view.syncError = true; render(); });
  document.getElementById('reset').addEventListener('click', resetView);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshIfStale();
      syncRemote();
    }
  });
  setInterval(refreshIfStale, 60000);
}
