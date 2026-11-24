// Contents sidebar for distill pages (opt in with `toc_sidebar: true` next to `toc`).
// The layout renders the list into <d-contents>; this pins it left of the text,
// marks the section being read, and fades it while a wide figure (an .l-page
// element, say) passes beside it. Where there is no room beside the text it
// stays hidden.
(() => {
  const article = document.querySelector("d-article");
  const toc = article && article.querySelector("d-contents");
  if (!toc) return;

  const GAP = 32; // between the sidebar and the text (or a wide figure)
  const EDGE = 16; // from the window edge
  const MIN_WIDTH = 120; // any narrower and it hides
  const MAX_WIDTH = 220;
  const BELOW_NAV = 32; // from the fixed navbar while pinned
  const CLEAR = 24; // vertical room kept from wide figures
  const READ_LINE = 0.3; // a section is current once its heading passes this share of the view

  const links = [...toc.querySelectorAll('a[href^="#"]')];
  const heads = links.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1))));
  const anchor = heads.find(Boolean) || article.querySelector(":scope > p");
  if (!anchor) return;
  const wide = [...article.querySelectorAll(".l-page, .l-page-outset, .l-screen, .l-screen-inset, .l-middle, .l-middle-outset, .l-gutter")];
  const pageWide = wide.filter((el) => el.matches(".l-page, .l-page-outset"));
  const nav = document.getElementById("navbar");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let active = -1;
  let queued = false;

  // d-article has `contain: layout`, which makes it the frame for fixed
  // positioning inside it, so the sidebar has to live outside. It goes just
  // before the article's wrapper to keep its place in the tab order.
  const post = article.closest(".post") || article;
  post.parentNode.insertBefore(toc, post);
  toc.classList.add("toc-sidebar");

  function update() {
    queued = false;

    // Across: beside the text, or out past the wide figures when there is room
    // there, so it never has to step aside for them.
    let right = anchor.getBoundingClientRect().left - GAP;
    const pageLeft = Math.min(Infinity, ...pageWide.map((el) => el.getBoundingClientRect().left));
    if (pageLeft - GAP - EDGE >= MIN_WIDTH) right = Math.min(right, pageLeft - GAP);
    const width = Math.min(MAX_WIDTH, right - EDGE);
    if (width < MIN_WIDTH) {
      toc.classList.remove("toc-on");
      return;
    }
    const left = right - width;

    // Down: level with the first heading, pinned under the navbar once that
    // scrolls past, and carried off with the end of the article.
    const pin = (nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0) + BELOW_NAV;
    toc.style.left = `${left}px`;
    toc.style.width = `${width}px`;
    toc.style.maxHeight = `${Math.max(120, window.innerHeight - pin - EDGE)}px`;
    const height = toc.offsetHeight;
    const end = article.getBoundingClientRect().bottom;
    const top = Math.min(Math.max(pin, anchor.getBoundingClientRect().top), end - height);
    toc.style.top = `${top}px`;

    const blocked = wide.some((el) => {
      const r = el.getBoundingClientRect();
      return r.left < left + width && r.right > left && r.top < top + height + CLEAR && r.bottom > top - CLEAR;
    });
    toc.classList.toggle("toc-on", !blocked);

    // The current section: the last heading above the reading line.
    const line = pin + (window.innerHeight - pin) * READ_LINE;
    let now = 0;
    heads.forEach((h, i) => {
      if (h && h.getBoundingClientRect().top <= line) now = i;
    });
    if (now !== active) {
      if (links[active]) {
        links[active].classList.remove("toc-active");
        links[active].removeAttribute("aria-current");
      }
      active = now;
      if (links[now]) {
        links[now].classList.add("toc-active");
        links[now].setAttribute("aria-current", "location");
      }
    }
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }

  links.forEach((a, i) =>
    a.addEventListener("click", (event) => {
      if (!heads[i]) return;
      event.preventDefault();
      heads[i].scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
      history.pushState(null, "", a.hash);
    })
  );

  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue);
  new ResizeObserver(queue).observe(article);
  update();
})();
