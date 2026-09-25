import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsSnapshot, createTicketCache, shortcutOnly } from './ticket-cache.mjs';

const packet = revision => ({ version: 1, classes: [{ id: 'example' }], calendarTickets: { revision, sources: [{ data: 'JVBERi0xLjcK' }] } });

test('revision guards reject replay, missing calendars and changed data at the same revision', () => {
  assert.equal(acceptsSnapshot(packet(9), packet(10)), false);
  assert.equal(acceptsSnapshot({ version: 1, classes: [] }, packet(10)), false);
  assert.equal(acceptsSnapshot(packet(10), packet(10)), true);
  assert.equal(acceptsSnapshot(packet(11), packet(10)), true);
  assert.equal(acceptsSnapshot(packet(9), null, 10), false);
  assert.equal(acceptsSnapshot({ ...packet(10), calendarTickets: { revision: 10, sources: [] } }, packet(10)), false);
  assert.deepEqual(shortcutOnly(packet(10)), { version: 1, classes: [{ id: 'example' }] });
});

// Models transaction completion/abort separately from a successful put request.
function memoryIDB() {
  let snapshot;
  let abortNext = false;
  return {
    failNextWrite() { abortNext = true; },
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction(name, mode) {
            const transaction = {};
            let next = snapshot;
            transaction.objectStore = () => ({
              get() {
                const get = {};
                queueMicrotask(() => {
                  get.result = structuredClone(snapshot);
                  get.onsuccess();
                  queueMicrotask(() => {
                    if (mode === 'readwrite' && abortNext) { abortNext = false; transaction.onabort(); }
                    else { snapshot = next; transaction.oncomplete(); }
                  });
                });
                return get;
              },
              put(data) { next = structuredClone(data); },
            });
            return transaction;
          },
        };
        request.onsuccess();
      });
      return request;
    },
  };
}

test('cold cache instance preserves exact originals and rejects a lower revision', async () => {
  const idb = memoryIDB();
  const first = createTicketCache(idb);
  assert.equal((await first.save(packet(10))).accepted, true);
  const restart = createTicketCache(idb);
  assert.deepEqual(await restart.read(), packet(10));
  assert.equal((await restart.save(packet(9))).accepted, false);
  assert.deepEqual(await restart.read(), packet(10));
});

test('transaction abort never claims saved and does not overwrite a durable original', async () => {
  const idb = memoryIDB();
  const cache = createTicketCache(idb);
  await cache.save(packet(10));
  idb.failNextWrite();
  await assert.rejects(cache.save(packet(11)), /could not be saved/);
  assert.deepEqual(await createTicketCache(idb).read(), packet(10));
  await assert.rejects(createTicketCache(null).read(), /unavailable/);
});
