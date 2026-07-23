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

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderCard(item) {
  const card = element('a', 'card');
  card.href = safeHttpsUrl(item.url);
  card.target = '_blank';
  card.rel = 'noopener noreferrer';

  const row = element('div', 'row');
  row.append(element('div', 'chip', item.chip));

  const meta = element('div', 'meta');
  meta.append(element('div', 'tag', item.tag));
  meta.append(element('div', 'venue', item.venue));
  meta.append(element('div', 'when', item.when));
  row.append(meta);
  card.append(row);

  const go = element('span', 'go');
  go.append(document.createTextNode(`${item.action} `));
  go.append(element('span', 'arrow', '→'));
  card.append(go);
  return card;
}

function render(data) {
  const cards = document.getElementById('cards');
  const empty = document.getElementById('empty');
  cards.replaceChildren();

  if (!data) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  data.classes.forEach((item) => cards.append(renderCard(item)));
  document.getElementById('count').textContent = `${data.classes.length} shortcuts · private to this device`;
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
