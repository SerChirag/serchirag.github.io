// Hero draft 2 for the Chamfer page: the paper's two-pentagon counterexample
// (Chamfer/Illustrations/Counterexamples/pentagon.py). One large pair turns
// slowly behind the title, and a few small pairs turn at the edges. A sheet of
// frosted glass (CSS, in the hero include) softens them, so they are drawn
// nearly opaque.
//
// Geometry, as in the paper: real samples (green squares) on a regular
// pentagon of radius 1, one vertex up; candidates (orange, drawn here as round
// dots where the paper uses stars) at the centre plus a pentagon of radius
// sqrt(5/4) turned by 36 degrees. Each pair rotates
// as one rigid piece, so the construction stays exact.
(() => {
  const hero = document.getElementById("pentagon-hero");
  if (!hero) return;
  const canvas = hero.querySelector(".pentagon-hero-canvas");
  const content = hero.querySelector(".pentagon-hero-content");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const N = 5;
  const RHO = Math.sqrt(N / (N - 1));
  const COLORS = { real: "#1F9D72", gen: "#F08A2C" };

  // Sizes in units of the real pentagon's radius, measured off the paper figure.
  const SQUARE_SIDE = 0.145;
  const DOT_RADIUS = 0.085; // about the same area as a square
  const BOUND = RHO + DOT_RADIUS; // radius of the circle that holds a whole pair

  // The large pair behind the title.
  const FRAME_SIZE = 0.34; // bounding radius, as a share of the hero's short side
  const FRAME_ALPHA = 0.6;
  const FRAME_OMEGA = 0.025; // radians per second, before SPIN

  // Overall rotation speed, multiplying every pair's own speed.
  const SPIN = 1.15;

  // The pairs around it, in three sizes: [size as a share of the hero's short
  // side, count at 1280 x 720, opacity]. The largest tier may hang off the edges.
  const TIERS = [
    [0.16, 2, 0.85],
    [0.085, 4, 0.9],
    [0.05, 7, 0.85],
  ];
  // Multiplies every tier's count. Pairs that find no room are dropped, so the
  // number on screen is lower than asked on small or crowded heroes.
  const DENSITY = 1.2;
  const PLACE_TRIES = 1000; // attempts to find room for each pair

  // Room between pairs: centres at least SPACING times the sum of their
  // bounding radii apart, and FRAME_GAP pixels clear of the large pair.
  const SPACING = 1.6;
  const FRAME_GAP = 48;
  // Smallest mark sizes in pixels, so marks stay visible through the frost.
  const MIN_SQUARE = 6;
  const MIN_DOT = 3.5; // radius

  const SEED = 2026;
  const FADE_MS = 1400;

  const ngon = (r, rotDeg, n = N) =>
    Array.from({ length: n }, (_, i) => {
      const a = ((rotDeg + (360 * i) / n) * Math.PI) / 180;
      return [r * Math.cos(a), -r * Math.sin(a)];
    });
  const REAL = ngon(1, 90);
  const GEN = ngon(RHO, 90 + 180 / N);

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let width = 0;
  let height = 0;
  let items = [];
  let start = performance.now();
  let raf = 0;
  let visible = true;
  let firstLayout = true;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // The large pair centred on the title, then a few small pairs per tier, with
  // room between them. A small pair may reach under the edge of the title
  // block, but its centre stays outside it, so the text never sits on a whole pair.
  function layout() {
    const heroBox = hero.getBoundingClientRect();
    const textBox = content.getBoundingClientRect();
    const title = {
      left: textBox.left - heroBox.left,
      right: textBox.right - heroBox.left,
      top: textBox.top - heroBox.top,
      bottom: textBox.bottom - heroBox.top,
    };

    const rng = mulberry32(SEED);
    const unit = Math.min(width, height);
    const areaScale = Math.max(0.5, Math.min(1.6, (width * height) / (1280 * 720)));

    const frameBound = unit * FRAME_SIZE;
    const frame = {
      x: width / 2,
      y: (title.top + title.bottom) / 2,
      r: frameBound / BOUND,
      bound: frameBound,
      alpha: FRAME_ALPHA,
      theta0: 0,
      omega: FRAME_OMEGA * SPIN,
      delay: firstLayout ? 0 : -FADE_MS,
    };
    const placed = [frame];
    const crowds = (x, y, bound) =>
      placed.some((p) => {
        const room = p === frame ? p.bound + bound + FRAME_GAP : (p.bound + bound) * SPACING + 24;
        return Math.hypot(p.x - x, p.y - y) < room;
      });

    TIERS.forEach(([share, baseCount, alpha], tier) => {
      const count = Math.max(1, Math.round(baseCount * DENSITY * areaScale));
      const r0 = Math.max(12, share * unit);
      for (let i = 0; i < count; i++) {
        const r = r0 * (0.85 + 0.3 * rng());
        const bound = r * BOUND;
        const margin = tier === 0 ? -0.3 * bound : bound + 8;
        for (let tries = 0; tries < PLACE_TRIES; tries++) {
          const x = margin + rng() * (width - 2 * margin);
          const y = margin + rng() * (height - 2 * margin);
          if (x > title.left && x < title.right && y > title.top && y < title.bottom) continue;
          if (crowds(x, y, bound)) continue;
          placed.push({
            x,
            y,
            r,
            bound,
            alpha,
            theta0: rng() * Math.PI * 2,
            // Same direction as the large pair; smaller pairs turn a little faster.
            omega: (0.05 + 0.025 * rng()) * (1 + 0.25 * tier) * SPIN,
            delay: firstLayout ? 200 + 300 * tier + 400 * rng() : -FADE_MS,
          });
          break;
        }
      }
    });
    items = placed;
    firstLayout = false;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = hero.clientWidth;
    height = hero.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
    draw(performance.now());
  }

  function dot(x, y, radius) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Flat marks only: no outlines and no lines joining them.
  function drawPair(item, theta, fade) {
    const R = item.r;
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(theta);
    ctx.globalAlpha = item.alpha * fade;
    const side = Math.max(MIN_SQUARE, SQUARE_SIDE * R);
    ctx.fillStyle = COLORS.real;
    for (const [x, y] of REAL) ctx.fillRect(x * R - side / 2, y * R - side / 2, side, side);
    const radius = Math.max(MIN_DOT, DOT_RADIUS * R);
    ctx.fillStyle = COLORS.gen;
    dot(0, 0, radius);
    for (const [x, y] of GEN) dot(x * R, y * R, radius);
    ctx.restore();
  }

  const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

  function draw(now) {
    const still = reduceMotion.matches;
    const t = still ? 0 : (now - start) / 1000;
    ctx.clearRect(0, 0, width, height);
    for (const item of items) {
      const p = still ? 1 : (now - start - item.delay) / FADE_MS;
      const fade = p <= 0 ? 0 : p >= 1 ? 1 : easeInOut(p);
      if (fade > 0) drawPair(item, item.theta0 + item.omega * t, fade);
    }
  }

  function frame(now) {
    raf = 0;
    draw(now);
    schedule();
  }

  function schedule() {
    if (!raf && visible && !reduceMotion.matches) raf = requestAnimationFrame(frame);
  }

  let resizeQueued = false;
  new ResizeObserver(() => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      resize();
    });
  }).observe(hero);

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    schedule();
  }).observe(hero);

  reduceMotion.addEventListener("change", () => {
    draw(performance.now());
    schedule();
  });

  start = performance.now();
  resize();
  schedule();
})();
