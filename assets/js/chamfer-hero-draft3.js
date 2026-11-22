// Hero draft 3 for the Chamfer page: a wind of orange dots and blue squares
// flowing in several streams. Every few seconds the wind settles into the
// paper's two-pentagon counterexample behind the title
// (Chamfer/Illustrations/Counterexamples/pentagon.py), holds, and a gust blows
// it away like petals that flutter and tumble across the whole hero.
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
  const RELEASE_SPREAD = 1.6; // the gust lifts the downwind marks first, the upwind ones this much later

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
  // The break-up: a gust blows the marks away like petals. Each one is lifted
  // off in turn, picks up speed downwind, flutters side to side and tumbles,
  // and drifts along a gently curving path; as the gust dies down its own
  // stream takes over. Petals that leave one edge come back in at the opposite
  // one, so the drift covers the whole hero.
  const PETAL_SPEED = [80, 240]; // pixels per second at the height of the gust
  const PETAL_SPREAD = 0.6; // radians either side of the gust direction
  const PETAL_LIFT = 0.8; // seconds to pick up speed
  const PETAL_CALM = 4; // seconds for the gust to die down
  const PETAL_CURL = 0.35; // how much the paths curve
  const FLUTTER = { amp: [8, 28], freq: [0.5, 1.2] }; // side-to-side sway: pixels, cycles per second
  const TUMBLE = 2.2; // radians per second, the fastest a petal spins in the gust
  const FLIP = { rate: [1.2, 3], thinnest: 0.25 }; // flipping over: radians per second, how thin it gets
  const WRAP_MARGIN = 40; // pixels past an edge before a petal comes back in on the other side

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
          petalSpeed: lerp(PETAL_SPEED[0], PETAL_SPEED[1], rng()),
          petalAngle: (rng() * 2 - 1) * PETAL_SPREAD,
          curl: (rng() * 2 - 1) * PETAL_CURL,
          flutA: lerp(FLUTTER.amp[0], FLUTTER.amp[1], rng()),
          flutW: lerp(FLUTTER.freq[0], FLUTTER.freq[1], rng()) * Math.PI * 2,
          flutP: rng() * Math.PI * 2,
          tumble: (rng() * 2 - 1) * TUMBLE,
          flipRate: lerp(FLIP.rate[0], FLIP.rate[1], rng()),
          flipP: rng() * Math.PI * 2,
          mode: "flow", // "flow" in a lane, or "free" after being blown off the pentagon
          free: null,
          wrapFix: null, // edge wrap held fixed while flying to a mark, so the start never jumps
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

  // How far the gust has carried a petal after tau seconds: it picks up speed
  // over PETAL_LIFT while the gust dies down over PETAL_CALM.
  function gustDistance(speed, tau) {
    const lift = 1 / PETAL_LIFT;
    const calm = 1 / PETAL_CALM;
    return speed * ((1 - Math.exp(-calm * tau)) / calm - (1 - Math.exp(-(lift + calm) * tau)) / (lift + calm));
  }

  // Blown off the pentagon, before wrapping round the edges.
  function petalPath(p) {
    const f = p.free;
    const tau = sim - f.t0;
    const ramp = clamp01(tau / PETAL_LIFT);
    const flutter = p.flutP + p.flutW * tau;
    const carried = gustDistance(p.petalSpeed, tau);
    // Along the gust, with a small surge and sway that trace a figure eight,
    // and a sideways curl that grows with distance.
    const along = carried + 0.3 * p.flutA * Math.sin(2 * flutter) * ramp;
    const across = p.flutA * Math.sin(flutter) * ramp + (p.curl * carried * carried) / unit;
    // Its own stream takes over as the gust dies down.
    const L = lanes[p.k];
    const byStream = p.speed * (tau - PETAL_CALM * (1 - Math.exp(-tau / PETAL_CALM)));
    return [f.rx + f.gx * along - f.gy * across + L.dx * byStream, f.ry + f.gy * along + f.gx * across + L.dy * byStream];
  }

  function wrapOffset([x, y]) {
    const w = width + 2 * WRAP_MARGIN;
    const h = height + 2 * WRAP_MARGIN;
    return [Math.floor((x + WRAP_MARGIN) / w) * w, Math.floor((y + WRAP_MARGIN) / h) * h];
  }

  function freePos(p) {
    const raw = petalPath(p);
    const [ox, oy] = p.wrapFix || wrapOffset(raw);
    return [raw[0] - ox, raw[1] - oy];
  }

  // A petal's spin and flip: quick while the gust blows, settling as it dies down.
  function petalLook(p) {
    const f = p.free;
    const tau = sim - f.t0;
    const turn = p.tumble * PETAL_CALM * (1 - Math.exp(-tau / PETAL_CALM)) + p.spinV * tau;
    const gustLeft = Math.exp(-tau / (2 * PETAL_CALM)) * clamp01(tau / PETAL_LIFT);
    const flip = 1 - (1 - FLIP.thinnest) * gustLeft * Math.abs(Math.sin(p.flipP + p.flipRate * tau));
    return { angle: f.a0 + turn, flip };
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
      if (p.mode === "free") p.wrapFix = wrapOffset(petalPath(p));
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
    particles.forEach((p, i) => {
      const order = hi > lo ? (hi - proj[i]) / (hi - lo) : 0;
      p.release = sim + order * RELEASE_SPREAD + rng() * 0.3;
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
      }
      if (p.gather && sim >= p.gather.start + p.gather.dur) {
        p.gather = null;
        p.wrapFix = null;
        p.held = true;
      }
      if (p.held && phase === "flow" && sim >= p.release) {
        const [rx, ry] = slotPos(p.slot);
        const a = Math.atan2(gust.y, gust.x) + p.petalAngle;
        p.free = { rx, ry, t0: sim, gx: Math.cos(a), gy: Math.sin(a), a0: PENTAGON_OMEGA * sim };
        p.mode = "free";
        p.held = false;
      }
    }
  }

  // Where a particle is drawn and how: position, size, turn, flip (1 is face on) and opacity.
  function place(p) {
    const th = PENTAGON_OMEGA * sim;
    const M = markSize(p);
    if (p.held) {
      const [x, y] = slotPos(p.slot);
      return { x, y, size: M, angle: th, flip: 1, alpha: holdAlpha };
    }
    const [bx, by] = basePos(p);
    const look = p.mode === "free" ? petalLook(p) : { angle: p.spin + p.spinV * sim, flip: 1 };
    // Size and opacity of a petal shrink from the mark's to its own over its first moments.
    const fromMark = p.mode === "free" ? smooth(clamp01((sim - p.free.t0) / 1.2)) : 1;
    const size = lerp(M, p.size, fromMark);
    const alpha = lerp(holdAlpha, STREAM_OPACITY, fromMark);
    if (p.gather) {
      const e = easeInOut(clamp01((sim - p.gather.start) / p.gather.dur));
      const [tx, ty] = slotPos(p.slot);
      const dx = tx - bx;
      const dy = ty - by;
      const b = p.bulge * Math.sin(Math.PI * e);
      return {
        x: bx + dx * e - dy * b,
        y: by + dy * e + dx * b,
        size: lerp(size, M, e),
        angle: lerpSquareAngle(look.angle, th, e),
        flip: lerp(look.flip, 1, e),
        alpha: lerp(alpha, holdAlpha, e),
      };
    }
    return { x: bx, y: by, size, angle: look.angle, flip: look.flip, alpha };
  }

  function render() {
    ctx.clearRect(0, 0, width, height);
    const fadeIn = reduceMotion.matches ? 1 : clamp01(sim / 1.2);
    // Squares first, dots on top, as in the paper figure.
    for (const square of [true, false]) {
      ctx.fillStyle = square ? COLORS.real : COLORS.gen;
      for (const p of particles) {
        if (p.square !== square) continue;
        const { x, y, size, angle, flip, alpha } = place(p);
        ctx.globalAlpha = alpha * fadeIn;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.scale(1, flip); // a petal flipping over looks thinner
        if (square) {
          ctx.fillRect(-size / 2, -size / 2, size, size);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
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
