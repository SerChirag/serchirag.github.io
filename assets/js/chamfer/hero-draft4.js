// Hero draft 4 for the Chamfer page: swirling gusts. Blue squares and orange
// dots ride a smooth, ever-changing swirl of wind, each leaving a short trail.
// Neighbours move together while different parts of the hero swirl in
// different directions. Every few seconds the particles gather into the
// paper's two-pentagon counterexample (Chamfer/Illustrations/Counterexamples/
// pentagon.py) at a new place and size; when it breaks, each mark unravels
// into its own winding gust, the gusts head off in different directions and
// loosen until they cover the hero.
//
// Geometry, as in the paper: real samples (squares) on a regular pentagon of
// radius 1, one vertex up; candidates (orange, drawn as round dots where the
// paper uses stars) at the centre plus a pentagon of radius sqrt(5/4) turned
// by 36 degrees. Several particles merge into each mark.
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

  // The pentagon. The first one forms behind the title; each later one picks
  // a new place and size, away from the last one.
  const FIRST_PENTAGON_SIZE = 0.34; // bounding radius, as a share of the hero's short side
  const PENTAGON_SIZE = [0.16, 0.36]; // range for the later ones
  const PENTAGON_MOVE = 0.35; // a new pentagon's centre is at least this far from the last, as a share of the short side
  const PENTAGON_OMEGA = 0.03; // radians per second
  const HOLD_OPACITY = 0.75; // of a finished mark, with all its particles stacked

  // Timeline, in seconds.
  const FIRST_FLOW = 2.5; // swirling before the first pentagon, right after the page loads
  const FLOW = 7; // swirling between a break-up and the next pentagon
  const GATHER = 3; // the wind calms while every particle flies to its mark
  const HOLD = 4; // the pentagon on its own

  // The particles.
  const PER_SLOT = 36; // particles that merge into each mark (396 in all)
  const PARTICLE_SQUARE = [5.5, 7.5]; // side in pixels
  const PARTICLE_DOT = [2.75, 3.75]; // radius in pixels
  const PARTICLE_OPACITY = 0.9;
  const SPEED_SPREAD = [0.8, 1.2]; // each particle's own speed, as a multiple of the wind's

  // The swirling wind: the curl of smooth noise that drifts over time, so it
  // never piles particles up or thins them out.
  const SWIRL_SIZE = 0.4; // size of a swirl, as a share of the short side
  const SWIRL_DETAIL = 0.4; // weight of smaller swirls on top
  const SWIRL_SPEED = 55; // pixels per second, roughly the typical wind speed
  const SWIRL_CHANGE = 0.06; // how quickly the swirls change shape

  // The break-up: each mark unravels into its own gust, one particle after
  // another. Every gust heads its own way (roughly outward from its mark, with
  // a random twist) and winds through a swirl of its own. Within a gust the
  // particles fan out a little and ride slightly different swirls, so the
  // gusts loosen as they travel and spread over the whole hero.
  const UNRAVEL_GAP = 0.035; // seconds between particles leaving the same mark (about 1.3 s per mark)
  const UNRAVEL_JITTER = 3; // pixels of spread as they leave, so a stream has some width
  const PICK_UP = 0.6; // seconds for a released particle to reach full speed
  const GUST_SPEED = [90, 150]; // pixels per second a gust carries its particles at first
  const GUST_FADE = 3.5; // seconds for that push to die down, leaving the swirl
  const GUST_TWIST = 0.8; // radians a gust's heading turns away from straight out
  const GUST_FAN = 0.35; // radians the particles of one gust fan out
  const GUST_LOOSEN = 0.15; // how different each particle's swirl is from its gust's

  // Trails.
  const TRAIL = 14; // frames of history drawn behind each particle
  const TRAIL_OPACITY = 0.35; // at the particle, fading to nothing
  const TRAIL_WIDTH = 4; // pixels at the particle, tapering to nothing
  const WRAP_MARGIN = 40; // pixels past an edge before a particle comes back in on the other side

  const SEED = 2026;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const holdAlpha = 1 - (1 - HOLD_OPACITY) ** (1 / PER_SLOT);

  let width = 0;
  let height = 0;
  let unit = 1;
  let pent = { x: 0, y: 0, R: 1 };
  let pentShare = null; // { fx, fy, size } as shares of the hero, or null for behind the title
  let particles = [];
  let sim = 0; // seconds of animation, paused while the hero is off screen
  let last = 0;
  let phase = "flow";
  let phaseStart = 0;
  let flowLength = FIRST_FLOW;
  let cycle = 0;
  // One gust per mark: { angle, speed, swirl }. Before the first break-up
  // there is no push, and every mark's particles have their own swirl.
  let gusts = SLOTS.map((_, j) => ({ angle: 0, speed: 0, swirl: 7.3 * j }));
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

  // Smooth 3D gradient noise (Perlin's improved noise), seeded.
  function makeNoise(seed) {
    const rng = mulberry32(seed);
    const perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const grad = (hash, x, y, z) => {
      const h = hash & 15;
      const u = h < 8 ? x : y;
      const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
      return (h & 1 ? -u : u) + (h & 2 ? -v : v);
    };
    return (x, y, z) => {
      const fx = Math.floor(x);
      const fy = Math.floor(y);
      const fz = Math.floor(z);
      const X = fx & 255;
      const Y = fy & 255;
      const Z = fz & 255;
      x -= fx;
      y -= fy;
      z -= fz;
      const u = fade(x);
      const v = fade(y);
      const w = fade(z);
      const A = p[X] + Y;
      const AA = p[A] + Z;
      const AB = p[A + 1] + Z;
      const B = p[X + 1] + Y;
      const BA = p[B] + Z;
      const BB = p[B + 1] + Z;
      return lerp(
        lerp(lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u), lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
        lerp(
          lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
          lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u),
          v
        ),
        w
      );
    };
  }
  const noise = makeNoise(SEED);

  // The stream function: one size of swirl plus smaller ones on top.
  function swirlPotential(x, y, z) {
    return noise(x, y, z) + SWIRL_DETAIL * noise(2.1 * x + 17.3, 2.1 * y - 9.1, 1.7 * z);
  }

  // The wind at a point: the curl of the stream function, so it swirls
  // without piling particles up. `swirl` picks one of many different swirls.
  function windAt(x, y, swirl) {
    const s = 1 / (SWIRL_SIZE * unit);
    const nx = x * s;
    const ny = y * s;
    const nz = sim * SWIRL_CHANGE + swirl;
    const e = 0.01;
    const ddx = (swirlPotential(nx + e, ny, nz) - swirlPotential(nx - e, ny, nz)) / (2 * e);
    const ddy = (swirlPotential(nx, ny + e, nz) - swirlPotential(nx, ny - e, nz)) / (2 * e);
    return [ddy * SWIRL_SPEED, -ddx * SWIRL_SPEED];
  }

  function measure() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = hero.clientWidth;
    height = hero.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    unit = Math.min(width, height);
    placePentagon();
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
    const lastSpot = { x: pent.x, y: pent.y };
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
      if (tries < 39 && Math.hypot(x - lastSpot.x, y - lastSpot.y) < PENTAGON_MOVE * unit) continue;
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
        const range = slot.square ? PARTICLE_SQUARE : PARTICLE_DOT;
        particles.push({
          slot: j,
          order: i, // place in line when its mark unravels
          square: slot.square,
          x: rng() * width,
          y: rng() * height,
          speed: lerp(SPEED_SPREAD[0], SPEED_SPREAD[1], rng()),
          size: lerp(range[0], range[1], rng()),
          spin: rng() * Math.PI * 2,
          spinV: (rng() * 2 - 1) * 0.6,
          bulge: (rng() * 2 - 1) * 0.25, // how much the path curves on the way to the mark
          fan: (rng() * 2 - 1) * GUST_FAN, // radians off its gust's heading
          loosen: (rng() * 2 - 1) * GUST_LOOSEN, // how far its swirl is from its gust's
          gather: null, // { start, dur } while flying to the mark
          held: false,
          release: 0,
          t0: -Infinity, // when it last left a mark
          trail: [],
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

  function windRate() {
    const t = sim - phaseStart;
    if (phase === "gather") return 1 - smooth(clamp01(t / GATHER));
    if (phase === "hold") return 0;
    return 1;
  }

  function startGather() {
    phase = "gather";
    phaseStart = sim;
    choosePentagon();
    const rng = mulberry32(SEED + 1000 + cycle);
    for (const p of particles) {
      const [tx, ty] = slotPos(p.slot);
      const dur = Math.max(1.3, Math.min(2.3, Math.hypot(tx - p.x, ty - p.y) / 420));
      p.gather = { start: sim + rng() * 0.7, dur };
    }
  }

  // Every mark unravels at once, each into its own gust.
  function startRelease() {
    cycle++;
    const rng = mulberry32(SEED + cycle);
    const th = PENTAGON_OMEGA * sim;
    gusts = SLOTS.map((s, j) => {
      // Straight out from the pentagon's centre (the centre mark picks any way), then twisted.
      const out = s.x || s.y ? Math.atan2(s.y, s.x) + th : rng() * Math.PI * 2;
      return {
        angle: out + (rng() * 2 - 1) * GUST_TWIST,
        speed: lerp(GUST_SPEED[0], GUST_SPEED[1], rng()),
        swirl: 100 + 13.7 * cycle + 7.3 * j,
      };
    });
    const markDelay = SLOTS.map(() => rng() * 0.4);
    for (const p of particles) p.release = sim + markDelay[p.slot] + p.order * UNRAVEL_GAP;
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
    const w = width + 2 * WRAP_MARGIN;
    const h = height + 2 * WRAP_MARGIN;
    const jitter = mulberry32(SEED + 3000 + Math.floor(sim * 60));
    for (const p of particles) {
      if (p.held) {
        if (phase === "flow" && sim >= p.release) {
          const [x, y] = slotPos(p.slot);
          p.x = x + (jitter() * 2 - 1) * UNRAVEL_JITTER;
          p.y = y + (jitter() * 2 - 1) * UNRAVEL_JITTER;
          p.t0 = sim;
          p.held = false;
          p.trail = [];
        }
        continue;
      }
      // Its gust's own swirl, plus the gust's push, which dies down after the break-up.
      const g = gusts[p.slot];
      const [vx, vy] = windAt(p.x, p.y, g.swirl + p.loosen);
      const tau = sim - p.t0;
      const pickUp = clamp01(tau / PICK_UP);
      const push = tau === Infinity ? 0 : g.speed * Math.exp(-tau / GUST_FADE) * pickUp;
      const heading = g.angle + p.fan;
      p.x += (vx * p.speed * pickUp + Math.cos(heading) * push) * rate * dt;
      p.y += (vy * p.speed * pickUp + Math.sin(heading) * push) * rate * dt;
      if (!p.gather) {
        // Off one edge, back in at the other.
        if (p.x < -WRAP_MARGIN) p.x += w;
        else if (p.x > width + WRAP_MARGIN) p.x -= w;
        if (p.y < -WRAP_MARGIN) p.y += h;
        else if (p.y > height + WRAP_MARGIN) p.y -= h;
      } else if (sim >= p.gather.start + p.gather.dur) {
        p.gather = null;
        p.held = true;
      }
    }
  }

  // Where a particle is drawn and how: position, size, turn and opacity.
  function place(p) {
    const th = PENTAGON_OMEGA * sim;
    const M = markSize(p);
    if (p.held) {
      const [x, y] = slotPos(p.slot);
      return { x, y, size: M, angle: th, alpha: holdAlpha };
    }
    const angle = p.spin + p.spinV * sim;
    // Size and opacity shrink from the mark's to the particle's own as it leaves.
    const fromMark = smooth(clamp01((sim - p.t0) / 0.8));
    const size = lerp(M, p.size, fromMark);
    const alpha = lerp(holdAlpha, PARTICLE_OPACITY, fromMark);
    if (p.gather) {
      const e = easeInOut(clamp01((sim - p.gather.start) / p.gather.dur));
      const [tx, ty] = slotPos(p.slot);
      const dx = tx - p.x;
      const dy = ty - p.y;
      const b = p.bulge * Math.sin(Math.PI * e);
      return {
        x: p.x + dx * e - dy * b,
        y: p.y + dy * e + dx * b,
        size: lerp(size, M, e),
        angle: lerpSquareAngle(angle, th, e),
        alpha: lerp(alpha, holdAlpha, e),
      };
    }
    return { x: p.x, y: p.y, size, angle, alpha };
  }

  function render() {
    ctx.clearRect(0, 0, width, height);
    const fadeIn = reduceMotion.matches ? 1 : clamp01(sim / 1.2);
    const looks = particles.map(place);

    // Remember where each particle was drawn; start the trail afresh after a jump across an edge.
    particles.forEach((p, i) => {
      const { x, y } = looks[i];
      const head = p.trail[0];
      if (head && Math.hypot(head[0] - x, head[1] - y) > 60) p.trail = [];
      p.trail.unshift([x, y]);
      if (p.trail.length > TRAIL) p.trail.pop();
    });

    // Trails: one stroke per colour and step back in time, thinner and fainter further back.
    ctx.lineCap = "round";
    for (const square of [true, false]) {
      ctx.strokeStyle = square ? COLORS.real : COLORS.gen;
      for (let k = 0; k < TRAIL - 1; k++) {
        const fade = 1 - k / (TRAIL - 1);
        ctx.beginPath();
        for (const p of particles) {
          if (p.square !== square || p.held || p.trail.length < k + 2) continue;
          ctx.moveTo(p.trail[k][0], p.trail[k][1]);
          ctx.lineTo(p.trail[k + 1][0], p.trail[k + 1][1]);
        }
        ctx.globalAlpha = TRAIL_OPACITY * fade * fadeIn;
        ctx.lineWidth = TRAIL_WIDTH * fade;
        ctx.stroke();
      }
    }

    // Marks: squares first, dots on top, as in the paper figure.
    for (const square of [true, false]) {
      ctx.fillStyle = square ? COLORS.real : COLORS.gen;
      particles.forEach((p, i) => {
        if (p.square !== square) return;
        const { x, y, size, angle, alpha } = looks[i];
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
      });
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
      p.trail = [];
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
