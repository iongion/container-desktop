// Engine color themes. The active theme is an html[data-theme] attribute (read
// by the CSS token blocks in site.css); this module wires the nav swatches,
// persists the choice, swaps the per-engine screenshots, and keeps the mobile
// browser chrome (meta theme-color) in sync. A tiny inline script in the page
// <head> applies the stored theme before first paint to avoid a color flash.
(() => {
  var STORAGE_KEY = "cd-theme";
  var swatches = Array.prototype.slice.call(document.querySelectorAll(".engine-swatch"));
  if (!swatches.length) return;

  var ids = swatches.map((s) => s.dataset.themeId);
  var shotsFor = {};
  var replayFor = {};
  var taglineFor = {};
  var initial;
  var initialActive;
  swatches.forEach((s) => {
    shotsFor[s.dataset.themeId] = s.dataset.shots || "unified";
    replayFor[s.dataset.themeId] = { replay: s.dataset.replay || "", poster: s.dataset.poster || "" };
    taglineFor[s.dataset.themeId] = s.dataset.tagline || "";
  });

  function updateTagline(id) {
    var el = document.querySelector(".brand-tagline");
    if (el && taglineFor[id]) {
      el.textContent = taglineFor[id];
    }
  }

  // Every known screenshot folder, so the swap matches images currently pointing at any engine
  // (e.g. switching unified -> docker), not just podman/docker.
  var shotFolders = ["podman"];
  ids.forEach((id) => {
    if (shotFolders.indexOf(shotsFor[id]) === -1) {
      shotFolders.push(shotsFor[id]);
    }
  });
  var engineFolderRe = new RegExp(`/img/(?:${shotFolders.join("|")})/`);

  function applyEngineImage(img, src, folder) {
    // Until an engine's screenshots are captured its folder is empty; fall back to unified's set so
    // the page never shows broken images. Unified is the base and never falls back.
    if (folder === "unified") {
      img.onerror = null;
    } else {
      img.onerror = () => {
        img.onerror = null;
        img.setAttribute("src", src.replace(/\/img\/[^/]+\//, "/img/unified/"));
      };
    }
    img.setAttribute("src", src);
  }

  function swapScreenshots(folder) {
    var images = document.querySelectorAll('img[src*="/img/"]');
    var i;
    var src;
    for (i = 0; i < images.length; i += 1) {
      src = images[i].getAttribute("src") || "";
      if (engineFolderRe.test(src)) {
        applyEngineImage(images[i], src.replace(engineFolderRe, `/img/${folder}/`), folder);
      }
    }
  }

  function syncThemeColor() {
    var meta = document.querySelector('meta[name="theme-color"]');
    var bg;
    if (!meta) return;
    bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (bg) meta.setAttribute("content", bg);
  }

  function markActive(id) {
    var i;
    var active;
    for (i = 0; i < swatches.length; i += 1) {
      active = swatches[i].dataset.themeId === id;
      swatches[i].classList.toggle("is-active", active);
      swatches[i].setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function attachPosterFallback(posterEl, fallbackSrc) {
    posterEl.onerror = () => {
      posterEl.onerror = null;
      if (fallbackSrc) posterEl.setAttribute("src", fallbackSrc);
    };
  }

  function updateReplay(id) {
    var assets = replayFor[id];
    var fallback = replayFor.unified || {};
    var mounts;
    var mount;
    var poster;
    var i;
    var changed = false;
    if (!assets?.replay) return;
    mounts = document.querySelectorAll("[data-demo-replay]");
    for (i = 0; i < mounts.length; i += 1) {
      mount = mounts[i];
      if (mount.getAttribute("data-demo-replay") !== assets.replay) changed = true;
      mount.setAttribute("data-demo-replay", assets.replay);
      // Until an engine's replay/poster are captured, demo-replay.js falls back to these.
      mount.setAttribute("data-demo-replay-fallback", fallback.replay || "");
      if (assets.poster) mount.setAttribute("data-demo-poster", assets.poster);
      if (fallback.poster) mount.setAttribute("data-demo-poster-fallback", fallback.poster);
      poster = mount.querySelector(".demo-replay-poster");
      if (poster && assets.poster) {
        attachPosterFallback(poster, fallback.poster);
        poster.setAttribute("src", assets.poster);
      }
    }
    // Re-initialize the player only when the source actually changed (the rebuild
    // is non-trivial). On first load the player script hasn't run yet, so the
    // global is absent and demo-replay.js will read the attributes we just set.
    if (changed && typeof window.__cdReplayReinit === "function") {
      window.__cdReplayReinit();
    }
  }

  function applyTheme(id, persist) {
    if (ids.indexOf(id) === -1) return;
    document.documentElement.setAttribute("data-theme", id);
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // ignore storage failures (private mode, etc.)
      }
    }
    markActive(id);
    swapScreenshots(shotsFor[id]);
    syncThemeColor();
    updateReplay(id);
    updateTagline(id);
  }

  function onSwatchClick(event) {
    applyTheme(event.currentTarget.dataset.themeId, true);
  }

  function onSwatchKeydown(event) {
    var current = swatches.indexOf(event.currentTarget);
    var next;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (current + 1) % swatches.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (current - 1 + swatches.length) % swatches.length;
    } else {
      return;
    }
    event.preventDefault();
    swatches[next].focus();
  }

  swatches.forEach((s) => {
    s.addEventListener("click", onSwatchClick);
    s.addEventListener("keydown", onSwatchKeydown);
  });

  // Reconcile the (possibly head-script-applied) attribute with the swatches and
  // the rest of the page on load; don't persist a choice the visitor didn't make.
  initial = document.documentElement.getAttribute("data-theme");
  if (ids.indexOf(initial) === -1) {
    initialActive = swatches.filter((s) => s.classList.contains("is-active"))[0];
    initial = initialActive ? initialActive.dataset.themeId : ids[0];
  }
  applyTheme(initial, false);
})();
