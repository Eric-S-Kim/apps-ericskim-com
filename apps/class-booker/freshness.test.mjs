import test from 'node:test';
import assert from 'node:assert/strict';
import { startFreshness } from './freshness.mjs';

const MINUTE = 60_000;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function target() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type) { for (const listener of [...(listeners.get(type) || [])]) listener({ type }); },
    listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

function harness({ controlled = true, visible = true, online = true, sync, update, register } = {}) {
  let now = 100_000, nextTimer = 0, reloadable = true;
  const timers = new Map();
  const calls = { sync: 0, refresh: 0, register: [], update: 0, reload: 0 };
  const window = target(), document = { ...target(), visibilityState: visible ? 'visible' : 'hidden' };
  const registration = { update: () => { calls.update++; return update?.() || Promise.resolve(); } };
  const serviceWorker = {
    ...target(), controller: controlled ? {} : null,
    register: (...args) => {
      calls.register.push(args);
      return register?.() || Promise.resolve(registration);
    },
  };
  const host = {
    window, document, navigator: { onLine: online, serviceWorker },
    location: { reload: () => { calls.reload++; } }, Date: { now: () => now },
    setInterval: (callback, delay) => {
      const id = ++nextTimer; timers.set(id, { callback, delay, next: now + delay }); return id;
    },
    clearInterval: id => timers.delete(id),
  };
  const cleanup = startFreshness({
    syncRemote: () => { calls.sync++; return sync?.() || Promise.resolve(); },
    refreshView: () => { calls.refresh++; }, canReload: () => reloadable,
  }, host);
  return {
    host, calls, cleanup, serviceWorker, registration, timers,
    busy: value => { reloadable = !value; },
    activity: type => { document.emit(type); window.emit(type); },
    visible: value => { document.visibilityState = value ? 'visible' : 'hidden'; document.emit('visibilitychange'); },
    online: value => { host.navigator.onLine = value; window.emit(value ? 'online' : 'offline'); },
    close: () => document.emit('close'),
    async advance(milliseconds) {
      const end = now + milliseconds;
      while (true) {
        const due = [...timers.values()].filter(timer => timer.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        now = due.next; due.next += due.delay; due.callback(); await flush();
      }
      now = end; await flush();
    },
  };
}

test('visible idle tabs refresh private data every five minutes and worker code every fifteen', async () => {
  const h = harness(); await flush();
  assert.equal(h.calls.sync, 1);
  assert.deepEqual(h.calls.register, [['./sw.js', { updateViaCache: 'none' }]]);
  const initialUpdates = h.calls.update;
  await h.advance(MINUTE);
  assert.equal(h.calls.sync, 1, 'the display tick must not download originals every minute');
  await h.advance(4 * MINUTE);
  assert.equal(h.calls.sync, 2);
  assert.equal(h.calls.update, initialUpdates);
  await h.advance(10 * MINUTE);
  assert.equal(h.calls.sync, 4);
  assert.equal(h.calls.update, initialUpdates + 1);
  assert.equal(h.calls.register.length, 1);
  assert.ok(h.calls.refresh >= 15, 'time-sensitive event display keeps its minute cadence');
  h.cleanup();
});

test('hidden and offline starts do not consume a refresh; returning visible and online refreshes immediately', async () => {
  for (const initial of [{ visible: false }, { online: false }]) {
    const h = harness(initial); await flush();
    await h.advance(20 * MINUTE);
    h.host.window.emit('focus'); await flush();
    assert.equal(h.calls.sync, 0);
    assert.equal(h.calls.register.length, 0);
    h.visible(true); h.online(true); await flush();
    assert.equal(h.calls.sync, 1);
    assert.equal(h.calls.register.length, 1);
    const before = { sync: h.calls.sync, update: h.calls.update };
    h.visible(false); await h.advance(20 * MINUTE);
    assert.equal(h.calls.sync, before.sync);
    assert.equal(h.calls.update, before.update);
    h.visible(true); await flush();
    assert.equal(h.calls.sync, before.sync + 1);
    h.online(false); await h.advance(20 * MINUTE);
    const offlineSyncs = h.calls.sync;
    h.online(true); await flush();
    assert.equal(h.calls.sync, offlineSyncs + 1);
    h.cleanup();
  }
});

test('focus, visibility and connectivity bursts share an in-flight private sync', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const h = harness({ sync: () => pending }); await flush();
  h.host.window.emit('focus'); h.visible(true); h.online(true);
  await h.advance(5 * MINUTE);
  assert.equal(h.calls.sync, 1);
  release(); await flush();
  h.host.window.emit('focus'); await flush();
  assert.equal(h.calls.sync, 2);
  h.cleanup();
});

