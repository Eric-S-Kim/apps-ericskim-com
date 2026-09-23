// Tap delight: a small cat-pink moment on each kind of tap, a little different every time.
// Day circle = bloom, class row = fingertip ripple, big button = glint, arrow = trail.
// Everything draws on one pointer-transparent canvas, so a tap is never blocked or delayed.

const PINK = '255,20,200';
const HOT = '255,26,120';
const TAU = Math.PI * 2;

const R = (a, b) => a + Math.random() * (b - a);
const coin = (p = 0.5) => Math.random() < p;
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const rgba = (alpha, hot) => `rgba(${hot ? HOT : PINK},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

// Which effect each tappable thing gets. First match wins.
const TARGETS = [
  ['button.day', 'bloom'],
  ['.row-select', 'ripple'],
  ['.hero-go', 'glint'],
  ['.nav-btn', 'trail'],
  ['a.row-go', 'trail'],
];

export function installDelight(doc = document) {
  const win = doc.defaultView;
  const canvas = doc.createElement('canvas');
  canvas.className = 'fx-layer';
  canvas.setAttribute('aria-hidden', 'true');
  doc.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const calm = win.matchMedia('(prefers-reduced-motion: reduce)');
  let dpr = 1;
  let live = [];
  let frame = 0;

  function size() {
    dpr = Math.min(2, win.devicePixelRatio || 1);
    canvas.width = Math.round(win.innerWidth * dpr);
    canvas.height = Math.round(win.innerHeight * dpr);
  }
  size();
  win.addEventListener('resize', size);

  function add(duration, draw) {
    live.push({ start: win.performance.now(), duration, draw });
    if (!frame) frame = win.requestAnimationFrame(tick);
  }

  function tick(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    live = live.filter((fx) => {
      const p = (now - fx.start) / fx.duration;
      if (p >= 1) return false;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fx.draw(Math.max(0, p));
      ctx.restore();
      return true;
    });
    frame = live.length ? win.requestAnimationFrame(tick) : 0;
    if (!frame) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // A tap re-renders the view, replacing the tapped node. Re-find its replacement by position among
  // same-selector siblings so the effect follows it (the card above can change height); if it's gone,
  // keep the last known box.
  function follow(el, selector, inner) {
    const index = [...doc.querySelectorAll(selector)].indexOf(el);
    let last = (inner ? el.querySelector(inner) || el : el).getBoundingClientRect();
    const node = () => (el.isConnected ? el : doc.querySelectorAll(selector)[index]) || null;
    return {
      node,
      box() {
        const current = node();
        const target = current && inner ? current.querySelector(inner) || current : current;
        if (target) last = target.getBoundingClientRect();
        return last;
      },
    };
  }

  const glow = (blur, hot) => { ctx.shadowColor = rgba(1, hot); ctx.shadowBlur = blur; };

  const effects = {
    // A soft pink halo swells around the day circle and fades.
    bloom(el, selector) {
      const target = follow(el, selector, '.day-num');
      const peak = R(0.45, 0.7);
      const spread = R(1, 4);
      const hot = coin(0.3);
      add(R(480, 640), (p) => {
        const r = target.box();
        const c = center(r);
        const envelope = p < 0.3 ? easeOut(p / 0.3) : 1 - (p - 0.3) / 0.7;
        ctx.shadowColor = rgba(peak * envelope, hot);
        ctx.shadowBlur = 16;
        ctx.strokeStyle = rgba(envelope, hot);
        ctx.lineWidth = 1 + spread * 0.4;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r.width / 2 + spread / 2, 0, TAU);
        ctx.stroke();
      });
    },

    // A faint pink ring spreads from the fingertip.
    ripple(el, selector, point) {
      const at = point || center(el.getBoundingClientRect());
      const max = R(38, 60);
      const hot = coin(0.3);
      add(500, (p) => {
        const radius = Math.max(0.1, max * easeOut(p));
        const fill = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
        fill.addColorStop(0, rgba(0.24 * (1 - p), hot));
        fill.addColorStop(1, rgba(0, hot));
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(at.x, at.y, radius, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba(0.6 * (1 - p), hot);
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    },

    // A slanted glint of pink light passes across the pill.
    glint(el, selector) {
      const target = follow(el, selector);
      const width = R(14, 24);
      const slant = R(0.3, 0.65) * (coin() ? 1 : -1);
      const hot = coin(0.35);
      add(420, (p) => {
        const r = target.box();
        ctx.beginPath();
        ctx.roundRect(r.left, r.top, r.width, r.height, r.height / 2);
        ctx.clip();
        ctx.transform(1, 0, -slant, 1, slant * (r.top + r.height / 2), 0);
        const x = r.left - width * 2 + (r.width + width * 4) * easeInOut(p);
        const band = ctx.createLinearGradient(x - width, 0, x + width, 0);
        band.addColorStop(0, rgba(0, hot));
        band.addColorStop(0.5, rgba(0.5, hot));
        band.addColorStop(1, rgba(0, hot));
        ctx.fillStyle = band;
        ctx.fillRect(x - width, r.top - 20, width * 2, r.height + 40);
      });
    },

    // The arrow nudges its way and leaves a short pink streak behind the circle.
    trail(el, selector) {
      const target = follow(el, selector);
      const label = el.getAttribute('aria-label') || '';
      const dir = el.matches('a') ? { x: 0.707, y: -0.707 } : /^Previous/.test(label) ? { x: -1, y: 0 } : { x: 1, y: 0 };
      const nudge = R(3, 5);
      const length = R(10, 18);
      win.requestAnimationFrame(() => {
        const icon = target.node()?.querySelector('svg');
        icon?.animate(
          [{ transform: 'translate(0,0)' }, { transform: `translate(${dir.x * nudge}px,${dir.y * nudge}px)`, offset: 0.3 }, { transform: 'translate(0,0)' }],
          { duration: 400, easing: 'ease-out' },
        );
      });
      add(420, (p) => {
        const r = target.box();
        const c = center(r);
        const radius = r.width / 2 + 3;
        const hx = c.x - dir.x * radius;
        const hy = c.y - dir.y * radius;
        const tail = length * (1 - p * 0.6);
        const streak = ctx.createLinearGradient(hx - dir.x * tail, hy - dir.y * tail, hx, hy);
        streak.addColorStop(0, rgba(0));
        streak.addColorStop(1, rgba(0.9 * (1 - p)));
        glow(6);
        ctx.strokeStyle = streak;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(hx - dir.x * tail, hy - dir.y * tail);
        ctx.lineTo(hx, hy);
        ctx.stroke();
      });
    },

    // Reduced motion: nothing moves; the tapped shape's outline glows pink and fades.
    still(el, selector) {
      const target = follow(el, selector, '.day-num');
      const round = parseFloat(win.getComputedStyle(el.querySelector('.day-num') || el).borderTopLeftRadius) || 0;
      add(500, (p) => {
        const r = target.box();
        const envelope = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
        ctx.shadowColor = rgba(0.5 * envelope);
        ctx.shadowBlur = 12;
        ctx.strokeStyle = rgba(envelope);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(r.left, r.top, r.width, r.height, Math.min(round, r.height / 2, r.width / 2));
        ctx.stroke();
      });
    },
  };

  // Capture phase: measure the tapped node before the app's own handler re-renders it.
  doc.addEventListener('click', (event) => {
    const hit = event.target instanceof win.Element ? event.target : null;
    if (!hit) return;
    for (const [selector, name] of TARGETS) {
      const el = hit.closest(selector);
      if (!el) continue;
      const point = event.detail > 0 && (event.clientX || event.clientY) ? { x: event.clientX, y: event.clientY } : null;
      try {
        effects[calm.matches ? 'still' : name](el, selector, point);
      } catch {
        // Decoration only: never let an effect break the tap it decorates.
      }
      return;
    }
  }, true);
}

if (typeof document !== 'undefined') installDelight();
