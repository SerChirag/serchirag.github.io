// Chamfer-Fidelity per sample, model by model (the paper's Figure 11, interactive).
// Markup and styles: _includes/chamfer/fidelity-density.liquid.
// Data: _data/chamfer_fidelity_density.json.
//
// A fixed-size marker on the distance axis picks a distance; each model shows
// the sample whose distance is nearest to it (a nearest-neighbour search over
// the sorted distances). Ctrl/Cmd + scroll or a pinch zooms, dragging pans, and
// the buttons zoom and reset. The box is sized to fit the window.
(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";

  const START = 0.02; // the marker's distance when the page opens
  const MIN_X_SPAN = 0.01; // the deepest zoom, in distance units across the plot
  const MIN_Y_SPAN = 0.2; // the same for the % of samples axis
  const ZOOM_STEP = 1.6; // one press of + or −
  const DRAG = 4; // px the pointer moves before a press on the plot becomes a drag
  const MARKER_W = 22; // the handle's width in px; it stays this size at any zoom
  const MARKER_HIT = 12; // px either side of the marker that grab it
  const ANIM = 260; // ms for the zoom buttons' eased moves
  const WIDE = 720; // box width (px) from which the panel sits beside the chart
  const PAUSE = 100; // ms the marker must rest before a new image is fetched, so a fast drag doesn't download every image it passes
  const FADE = 250; // ms for the cross-fade between a tile's images (matches .cfd-in in the include)

  const el = (tag, attrs = {}, parent) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  };
  const set = (node, attrs) => {
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmt = (v) => v.toFixed(3);
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  // A round tick step giving about n ticks across a span.
  const niceStep = (span, n) => {
    const raw = span / Math.max(1, n);
    const pow = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  };
  const decimals = (step) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarse = window.matchMedia("(pointer: coarse)");
  let instances = 0;

  function setup(root) {
    const { data, images } = JSON.parse(root.querySelector(".cfd-data").textContent);
    const models = data.models.map((m) => ({ ...m, samples: [...m.samples].sort((a, b) => a.d - b.d) }));
    const xMax = data.x_max;
    const yTop = Math.max(data.y_ticks[data.y_ticks.length - 1], ...models.flatMap((m) => m.curve.map((p) => p[1])));
    const home = { x0: 0, x1: xMax, y0: 0, y1: yTop };

    const svg = root.querySelector(".cfd-chart");
    const plot = root.querySelector(".cfd-plot");
    const panel = root.querySelector(".cfd-panel");
    const zoomBox = root.querySelector(".cfd-zoom");
    const resetButton = zoomBox.querySelector('[data-zoom="reset"]');
    root.querySelector(".cfd-hint").textContent = coarse.matches
      ? "Drag the marker to pick a distance. Zoom with + and −."
      : "Drag the marker to pick a distance. Ctrl/⌘ + scroll to zoom, drag to pan.";

    let view = { ...home };
    let q = START; // the marker's distance
    let L = null; // pixel layout, set by layout()
    let frame = 0; // a running zoom animation

    // ---- SVG skeleton. The parts that move are updated in place, so the marker keeps keyboard focus.
    const clipId = `cfd-clip-${++instances}`;
    const clipRect = el("rect", {}, el("clipPath", { id: clipId }, el("defs", {}, svg)));
    const gGrid = el("g", {}, svg);
    const gCurves = el("g", { "clip-path": `url(#${clipId})` }, svg);
    const curves = models.map((m) => {
      const g = el("g", { class: "cfd-curve" }, gCurves);
      const area = el("path", { fill: m.color, "fill-opacity": 0.1 }, g);
      const line = el("path", { fill: "none", stroke: m.color, "stroke-width": 1.75, "stroke-linejoin": "round" }, g);
      const mean = el("line", { stroke: m.color, "stroke-width": 1.2, "stroke-dasharray": "4 3" }, g);
      const label = el("text", { class: "cfd-mean-label" }, g);
      label.textContent = `mean ${fmt(m.mean)}`;
      label.style.fill = m.color;
      return { m, g, area, line, mean, label };
    });
    const markerLine = el("line", { class: "cfd-marker-line" }, el("g", { "clip-path": `url(#${clipId})` }, svg));
    const gAxis = el("g", {}, svg);
    const gRug = el("g", {}, svg);
    const marker = el(
      "g",
      {
        class: "cfd-marker",
        tabindex: 0,
        role: "slider",
        "aria-label": "Distance to nearest real image",
        "aria-valuemin": 0,
        "aria-valuemax": xMax,
      },
      svg
    );
    const handle = el("rect", { class: "cfd-handle", width: MARKER_W, height: 14, rx: 7 }, marker);
    const grips = [el("line", { class: "cfd-grip" }, marker), el("line", { class: "cfd-grip" }, marker)];
    marker.style.visibility = "hidden"; // until the first layout places it

    // ---- Panel: one block per model, built once; the images change with the marker.
    const blocks = models.map((m, i) => {
      const block = document.createElement("div");
      block.className = "cfd-block";
      const head = document.createElement("div");
      head.className = "cfd-head";
      const name = document.createElement("div");
      name.className = "cfd-name";
      name.style.color = m.color;
      name.textContent = m.name;
      head.append(name);
      const strip = document.createElement("div");
      strip.className = "cfd-strip";
      strip.style.borderColor = m.color;
      block.append(head, strip);
      panel.appendChild(block);
      block.addEventListener("pointerenter", () => setFocus(i));
      block.addEventListener("pointerleave", () => setFocus(null));
      const index = new Map(m.samples.map((s, j) => [s.file, j]));
      return { m, strip, index, target: null, current: null, shown: new Set(), cache: new Map() };
    });

    // ---- Key: a line per model in its colour, then the dashed line for a mean. Hovering a model highlights it.
    const keyBox = root.querySelector(".cfd-key");
    const keyItem = (stroke, dash, text, cls) => {
      const item = document.createElement("span");
      item.className = `cfd-key-item${cls ? ` ${cls}` : ""}`;
      item.setAttribute("role", "listitem");
      const swatch = el("svg", { viewBox: "0 0 22 10", "aria-hidden": "true" }, item);
      el("line", { x1: 1, y1: 5, x2: 21, y2: 5, stroke, "stroke-width": dash ? 1.5 : 2.25, "stroke-dasharray": dash || "none" }, swatch);
      item.append(text);
      keyBox.appendChild(item);
      return item;
    };
    models.forEach((m, i) => {
      const item = keyItem(m.color, null, m.name);
      item.addEventListener("pointerenter", () => setFocus(i));
      item.addEventListener("pointerleave", () => setFocus(null));
    });
    keyItem("currentColor", "4 3", "Mean", "cfd-key-mean");

    function setFocus(i) {
      curves.forEach((c, j) => {
        c.g.classList.toggle("cfd-dim", i !== null && i !== j);
        c.g.classList.toggle("cfd-focus", i === j);
      });
    }

    // Index of the sample whose distance is nearest to x: a binary search over the sorted distances.
    function nearestIndex(samples, x) {
      let lo = 0;
      let hi = samples.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].d < x) lo = mid + 1;
        else hi = mid;
      }
      if (lo === 0) return 0;
      if (lo === samples.length) return lo - 1;
      return x - samples[lo - 1].d <= samples[lo].d - x ? lo - 1 : lo;
    }

    // ---- Images. Each is made the first time it is needed and kept, so going back is instant.
    // A tile keeps its image until the next one has loaded, then fades the new one in over it.
    // Nothing is downloaded while the marker moves: once it rests for PAUSE ms, each tile's image
    // is fetched and the samples either side of it are preloaded, so the next small step is instant.
    const isLoaded = (img) => img.complete && img.naturalWidth > 0;
    const whenLoaded = (img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((done) => {
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
          });

    function getImg(b, file) {
      let img = b.cache.get(file);
      if (!img) {
        img = document.createElement("img");
        img.alt = `${b.m.name} sample`;
        img.width = 256;
        img.height = 256;
        img.decoding = "async";
        img.dataset.file = file;
        img.src = `${images}${b.m.id}/${file}`; // starts the download
        b.cache.set(file, img);
      }
      return img;
    }

    function preloadNeighbours(b, file) {
      const i = b.index.get(file);
      for (const j of [i - 1, i + 1]) {
        if (j >= 0 && j < b.m.samples.length) getImg(b, b.m.samples[j].file);
      }
    }

    // Put img on top of the tile and fade it in; what was under it goes once the fade ends.
    function show(b, img) {
      if (b.current === img) return;
      b.current = img;
      const under = [...b.strip.children].filter((n) => n !== img);
      img.classList.remove("cfd-in");
      b.strip.appendChild(img);
      const clear = () => {
        for (const n of under) if (n !== b.current) n.remove();
        img.classList.remove("cfd-in");
      };
      if (!under.length || reduceMotion.matches) clear();
      else {
        void img.offsetWidth; // restart the fade if this image was shown before
        img.classList.add("cfd-in");
        setTimeout(clear, FADE + 50);
      }
    }

    let restTimer = 0;
    function updatePanel() {
      for (const b of blocks) {
        if (!b.m.samples.length) continue;
        const { file } = b.m.samples[nearestIndex(b.m.samples, q)];
        b.target = file;
        b.shown = new Set([file]);
        if (b.current && b.current.dataset.file === file) continue;
        const cached = b.cache.get(file);
        // The first image goes up at once; later ones at once only if already loaded.
        if (!b.current || (cached && isLoaded(cached))) show(b, getImg(b, file));
      }
      clearTimeout(restTimer);
      restTimer = setTimeout(onRest, PAUSE);
    }

    // The marker has rested: fetch each tile's image, show it once loaded (if still wanted), and preload its neighbours.
    function onRest() {
      for (const b of blocks) {
        const file = b.target;
        if (!file) continue;
        if (!b.current || b.current.dataset.file !== file) {
          const img = getImg(b, file);
          whenLoaded(img).then(() => {
            if (b.target === file) show(b, img);
          });
        }
        preloadNeighbours(b, file);
      }
    }

    // ---- Layout: the chart is as tall as the window allows, and the panel matches it.
    function layout() {
      const boxW = root.clientWidth;
      if (!boxW) return;
      const wide = boxW >= WIDE;
      root.classList.toggle("cfd-wide", wide);
      const W = Math.round(plot.clientWidth);
      let H;
      if (wide) {
        const nav = document.getElementById("navbar");
        const top = nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0;
        const style = getComputedStyle(root);
        const chrome =
          parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        const head = root.querySelector(".cfd-top");
        const above = head.offsetHeight + parseFloat(getComputedStyle(head).marginBottom);
        const room = window.innerHeight - top - chrome - above - 16;
        // Tall enough for the panel beside it: a square grid, two blocks across.
        const ps = getComputedStyle(panel);
        const rows = Math.ceil(models.length / 2);
        const side = (panel.clientWidth - (parseFloat(ps.columnGap) || 0)) / 2 - 10; // less the frame
        const headH = Math.max(...[...panel.querySelectorAll(".cfd-head")].map((h) => h.offsetHeight)) + 4;
        const noteH = panel.querySelector(".cfd-panel-note")?.offsetHeight || 0;
        const need = noteH + rows * (side + 10 + headH) + (parseFloat(ps.rowGap) || 0) * rows;
        H = Math.round(clamp(Math.max(Math.min(room, W * 0.85), need), 300, 720));
      } else {
        H = Math.round(clamp(W * 0.72, 240, 420));
      }
      const narrow = W < 420;
      const ml = narrow ? 34 : 44;
      const mr = 10;
      const mt = 10;
      const bottom = 9 + models.length * 5 + 16 + 20 + 8; // rug, tick labels, axis title
      L = { W, H, ml, mr, mt, PW: W - ml - mr, PH: H - mt - bottom, narrow };
      L.axisY = mt + L.PH;
      set(svg, { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
      set(clipRect, { x: ml, y: mt, width: L.PW, height: L.PH });
      zoomBox.style.right = `${mr + 6}px`;
      zoomBox.style.top = `${mt + 6}px`;

      // Beside the chart, the panel takes its height; underneath, its own.
      panel.style.height = wide ? `${H}px` : "";
      updatePanel();
      draw();
    }

    // ---- Drawing, for the current view.
    const sx = (x) => L.ml + ((x - view.x0) / (view.x1 - view.x0)) * L.PW;
    const sy = (y) => L.mt + L.PH - ((y - view.y0) / (view.y1 - view.y0)) * L.PH;
    const xAt = (px) => view.x0 + ((px - L.ml) / L.PW) * (view.x1 - view.x0);
    const yAt = (py) => view.y0 + ((L.mt + L.PH - py) / L.PH) * (view.y1 - view.y0);
    const atHome = () =>
      Math.abs(view.x0 - home.x0) < 1e-9 &&
      Math.abs(view.x1 - home.x1) < 1e-9 &&
      Math.abs(view.y0 - home.y0) < 1e-9 &&
      Math.abs(view.y1 - home.y1) < 1e-9;

    function draw() {
      if (!L) return;
      const { W, ml, mr, mt, PW, PH, axisY, narrow } = L;

      // Grid and y axis.
      gGrid.replaceChildren();
      const yStep = niceStep(view.y1 - view.y0, Math.max(3, Math.round(PH / 55)));
      const yDec = decimals(yStep);
      for (let t = Math.ceil(view.y0 / yStep - 1e-9) * yStep; t <= view.y1 + 1e-9; t += yStep) {
        const y = sy(t);
        if (t > view.y0 + 1e-9) el("line", { class: "cfd-grid", x1: ml, x2: ml + PW, y1: y, y2: y }, gGrid);
        el("text", { x: ml - 7, y: y + 4, "text-anchor": "end", "font-size": 11 }, gGrid).textContent = t.toFixed(yDec);
      }
      el(
        "text",
        {
          transform: `translate(${narrow ? 9 : 12} ${mt + PH / 2}) rotate(-90)`,
          "text-anchor": "middle",
          "font-size": 12,
        },
        gGrid
      ).textContent = data.y_label;

      // Curves and means.
      for (const c of curves) {
        const pts = c.m.curve;
        const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join("");
        const base = sy(0).toFixed(1);
        c.line.setAttribute("d", line);
        c.area.setAttribute("d", `${line}L${sx(pts[pts.length - 1][0]).toFixed(1)},${base}L${sx(pts[0][0]).toFixed(1)},${base}Z`);
        const mx = sx(c.m.mean);
        set(c.mean, { x1: mx, x2: mx, y1: mt, y2: axisY });
        set(c.label, { x: mx + 4, y: mt + 11, "font-size": 11 });
      }

      // x axis, ticks and titles.
      gAxis.replaceChildren();
      el("line", { class: "cfd-axis", x1: ml, x2: ml + PW, y1: axisY, y2: axisY }, gAxis);
      const xStep = niceStep(view.x1 - view.x0, Math.max(3, Math.round(PW / 70)));
      const xDec = decimals(xStep);
      const tickY = axisY + 9 + models.length * 5 + 14;
      for (let t = Math.ceil(view.x0 / xStep - 1e-9) * xStep; t <= view.x1 + 1e-9; t += xStep) {
        const x = sx(t);
        el("line", { class: "cfd-axis", x1: x, x2: x, y1: axisY, y2: axisY + 4 }, gAxis);
        el("text", { x, y: tickY, "text-anchor": "middle", "font-size": 11 }, gAxis).textContent = t.toFixed(xDec);
      }
      const titleY = tickY + 20;
      el("text", { x: ml + PW / 2, y: titleY, "text-anchor": "middle", "font-size": 12 }, gAxis).textContent = data.x_label;
      if (!narrow) {
        el("text", { x: ml, y: titleY, "font-size": 11 }, gAxis).textContent = "← Closer";
        el("text", { x: W - mr, y: titleY, "text-anchor": "end", "font-size": 11 }, gAxis).textContent = "Farther →";
      }

      drawRug();
      placeMarker();
      resetButton.disabled = atHome();
    }

    // Rug: a tick for every sample with an image, one row per model; the ones on show are bold.
    function drawRug() {
      gRug.replaceChildren();
      blocks.forEach((b, i) => {
        const y = L.axisY + 9 + i * 5;
        let dim = "";
        let bold = "";
        for (const s of b.m.samples) {
          if (s.d < view.x0 || s.d > view.x1) continue;
          const seg = `M${sx(s.d).toFixed(1)},${y}v3`;
          if (b.shown.has(s.file)) bold += seg;
          else dim += seg;
        }
        if (dim) el("path", { d: dim, stroke: b.m.color, "stroke-width": 1.25, "stroke-opacity": 0.35 }, gRug);
        if (bold) el("path", { d: bold, stroke: b.m.color, "stroke-width": 2.25 }, gRug);
      });
    }

    function placeMarker() {
      const inView = q >= view.x0 && q <= view.x1;
      const x = sx(q);
      marker.style.visibility = "";
      set(markerLine, { x1: x, x2: x, y1: L.mt, y2: L.axisY });
      markerLine.style.display = inView ? "" : "none";
      handle.style.display = inView ? "" : "none";
      grips.forEach((g, i) => {
        const gx = x + (i ? 2.5 : -2.5);
        set(g, { x1: gx, x2: gx, y1: L.axisY - 3.5, y2: L.axisY + 3.5 });
        g.style.display = inView ? "" : "none";
      });
      set(handle, { x: x - MARKER_W / 2, y: L.axisY - 7 });
      marker.setAttribute("aria-valuenow", q.toFixed(3));
      marker.setAttribute("aria-valuetext", fmt(q));
    }

    // Move the marker; with follow, pan so it stays on screen.
    function setQ(x, follow) {
      q = clamp(x, 0, xMax);
      if (follow && (q < view.x0 || q > view.x1)) {
        const span = view.x1 - view.x0;
        const x0 = clamp(q - span / 2, 0, xMax - span);
        view = { ...view, x0, x1: x0 + span };
      }
      updatePanel();
      draw();
    }

    // ---- Zoom and pan.
    function clampView(v) {
      const xs = clamp(v.x1 - v.x0, MIN_X_SPAN, xMax);
      const ys = clamp(v.y1 - v.y0, MIN_Y_SPAN, yTop);
      const x0 = clamp(v.x0, 0, xMax - xs);
      const y0 = clamp(v.y0, 0, yTop - ys);
      return { x0, x1: x0 + xs, y0, y1: y0 + ys };
    }
    // The view scaled by f about the pixel (px, py), which stays where it is.
    function zoomed(base, px, py, f) {
      const fx = (px - L.ml) / L.PW;
      const fy = (L.mt + L.PH - py) / L.PH;
      const ax = base.x0 + fx * (base.x1 - base.x0);
      const ay = base.y0 + fy * (base.y1 - base.y0);
      const xs = clamp((base.x1 - base.x0) * f, MIN_X_SPAN, xMax);
      const ys = clamp((base.y1 - base.y0) * f, MIN_Y_SPAN, yTop);
      return clampView({ x0: ax - fx * xs, x1: ax - fx * xs + xs, y0: ay - fy * ys, y1: ay - fy * ys + ys });
    }
    function setView(next) {
      cancelAnimationFrame(frame);
      view = clampView(next);
      draw();
    }
    function goTo(target) {
      cancelAnimationFrame(frame);
      target = clampView(target);
      if (reduceMotion.matches) {
        view = target;
        draw();
        return;
      }
      const from = { ...view };
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / ANIM);
        const e = ease(t);
        view = Object.fromEntries(Object.keys(from).map((key) => [key, from[key] + (target[key] - from[key]) * e]));
        draw();
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }
    // The buttons zoom about the marker (or the middle, if it is off screen), keeping the baseline in place.
    const zoomAnchor = () => [q >= view.x0 && q <= view.x1 ? sx(q) : L.ml + L.PW / 2, sy(view.y0)];
    zoomBox.addEventListener("click", (e) => {
      const which = e.target.closest("button")?.dataset.zoom;
      if (!which || !L) return;
      if (which === "reset") goTo(home);
      else goTo(zoomed(view, ...zoomAnchor(), which === "in" ? 1 / ZOOM_STEP : ZOOM_STEP));
    });

    // ---- Pointer: the marker drags; a click on the plot moves it there; a drag on the plot pans
    // (or, when nothing is zoomed, slides the marker); two fingers pinch.
    const local = (e) => {
      const r = svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    function zone(p) {
      if (!L || p.y < L.mt - 4 || p.y > L.axisY + 9 + models.length * 5 + 6) return null;
      if (p.x < L.ml - MARKER_HIT || p.x > L.ml + L.PW + MARKER_HIT) return null;
      if (q >= view.x0 && q <= view.x1 && Math.abs(p.x - sx(q)) <= MARKER_HIT) return "marker";
      if (p.x < L.ml || p.x > L.ml + L.PW) return null;
      return "plot";
    }
    const pointers = new Map();
    let drag = null;
    let pinch = null;
    let pending = null;
    let raf = 0;
    const pair = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };
    const capture = (id) => {
      try {
        svg.setPointerCapture(id);
      } catch (err) {
        // the pointer is already gone
      }
    };
    // One update per frame while dragging.
    const schedule = (fn) => {
      pending = fn;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          const run = pending;
          pending = null;
          if (run) run();
        });
      }
    };

    svg.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const p = local(e);
      const z = zone(p);
      if (!z && !pointers.size) return;
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        drag = null;
        pinch = { ...pair(), view: { ...view } };
        return;
      }
      if (pointers.size > 2) return;
      e.preventDefault();
      drag = { id: e.pointerId, z, x: p.x, y: p.y, view: { ...view }, moved: false, mode: null };
      if (z === "marker") {
        drag.mode = "marker";
        capture(e.pointerId);
        svg.classList.add("cfd-panning");
        marker.focus({ preventScroll: true });
      }
    });

    svg.addEventListener("pointermove", (e) => {
      const p = local(e);
      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, p);
        if (pinch && pointers.size === 2) {
          const now = pair();
          schedule(() => {
            const next = zoomed(pinch.view, pinch.mid.x, pinch.mid.y, pinch.dist / now.dist);
            const dx = ((now.mid.x - pinch.mid.x) / L.PW) * (next.x1 - next.x0);
            const dy = ((now.mid.y - pinch.mid.y) / L.PH) * (next.y1 - next.y0);
            setView({ x0: next.x0 - dx, x1: next.x1 - dx, y0: next.y0 + dy, y1: next.y1 + dy });
          });
          return;
        }
        if (drag && drag.id === e.pointerId) {
          if (drag.mode === "marker") {
            schedule(() => setQ(xAt(p.x), false));
            return;
          }
          const dx = p.x - drag.x;
          const dy = p.y - drag.y;
          if (!drag.moved && Math.hypot(dx, dy) > DRAG) {
            drag.moved = true;
            drag.mode = atHome() ? "slide" : "pan";
            capture(e.pointerId);
            svg.classList.add("cfd-panning");
          }
          if (drag.mode === "slide") schedule(() => setQ(xAt(p.x), false));
          else if (drag.mode === "pan") {
            const v = drag.view;
            const ox = (dx / L.PW) * (v.x1 - v.x0);
            const oy = (dy / L.PH) * (v.y1 - v.y0);
            schedule(() => setView({ x0: v.x0 - ox, x1: v.x1 - ox, y0: v.y0 + oy, y1: v.y1 + oy }));
          }
          return;
        }
      }
      if (e.pointerType !== "mouse") return;
      const z = zone(p);
      svg.classList.toggle("cfd-on-marker", z === "marker");
      svg.classList.toggle("cfd-can-pan", z === "plot" && !atHome());
      svg.classList.toggle("cfd-can-jump", z === "plot" && atHome());
    });

    const release = (e) => {
      if (drag && drag.id === e.pointerId && drag.z === "plot" && !drag.moved && e.type === "pointerup") {
        setQ(xAt(local(e).x), false); // a click on the plot moves the marker there
      }
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) {
        drag = null;
        svg.classList.remove("cfd-panning");
      }
    };
    svg.addEventListener("pointerup", release);
    svg.addEventListener("pointercancel", release);

    svg.addEventListener("dblclick", (e) => {
      const p = local(e);
      if (zone(p) === "plot") goTo(zoomed(view, p.x, p.y, 1 / ZOOM_STEP));
    });
    // Ctrl/Cmd + scroll, and trackpad pinches (which arrive the same way), zoom; a plain scroll scrolls the page.
    svg.addEventListener(
      "wheel",
      (e) => {
        if (!(e.ctrlKey || e.metaKey) || !L) return;
        e.preventDefault();
        const p = local(e);
        setView(zoomed(view, p.x, p.y, Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025))));
      },
      { passive: false }
    );
    // Safari reports trackpad pinches as gestures.
    let gesture = null;
    svg.addEventListener("gesturestart", (e) => {
      e.preventDefault();
      gesture = { p: local(e), view: { ...view } };
    });
    svg.addEventListener("gesturechange", (e) => {
      e.preventDefault();
      if (gesture) setView(zoomed(gesture.view, gesture.p.x, gesture.p.y, 1 / e.scale));
    });
    svg.addEventListener("gestureend", () => (gesture = null));

    // ---- Keyboard, on the marker: arrows move it, + and − zoom, 0 resets.
    marker.addEventListener("keydown", (e) => {
      const step = ((view.x1 - view.x0) / 100) * (e.shiftKey ? 10 : 1);
      let handled = true;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") setQ(q - step, true);
      else if (e.key === "ArrowRight" || e.key === "ArrowUp") setQ(q + step, true);
      else if (e.key === "Home") setQ(0, true);
      else if (e.key === "End") setQ(xMax, true);
      else if (e.key === "+" || e.key === "=") goTo(zoomed(view, ...zoomAnchor(), 1 / ZOOM_STEP));
      else if (e.key === "-" || e.key === "_") goTo(zoomed(view, ...zoomAnchor(), ZOOM_STEP));
      else if (e.key === "0") goTo(home);
      else handled = false;
      if (handled) e.preventDefault();
    });

    // Lay out again when the box changes width or the window changes height.
    let lastSize = "";
    const relayout = () => {
      const size = `${root.clientWidth}x${window.innerHeight}`;
      if (size !== lastSize) {
        lastSize = size;
        layout();
      }
    };
    new ResizeObserver(relayout).observe(root);
    window.addEventListener("resize", relayout);
    relayout();
  }

  const init = () => document.querySelectorAll("[data-fidelity-density]").forEach(setup);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
