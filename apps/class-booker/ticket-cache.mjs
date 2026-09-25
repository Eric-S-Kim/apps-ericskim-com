// One snapshot transaction owns both the revision and originals. No credentials are stored here.
const DATABASE = 'class-booker-originals-v1';
const STORE = 'snapshots';
export const REVISION_KEY = 'class-booker-revision-v1';
export const revisionOf = data => data?.calendarTickets?.revision || 0;

export function acceptsSnapshot(next, current, minimum = 0) {
  if (revisionOf(next) < Math.max(revisionOf(current), minimum)) return false;
  return !current?.calendarTickets || revisionOf(next) !== revisionOf(current)
    || JSON.stringify(next.calendarTickets) === JSON.stringify(current.calendarTickets);
}

export function shortcutOnly(data) {
  return data && { version: data.version, classes: data.classes };
}

export function createTicketCache(indexedDB = globalThis.indexedDB) {
  async function open() {
    if (!indexedDB) throw new Error('Original storage unavailable');
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      let settled = false;
      const timer = setTimeout(() => { settled = true; reject(new Error('Original storage timed out')); }, 5000);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => { clearTimeout(timer); reject(new Error('Original storage unavailable')); };
      request.onblocked = () => { clearTimeout(timer); settled = true; reject(new Error('Original storage blocked')); };
      request.onsuccess = () => { clearTimeout(timer); if (settled) request.result.close(); else resolve(request.result); };
    });
  }
  async function transact(mode, data, minimum = 0) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        let result;
        const transaction = db.transaction(STORE, mode, { durability: 'strict' });
        const store = transaction.objectStore(STORE);
        const get = store.get('current');
        get.onsuccess = () => {
          const current = get.result || null;
          if (mode === 'readonly') { result = current; return; }
          if (!acceptsSnapshot(data, current, minimum)) { result = { accepted: false, data: current }; return; }
          store.put(data, 'current');
          result = { accepted: true, data };
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = transaction.onabort = () => reject(new Error('Originals could not be saved'));
      });
    } finally { db.close(); }
  }
  return {
    read: () => transact('readonly'),
    async save(data, minimum = 0) {
      const result = await transact('readwrite', data, minimum);
      if (!result.accepted) return result;
      const stored = await transact('readonly');
      // A second tab may have committed a newer complete snapshot while we read back.
      if (!stored || revisionOf(stored) < revisionOf(data) || revisionOf(stored) === revisionOf(data)
        && JSON.stringify(stored) !== JSON.stringify(data)) throw new Error('Original storage verification failed');
      return { accepted: true, data: stored };
    },
  };
}