test('a worker update waits through a wallet or import and reloads once after closing idle', async () => {
  const h = harness(); await flush(); h.busy(true);
  await h.advance(6_000); h.serviceWorker.emit('controllerchange'); await flush();
  await h.advance(MINUTE);
  assert.equal(h.calls.reload, 0);
  h.busy(false); h.close(); await flush();
  assert.equal(h.calls.reload, 1);
  h.serviceWorker.emit('controllerchange'); h.close(); await h.advance(MINUTE);
  assert.equal(h.calls.reload, 1, 'a single page lifetime may request only one reload');
  h.cleanup();
});

test('a code reload waits until the in-flight private snapshot finishes saving', async () => {
  let release;
  const h = harness({ sync: () => new Promise(resolve => { release = resolve; }) });
  await flush(); await h.advance(6_000);
  h.serviceWorker.emit('controllerchange'); h.close(); await flush();
  assert.equal(h.calls.reload, 0);
  release(); await flush();
  assert.equal(h.calls.reload, 1);
  h.cleanup();
});

test('keyboard, pointer and input activity each postpone a pending code reload', async () => {
  for (const event of ['keydown', 'pointerdown', 'input']) {
    const h = harness(); await flush(); h.busy(true);
    await h.advance(6_000); h.serviceWorker.emit('controllerchange'); await flush();
    h.activity(event); h.busy(false); h.close(); await flush();
    assert.equal(h.calls.reload, 0, event);
    await h.advance(4_999); h.close(); await flush();
    assert.equal(h.calls.reload, 0, event);
    await h.advance(1); h.close(); await flush();
    assert.equal(h.calls.reload, 1, event);
    h.cleanup();
  }
});

test('a pending code reload remains deferred while hidden or offline', async () => {
  const h = harness(); await flush(); await h.advance(6_000);
  h.visible(false); h.serviceWorker.emit('controllerchange'); await h.advance(MINUTE);
  assert.equal(h.calls.reload, 0);
  h.online(false); h.visible(true); await flush();
  assert.equal(h.calls.reload, 0);
  h.online(true); await flush();
  assert.equal(h.calls.reload, 1);
  h.cleanup();
});

test('first installation does not reload, but a later worker replacement updates that same tab', async () => {
  const h = harness({ controlled: false }); await flush(); await h.advance(6_000);
  h.serviceWorker.controller = {};
  h.serviceWorker.emit('controllerchange'); await flush();
  assert.equal(h.calls.reload, 0);
  h.serviceWorker.controller = {};
  h.serviceWorker.emit('controllerchange'); await flush();
  assert.equal(h.calls.reload, 1);
  h.cleanup();
});

test('cleanup removes timers and listeners without allowing later refreshes or reloads', async () => {
  const h = harness(); await flush();
  h.cleanup(); const before = { ...h.calls };
  assert.equal(h.timers.size, 0);
  assert.equal(h.host.window.listenerCount(), 0);
  assert.equal(h.host.document.listenerCount(), 0);
  assert.equal(h.serviceWorker.listenerCount(), 0);
  h.host.window.emit('focus'); h.visible(true); h.online(true); h.close();
  h.serviceWorker.emit('controllerchange'); await h.advance(20 * MINUTE);
  assert.deepEqual(h.calls, before);
});

test('failed private sync and worker checks are absorbed and later attempts still run', async () => {
  const h = harness({ sync: () => Promise.reject(new Error('Offline')), update: () => Promise.reject(new Error('Unavailable')) });
  await flush();
  h.host.window.emit('focus'); await flush();
  assert.equal(h.calls.sync, 2);
  await h.advance(15 * MINUTE);
  assert.ok(h.calls.sync >= 5);
  h.cleanup();
  const registrationFailure = harness({ register: () => Promise.reject(new Error('Worker unavailable')) });
  await flush(); registrationFailure.cleanup();
});
