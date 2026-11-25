// The nearest-neighbour explorers on the Chamfer page: the paper's Figures 6 and 7
// made interactive (markup and styles in _includes/chamfer/nn-explorer.liquid).
//
// Each explorer shows a query image beside its three nearest neighbours in the
// other set. The reader picks a class, then one of its three query images, shown
// as small pictures; their nearest neighbours run from close to far. On a change
// the four new images load first, then everything changes together: the images
// fade in, the distances count to their new values, the dots on the distance
// line slide, and the comment below changes.
(function () {
  "use strict";

  var FADE = 300; // ms; matches the fade in the styles
  var COUNT = 550; // ms for the distances to count to their new values

  function setup(root) {
    if (root.dataset.ready) return;
    root.dataset.ready = "1";

    var cfg = JSON.parse(root.querySelector(".nnx-data").textContent);
    var classes = cfg.data.classes;
    var text = cfg.text;
    var xMax = cfg.x_max;
    var state = { c: 0, l: 0 };
    var shown = [0, 0, 0]; // the distances on show, while they count
    var token = 0; // the latest change; an older one that finishes loading late is dropped
    var raf = 0;

    var tiles = root.querySelectorAll(".nnx-tile");
    var dText = root.querySelectorAll(".nnx-d span");
    var dots = root.querySelectorAll(".nnx-dot:not(.nnx-dot-query)");
    var span = root.querySelector(".nnx-span");
    var says = root.querySelector(".nnx-says-text");
    var ruler = root.querySelector(".nnx-ruler");

    function url(file) {
      return cfg.images + file;
    }

    // The ticks under the distance line.
    var step = xMax % 3 === 0 ? 3 : 2;
    for (var t = 0; t <= xMax + 1e-9; t += step) {
      var tick = document.createElement("div");
      tick.className = "nnx-tick";
      tick.style.left = (t / xMax) * 100 + "%";
      tick.textContent = t;
      ruler.insertBefore(tick, ruler.querySelector(".nnx-axis"));
    }

    // The class, a dropdown.
    var classBox = root.querySelector(".nnx-classes");
    classes.forEach(function (c) {
      var o = document.createElement("option");
      o.textContent = c.name;
      classBox.appendChild(o);
    });
    classBox.addEventListener("change", function () {
      select("c", classBox.selectedIndex);
    });

    // The query image: a radio group of the class's three, as small pictures,
    // with arrow keys inside it.
    var pickBox = root.querySelector(".nnx-picks");
    var n = text.levels.length;
    for (var i = 0; i < n; i++) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "nnx-pick";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", text.query + " image " + (i + 1));
      b.appendChild(document.createElement("img")).alt = "";
      b.addEventListener("click", select.bind(null, "l", i));
      pickBox.appendChild(b);
    }
    pickBox.addEventListener("keydown", function (e) {
      var i = state.l;
      var j = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[e.key];
      if (j === undefined) return;
      e.preventDefault();
      j = Math.max(0, Math.min(n - 1, j));
      select("l", j);
      pickBox.children[j].focus();
    });

    function syncControls() {
      classBox.selectedIndex = state.c;
      Array.prototype.forEach.call(pickBox.children, function (b, i) {
        b.setAttribute("aria-checked", i === state.l ? "true" : "false");
        b.tabIndex = i === state.l ? 0 : -1;
        var src = url(classes[state.c].levels[i].query);
        var img = b.querySelector("img");
        if (img.getAttribute("src") !== src) img.src = src;
      });
    }

    function select(key, i) {
      if (state[key] === i) return;
      state[key] = i;
      syncControls();
      render(true);
    }

    // A new image element, resolved once it can be drawn (or has failed).
    function load(src, alt) {
      var img = new Image();
      img.alt = alt;
      img.decoding = "async";
      img.src = src;
      if (img.decode) {
        return img.decode().then(
          function () {
            return img;
          },
          function () {
            return img;
          }
        );
      }
      return new Promise(function (resolve) {
        img.onload = img.onerror = function () {
          resolve(img);
        };
      });
    }

    function countTo(target, animate) {
      cancelAnimationFrame(raf);
      var from = shown.slice();
      var t0 = performance.now();
      function frame(now) {
        var u = animate ? Math.min(1, (now - t0) / COUNT) : 1;
        var e = 1 - Math.pow(1 - u, 3);
        for (var k = 0; k < 3; k++) {
          shown[k] = from[k] + (target[k] - from[k]) * e;
          dText[k].textContent = shown[k].toFixed(2);
        }
        if (u < 1) raf = requestAnimationFrame(frame);
      }
      frame(t0);
    }

    // The comment: how far the nearest neighbour is (the size in bold), what that
    // means, and what to see in these images.
    function comment(cls, words) {
      var parts = text.distance.split("{size}");
      var size = document.createElement("strong");
      size.className = "nnx-size";
      size.textContent = words.size;
      var note = ((text.notes || {})[cls.id] || [])[state.l];
      says.textContent = "";
      says.appendChild(document.createTextNode(parts[0]));
      if (parts.length > 1) {
        says.appendChild(size);
        says.appendChild(document.createTextNode(parts.slice(1).join(words.size)));
      }
      says.appendChild(document.createTextNode(" " + words.says + (note ? ": " + note : ".")));
    }

    function render(animate) {
      var cls = classes[state.c];
      var level = cls.levels[state.l];
      var mine = ++token;
      var srcs = [level.query].concat(
        level.neighbours.map(function (n) {
          return n.file;
        })
      );
      var alts = [text.query + " " + cls.name.toLowerCase() + " image"].concat(
        level.neighbours.map(function (n, k) {
          return text.neighbours + ", " + (k + 1) + " of 3, distance " + n.d.toFixed(2);
        })
      );
      Promise.all(
        srcs.map(function (f, k) {
          return load(url(f), alts[k]);
        })
      ).then(function (imgs) {
        if (mine !== token) return;
        imgs.forEach(function (img, k) {
          var old = Array.prototype.slice.call(tiles[k].querySelectorAll("img"));
          if (animate) img.classList.add("nnx-in");
          tiles[k].appendChild(img);
          setTimeout(
            function () {
              old.forEach(function (o) {
                o.remove();
              });
            },
            animate ? FADE : 0
          );
        });

        var d = level.neighbours.map(function (n) {
          return n.d;
        });
        countTo(d, animate);
        span.style.width = (d[0] / xMax) * 100 + "%";
        d.forEach(function (v, k) {
          dots[k].style.left = (v / xMax) * 100 + "%";
        });

        root.dataset.level = state.l;
        comment(cls, text.levels[state.l]);
        if (animate) {
          says.classList.remove("nnx-in");
          void says.offsetWidth; // restart the fade
          says.classList.add("nnx-in");
        } else {
          // From now on, changes slide; the first drawing does not.
          requestAnimationFrame(function () {
            root.classList.add("nnx-animate");
          });
        }
      });
    }

    // Fetch every other image once the explorer is close to the screen, so a change shows at once.
    function preload() {
      classes.forEach(function (cls) {
        cls.levels.forEach(function (level) {
          [level.query]
            .concat(
              level.neighbours.map(function (n) {
                return n.file;
              })
            )
            .forEach(function (f) {
              new Image().src = url(f);
            });
        });
      });
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(
        function (entries) {
          if (entries[0].isIntersecting) {
            io.disconnect();
            preload();
          }
        },
        { rootMargin: "600px 0px" }
      );
      io.observe(root);
    } else {
      preload();
    }

    syncControls();
    render(false);
  }

  function init() {
    document.querySelectorAll("[data-nn-explorer]").forEach(setup);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
