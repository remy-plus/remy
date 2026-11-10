// Weighted scrolling for remy.plus. The wheel does not jump: it pushes a target, and the page glides
// to it with a soft start and a long, even stop. Anchor links travel there on a slow ease, like a lid
// lifting. Keyboard, scrollbar and touch stay native. Nothing runs under reduced motion, on touch
// screens, or inside an element that scrolls on its own.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeInOut = (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2); // quartic: slow, then slow

/**
 * @param {{ weight?: number, step?: number, onFrame?: (y: number, velocity: number) => void }} opts
 * `weight`: how heavy the page feels (higher is quicker to catch up). `step`: how far one notch goes.
 */
export function smoothScroll({ weight = 5.5, step = 0.85, onFrame } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  if (matchMedia('(pointer: coarse)').matches) return null;
  const root = document.documentElement;
  const max = () => Math.max(0, root.scrollHeight - innerHeight);
  let target = scrollY;
  let current = scrollY;
  let velocity = 0;
  let raf = 0;
  let last = 0;
  let tween = null;
  let own = false; // true while the scroll position is being set by this engine

  const set = (y) => {
    own = true;
    scrollTo(0, y);
    requestAnimationFrame(() => {
      own = false;
    });
  };

  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    const before = current;
    if (tween) {
      const p = clamp((now - tween.t0) / tween.ms, 0, 1);
      current = tween.from + (tween.to - tween.from) * easeInOut(p);
      target = current;
      if (p >= 1) tween = null;
    } else {
      // Frame-rate independent catch-up: the gap closes by a fixed share each second.
      current += (target - current) * (1 - Math.exp(-dt * weight));
      if (Math.abs(target - current) < 0.15) current = target;
    }
    velocity = (current - before) / Math.max(dt, 0.001);
    set(current);
    onFrame?.(current, velocity);
    if (tween || current !== target) raf = requestAnimationFrame(frame);
    else raf = 0;
  };
  const run = () => {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  const insideScroller = (el) => {
    for (let n = el; n && n !== root; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return true;
    }
    return false;
  };

  addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.defaultPrevented || insideScroller(e.target)) return;
      e.preventDefault();
      tween = null;
      const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? innerHeight : 1;
      target = clamp(target + e.deltaY * unit * step, 0, max());
      run();
    },
    { passive: false },
  );

  // Anything else that moves the page (keys, scrollbar drag, find) is taken as the new position.
  addEventListener(
    'scroll',
    () => {
      if (own) return;
      current = target = scrollY;
      velocity = 0;
      onFrame?.(current, 0);
    },
    { passive: true },
  );

  // Anchor links glide, slowly, and leave room for the header.
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const id = a.getAttribute('href').slice(1);
    const el = id ? document.getElementById(id) : root;
    if (!el) return;
    e.preventDefault();
    const to = clamp(id ? el.getBoundingClientRect().top + scrollY - 72 : 0, 0, max());
    tween = {
      from: current,
      to,
      t0: performance.now(),
      ms: clamp(Math.abs(to - current) * 0.55 + 700, 900, 2200),
    };
    history.replaceState(null, '', id ? `#${id}` : location.pathname);
    run();
  });

  addEventListener('resize', () => {
    target = clamp(target, 0, max());
  });
  onFrame?.(current, 0);
  return {
    scrollTo(y) {
      tween = { from: current, to: clamp(y, 0, max()), t0: performance.now(), ms: 1200 };
      run();
    },
  };
}
