// Hero draft 3 for the Chamfer page: a wind of orange dots and blue squares
// flowing in several streams. Every few seconds the wind settles into the
// paper's two-pentagon counterexample behind the title
// (Chamfer/Illustrations/Counterexamples/pentagon.py), holds, and a gust blows
// it apart across the whole hero, where the particles drift on with the wind.
//
// Geometry, as in the paper: real samples (squares) on a regular
// pentagon of radius 1, one vertex up; candidates (orange, drawn as round dots
// where the paper uses stars) at the centre plus a pentagon of radius
// sqrt(5/4) turned by 36 degrees. Several particles merge into each mark.
(() => {
  const hero = document.getElementById("pentagon-hero");
  if (!hero) return;
  const canvas = hero.querySelector(".pentagon-hero-canvas");
  const content = hero.querySelector(".pentagon-hero-content");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const N = 5;
  const RHO = Math.sqrt(N / (N - 1));
  // Real samples are blue here (green in the paper's figures); candidates orange.
  const COLORS = { real: "#2F80ED", gen: "#F08A2C" };

  // Sizes in units of the real pentagon's radius, measured off the paper figure.
  const SQUARE_SIDE = 0.145;
  const DOT_RADIUS = 0.085;
  const BOUND = RHO + DOT_RADIUS; // radius of the circle that holds the pentagon pair

  const ngon = (r, rotDeg) =>
    Array.from({ length: N }, (_, i) => {
      const a = ((rotDeg + (360 * i) / N) * Math.PI) / 180;
      return [r * Math.cos(a), -r * Math.sin(a)];
    });
  // The 11 marks: 5 squares on the real pentagon, then the centre dot and 5 dots on the turned one.
  const SLOTS = [
    ...ngon(1, 90).map(([x, y]) => ({ x, y, square: true })),
    { x: 0, y: 0, square: false },
    ...ngon(RHO, 90 + 180 / N).map(([x, y]) => ({ x, y, square: false })),
  ];

  // The pentagon the wind settles into. The first one forms behind the title;
  // each later one picks a new place and size, away from the last one.
  const FIRST_PENTAGON_SIZE = 0.34; // bounding radius, as a share of the hero's short side
  const PENTAGON_SIZE = [0.16, 0.36]; // range for the later ones
  const PENTAGON_MOVE = 0.35; // a new pentagon's centre is at least this far from the last, as a share of the short side
  const PENTAGON_OMEGA = 0.03; // radians per second
  const HOLD_OPACITY = 0.75; // of a finished mark, with all its particles stacked

  // Timeline, in seconds.
  const FIRST_FLOW = 2.5; // wind before the first pentagon, right after the page loads
  const FLOW = 5.5; // wind between a release and the next pentagon
  const GATHER = 3; // the wind calms while every particle flies to its mark
  const HOLD = 4; // the pentagon on its own
  const RELEASE_SPREAD = 0.9; // the gust takes the downwind marks first, the upwind ones this much later

  // The wind.
  const PER_SLOT = 18; // particles that merge into each mark (198 in all)
  // [direction in degrees (0 = right, 90 = down), the lane passes through (x, y)
  // as shares of the hero's width and height, bend as a share of the short side]
  const STREAMS = [
    [8, 0.5, 0.18, 0.08],
    [190, 0.5, 0.84, -0.06],
    [300, 0.15, 0.62, 0.05],
    [125, 0.86, 0.38, -0.05],
  ];
  const BAND = 0.1; // half-width of a stream, as a share of the short side
  const SPEED = [42, 70]; // pixels per second
  const STREAM_SQUARE = [5.5, 7.5]; // side in pixels
  const STREAM_DOT = [2.75, 3.75]; // radius in pixels
  const STREAM_OPACITY = 0.9;
  // The break-up: each particle bursts out to its own spot, spread evenly over
  // the whole hero, then drifts on with its stream.
  const SPREAD_TIME = 2.6; // seconds to reach its spot
  const SPREAD_MARGIN = { x: 16, y: 0.06 }; // keep spots this far in: pixels at the sides, share of the height top and bottom
  const GUST_PUSH = 90; // pixels the paths bow out along the gust direction

  const SEED = 2026;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const holdAlpha = 1 - (1 - HOLD_OPACITY) ** (1 / PER_SLOT);

  let width = 0;
  let height = 0;
  let unit = 1;
  let lanes = [];
  let pent = { x: 0, y: 0, R: 1 };
  let pentShare = null; // { fx, fy, size } as shares of the hero, or null for behind the title
  let particles = [];
  let sim = 0; // seconds of animation, paused while the hero is off screen
  let last = 0;
  let phase = "flow";
  let phaseStart = 0;
  let flowLength = FIRST_FLOW;
  let cycle = 0;
  let gust = { x: 1, y: 0 };
  let raf = 0;
  let visible = true;

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

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const smooth = (p) => p * p * (3 - 2 * p);
  const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  // Squares look the same every quarter turn, so turn the short way round.
  const lerpSquareAngle = (a, b, t) => {
    const q = Math.PI / 2;
    let d = (((b - a) % q) + q) % q;
    if (d > q / 2) d -= q;
    return a + d * t;
  };

  function measure() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = hero.clientWidth;
    height = hero.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    unit = Math.min(width, height);
    placePentagon();

    const corners = [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ];
    lanes = STREAMS.map(([deg, px, py, bend]) => {
      const a = (deg * Math.PI) / 180;
      const ox = px * width;
      const oy = py * height;
      // Long enough that both ends are off screen, so wrapping round is never seen.
      const half = Math.max(...corners.map(([cx, cy]) => Math.hypot(cx - ox, cy - oy))) + 80;
      return { ox, oy, dx: Math.cos(a), dy: Math.sin(a), nx: -Math.sin(a), ny: Math.cos(a), half, bend: bend * unit };
    });
  }

  function placePentagon() {
    if (pentShare) {
      pent = { x: pentShare.fx * width, y: pentShare.fy * height, R: (pentShare.size * unit) / BOUND };
      return;
    }
    const heroBox = hero.getBoundingClientRect();
    const textBox = content.getBoundingClientRect();
    pent = {
      x: width / 2,
      y: (textBox.top + textBox.bottom) / 2 - heroBox.top,
      R: (FIRST_PENTAGON_SIZE * unit) / BOUND,
    };
  }

  // A new place and size, fully on screen and away from the last pentagon.
  function choosePentagon() {
    if (cycle === 0) {
      pentShare = null;
      placePentagon();
      return;
    }
    const rng = mulberry32(SEED + 2000 + cycle);
    const last = { x: pent.x, y: pent.y };
    for (let tries = 0; tries < 40; tries++) {
      const size = lerp(PENTAGON_SIZE[0], PENTAGON_SIZE[1], rng());
      const bound = size * unit;
      const x0 = bound + 16;
      const x1 = width - bound - 16;
      const y0 = bound + 0.08 * height;
      const y1 = height - bound - 0.1 * height;
      if (x1 < x0 || y1 < y0) continue;
      const x = lerp(x0, x1, rng());
      const y = lerp(y0, y1, rng());
      if (tries < 39 && Math.hypot(x - last.x, y - last.y) < PENTAGON_MOVE * unit) continue;
      pentShare = { fx: x / width, fy: y / height, size };
      break;
    }
    placePentagon();
  }

  function makeParticles() {
    const rng = mulberry32(SEED);
    particles = [];
    SLOTS.forEach((slot, j) => {
      for (let i = 0; i < PER_SLOT; i++) {
        const k = Math.floor(rng() * lanes.length);
        const range = slot.square ? STREAM_SQUARE : STREAM_DOT;
        particles.push({
          slot: j,
          square: slot.square,
          k,
          s: (rng() * 2 - 1) * lanes[k].half, // position along the lane
          u: (rng() * 2 - 1) * BAND, // position across the lane
          wobA: 4 + 14 * rng(),
          wobF: 0.3 + 0.6 * rng(),
          wobP: rng() * Math.PI * 2,
          speed: SPEED[0] + (SPEED[1] - SPEED[0]) * rng(),
          size: range[0] + (range[1] - range[0]) * rng(),
          spin: rng() * Math.PI * 2,
          spinV: (rng() * 2 - 1) * 0.6,
          bulge: (rng() * 2 - 1) * 0.25, // how much the path curves on the way to the mark
          spread: (rng() * 2 - 1) * 0.25, // radians off the gust direction
          mode: "flow", // "flow" in a lane, or "free" after being blown off the pentagon
          free: null,
          gather: null, // { start, dur } while flying to the mark
          held: false,
          release: 0,
        });
      }
    });
  }

  function slotPos(j) {
    const s = SLOTS[j];
    const th = PENTAGON_OMEGA * sim;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    return [pent.x + (s.x * c - s.y * sn) * pent.R, pent.y + (s.x * sn + s.y * c) * pent.R];
  }

  const markSize = (p) => (p.square ? SQUARE_SIDE : DOT_RADIUS) * pent.R;

  function lanePos(p) {
    const L = lanes[p.k];
    const along = p.s / L.half;
    const across = p.u * unit + p.wobA * Math.sin(p.wobP + p.wobF * sim) + L.bend * along * along;
    return [L.ox + L.dx * p.s + L.nx * across, L.oy + L.dy * p.s + L.ny * across];
  }

  // Blown off the pentagon: a fast burst out to the particle's own spot, bowed
  // along the gust, easing into a drift with its stream.
  function freePos(p) {
    const f = p.free;
    const tau = sim - f.t0;
    const T = SPREAD_TIME;
    const k = clamp01(tau / T);
    const e = 1 - (1 - k) ** 3;
    const push = GUST_PUSH * Math.sin(Math.PI * k);
    const drift = p.speed * (tau < T ? (tau * tau) / (2 * T) : tau - T / 2);
    const L = lanes[p.k];
    const wob = p.wobA * Math.sin(p.wobP + p.wobF * sim) * k;
    return [lerp(f.rx, f.tx, e) + f.gx * push + L.dx * drift + L.nx * wob, lerp(f.ry, f.ty, e) + f.gy * push + L.dy * drift + L.ny * wob];
  }

  const basePos = (p) => (p.mode === "free" ? freePos(p) : lanePos(p));

  function windRate() {
    const t = sim - phaseStart;
    if (phase === "gather") return 1 - smooth(clamp01(t / GATHER));
    if (phase === "hold") return 0;
    return cycle === 0 ? 1 : smooth(clamp01(t / 1.5));
  }

  function startGather() {
    phase = "gather";
    phaseStart = sim;
    choosePentagon();
    const rng = mulberry32(SEED + 1000 + cycle);
    for (const p of particles) {
      const [x, y] = basePos(p);
      const [tx, ty] = slotPos(p.slot);
      const dur = Math.max(1.3, Math.min(2.3, Math.hypot(tx - x, ty - y) / 420));
      p.gather = { start: sim + rng() * 0.7, dur };
    }
  }

  function startRelease() {
    cycle++;
    const rng = mulberry32(SEED + cycle);
    const L = lanes[Math.floor(rng() * lanes.length)];
    gust = { x: L.dx, y: L.dy };
    const proj = particles.map((p) => {
      const [x, y] = slotPos(p.slot);
      return x * gust.x + y * gust.y;
    });
    const lo = Math.min(...proj);
    const hi = Math.max(...proj);
    // Spots spread evenly over the whole hero: one jittered grid cell per particle, shuffled.
    const cols = Math.max(1, Math.round(Math.sqrt((particles.length * width) / height)));
    const rows = Math.ceil(particles.length / cols);
    const cells = Array.from({ length: cols * rows }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const top = SPREAD_MARGIN.y * height;
    const bottom = (1 - SPREAD_MARGIN.y) * height;
    particles.forEach((p, i) => {
      const order = hi > lo ? (hi - proj[i]) / (hi - lo) : 0;
      p.release = sim + order * RELEASE_SPREAD + rng() * 0.2;
      const cx = ((cells[i] % cols) + rng()) / cols;
      const cy = (Math.floor(cells[i] / cols) + rng()) / rows;
      p.dest = { x: lerp(SPREAD_MARGIN.x, width - SPREAD_MARGIN.x, cx), y: lerp(top, bottom, cy) };
    });
    phase = "flow";
    phaseStart = sim;
    flowLength = FLOW;
  }

  function step(dt) {
    sim += dt;
    const t = sim - phaseStart;
    if (phase === "flow" && t >= flowLength && particles.every((p) => !p.held)) startGather();
    else if (phase === "gather" && particles.every((p) => p.held)) {
      phase = "hold";
      phaseStart = sim;
    } else if (phase === "hold" && t >= HOLD) startRelease();

    const rate = windRate();
    for (const p of particles) {
      const busy = p.gather || p.held;
      if (p.mode === "flow") {
        p.s += p.speed * rate * dt;
        if (!busy && p.s > lanes[p.k].half) p.s -= 2 * lanes[p.k].half;
      } else if (!busy) {
        // Off the edge after being blown away: rejoin the lane upstream, off screen.
        const [x, y] = freePos(p);
        const m = 30 + p.size;
        if (x < -m || x > width + m || y < -m || y > height + m) {
          p.mode = "flow";
          p.free = null;
          p.s = -lanes[p.k].half;
        }
      }
      if (p.gather && sim >= p.gather.start + p.gather.dur) {
        p.gather = null;
        p.held = true;
      }
      if (p.held && phase === "flow" && sim >= p.release) {
        const [rx, ry] = slotPos(p.slot);
        const a = Math.atan2(gust.y, gust.x) + p.spread;
        p.free = { rx, ry, tx: p.dest.x, ty: p.dest.y, t0: sim, gx: Math.cos(a), gy: Math.sin(a) };
        p.mode = "free";
        p.held = false;
      }
    }
  }

  function place(p) {
    const th = PENTAGON_OMEGA * sim;
    const streamAngle = p.spin + p.spinV * sim;
    const M = markSize(p);
    if (p.held) {
      const [x, y] = slotPos(p.slot);
      return { x, y, size: M, angle: th, alpha: holdAlpha };
    }
    const [bx, by] = basePos(p);
    if (p.gather) {
      const e = easeInOut(clamp01((sim - p.gather.start) / p.gather.dur));
      const [tx, ty] = slotPos(p.slot);
      const dx = tx - bx;
      const dy = ty - by;
      const b = p.bulge * Math.sin(Math.PI * e);
      return {
        x: bx + dx * e - dy * b,
        y: by + dy * e + dx * b,
        size: lerp(p.size, M, e),
        angle: lerpSquareAngle(streamAngle, th, e),
        alpha: lerp(STREAM_OPACITY, holdAlpha, e),
      };
    }
    if (p.mode === "free") {
      const k = smooth(clamp01((sim - p.free.t0) / 1.2));
      return {
        x: bx,
        y: by,
        size: lerp(M, p.size, k),
        angle: lerpSquareAngle(th, streamAngle, k),
        alpha: lerp(holdAlpha, STREAM_OPACITY, k),
      };
    }
    return { x: bx, y: by, size: p.size, angle: streamAngle, alpha: STREAM_OPACITY };
  }

  function render() {
    ctx.clearRect(0, 0, width, height);
    const fadeIn = reduceMotion.matches ? 1 : clamp01(sim / 1.2);
    // Squares first, dots on top, as in the paper figure.
    for (const square of [true, false]) {
      ctx.fillStyle = square ? COLORS.real : COLORS.gen;
      for (const p of particles) {
        if (p.square !== square) continue;
        const { x, y, size, angle, alpha } = place(p);
        ctx.globalAlpha = alpha * fadeIn;
        if (square) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.fillRect(-size / 2, -size / 2, size, size);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    step(dt);
    render();
    schedule();
  }

  function schedule() {
    if (!visible || reduceMotion.matches) {
      last = 0;
      return;
    }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  // With reduced motion, show the finished pentagon and nothing moving.
  function showStill() {
    for (const p of particles) {
      p.gather = null;
      p.held = true;
    }
    phase = "hold";
    render();
  }

  let resizeQueued = false;
  new ResizeObserver(() => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      measure();
      render();
    });
  }).observe(hero);

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    schedule();
  }).observe(hero);

  reduceMotion.addEventListener("change", () => {
    if (reduceMotion.matches) showStill();
    schedule();
  });

  measure();
  makeParticles();
  if (reduceMotion.matches) showStill();
  schedule();
})();
