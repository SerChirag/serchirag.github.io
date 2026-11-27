// Two-pentagon simulator for the Chamfer page: the paper's counterexample
// (Chamfer/Illustrations/Counterexamples/pentagon.py), with one view per metric
// family: FD on its own (one symmetric number), then the three directional
// pairs, each with a fidelity half and a coverage half: Precision and Recall,
// Density and Coverage, and Chamfer-Fidelity and Chamfer-Coverage.
//
// Each view lists its numbered steps under the metric they belong to,
// highlights the one being carried out, narrates it in a commentary line, and
// ends on the values, computed from the points. Everything fades in and out,
// and there is a short pause between steps.
//
// Geometry, as in the paper: real samples on a regular pentagon of radius 1,
// one vertex up; generated samples at the centre plus a pentagon of radius
// sqrt(5/4) turned by 36 degrees. The ball-based metrics use k = 1 and the
// strict membership test of the prdc package. FD uses the sample covariance
// (ddof = 1), as pytorch-fid does.
(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const N = 5;
  const RHO = Math.sqrt(N / (N - 1));
  const MARK = 0.09; // half-size of a square and radius of a dot, in the pentagon's units
  const SIGMAS = [0.5, 1, 1.5, 2]; // isocontours drawn for a fitted Gaussian, in standard deviations

  // Timing.
  const PACE = 1; // multiplies every duration: above 1 is slower
  const READ_BASE = 1000; // every phase stays up at least this long plus READ_PER_WORD per word of commentary
  const READ_PER_WORD = 260; // milliseconds, about 230 words a minute
  const PER_ITEM = 1800; // milliseconds per sample when counting or checking them one by one
  const CHECK_ITEM = 1100; // the same for the binary checks of Precision and Recall, which go quicker
  const QUICK_ITEM = 900; // milliseconds per sample when the rest follow quickly after a worked example
  const STEP_PAUSE = 1000; // pause before each new step
  const GROUP_PAUSE = 1500; // longer pause before the second metric of a pair, while the first one's marks fade
  const LEAD_IN = 300; // a phase's motion starts this long after it begins, as its commentary fades in
  const readTime = (text) => (text ? READ_BASE + READ_PER_WORD * text.trim().split(/\s+/).length : 0);

  // Tab label, title (with an optional note after it and a byline under it) for
  // each view. The steps and commentary are in VIEWS_STEPS below.
  const VIEWS = [
    {
      id: "fd",
      tab: "FD",
      title: "Fréchet Distance (FD)",
      note: "under Gaussian assumption", // after the title, not bold
      byline: "Metric behind FID, FD<sub>DINOv2</sub>, FDr<sup>K</sup> etc.", // under the title (HTML)
    },
    { id: "pr", tab: "Precision & Recall", title: "Precision and Recall" },
    { id: "dc", tab: "Density & Coverage", title: "Density and Coverage" },
    { id: "chamfer", tab: "Chamfer", title: "Chamfer distance", ours: true }, // our metric: crown, gold, "ours" badge
  ];

  const ngon = (r, rotDeg) =>
    Array.from({ length: N }, (_, i) => {
      const a = ((rotDeg + (360 * i) / N) * Math.PI) / 180;
      return [r * Math.cos(a), r * Math.sin(a)];
    });

  // --- Metrics ----------------------------------------------------------------

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const indices = (n) => Array.from({ length: n }, (_, i) => i);
  // Index in `set` nearest to point p, skipping index `skip`.
  const nearestIndex = (p, set, skip = -1) =>
    indices(set.length)
      .filter((j) => j !== skip)
      .reduce((best, j) => (dist(p, set[j]) < dist(p, set[best]) ? j : best), skip === 0 ? 1 : 0);
  const radiiOf = (set) => set.map((p, i) => dist(p, set[nearestIndex(p, set, i)]));
  // Which balls (centres, radii) contain point q, with the strict test.
  const ballsHolding = (q, centres, radii) => indices(centres.length).filter((i) => dist(q, centres[i]) < radii[i]);

  function gaussian(set) {
    const n = set.length;
    const mx = set.reduce((s, p) => s + p[0], 0) / n;
    const my = set.reduce((s, p) => s + p[1], 0) / n;
    let xx = 0;
    let xy = 0;
    let yy = 0;
    for (const [x, y] of set) {
      xx += (x - mx) ** 2;
      xy += (x - mx) * (y - my);
      yy += (y - my) ** 2;
    }
    return { mean: [mx, my], cov: [xx / (n - 1), xy / (n - 1), yy / (n - 1)] };
  }

  // FD between two 2D Gaussians. For 2x2 matrices, tr(sqrt(AB)) = sqrt(tr(AB) + 2 sqrt(det(AB))).
  function frechet(g1, g2) {
    const [a, b, c] = g1.cov;
    const [d, e, f] = g2.cov;
    const dm = (g1.mean[0] - g2.mean[0]) ** 2 + (g1.mean[1] - g2.mean[1]) ** 2;
    const trAB = a * d + 2 * b * e + c * f;
    const detAB = (a * c - b * b) * (d * f - e * e);
    const trSqrt = Math.sqrt(Math.max(0, trAB + 2 * Math.sqrt(Math.max(0, detAB))));
    return Math.max(0, dm + a + c + d + f - 2 * trSqrt);
  }

  // One nearest neighbour in `to` for each sample in `from`, for drawing. The
  // pentagons are symmetric, so a sample often has several tied for nearest:
  // take the one picked least so far, settling the samples with the fewest
  // ties first, so the lines spread over as many targets as they can. Ties
  // have equal distances, so the metric is unaffected.
  function nearestSpread(from, to) {
    const tied = from.map((q) => {
      const d = dist(q, to[nearestIndex(q, to)]);
      return indices(to.length).filter((j) => dist(q, to[j]) <= d + 1e-6);
    });
    const used = to.map(() => 0);
    const picks = [];
    indices(from.length)
      .sort((a, b) => tied[a].length - tied[b].length)
      .forEach((i) => {
        picks[i] = tied[i].reduce((best, j) => (used[j] < used[best] ? j : best));
        used[picks[i]]++;
      });
    return picks;
  }

  const chamfer = (from, to) => from.reduce((s, p) => s + dist(p, to[nearestIndex(p, to)]), 0) / from.length;

  // Axes of the k-sigma ellipse of a covariance [xx, xy, yy], angle in radians.
  function ellipseOf(cov, k) {
    const [a, b, c] = cov;
    const mid = (a + c) / 2;
    const spread = Math.sqrt(((a - c) / 2) ** 2 + b * b);
    return {
      rx: k * Math.sqrt(Math.max(0, mid + spread)),
      ry: k * Math.sqrt(Math.max(0, mid - spread)),
      angle: 0.5 * Math.atan2(2 * b, a - c),
    };
  }

  // --- Easing -----------------------------------------------------------------

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ease = (p) => 1 - (1 - clamp01(p)) ** 3;
  const span = (t, from, to) => clamp01((t - from) / (to - from));
  // Item i of n appears during its own slice of a phase's progress p.
  const slice = (p, i, n, overlap = 0.8) => ease(span(p, i / n, Math.min(1, (i + overlap) / n)));
  // Which of n items a phase is on at progress p.
  const itemAt = (p, n) => Math.min(n - 1, Math.floor(p * n));

  // --- One simulator -----------------------------------------------------------

  function setup(root) {
    const svg = root.querySelector(".psim-figure");
    const panel = root.querySelector(".psim-panel");
    const tablist = root.querySelector(".psim-tabs");
    const titleEl = root.querySelector(".psim-title");
    const bylineEl = root.querySelector(".psim-byline");
    const stepsEl = root.querySelector(".psim-steps");
    const commentEl = root.querySelector(".psim-comment");
    const metricsEl = root.querySelector(".psim-metrics");
    const resultsEl = root.querySelector(".psim-results"); // the metrics row and the verdict under it
    const verdictEl = root.querySelector(".psim-verdict");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const real = ngon(1, 90);
    const gen = [[0, 0], ...ngon(RHO, 90 + 180 / N)];
    const realRadii = radiiOf(real);
    const genRadii = radiiOf(gen);

    const CROWN = '<svg class="psim-crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 7.5l5 4.2L12 4l4.5 7.7 5-4.2-2 11H4.5z"/></svg>';
    function setTitle(v) {
      titleEl.textContent = v.title;
      if (v.note) titleEl.insertAdjacentHTML("beforeend", ` <span class="psim-title-note">${v.note}</span>`);
      if (v.ours) titleEl.insertAdjacentHTML("beforeend", ` <span class="psim-ours">${CROWN}ours</span>`);
      bylineEl.innerHTML = v.byline || "";
    }

    const tabs = VIEWS.map((v) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "psim-tab ch-btn";
      b.setAttribute("role", "tab");
      if (v.ours) {
        b.classList.add("psim-tab-ours");
        b.innerHTML = `${CROWN}<span>${v.tab}</span><span class="psim-ours">ours</span>`;
        b.setAttribute("aria-label", `${v.tab} (ours)`);
      } else b.textContent = v.tab;
      tablist.appendChild(b);
      return b;
    });

    // --- Drawing pools ---

    const el = (name, attrs, parent) => {
      const node = document.createElementNS(SVG_NS, name);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      parent.appendChild(node);
      return node;
    };
    const svgXY = ([x, y]) => [x, -y]; // the drawing has y pointing up
    const layer = () => el("g", {}, svg);
    const gEllipses = layer();
    const gBalls = layer();
    const gLines = layer();
    const gPoints = layer();
    const gMarks = layer();
    const pool = (n, make) => Array.from({ length: n }, make);
    // Dynamic marks fade in and out (CSS transition on opacity, class psim-dyn).
    const dyn = (name, attrs, parent) => el(name, { ...attrs, class: `psim-dyn ${attrs.class || ""}`.trim() }, parent);

    // Each set's fitted Gaussian (mean and isocontours) has its own group, which fades with the set.
    const gRealFit = el("g", { class: "psim-set" }, gEllipses);
    const gGenFit = el("g", { class: "psim-set" }, gEllipses);
    const contours = (cls, g) => SIGMAS.map((_, i) => dyn("ellipse", { class: cls, "stroke-opacity": 1 - 0.2 * i }, g));
    const realContours = contours("psim-ellipse-real", gRealFit);
    const genContours = contours("psim-ellipse-gen", gGenFit);
    const meanReal = dyn("path", { class: "psim-mean-real", d: "M -0.13 0 L 0.13 0 M 0 -0.13 L 0 0.13" }, gRealFit);
    const meanGen = dyn("circle", { class: "psim-mean-gen", r: 0.15 }, gGenFit);
    const realBalls = pool(real.length, () => dyn("circle", { class: "psim-ball" }, gBalls));
    const genBalls = pool(gen.length, () => dyn("circle", { class: "psim-ball" }, gBalls));
    const pairs = real.length * gen.length;
    const nnLines = pool(gen.length, () => dyn("line", { class: "psim-nn" }, gLines));
    const spokes = pool(pairs, () => dyn("line", { class: "psim-spoke" }, gLines));
    const fidLinks = pool(pairs, () => dyn("line", { class: "psim-link-fid" }, gLines));
    const covLinks = pool(pairs, () => dyn("line", { class: "psim-link-cov" }, gLines));
    // One group per set, so a step can fade the set it does not use.
    const gReal = el("g", { class: "psim-set" }, gPoints);
    const gGen = el("g", { class: "psim-set" }, gPoints);
    const realMarks = real.map((p) => {
      const [x, y] = svgXY(p);
      return el("rect", { class: "psim-real", x: x - MARK, y: y - MARK, width: 2 * MARK, height: 2 * MARK }, gReal);
    });
    const genMarks = gen.map((p) => {
      const [x, y] = svgXY(p);
      return el("circle", { class: "psim-gen", cx: x, cy: y, r: MARK }, gGen);
    });
    const allMarks = [...realMarks, ...genMarks];
    const ring = dyn("circle", { class: "psim-ring", r: 0.2 }, gMarks);
    const counts = pool(gen.length, () => dyn("text", { class: "psim-count" }, gMarks));
    const realChecks = pool(real.length, () => dyn("path", { class: "psim-check" }, gMarks));
    const genChecks = pool(gen.length, () => dyn("path", { class: "psim-check" }, gMarks));

    const dynamic = [...realContours, ...genContours, meanReal, meanGen, ...realBalls, ...genBalls, ...nnLines, ...spokes, ...fidLinks, ...covLinks];
    dynamic.push(ring, ...counts, ...realChecks, ...genChecks);

    // Showing and hiding go through opacity, which fades (see .psim-dyn).
    const show = (node, on = true) => {
      const o = on ? "1" : "0";
      if (node.style.opacity !== o) node.style.opacity = o;
    };
    function hideAll() {
      dynamic.forEach((node) => show(node, false));
      [...realBalls, ...genBalls].forEach((b) => b.classList.remove("active"));
    }
    // Focus: which set a step works with. "real" or "gen" fades the other set;
    // an object gives each set a level: "" (full), "dim" (a little faded) or
    // "faded". A set's fitted Gaussian fades only when the set is "faded".
    const FOCUS = { real: { gen: "faded" }, gen: { real: "faded" }, both: {} };
    function setFocus(focus) {
      const f = typeof focus === "string" ? FOCUS[focus] : focus;
      [
        [gReal, gRealFit, f.real],
        [gGen, gGenFit, f.gen],
      ].forEach(([points, fit, level]) => {
        points.classList.toggle("psim-faded", level === "faded");
        points.classList.toggle("psim-dim", level === "dim");
        fit.classList.toggle("psim-faded", level === "faded");
      });
    }

    // --- Drawing helpers (all take points in the pentagon's units) ---

    function line(node, a, b, p = 1) {
      const [x1, y1] = svgXY(a);
      const [x2, y2] = svgXY(b);
      node.setAttribute("x1", x1);
      node.setAttribute("y1", y1);
      node.setAttribute("x2", x1 + (x2 - x1) * p);
      node.setAttribute("y2", y1 + (y2 - y1) * p);
      show(node, p > 0);
    }
    function ball(node, c, r, active = false) {
      const [x, y] = svgXY(c);
      node.setAttribute("cx", x);
      node.setAttribute("cy", y);
      node.setAttribute("r", Math.max(0, r));
      if (active) node.classList.add("active");
      show(node, r > 0);
    }
    function ringAt(p, scale) {
      const [x, y] = svgXY(p);
      ring.setAttribute("transform", `translate(${x} ${y}) scale(${Math.max(scale, 0.001)})`);
      show(ring, scale > 0);
    }
    function text(node, at, content, dx = 0, dy = 0) {
      const [x, y] = svgXY(at);
      node.setAttribute("x", x + dx);
      node.setAttribute("y", y + dy);
      if (node.textContent !== content) node.textContent = content;
      show(node);
    }
    const TICK = "M -0.07 0 L -0.02 0.055 L 0.08 -0.065";
    const CROSS = "M -0.06 -0.06 L 0.06 0.06 M -0.06 0.06 L 0.06 -0.06";
    function check(node, p, ok, scale) {
      const [x, y] = svgXY(p);
      node.setAttribute("d", ok ? TICK : CROSS);
      node.classList.toggle("ok", ok);
      node.classList.toggle("no", !ok);
      node.setAttribute("transform", `translate(${x + 0.17} ${y - 0.17}) scale(${Math.max(scale, 0.001)})`);
      show(node, scale > 0);
    }

    // --- Steps ---
    // A view is a list of groups (one per metric), each with numbered steps.
    // A step has a focus (which set of points it uses; in the ball metrics,
    // the samples behind the balls fade once the balls are drawn) and phases
    // { comment, dur, draw(p, current) }; the comment goes in the commentary
    // line, and draw may replace it through frame.comment. Within the current
    // group, finished phases are redrawn at p = 1 every frame (current = false),
    // so a phase draws only what should stay on screen afterwards unless
    // `current` is true. Marks of a finished group fade away; its result stays
    // in the metrics row, which names every metric of the view from the start.

    let frame = {};

    // Grow balls around `centres`, one at a time first: pick a sample, find its
    // nearest neighbour in the same set, grow its ball; then all the others.
    function manifoldPhases(centres, balls, radii, pick, who) {
      const others = indices(centres.length).filter((j) => j !== pick);
      const nn = nearestIndex(centres[pick], centres, pick);
      return [
        {
          comment: `Consider one ${who} sample.`,
          dur: 900,
          draw: (p, cur) => cur && ringAt(centres[pick], ease(p)),
        },
        {
          comment: `Find its nearest ${who} neighbour within the ${who} set.`,
          dur: 1500,
          draw: (p, cur) => {
            if (!cur) return;
            ringAt(centres[pick], 1);
            line(nnLines[0], centres[pick], centres[nn], ease(span(p, 0, 0.6)));
          },
        },
        {
          comment: "Draw a ball around the sample, with nearest neighbour distance as radius.",
          dur: 1400,
          draw: (p, cur) => {
            ball(balls[pick], centres[pick], radii[pick] * ease(p), cur);
            if (!cur) return;
            ringAt(centres[pick], 1);
            line(nnLines[0], centres[pick], centres[nn]);
          },
        },
        {
          comment: `Every ${who} sample gets an isotropic ball the same way. Together they approximate the ${who} manifold.`,
          dur: 2000,
          draw: (p) => others.forEach((j, k) => ball(balls[j], centres[j], radii[j] * slice(p, k, others.length, 1.4))),
        },
      ];
    }

    // Check queries one by one against the balls (Precision and Recall).
    // The commentary stays one steady line; each tick (or cross) gives the answer.
    function checkPhase(queries, checks, centres, radii, name, what) {
      return {
        comment: `Check each ${what} sample: a tick if it is inside a ball.`,
        dur: CHECK_ITEM * queries.length,
        draw: (p) => {
          let shown = 0;
          let hits = 0;
          queries.forEach((q, j) => {
            const pop = slice(p, j, queries.length, 0.5);
            if (pop <= 0) return;
            const holding = ballsHolding(q, centres, radii);
            check(checks[j], q, holding.length > 0, pop);
            shown++;
            if (holding.length) hits++;
          });
          if (shown) frame.value = `${name} = ${hits} / ${queries.length}`;
        },
      };
    }

    // Draw the balls fully, unchanged (when a later step reuses them).
    const keepBalls = (centres, balls, radii) => centres.forEach((c, j) => ball(balls[j], c, radii[j]));

    const ratio = (a, b) => `${a} / ${b} = ${(a / b).toFixed(2)}`;

    const VIEWS_STEPS = {
      fd: () => {
        const gr = gaussian(real);
        const gg = gaussian(gen);
        const fd = frechet(gr, gg);
        // The mean appears first, then the isocontours grow out from it, innermost first.
        const drawFit = (g, mean, rings, p) => {
          const [mx, my] = svgXY(g.mean);
          const m = ease(span(p, 0, 0.25));
          mean.setAttribute("transform", `translate(${mx} ${my}) scale(${Math.max(m, 0.001)})`);
          show(mean, m > 0);
          rings.forEach((node, i) => {
            const grow = slice(span(p, 0.2, 1), i, rings.length, 1.5);
            const { rx, ry, angle } = ellipseOf(g.cov, SIGMAS[i]);
            node.setAttribute("cx", mx);
            node.setAttribute("cy", my);
            node.setAttribute("rx", Math.max(0, rx * grow));
            node.setAttribute("ry", Math.max(0, ry * grow));
            node.setAttribute("transform", `rotate(${(-angle * 180) / Math.PI} ${mx} ${my})`);
            show(node, grow > 0);
          });
        };
        // For each set: show it with the other set faded well back, then dim it
        // a little and draw its mean and covariance over it.
        const fitStep = (title, own, other, g, mean, rings) => ({
          title,
          phases: [
            { comment: "Calculate mean and covariance.", dur: 1200, focus: { [other]: "faded" }, draw: () => {} },
            {
              comment: "Calculate mean and covariance.",
              dur: 3200,
              focus: { [own]: "dim", [other]: "faded" },
              draw: (p) => drawFit(g, mean, rings, p),
            },
          ],
        });
        return [
          {
            name: "",
            metric: "FD", // no heading in the step list, but named in the metrics row
            steps: [
              fitStep("Fit a Gaussian to the real samples", "real", "gen", gr, meanReal, realContours),
              fitStep("Fit a Gaussian to the generated samples", "gen", "real", gg, meanGen, genContours),
              {
                title: "Compare the two Gaussians",
                phases: [
                  {
                    comment: "Same mean and same covariance: the two Gaussians are identical.",
                    dur: 2000,
                    focus: { real: "dim", gen: "dim" },
                    draw: () => {
                      frame.value = `FD = ${fd.toFixed(2)}`;
                      frame.verdict = fd < 0.005 ? "FD achieves a perfect score, even though the two sets are clearly different." : "";
                    },
                  },
                ],
              },
            ],
          },
        ];
      },

      pr: () => {
        const p = gen.filter((q) => ballsHolding(q, real, realRadii).length).length;
        const r = real.filter((q) => ballsHolding(q, gen, genRadii).length).length;
        return [
          {
            name: "Precision",
            result: `Precision = ${ratio(p, gen.length)}`,
            steps: [
              {
                title: "Approximate the real manifold using isotropic balls",
                focus: "real",
                phases: manifoldPhases(real, realBalls, realRadii, 0, "real"),
              },
              {
                title: "Binary check: is each generated sample inside a ball?",
                focus: "gen",
                phases: [
                  checkPhase(gen, genChecks, real, realRadii, "Precision", "generated"),
                  {
                    comment: `${p} of ${gen.length} generated samples are inside a ball.`,
                    dur: 1800,
                    draw: () => (frame.value = `Precision = ${ratio(p, gen.length)}`),
                  },
                ],
              },
            ],
          },
          {
            name: "Recall",
            steps: [
              {
                title: "Approximate the generated manifold using isotropic balls",
                focus: "gen",
                phases: manifoldPhases(gen, genBalls, genRadii, 1, "generated"),
              },
              {
                title: "Binary check: is each real sample inside a ball?",
                focus: "real",
                phases: [
                  checkPhase(real, realChecks, gen, genRadii, "Recall", "real"),
                  {
                    comment: `${r} of ${real.length} real samples are inside a ball.`,
                    dur: 1800,
                    draw: () => {
                      frame.value = `Recall = ${ratio(r, real.length)}`;
                      frame.verdict =
                        p === gen.length && r === real.length
                          ? "Precision and Recall achieve a perfect score, even though the two sets are clearly different."
                          : "";
                    },
                  },
                ],
              },
            ],
          },
        ];
      },

      dc: () => {
        const holding = gen.map((q) => ballsHolding(q, real, realRadii));
        const total = holding.reduce((s, h) => s + h.length, 0);
        const density = total / gen.length; // k = 1
        const inBall = real.map((c, i) => indices(gen.length).filter((j) => dist(gen[j], c) < realRadii[i]));
        const covered = inBall.filter((l) => l.length).length;
        return [
          {
            name: "Density",
            result: `Density = ${total} / ${gen.length} = ${density.toFixed(2)}`,
            steps: [
              {
                title: "Approximate the real manifold using isotropic balls",
                focus: "real",
                phases: manifoldPhases(real, realBalls, realRadii, 0, "real"),
              },
              {
                title: "Count the real balls that contain each generated sample",
                focus: "gen",
                phases: [
                  {
                    comment: "Check each generated sample: count the real balls that contain it.",
                    dur: PER_ITEM * gen.length,
                    draw: (p, cur) => {
                      let s = 0;
                      let sum = 0;
                      const now = itemAt(p, gen.length);
                      gen.forEach((q, j) => {
                        const pop = slice(p, j, gen.length);
                        if (pop <= 0) return;
                        if (cur && j === now) {
                          holding[j].forEach((i) => ball(realBalls[i], real[i], realRadii[i], true));
                          // Lines to its balls only while it is counted; its count stays.
                          holding[j].forEach((i) => line(spokes[s++], q, real[i], pop));
                        }
                        text(counts[j], q, String(holding[j].length), 0.2, 0.06);
                        sum += holding[j].length;
                      });
                      if (sum) frame.value = `Density = ${sum} / ${gen.length}`;
                    },
                  },
                  {
                    comment: `Sum the counts and divide by the ${gen.length} generated samples (k = 1): ${total} / ${gen.length}.`,
                    dur: 2000,
                    draw: () => (frame.value = `Density = ${total} / ${gen.length} = ${density.toFixed(2)}`),
                  },
                ],
              },
            ],
          },
          {
            name: "Coverage",
            carry: () => keepBalls(real, realBalls, realRadii), // same balls as Density
            steps: [
              {
                title: "Binary check with the same real balls: does each contain a generated sample?",
                focus: "gen",
                phases: [
                  {
                    comment: "Coverage reuses the real balls from Density.",
                    dur: 1500,
                    draw: () => keepBalls(real, realBalls, realRadii),
                  },
                  {
                    comment: "Check each real ball: a tick if it contains at least one generated sample.",
                    dur: PER_ITEM * real.length,
                    draw: (p, cur) => {
                      let k = 0;
                      const now = itemAt(p, real.length);
                      real.forEach((c, i) => {
                        const pop = slice(p, i, real.length);
                        if (pop <= 0) return;
                        if (cur && i === now) {
                          ball(realBalls[i], c, realRadii[i], true);
                        }
                        if (inBall[i].length) {
                          // Line to the sample it holds only while it is checked; its tick stays.
                          if (cur && i === now) {
                            const j = inBall[i].reduce((b, x) => (dist(gen[x], c) < dist(gen[b], c) ? x : b));
                            line(spokes[i], c, gen[j], pop);
                          }
                          k++;
                        }
                        check(realChecks[i], c, inBall[i].length > 0, pop);
                      });
                      if (p > 0) frame.value = `Coverage = ${k} / ${real.length}`;
                    },
                  },
                  {
                    comment: `${covered} of ${real.length} real balls contain a generated sample.`,
                    dur: 1800,
                    draw: () => {
                      frame.value = `Coverage = ${ratio(covered, real.length)}`;
                      frame.verdict =
                        covered === real.length && density > 1.05
                          ? "Density and Coverage achieve a perfect score, even though the two sets are clearly different."
                          : "";
                    },
                  },
                ],
              },
            ],
          },
        ];
      },

      chamfer: () => {
        const fid = chamfer(gen, real);
        const cov = chamfer(real, gen);
        // One line per sample, spread so every target that can be is picked.
        const fidPicks = nearestSpread(gen, real);
        const covPicks = nearestSpread(real, gen);
        // One sample in detail, then the rest quickly, one by one. Samples of
        // the set being walked that are not reached yet are faded.
        const walk = (from, to, picks, marks, links, pick, who, other) => {
          const rest = [...indices(from.length).slice(pick + 1), ...indices(from.length).slice(0, pick)];
          const link = (j, p) => line(links[j], from[j], to[picks[j]], p);
          const fadeUnreached = (reached) => marks.forEach((m, j) => reached(j) || frame.faded.push(m));
          return [
            {
              comment: `Consider one ${who} sample.`,
              dur: 900,
              draw: (p, cur) => {
                if (!cur) return;
                ringAt(from[pick], ease(p));
                fadeUnreached((j) => j === pick);
              },
            },
            {
              comment: `Find its nearest ${other} sample, and the distance to it.`,
              dur: 1500,
              draw: (p, cur) => {
                link(pick, ease(span(p, 0, 0.6)));
                if (!cur) return;
                ringAt(from[pick], 1);
                fadeUnreached((j) => j === pick);
              },
            },
            {
              comment: `Similarly, repeat for other ${who} samples.`,
              dur: QUICK_ITEM * rest.length,
              draw: (p, cur) => {
                rest.forEach((j, k) => link(j, slice(p, k, rest.length)));
                if (cur) fadeUnreached((j) => j === pick || rest.indexOf(j) <= itemAt(p, rest.length));
              },
            },
          ];
        };
        return [
          {
            name: "Chamfer-Fidelity",
            result: `Chamfer-Fidelity = ${fid.toFixed(2)}`,
            steps: [
              {
                title: "Find distance of each generated sample to its nearest real sample",
                // A vertex first (index 0 is the centre, which then comes last).
                phases: walk(gen, real, fidPicks, genMarks, fidLinks, 1, "generated", "real"),
              },
              {
                title: "Take the average across all generated samples",
                phases: [
                  {
                    comment: `Average is ${fid.toFixed(2)}.`,
                    dur: 2600,
                    draw: () => (frame.value = `Chamfer-Fidelity = ${fid.toFixed(2)}`),
                  },
                ],
              },
            ],
          },
          {
            name: "Chamfer-Coverage",
            steps: [
              {
                title: "Find distance of each real sample to its nearest generated sample",
                phases: walk(real, gen, covPicks, realMarks, covLinks, 0, "real", "generated"),
              },
              {
                title: "Take the average across all real samples",
                phases: [
                  {
                    // The conclusion comes with the last value, as in the other views.
                    comment: `Average is ${cov.toFixed(2)}.`,
                    dur: 3400,
                    draw: () => {
                      frame.value = `Chamfer-Coverage = ${cov.toFixed(2)}`;
                      frame.verdict = fid > 0.005 && cov > 0.005 ? "Both are above zero, so Chamfer tells the two sets apart." : "";
                    },
                  },
                ],
              },
            ],
          },
        ];
      },
    };

    // --- Playback ---

    let current = 0;
    let groups = [];
    let phases = []; // flattened, each with its group and global step index
    let total = 0;
    let listItems = []; // { li, group, step } for the rendered list
    let metricCells = []; // one per group, in the metrics row
    let raf = 0;
    let started = false;

    function build(view) {
      groups = VIEWS_STEPS[view]();
      phases = [];
      let stepIndex = 0;
      groups.forEach((g, gi) => {
        g.steps.forEach((s, si) => {
          // A pause before every step but the first, longer before a new metric.
          // A metric that reuses the previous one's marks keeps them through the pause (`carry`).
          if (stepIndex > 0) {
            const draw = si === 0 && g.carry ? g.carry : () => {};
            const focus = s.phases[0].focus || s.focus || "both"; // the pause already shows the coming step's focus
            phases.push({ comment: "", dur: si === 0 ? GROUP_PAUSE : STEP_PAUSE, draw, pause: true, focus, group: gi, step: stepIndex });
          }
          s.phases.forEach((ph) =>
            phases.push({ ...ph, focus: ph.focus || s.focus || "both", dur: Math.max(ph.dur, readTime(ph.comment)), group: gi, step: stepIndex })
          );
          stepIndex++;
        });
      });
      phases.forEach((ph) => (ph.dur *= PACE));
      total = phases.reduce((sum, ph) => sum + ph.dur, 0);

      // The step list: a heading per metric (when there is more than one), numbered steps under it.
      const items = [];
      listItems = [];
      let n = 0;
      groups.forEach((g, gi) => {
        if (g.name) {
          const li = document.createElement("li");
          li.className = "psim-group";
          li.textContent = g.name;
          items.push(li);
          listItems.push({ li, group: gi, step: -1 });
        }
        g.steps.forEach((s) => {
          const li = document.createElement("li");
          li.className = "psim-step";
          li.textContent = s.title;
          items.push(li);
          listItems.push({ li, group: gi, step: n++ });
        });
      });
      stepsEl.replaceChildren(...items);

      // The metrics row: one cell per metric, side by side (Precision left, Recall right).
      metricCells = groups.map(() => {
        const cell = document.createElement("div");
        cell.className = "psim-metric";
        return cell;
      });
      metricsEl.replaceChildren(...metricCells);
    }

    let lastComment = "";
    let lastMs = 0;
    function render(ms) {
      lastMs = ms;
      hideAll();
      frame = { comment: "", value: "", verdict: "", faded: [] };
      // Find the current phase.
      let acc = 0;
      let at = phases.length - 1;
      for (let i = 0; i < phases.length; i++) {
        if (ms < acc + phases[i].dur) {
          at = i;
          break;
        }
        acc += phases[i].dur;
      }
      const cur = phases[at];
      // Draw the current group: finished phases at p = 1, then the current one.
      let start = 0;
      for (let i = 0; i < at; i++) {
        if (phases[i].group === cur.group) phases[i].draw(1, false);
        start += phases[i].dur;
      }
      frame.comment = cur.pause ? lastComment : cur.comment;
      // Motion waits a moment, so the new commentary fades in first.
      const lead = cur.pause ? 0 : Math.min(LEAD_IN, cur.dur / 4);
      cur.draw(clamp01((ms - start - lead) / (cur.dur - lead)), true);
      if (!cur.pause) lastComment = frame.comment;
      // Metrics: a finished one shows its result, the current one its value so
      // far ("Precision =" until there is one), and one still to come its name.
      metricCells.forEach((cell, gi) => {
        const g = groups[gi];
        const label = g.metric || g.name;
        let text = label;
        let state = "todo";
        if (gi < cur.group) [text, state] = [g.result, "done"];
        else if (gi === cur.group) [text, state] = [frame.value || `${label} =`, "active"];
        if (cell.textContent !== text) cell.textContent = text;
        if (cell.dataset.state !== state) cell.dataset.state = state;
      });

      setFocus(cur.focus);
      allMarks.forEach((m) => m.classList.toggle("psim-faded", frame.faded.includes(m)));
      listItems.forEach(({ li, group, step }) => {
        let state;
        if (step < 0) state = group < cur.group ? "done" : group === cur.group ? "active" : "todo";
        else state = step < cur.step ? "done" : step === cur.step ? "active" : "todo";
        if (li.dataset.state !== state) li.dataset.state = state;
      });
      setComment(frame.comment);
      if (verdictEl.textContent !== frame.verdict) {
        verdictEl.textContent = frame.verdict;
        fadeIn(verdictEl);
      }
    }

    // The commentary cross-fades: the old line fades out, then the new one fades
    // in. While the height is measured, it changes at once.
    let commentTarget = "";
    let commentTimer = 0;
    let measuring = false;
    function setComment(text) {
      if (text === commentTarget) return;
      commentTarget = text;
      clearTimeout(commentTimer);
      const swap = () => {
        commentEl.textContent = commentTarget;
        commentEl.classList.remove("psim-out");
        if (!measuring) fadeIn(commentEl);
      };
      if (measuring || !commentEl.textContent) return swap();
      commentEl.classList.add("psim-out");
      commentTimer = setTimeout(swap, 250);
    }
    function fadeIn(node) {
      node.classList.remove("psim-fade-in");
      void node.offsetWidth;
      node.classList.add("psim-fade-in");
    }

    function play() {
      cancelAnimationFrame(raf);
      lastComment = "";
      if (reduceMotion.matches) {
        render(total);
        return;
      }
      const t0 = performance.now();
      const tick = (now) => {
        const ms = now - t0;
        render(Math.min(ms, total));
        if (ms < total) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    function select(index, direction) {
      current = (index + VIEWS.length) % VIEWS.length;
      tabs.forEach((tab, i) => {
        const on = i === current;
        tab.setAttribute("aria-selected", on ? "true" : "false");
        tab.tabIndex = on ? 0 : -1;
      });
      setTitle(VIEWS[current]);
      build(VIEWS[current].id);
      // Slide the text in from the side it came from.
      panel.classList.remove("psim-from-right", "psim-from-left");
      void panel.offsetWidth;
      panel.classList.add(direction < 0 ? "psim-from-left" : "psim-from-right");
      if (started) play();
      else render(0);
    }

    // Tabs, arrow keys and Replay (clicking the open tab replays it too).
    tabs.forEach((tab, i) => tab.addEventListener("click", () => select(i, i < current ? -1 : 1)));
    tablist.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const dir = e.key === "ArrowRight" ? 1 : -1;
      select(current + dir, dir);
      tabs[current].focus();
    });
    root.querySelector(".psim-replay").addEventListener("click", play);

    // Swiping across the figure switches metric.
    let swipe = null;
    svg.addEventListener("pointerdown", (e) => {
      swipe = { x: e.clientX, y: e.clientY };
    });
    svg.addEventListener("pointerup", (e) => {
      if (!swipe) return;
      const dx = e.clientX - swipe.x;
      const dy = e.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) select(current + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    });

    // Keep the box the same height on every tab: step through every phase of
    // every view in one go (nothing is painted in between), find the tallest
    // commentary line and then the tallest panel, and reserve both.
    function eachPhase(fn) {
      for (const v of VIEWS) {
        setTitle(v);
        build(v.id);
        let acc = 0;
        for (const ph of phases) {
          render(acc + ph.dur / 2);
          fn();
          acc += ph.dur;
        }
        render(total);
        fn();
      }
    }
    function lockHeight() {
      const keepMs = lastMs;
      const keepComment = lastComment;
      commentEl.style.minHeight = "";
      panel.style.minHeight = "";
      resultsEl.style.minHeight = "";
      let comment = 0;
      let tallest = 0;
      let metrics = 0;
      measuring = true;
      eachPhase(() => (comment = Math.max(comment, commentEl.offsetHeight)));
      commentEl.style.minHeight = `${comment}px`;
      eachPhase(() => {
        tallest = Math.max(tallest, panel.offsetHeight);
        metrics = Math.max(metrics, resultsEl.offsetHeight);
      });
      panel.style.minHeight = `${tallest}px`;
      resultsEl.style.minHeight = `${metrics}px`;
      // Back to where we were.
      setTitle(VIEWS[current]);
      build(VIEWS[current].id);
      lastComment = keepComment;
      render(keepMs);
      measuring = false;
    }

    // Start when the simulator scrolls into view.
    select(0, 1);
    lockHeight();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(lockHeight);
    let lockedWidth = root.offsetWidth;
    new ResizeObserver(() => {
      if (root.offsetWidth === lockedWidth) return; // only a new width changes the wrapping
      lockedWidth = root.offsetWidth;
      lockHeight();
    }).observe(root);
    new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started) {
          started = true;
          play();
        }
      },
      { threshold: 0.35 }
    ).observe(root);
  }

  document.querySelectorAll("[data-pentagon-sim]").forEach(setup);
})();
