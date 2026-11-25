// Ranking chart for the Chamfer page: the paper's Figure 9 made interactive.
// One bubble per model, Chamfer-Fidelity across and Chamfer-Coverage up on the
// same scale (lower is better on both), bubble area for the parameter count.
// The numbers come from _data/chamfer_models.json (written from the paper's
// table by bin/chamfer_table_to_json.py), the families and first view from
// _data/chamfer_chart.yml. Nothing here assumes a range of values: the axes fit
// whatever the table holds.
//
// Filters above pick the models and the view fits them. Inside the chart,
// Ctrl/Cmd + scroll or a pinch zooms, dragging pans, and the buttons above it
// zoom and reset. The chart is sized to fit the window. Hovering a model
// (tapping, on a touch screen) fills the panel beside the chart with its scores
// and its samples closest to and farthest from the real images. Samples are fetched only then, only for that
// model, and only as they scroll into view; clicking keeps a model in the panel.
(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const HOVER_DELAY = 120; // ms a model stays under the pointer before its samples are fetched
  const NEAR = 14; // px outside a bubble that still counts as pointing at it
  const ANIM = 450; // ms for animated changes of view
  const ZOOM_STEP = 1.6; // per click of + or -
  const MAX_ZOOM = 25; // how far in from the fitted view
  const DRAG = 4; // px the pointer moves before a press becomes a pan
  const M = { top: 12, right: 12, bottom: 46, left: 50 }; // plot margins, in px
  const SAMPLE = /\/assets\/chamfer-samples\/([^/]+)\/(closest|farthest)-(\d+)\.(webp|avif|jpe?g|png)$/i;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarse = window.matchMedia("(pointer: coarse)");

  const el = (tag, cls, parent, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  };
  const svg = (tag, attrs, parent) => {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
    if (parent) parent.appendChild(node);
    return node;
  };
  const setAttrs = (node, attrs) => Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  const fmt = (v) => (v == null ? "–" : v.toFixed(Math.abs(v) < 1 ? 3 : 2));
  const paramsText = (p) => (p >= 1000 ? `${+(p / 1000).toFixed(1)}B params` : `${p}M params`);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  // A round step (1, 2 or 5 times a power of ten) at least `raw` long.
  const niceStep = (raw) => {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  };

  document.querySelectorAll("[data-ranking-chart]").forEach(setup);

  function setup(root) {
    const data = JSON.parse(root.querySelector(".rk-data").textContent);
    const models = data.models || [];
    if (!models.length) return;
    const byId = new Map(models.map((m) => [m.id, m]));

    // Families: those set in chamfer_chart.yml, in that order, then any other
    // heading the table has (drawn as rings until it is given a mark).
    const configured = new Map((data.families || []).map((f) => [f.id, f]));
    const familyIds = [...new Set([...configured.keys(), ...models.map((m) => m.family)])].filter((id) => models.some((m) => m.family === id));
    const families = familyIds.map((id) => {
      const name = models.find((m) => m.family === id).family_name || id;
      const f = configured.get(id) || {};
      return { id, name, short: f.short || name, mark: f.mark || "ring" };
    });
    const familyOf = new Map(families.map((f) => [f.id, f]));
    const markOf = (m) => familyOf.get(m.family).mark;

    // Samples, from the files under assets/chamfer-samples/<id>/.
    const samples = new Map();
    (data.samples || []).forEach((path) => {
      const match = SAMPLE.exec(path);
      if (!match) return;
      if (!samples.has(match[1])) samples.set(match[1], { closest: [], farthest: [] });
      samples.get(match[1])[match[2].toLowerCase()].push({ n: +match[3], url: (data.base || "") + path });
    });
    samples.forEach((s) => ["closest", "farthest"].forEach((k) => s[k].sort((a, b) => a.n - b.n)));

    // The smallest range the fitted view shows: a share of the whole table's spread.
    const spread = (key) => Math.max(...models.map((m) => m[key])) - Math.min(...models.map((m) => m[key]));
    const minSpan = 0.15 * Math.max(spread("chamfer_fid"), spread("chamfer_cov")) || 1;

    const figure = (data.figure || []).filter((id) => byId.has(id));
    const state = {
      selected: new Set(figure.length ? figure : models.map((m) => m.id)),
      active: null, // the model in the panel
      pinned: false, // kept there by a click
    };

    // ----- Filters -----------------------------------------------------------

    const familiesEl = root.querySelector(".rk-families");
    const chips = families.map((f) => {
      const chip = el("button", "rk-chip ch-btn", familiesEl);
      chip.type = "button";
      chip.title = f.name;
      el("span", "rk-key", chip).dataset.mark = f.mark;
      el("span", null, chip, f.short);
      chip.addEventListener("click", () => {
        const ids = models.filter((m) => m.family === f.id).map((m) => m.id);
        const all = ids.every((id) => state.selected.has(id));
        ids.forEach((id) => (all ? state.selected.delete(id) : state.selected.add(id)));
        changed();
      });
      return { chip, family: f.id };
    });

    const pick = root.querySelector(".rk-pick");
    const summary = pick.querySelector("summary");
    const menu = pick.querySelector(".rk-menu");
    const boxes = new Map();
    families.forEach((f) => {
      const set = el("fieldset", null, menu);
      el("legend", null, set, f.name);
      models
        .filter((m) => m.family === f.id)
        .forEach((m) => {
          const label = el("label", null, set);
          const box = el("input", null, label);
          box.type = "checkbox";
          box.addEventListener("change", () => {
            if (box.checked) state.selected.add(m.id);
            else state.selected.delete(m.id);
            changed();
          });
          el("span", "rk-key", label).dataset.mark = f.mark;
          el("span", null, label, m.name);
          boxes.set(m.id, box);
        });
    });
    const presets = el("div", "rk-presets", menu);
    [
      ["Paper's Figure 9", figure],
      ["All models", models.map((m) => m.id)],
      ["None", []],
    ]
      .filter(([, ids], i) => i > 0 || ids.length)
      .forEach(([text, ids]) => {
        const button = el("button", "ch-btn", presets, text);
        button.type = "button";
        button.addEventListener("click", () => {
          state.selected = new Set(ids);
          changed();
        });
      });
    document.addEventListener("click", (e) => {
      if (pick.open && !pick.contains(e.target)) pick.open = false;
    });
    pick.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && pick.open) {
        pick.open = false;
        summary.focus();
      }
    });

    // ----- Chart -------------------------------------------------------------

    const plot = root.querySelector(".rk-plot");
    const panel = root.querySelector(".rk-panel");
    const chart = svg("svg", { class: "rk-svg", role: "group", "aria-label": "Chamfer-Fidelity and Chamfer-Coverage of each model" }, plot);
    const clipId = `rk-clip-${Math.random().toString(36).slice(2, 8)}`;
    const clipRect = svg("rect", {}, svg("clipPath", { id: clipId }, svg("defs", {}, chart)));
    const gridG = svg("g", { class: "rk-grid", "aria-hidden": "true" }, chart);
    const axisG = svg("g", { class: "rk-axis", "aria-hidden": "true" }, chart);
    const betterG = svg("g", { class: "rk-better", "aria-hidden": "true" }, chart);
    const dotsG = svg("g", { "clip-path": `url(#${clipId})` }, chart);
    const leadersG = svg("g", { "aria-hidden": "true" }, chart);
    const labelsG = svg("g", { "aria-hidden": "true" }, chart);

    // Zoom controls, inside the chart's top-left corner.
    const zoomEl = el("div", "rk-zoom", plot);
    zoomEl.style.left = `${M.left + 6}px`;
    zoomEl.style.top = `${M.top + 6}px`;
    const zoomButton = (text, label, action) => {
      const button = el("button", "ch-btn", zoomEl, text);
      button.type = "button";
      button.setAttribute("aria-label", label);
      button.title = label;
      button.addEventListener("click", action);
      return button;
    };
    zoomButton("+", "Zoom in", () => goTo(zoomed(view, M.left + PW / 2, M.top + PH / 2, 1 / ZOOM_STEP), true));
    zoomButton("−", "Zoom out", () => goTo(zoomed(view, M.left + PW / 2, M.top + PH / 2, ZOOM_STEP), true));
    const resetButton = zoomButton("Reset", "Reset the view", () => goTo(home, true));

    const emptyEl = el("div", "rk-empty", plot, "No models selected.");

    const dots = new Map();
    models.forEach((m) => {
      const mark = markOf(m);
      const square = mark === "square";
      const g = svg("g", { class: "rk-dot rk-off", "data-mark": mark, tabindex: "-1", role: "button" }, dotsG);
      g.setAttribute("aria-label", `${m.name}: Chamfer-Fidelity ${fmt(m.chamfer_fid)}, Chamfer-Coverage ${fmt(m.chamfer_cov)}`);
      if (m.params == null) g.classList.add("rk-unknown"); // no parameter count: a dashed bubble of middling size
      const shape = svg(square ? "rect" : "circle", { class: "rk-mark" }, g);
      const ring = svg(square ? "rect" : "circle", { class: "rk-ring" }, g);
      const leader = svg("line", { class: "rk-leader rk-hidden" }, leadersG);
      const label = svg("text", { class: "rk-label rk-hidden", "dominant-baseline": "central" }, labelsG);
      label.textContent = m.name;
      g.addEventListener("focus", () => hover(m.id));
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          togglePin(m.id);
        }
      });
      dots.set(m.id, { m, g, shape, ring, label, leader, square, x: 0, y: 0, r: 0, placed: false, far: false, fallback: null });
    });

    let W = 0; // chart width and height, in px
    let H = 0;
    let PW = 0; // plot area
    let PH = 0;
    let view = null; // { x0, y0, upp }: the values at the plot's bottom-left corner, and units per px
    let home = null; // the view that fits the chosen models
    let frame = 0;
    let labelFrame = 0;
    let rScale = 1;
    const radius = (m) => Math.max(4.5, rScale * Math.sqrt(m.params == null ? 500 : m.params));
    const toX = (v, d) => M.left + (v - d.x0) / d.upp;
    const toY = (v, d) => M.top + PH - (v - d.y0) / d.upp;
    const inPlot = (o) => o.x >= M.left && o.x <= M.left + PW && o.y >= M.top && o.y <= M.top + PH;

    // As tall as the window allows below the row of controls: on a wide screen
    // the panel sits beside the chart and takes its height; on a narrower one
    // it sits under the chart and must fit too. On a phone, simply in proportion.
    const wide = window.matchMedia("(min-width: 860px)");
    function chartHeight() {
      if (W < 480) return Math.round(W * 0.8);
      const nav = document.getElementById("navbar");
      const top = nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0;
      const controls = root.querySelector(".rk-controls");
      const above = controls.offsetHeight + parseFloat(getComputedStyle(controls).marginBottom);
      const below = wide.matches ? 0 : panel.offsetHeight + 20;
      const style = getComputedStyle(root); // the frame round the chart
      const frame =
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const room = window.innerHeight - top - frame - above - below - 24;
      return Math.round(Math.max(300, Math.min(W * (wide.matches ? 0.8 : 0.62), room)));
    }

    function measure() {
      W = Math.max(280, Math.round(plot.clientWidth));
      H = chartHeight();
      PW = W - M.left - M.right;
      PH = H - M.top - M.bottom;
      setAttrs(chart, { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
      setAttrs(clipRect, { x: M.left, y: M.top, width: PW, height: PH });
      rScale = ((Math.min(W, 640) / 560) * 22) / Math.sqrt(2000); // a 2B model gets a 22px radius at 560px wide
      dots.forEach((d) => {
        d.r = radius(d.m);
        if (d.square) {
          const s = d.r * 0.89; // a square of the same area as the circle
          const t = s + 3.5;
          setAttrs(d.shape, { x: -s, y: -s, width: 2 * s, height: 2 * s, rx: 2 });
          setAttrs(d.ring, { x: -t, y: -t, width: 2 * t, height: 2 * t, rx: 3 });
        } else {
          d.shape.setAttribute("r", d.r);
          d.ring.setAttribute("r", d.r + 3.5);
        }
      });
      drawBetter();
    }

    // The view that fits the chosen models, with both axes on the same scale.
    function fit() {
      const shown = [...state.selected].map((id) => dots.get(id));
      if (!shown.length) return view;
      const xs = shown.map((d) => d.m.chamfer_fid);
      const ys = shown.map((d) => d.m.chamfer_cov);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const inset = Math.max(...shown.map((d) => d.r)) + 14;
      const upp = Math.max((x1 - x0) / (PW - 2 * inset), (y1 - y0) / (PH - 2 * inset), minSpan / (PW - 2 * inset)) * 1.04;
      return { x0: (x0 + x1) / 2 - (upp * PW) / 2, y0: (y0 + y1) / 2 - (upp * PH) / 2, upp };
    }

    function ticks(lo, hi, upp) {
      const step = niceStep(44 * upp); // at least 44px apart
      const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
      const out = [];
      for (let i = Math.ceil(lo / step); i * step <= hi + 1e-9 * step; i++) out.push({ v: i * step, text: (i * step).toFixed(digits) });
      return out;
    }

    function drawAxes(d) {
      gridG.textContent = "";
      axisG.textContent = "";
      ticks(d.x0, d.x0 + d.upp * PW, d.upp).forEach(({ v, text }) => {
        const x = Math.round(toX(v, d)) + 0.5;
        svg("line", { x1: x, x2: x, y1: M.top, y2: M.top + PH }, gridG);
        svg("text", { x, y: M.top + PH + 16, "text-anchor": "middle" }, axisG).textContent = text;
      });
      ticks(d.y0, d.y0 + d.upp * PH, d.upp).forEach(({ v, text }) => {
        const y = Math.round(toY(v, d)) + 0.5;
        svg("line", { x1: M.left, x2: M.left + PW, y1: y, y2: y }, gridG);
        svg("text", { x: M.left - 8, y, "text-anchor": "end", "dominant-baseline": "central" }, axisG).textContent = text;
      });
      svg("text", { class: "rk-title", x: M.left + PW / 2, y: H - 6, "text-anchor": "middle" }, axisG).textContent =
        "Chamfer-Fidelity (lower is better)";
      const yTitle = svg(
        "text",
        { class: "rk-title", x: 0, y: 0, "text-anchor": "middle", transform: `translate(12 ${M.top + PH / 2}) rotate(-90)` },
        axisG
      );
      yTitle.textContent = "Chamfer-Coverage (lower is better)";
    }

    function drawBetter() {
      betterG.textContent = "";
      const x = M.left + PW - 16;
      const y = M.top + PH - 62;
      const [dx, dy] = [-56, 34];
      const len = Math.hypot(dx, dy);
      const [ux, uy] = [dx / len, dy / len];
      svg("line", { x1: x, y1: y, x2: x + dx - ux * 6, y2: y + dy - uy * 6 }, betterG);
      const hx = x + dx;
      const hy = y + dy;
      const points = [
        [hx, hy],
        [hx - ux * 8 - uy * 4, hy - uy * 8 + ux * 4],
        [hx - ux * 8 + uy * 4, hy - uy * 8 - ux * 4],
      ];
      svg("path", { d: `M${points.map((p) => p.join(",")).join("L")}Z` }, betterG);
      svg("text", { x, y: y - 8, "text-anchor": "end" }, betterG).textContent = "Better";
      // How to zoom, in the bottom-right corner beside the axis title.
      if (W >= 480) {
        const hint = coarse.matches ? "Pinch to zoom" : "Ctrl/⌘ + scroll to zoom";
        svg("text", { class: "rk-zoom-hint", x: W - M.right, y: H - 6, "text-anchor": "end" }, betterG).textContent = hint;
      }
    }

    function draw(d) {
      drawAxes(d);
      dots.forEach((o) => {
        o.x = toX(o.m.chamfer_fid, d);
        o.y = toY(o.m.chamfer_cov, d);
        o.g.setAttribute("transform", `translate(${o.x.toFixed(1)} ${o.y.toFixed(1)})`);
      });
    }

    // Labels go beside their bubble where they clear every other bubble and
    // label, or a little further out on a leader line; the rest stay hidden
    // until their model is hovered.
    const ruler = document.createElement("canvas").getContext("2d");
    const widths = new Map();
    function textWidth(text) {
      if (!widths.has(text)) {
        ruler.font = `12px ${getComputedStyle(chart).fontFamily}`;
        widths.set(text, ruler.measureText(text).width);
      }
      return widths.get(text);
    }
    function candidates(o, w, h, extra) {
      const { x, y } = o;
      const r = o.r + extra;
      const k = r * 0.75;
      return [
        { x0: x + r + 5, y0: y - h / 2 },
        { x0: x - r - 5 - w, y0: y - h / 2 },
        { x0: x - w / 2, y0: y - r - 3 - h },
        { x0: x - w / 2, y0: y + r + 3 },
        { x0: x + k + 2, y0: y - k - h },
        { x0: x + k + 2, y0: y + k },
        { x0: x - k - 2 - w, y0: y - k - h },
        { x0: x - k - 2 - w, y0: y + k },
      ].map((c) => ({ ...c, x1: c.x0 + w, y1: c.y0 + h, far: extra > 0 }));
    }
    const inBounds = (c) => c.x0 >= M.left + 2 && c.x1 <= M.left + PW - 2 && c.y0 >= M.top && c.y1 <= M.top + PH;
    function placeLabels() {
      labelFrame = 0;
      const shown = [...dots.values()].filter((o) => state.selected.has(o.m.id) && inPlot(o));
      const taken = shown.map((o) => ({ id: o.m.id, x0: o.x - o.r - 1, y0: o.y - o.r - 1, x1: o.x + o.r + 1, y1: o.y + o.r + 1 }));
      const z = { x0: zoomEl.offsetLeft - 4, y0: zoomEl.offsetTop - 4 };
      taken.push({ id: "zoom", ...z, x1: z.x0 + zoomEl.offsetWidth + 8, y1: z.y0 + zoomEl.offsetHeight + 8 });
      const order = [...shown].sort((a, b) => figure.includes(b.m.id) - figure.includes(a.m.id) || a.m.chamfer_fid - b.m.chamfer_fid);
      dots.forEach((o) => {
        o.placed = false;
        o.fallback = null;
      });
      order.forEach((o) => {
        const w = textWidth(o.m.name);
        const options = [...candidates(o, w, 15, 0), ...candidates(o, w, 15, 16)];
        const spot = options.find((c) => inBounds(c) && !taken.some((t) => t.id !== o.m.id && overlap(t, c)));
        if (spot) {
          taken.push({ id: "label", ...spot });
          o.placed = true;
          setLabel(o, spot);
        } else {
          o.fallback = options.find(inBounds) || options[0];
        }
      });
      updateLabels();
    }
    const queueLabels = () => {
      if (!labelFrame) labelFrame = requestAnimationFrame(placeLabels);
    };
    function setLabel(o, spot) {
      o.label.setAttribute("x", spot.x0.toFixed(1));
      o.label.setAttribute("y", ((spot.y0 + spot.y1) / 2).toFixed(1));
      o.far = spot.far;
      if (!spot.far) return;
      // Leader from the bubble's edge to the nearest point of the label.
      const ax = Math.min(Math.max(o.x, spot.x0), spot.x1);
      const ay = Math.min(Math.max(o.y, spot.y0 + 3), spot.y1 - 3);
      const len = Math.hypot(ax - o.x, ay - o.y) || 1;
      const [ux, uy] = [(ax - o.x) / len, (ay - o.y) / len];
      setAttrs(o.leader, { x1: o.x + ux * (o.r + 2), y1: o.y + uy * (o.r + 2), x2: ax - ux * 2, y2: ay - uy * 2 });
    }
    function updateLabels() {
      dots.forEach((o) => {
        const active = o.m.id === state.active && state.selected.has(o.m.id) && inPlot(o);
        if (active && !o.placed && o.fallback) setLabel(o, o.fallback);
        const hidden = !(state.selected.has(o.m.id) && (o.placed || active));
        o.label.classList.toggle("rk-hidden", hidden);
        o.label.classList.toggle("rk-active", active);
        o.leader.classList.toggle("rk-hidden", hidden || !o.far);
      });
    }

    // ----- Zoom and pan --------------------------------------------------------

    const clampUpp = (upp) => Math.min(home.upp * 1.5, Math.max(home.upp / MAX_ZOOM, upp));
    // The view scaled by `f` about the point (px, py), which stays where it is.
    function zoomed(base, px, py, f) {
      const upp = clampUpp(base.upp * f);
      const vx = base.x0 + (px - M.left) * base.upp;
      const vy = base.y0 + (M.top + PH - py) * base.upp;
      return { x0: vx - (px - M.left) * upp, y0: vy - (M.top + PH - py) * upp, upp };
    }
    const atHome = () =>
      !home || (Math.abs(view.upp - home.upp) < home.upp * 1e-3 && Math.abs(view.x0 - home.x0) < home.upp && Math.abs(view.y0 - home.y0) < home.upp);
    const updateReset = () => {
      resetButton.disabled = atHome();
    };

    // Straight to a view, as during a drag or a pinch.
    function setView(next) {
      cancelAnimationFrame(frame);
      view = next;
      draw(view);
      queueLabels();
      updateReset();
    }

    // Eased to a view, as for the buttons and the filters.
    function goTo(target, animate) {
      cancelAnimationFrame(frame);
      if (!target) return;
      if (!view || !animate || reduceMotion.matches) {
        view = target;
        draw(view);
        placeLabels();
        updateReset();
        return;
      }
      const from = view;
      const start = performance.now();
      dots.forEach((o) => {
        o.label.classList.add("rk-hidden");
        o.leader.classList.add("rk-hidden");
      });
      const step = (now) => {
        const t = Math.min(1, (now - start) / ANIM);
        const e = ease(t);
        view = { x0: from.x0 + (target.x0 - from.x0) * e, y0: from.y0 + (target.y0 - from.y0) * e, upp: from.upp + (target.upp - from.upp) * e };
        draw(view);
        if (t < 1) frame = requestAnimationFrame(step);
        else {
          placeLabels();
          updateReset();
        }
      };
      frame = requestAnimationFrame(step);
    }

    const local = (e) => {
      const box = chart.getBoundingClientRect();
      return { x: ((e.clientX - box.left) * W) / box.width, y: ((e.clientY - box.top) * H) / box.height };
    };
    // The nearest chosen bubble within reach of a point, so small ones are easy to hit.
    function nearest(p) {
      let best = null;
      let bestGap = NEAR;
      dots.forEach((o) => {
        if (!state.selected.has(o.m.id) || !inPlot(o)) return;
        const gap = Math.hypot(o.x - p.x, o.y - p.y) - o.r;
        if (gap <= bestGap) {
          best = o.m.id;
          bestGap = gap;
        }
      });
      return best;
    }

    const pointers = new Map();
    let drag = null; // one pointer pressed: { id, x, y, view, moved }
    let pinch = null; // two touch pointers: { dist, mid, view }
    let swallowClick = false;
    const pair = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };

    chart.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      swallowClick = false;
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) drag = { id: e.pointerId, x: p.x, y: p.y, view: { ...view }, moved: false };
      else if (pointers.size === 2) {
        drag = null;
        pinch = { ...pair(), view: { ...view } };
        swallowClick = true; // lifting the fingers is not a tap
      }
    });
    chart.addEventListener("pointermove", (e) => {
      const p = local(e);
      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, p);
        if (pinch && pointers.size === 2) {
          const now = pair();
          const next = zoomed(pinch.view, pinch.mid.x, pinch.mid.y, pinch.dist / now.dist);
          setView({ ...next, x0: next.x0 - (now.mid.x - pinch.mid.x) * next.upp, y0: next.y0 + (now.mid.y - pinch.mid.y) * next.upp });
          return;
        }
        if (drag && drag.id === e.pointerId) {
          const dx = p.x - drag.x;
          const dy = p.y - drag.y;
          if (!drag.moved && Math.hypot(dx, dy) > DRAG) {
            drag.moved = true;
            try {
              chart.setPointerCapture(e.pointerId); // keep panning when the pointer leaves the chart
            } catch (err) {
              // the pointer is already gone
            }
            chart.classList.add("rk-panning");
          }
          if (drag.moved) {
            setView({ x0: drag.view.x0 - dx * drag.view.upp, y0: drag.view.y0 + dy * drag.view.upp, upp: drag.view.upp });
            return;
          }
        }
      }
      if (e.pointerType === "touch") return;
      const id = nearest(p);
      chart.classList.toggle("rk-hovering", !!id);
      chart.classList.toggle("rk-grab", !id);
      if (id) hover(id);
    });
    const release = (e) => {
      if (drag && drag.moved) swallowClick = true;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) {
        drag = null;
        chart.classList.remove("rk-panning");
      }
    };
    chart.addEventListener("pointerup", release);
    chart.addEventListener("pointercancel", release);
    chart.addEventListener("pointerleave", () => chart.classList.remove("rk-hovering"));
    chart.addEventListener("click", (e) => {
      if (swallowClick) {
        swallowClick = false;
        return;
      }
      const id = nearest(local(e));
      if (id) togglePin(id);
      else if (state.pinned) {
        state.pinned = false;
        renderPanel();
      }
    });
    chart.addEventListener("dblclick", (e) => {
      const p = local(e);
      if (!nearest(p)) goTo(zoomed(view, p.x, p.y, 1 / ZOOM_STEP), true);
    });
    // Ctrl/Cmd + scroll, and pinches on a trackpad (which arrive the same way),
    // zoom; a plain scroll still scrolls the page.
    chart.addEventListener(
      "wheel",
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const p = local(e);
        setView(zoomed(view, p.x, p.y, Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025))));
      },
      { passive: false }
    );
    // Safari reports trackpad pinches as gestures.
    let gesture = null;
    chart.addEventListener("gesturestart", (e) => {
      e.preventDefault();
      gesture = { p: local(e), view: { ...view } };
    });
    chart.addEventListener("gesturechange", (e) => {
      e.preventDefault();
      if (gesture) setView(zoomed(gesture.view, gesture.p.x, gesture.p.y, 1 / e.scale));
    });
    chart.addEventListener("gestureend", () => (gesture = null));

    // ----- Panel ---------------------------------------------------------------

    const images = new Map(); // url -> <img>, so a model hovered again shows at once
    let loadTimer = 0;
    let observers = [];

    function hover(id) {
      if (state.pinned && id !== state.active) return;
      setActive(id);
    }
    function togglePin(id) {
      if (state.pinned && state.active === id) {
        state.pinned = false;
        renderPanel();
        return;
      }
      state.pinned = false;
      setActive(id);
      state.pinned = true;
      renderPanel();
    }
    function setActive(id) {
      if (state.active === id) return;
      state.active = id;
      dots.forEach((o) => o.g.classList.toggle("rk-active", o.m.id === id));
      updateLabels();
      renderPanel();
    }

    function renderPanel() {
      clearTimeout(loadTimer);
      observers.forEach((o) => o.disconnect());
      observers = [];
      panel.textContent = "";
      const m = byId.get(state.active);
      const info = el("div", "rk-info", panel);
      if (!m)
        el(
          "p",
          "rk-hint",
          info,
          "Hover over a model, or tap it, to see its generated samples closest to and farthest from the real images. Click a model to keep it here, and click it again to let it go."
        );
      else renderInfo(info, m);

      // Both rows are always drawn, so the panel keeps one height: empty tiles
      // until a model is hovered, a note for a model without samples yet.
      const s = m && samples.get(m.id);
      const wrap = el("div", "rk-samples", panel);
      const strips = [];
      [
        ["closest", "Closest to real images"],
        ["farthest", "Farthest from real images"],
      ].forEach(([side, heading]) => {
        const items = s ? s[side] : [];
        const title = el("div", "rk-side", wrap, heading);
        if (items.length) el("span", null, title, String(items.length));
        const strip = el("div", "rk-strip", wrap);
        if (m && !items.length) {
          strip.classList.add("rk-strip-soon");
          el("div", "rk-soon", strip, "Samples for this model are coming soon.");
          return;
        }
        if (!m) {
          for (let i = 0; i < 12; i++) el("div", "rk-thumb", strip);
          return;
        }
        strip.tabIndex = 0;
        strip.setAttribute("aria-label", `${heading}: ${items.length} samples, scroll for more`);
        items.forEach((item, i) => {
          const cell = el("div", "rk-thumb", strip);
          if (images.has(item.url)) cell.appendChild(images.get(item.url));
          else {
            cell.dataset.src = item.url;
            cell.dataset.alt = `${m.name}: sample ${i + 1} ${side} to the real images`;
          }
        });
        strips.push(strip);
      });
      sizeStrips();
      if (!strips.length) return;

      // Fetch once the pointer has settled on this model, and only the samples
      // in view (or about to scroll into it).
      const id = m.id;
      loadTimer = setTimeout(
        () => {
          if (state.active !== id) return;
          strips.forEach((strip) => {
            const io = new IntersectionObserver(
              (entries) =>
                entries.forEach((entry) => {
                  if (!entry.isIntersecting) return;
                  io.unobserve(entry.target);
                  load(entry.target);
                }),
              { root: strip, rootMargin: "0px 120px 0px 0px" }
            );
            strip.querySelectorAll(".rk-thumb[data-src]").forEach((cell) => io.observe(cell));
            observers.push(io);
          });
        },
        state.pinned ? 0 : HOVER_DELAY
      );
    }

    // The model's name with its size and steps in small on the right, then its
    // two Chamfer scores.
    function renderInfo(info, m) {
      const head = el("div", "rk-head", info);
      el("span", "rk-key", head).dataset.mark = markOf(m);
      el("div", "rk-name", head, m.name);
      const meta = [m.params == null ? "params not reported" : paramsText(m.params), m.nfe == null ? null : `NFE ${m.nfe}`];
      el("div", "rk-meta", head, meta.filter(Boolean).join(" · "));
      const scores = el("div", "rk-scores", info);
      [
        ["Chamfer-Fidelity", m.chamfer_fid],
        ["Chamfer-Coverage", m.chamfer_cov],
      ].forEach(([label, value]) => el("b", null, el("span", null, scores, label), fmt(value)));
    }

    // One row of samples per strip, or two when the strips are tall enough;
    // both strips get the same size of sample.
    function sizeStrips() {
      const strips = [...panel.querySelectorAll(".rk-strip:not(.rk-strip-soon)")];
      // The strip's height less its bottom padding, which is the scrollbar's room.
      const pad = strips.length ? parseFloat(getComputedStyle(strips[0]).paddingBottom) : 0;
      const h = Math.min(...strips.map((strip) => strip.clientHeight)) - pad;
      if (!strips.length || !h) return;
      const rows = h >= 170 ? 2 : 1;
      const size = Math.floor((h - (rows - 1) * 4) / rows);
      strips.forEach((strip) => {
        strip.style.setProperty("--rk-rows", rows);
        strip.style.setProperty("--rk-size", `${size}px`);
      });
    }

    function load(cell) {
      const url = cell.dataset.src;
      if (!url) return;
      const img = new Image();
      img.decoding = "async";
      img.width = 256;
      img.height = 256;
      img.alt = cell.dataset.alt;
      img.addEventListener("load", () => img.classList.add("rk-loaded"));
      img.addEventListener("error", () => images.delete(url));
      img.src = url;
      images.set(url, img);
      cell.removeAttribute("data-src");
      cell.appendChild(img);
    }

    // ----- Updates ---------------------------------------------------------

    function changed() {
      const n = state.selected.size;
      chips.forEach(({ chip, family }) => {
        const ids = models.filter((m) => m.family === family).map((m) => m.id);
        const on = ids.filter((id) => state.selected.has(id)).length;
        chip.setAttribute("aria-pressed", on === 0 ? "false" : on === ids.length ? "true" : "mixed");
      });
      boxes.forEach((box, id) => (box.checked = state.selected.has(id)));
      summary.textContent = `Models · ${n} of ${models.length}`;
      dots.forEach((o) => {
        const on = state.selected.has(o.m.id);
        o.g.classList.toggle("rk-off", !on);
        o.g.setAttribute("tabindex", on ? "0" : "-1");
      });
      if (state.active && !state.selected.has(state.active)) {
        state.pinned = false;
        setActive(null);
      }
      emptyEl.style.display = n ? "none" : "";
      home = fit() || home;
      goTo(home, true);
    }

    let lastSize = "";
    const resized = () => {
      const size = `${plot.clientWidth}x${window.innerHeight}`;
      if (size === lastSize) return;
      lastSize = size;
      measure();
      home = fit() || home;
      goTo(home, false);
    };
    new ResizeObserver(resized).observe(plot);
    new ResizeObserver(sizeStrips).observe(panel);
    window.addEventListener("resize", resized);

    // The first view appears at once; fades are for changes after that.
    root.classList.add("rk-instant");
    renderPanel(); // first, so the chart can leave room for it
    measure();
    changed();
    void root.offsetWidth; // settle the first styles before fades are allowed
    setTimeout(() => root.classList.remove("rk-instant"), 50);
  }
})();
