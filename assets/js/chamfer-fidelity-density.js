// Per-sample distances, model by model: the paper's Figures 11 (Chamfer-Fidelity)
// and 12 (Chamfer-Coverage), interactive.
// Markup and styles: _includes/chamfer/fidelity-density.liquid.
// Data: _data/chamfer_fidelity_density.json, _data/chamfer_coverage_density.json.
//
// A fixed-size marker on the distance axis picks a distance; each model shows
// the sample whose distance is nearest to it (a nearest-neighbour search over
// the sorted distances), or, for coverage, that real image and the model's
// sample nearest to it. Drag the marker or click the chart to move it; the
// arrow keys move it too. The box is sized to fit the window.
(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";

  const CURVE_HEIGHT = 0.65; // the share of the plot's height the highest curve reaches, leaving room above
  const MARKER_W = 22; // the handle's width in px
  const MARKER_HIT = 12; // px either side of the marker that grab it
  const WIDE = 720; // box width (px) from which the panel sits beside the chart
  const PAUSE = 100; // ms the marker must rest before a new image is fetched, so a fast drag doesn't download every image it passes
  const FADE = 250; // ms for the cross-fade between a tile's images (matches .cfd-in in the include)
  const HINT = "Drag the marker to pick a distance";

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
  // A round tick step giving about n ticks across a span.
  const niceStep = (span, n) => {
    const raw = span / Math.max(1, n);
    const pow = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  };
  const decimals = (step) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let instances = 0;

  function setup(root) {
    if (root.dataset.ready) return; // already set up (the script can be on a page twice)
    root.dataset.ready = "1";
    const { data, images } = JSON.parse(root.querySelector(".cfd-data").textContent);
    const models = data.models.map((m) => ({ ...m, samples: [...m.samples].sort((a, b) => a.d - b.d) }));
    const xMax = data.x_max;
    // The top of the y axis, so the highest curve reaches CURVE_HEIGHT of the plot.
    const yTop = Math.max(...models.flatMap((m) => m.curve.map((p) => p[1]))) / CURVE_HEIGHT;

    const svg = root.querySelector(".cfd-chart");
    const plot = root.querySelector(".cfd-plot");
    const keyBox = root.querySelector(".cfd-key");
    const panel = root.querySelector(".cfd-panel");
    svg.setAttribute("aria-label", `${data.y_label} by ${data.x_label.toLowerCase()}, one curve per model`);

    // The marker's distance; it starts at the closest sample of any model.
    let q = Math.min(xMax, ...models.flatMap((m) => m.samples.map((s) => s.d)));
    let L = null; // pixel layout, set by layout()

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
    // How to use it, in the empty top-right corner; it gives way to a mean's label while a model is highlighted.
    const hint = el("text", { class: "cfd-hint", "text-anchor": "end" }, svg);
    hint.textContent = HINT;
    const markerLine = el("line", { class: "cfd-marker-line" }, el("g", { "clip-path": `url(#${clipId})` }, svg));
    const gAxis = el("g", {}, svg);
    const marker = el(
      "g",
      {
        class: "cfd-marker",
        tabindex: 0,
        role: "slider",
        "aria-label": data.x_label,
        "aria-valuemin": 0,
        "aria-valuemax": xMax,
      },
      svg
    );
    const handle = el("rect", { class: "cfd-handle", width: MARKER_W, height: 14, rx: 7 }, marker);
    const grips = [el("line", { class: "cfd-grip" }, marker), el("line", { class: "cfd-grip" }, marker)];
    marker.style.visibility = "hidden"; // until the first layout places it

    // ---- Panel: a square grid of tiles, built once; the images change with the marker. Each model
    // has one tile, or, when its samples are pairs (a real image in `real` and the model's sample
    // nearest to it in `file`), a "Real" tile and then the model's.
    const pairs = models.some((m) => m.samples.some((s) => s.real));
    const slots = pairs ? ["real", "file"] : ["file"];
    const blocks = models.flatMap((m, mi) =>
      slots.map((key) => {
        const real = key === "real";
        const block = document.createElement("div");
        block.className = real ? "cfd-block cfd-real" : "cfd-block";
        const head = document.createElement("div");
        head.className = "cfd-head";
        const name = document.createElement("div");
        name.className = "cfd-name";
        name.textContent = real ? "Real" : m.name;
        head.append(name);
        const strip = document.createElement("div");
        strip.className = "cfd-strip";
        if (!real) {
          name.style.color = m.color;
          strip.style.borderColor = m.color;
        }
        block.append(head, strip);
        panel.appendChild(block);
        block.addEventListener("pointerenter", () => setFocus(mi));
        block.addEventListener("pointerleave", () => setFocus(null));
        const index = new Map(m.samples.map((s, j) => [s[key], j]));
        return { m, mi, key, real, strip, index, target: null, current: null, cache: new Map() };
      })
    );

    // ---- Key: a line per model in its colour, then the dashed line for a mean. Hovering a model highlights it.
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
      svg.classList.toggle("cfd-focusing", i !== null);
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
        img.alt = b.real ? "Real image" : `${b.m.name} sample`;
        img.width = 256;
        img.height = 256;
        img.decoding = "async";
        img.dataset.file = file;
        img.src = `${images}${file}`; // starts the download; file is relative to the images folder
        b.cache.set(file, img);
      }
      return img;
    }

    function preloadNeighbours(b, file) {
      const i = b.index.get(file);
      for (const j of [i - 1, i + 1]) {
        if (j >= 0 && j < b.m.samples.length) getImg(b, b.m.samples[j][b.key]);
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
      const nearestOf = models.map((m) => (m.samples.length ? m.samples[nearestIndex(m.samples, q)] : null));
      for (const b of blocks) {
        const s = nearestOf[b.mi];
        if (!s) continue;
        const file = s[b.key];
        b.target = file;
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

    // ---- Layout: the key and the chart on the left, as tall as the window allows; the panel on
    // the right, from the top. On a narrow box they stack.
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
        const above = keyBox.offsetHeight + parseFloat(getComputedStyle(keyBox).marginBottom);
        const room = window.innerHeight - top - chrome - above - 16;
        // The left column (key and chart) should be at least as tall as the panel: a note and a square grid, two tiles across.
        const ps = getComputedStyle(panel);
        const rows = Math.ceil(blocks.length / 2);
        const side = (panel.clientWidth - (parseFloat(ps.columnGap) || 0)) / 2 - 10; // less the frame
        const headH = Math.max(...[...panel.querySelectorAll(".cfd-head")].map((h) => h.offsetHeight)) + 4;
        const noteH = panel.querySelector(".cfd-panel-note")?.offsetHeight || 0;
        const need = noteH + rows * (side + 10 + headH) + (parseFloat(ps.rowGap) || 0) * rows;
        H = Math.round(clamp(Math.max(Math.min(room, W * 0.85), need - above), 300, 720));
      } else {
        H = Math.round(clamp(W * 0.72, 240, 420));
      }
      const narrow = W < 420;
      const ml = narrow ? 34 : 44;
      const mr = 10;
      const mt = 10;
      const bottom = 22 + 20 + 8; // tick labels (clear of the marker's handle), axis title
      L = { W, H, ml, mr, mt, PW: W - ml - mr, PH: H - mt - bottom, narrow };
      L.axisY = mt + L.PH;
      set(svg, { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
      set(clipRect, { x: ml, y: mt, width: L.PW, height: L.PH });
      updatePanel();
      draw();
    }

    // ---- Drawing.
    const sx = (x) => L.ml + (x / xMax) * L.PW;
    const sy = (y) => L.mt + L.PH - (y / yTop) * L.PH;
    const xAt = (px) => ((px - L.ml) / L.PW) * xMax;

    function draw() {
      if (!L) return;
      const { W, ml, mr, mt, PW, PH, axisY, narrow } = L;

      // Grid and y axis.
      gGrid.replaceChildren();
      const yStep = niceStep(yTop, Math.max(3, Math.round(PH / 55)));
      const yDec = decimals(yStep);
      for (let t = 0; t <= yTop + 1e-9; t += yStep) {
        const y = sy(t);
        if (t > 1e-9) el("line", { class: "cfd-grid", x1: ml, x2: ml + PW, y1: y, y2: y }, gGrid);
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
      set(hint, { x: ml + PW - 4, y: mt + 12, "font-size": 11 });

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
      const xStep = niceStep(xMax, Math.max(3, Math.round(PW / 70)));
      const xDec = decimals(xStep);
      const tickY = axisY + 22;
      for (let t = 0; t <= xMax + 1e-9; t += xStep) {
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

      placeMarker();
    }

    function placeMarker() {
      const x = sx(q);
      marker.style.visibility = "";
      set(markerLine, { x1: x, x2: x, y1: L.mt, y2: L.axisY });
      set(handle, { x: x - MARKER_W / 2, y: L.axisY - 7 });
      grips.forEach((g, i) => {
        const gx = x + (i ? 2.5 : -2.5);
        set(g, { x1: gx, x2: gx, y1: L.axisY - 3.5, y2: L.axisY + 3.5 });
      });
      marker.setAttribute("aria-valuenow", q.toFixed(3));
      marker.setAttribute("aria-valuetext", fmt(q));
    }

    function setQ(x) {
      q = clamp(x, 0, xMax);
      updatePanel();
      placeMarker();
    }

    // ---- Pointer: press on the marker or anywhere on the plot and drag; the marker follows.
    const local = (e) => {
      const r = svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    function zone(p) {
      if (!L || p.y < L.mt - 4 || p.y > L.axisY + 14) return null;
      if (p.x < L.ml - MARKER_HIT || p.x > L.ml + L.PW + MARKER_HIT) return null;
      if (Math.abs(p.x - sx(q)) <= MARKER_HIT) return "marker";
      if (p.x < L.ml || p.x > L.ml + L.PW) return null;
      return "plot";
    }
    let dragId = null;
    let pendingX = null;
    let raf = 0;
    // One update per frame while dragging.
    const follow = (x) => {
      pendingX = x;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (pendingX !== null) setQ(xAt(pendingX));
          pendingX = null;
        });
      }
    };

    svg.addEventListener("pointerdown", (e) => {
      if ((e.pointerType === "mouse" && e.button !== 0) || dragId !== null) return;
      const p = local(e);
      const z = zone(p);
      if (!z) return;
      e.preventDefault();
      dragId = e.pointerId;
      try {
        svg.setPointerCapture(e.pointerId);
      } catch (err) {
        // the pointer is already gone
      }
      svg.classList.add("cfd-dragging");
      marker.focus({ preventScroll: true });
      if (z === "plot") setQ(xAt(p.x)); // a press on the plot moves the marker there
    });
    svg.addEventListener("pointermove", (e) => {
      const p = local(e);
      if (e.pointerId === dragId) {
        follow(p.x);
        return;
      }
      if (e.pointerType !== "mouse") return;
      const z = zone(p);
      svg.classList.toggle("cfd-on-marker", z === "marker");
      svg.classList.toggle("cfd-on-plot", z === "plot");
    });
    const release = (e) => {
      if (e.pointerId !== dragId) return;
      dragId = null;
      svg.classList.remove("cfd-dragging");
    };
    svg.addEventListener("pointerup", release);
    svg.addEventListener("pointercancel", release);

    // ---- Keyboard, on the marker: the arrows move it (Shift for bigger steps), Home and End go to the ends.
    marker.addEventListener("keydown", (e) => {
      const step = (xMax / 100) * (e.shiftKey ? 10 : 1);
      let handled = true;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") setQ(q - step);
      else if (e.key === "ArrowRight" || e.key === "ArrowUp") setQ(q + step);
      else if (e.key === "Home") setQ(0);
      else if (e.key === "End") setQ(xMax);
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
