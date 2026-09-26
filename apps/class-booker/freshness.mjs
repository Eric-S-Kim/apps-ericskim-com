// One visible-tab lifecycle for private snapshots and app updates. No credentials live here.
export function startFreshness({ syncRemote, refreshView, canReload }, host = globalThis) {
  const { window: win, document: doc, navigator: nav, location } = host;
  const now = () => host.Date.now();
  let lastData = -Infinity, lastCode = -Infinity, lastInput = -Infinity;
  let syncing = false, checkingCode = false, registration = null;
  let controlled = Boolean(nav.serviceWorker?.controller);
  let updatePending = false, reloaded = false, stopped = false;
  const visible = () => doc.visibilityState === 'visible';
  const online = () => nav.onLine !== false;
  const reloadWhenSafe = () => {
    if (stopped || !updatePending || reloaded || !visible() || !online()
      || syncing || !canReload() || now() - lastInput < 5000) return;
    reloaded = true;
    location.reload();
  };
  const check = (force = false) => {
    if (stopped || !visible()) return;
    refreshView();
    if (!online()) return;
    if (!syncing && (force || now() - lastData >= 5 * 60000)) {
      syncing = true; lastData = now();
      Promise.resolve().then(syncRemote).catch(() => {}).finally(() => {
        syncing = false; reloadWhenSafe();
      });
    }
    if (nav.serviceWorker && !checkingCode && (force || now() - lastCode >= 15 * 60000)) {
      checkingCode = true; lastCode = now();
      Promise.resolve().then(() => registration ? registration.update()
        : nav.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
          .then(value => { registration = value; }))
        .catch(() => {}).finally(() => { checkingCode = false; });
    }
    reloadWhenSafe();
  };
  const resume = () => check(true);
  const activity = () => { lastInput = now(); };
  const controllerChanged = () => {
    if (!controlled) { controlled = true; return; }
    updatePending = true; reloadWhenSafe();
  };
  win.addEventListener('focus', resume);
  win.addEventListener('online', resume);
  doc.addEventListener('visibilitychange', resume);
  doc.addEventListener('close', reloadWhenSafe, true);
  for (const event of ['pointerdown', 'keydown', 'input']) doc.addEventListener(event, activity, true);
  nav.serviceWorker?.addEventListener('controllerchange', controllerChanged);
  const timer = host.setInterval(check, 60000);
  check();
  return () => {
    stopped = true; host.clearInterval(timer);
    win.removeEventListener('focus', resume);
    win.removeEventListener('online', resume);
    doc.removeEventListener('visibilitychange', resume);
    doc.removeEventListener('close', reloadWhenSafe, true);
    for (const event of ['pointerdown', 'keydown', 'input']) doc.removeEventListener(event, activity, true);
    nav.serviceWorker?.removeEventListener('controllerchange', controllerChanged);
  };
}
