(() => {
  const mounts = document.querySelectorAll("[data-demo-replay]");
  if (!mounts.length) {
    return;
  }

  function waitForReplayer() {
    if (typeof window.rrwebReplayer === "function") {
      return Promise.resolve(window.rrwebReplayer);
    }

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("rrweb replay did not load")), 15000);
      window.addEventListener(
        "rrweb-replay-ready",
        () => {
          window.clearTimeout(timer);
          if (typeof window.rrwebReplayer === "function") {
            resolve(window.rrwebReplayer);
          } else {
            reject(new Error("rrweb replay export is not a constructor"));
          }
        },
        { once: true },
      );
    });
  }

  function durationOf(events) {
    if (!Array.isArray(events) || events.length < 2) {
      return 0;
    }
    return events[events.length - 1].timestamp - events[0].timestamp;
  }

  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = `${totalSeconds % 60}`.padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function resizeReplay(mount, replay, replayer) {
    const shell = mount.querySelector("[data-demo-replay-shell]");
    const target = mount.querySelector("[data-demo-replay-player]");
    if (!shell || !target || !replayer?.wrapper) {
      return;
    }

    const sourceWidth = replay.viewport?.width || 1068;
    const sourceHeight = replay.viewport?.height || 718;
    const availableWidth = shell.clientWidth || sourceWidth;
    const scale = Math.min(1, availableWidth / sourceWidth);
    const scaledWidth = Math.ceil(sourceWidth * scale);
    const scaledHeight = Math.ceil(sourceHeight * scale);
    mount.style.setProperty("--demo-replay-source-width", `${sourceWidth}px`);
    shell.style.aspectRatio = `${sourceWidth} / ${sourceHeight}`;
    target.style.width = `${scaledWidth}px`;
    target.style.height = `${scaledHeight}px`;
    replayer.wrapper.style.width = `${sourceWidth}px`;
    replayer.wrapper.style.height = `${sourceHeight}px`;
    replayer.wrapper.style.transform = `scale(${scale})`;
    replayer.wrapper.style.transformOrigin = "top left";
    shell.style.height = `${scaledHeight}px`;
  }

  function currentOffset(replayer, replay) {
    try {
      return Math.min(durationOf(replay.events), replayer.getCurrentTime());
    } catch {
      return 0;
    }
  }

  function setIconButton(button, label, icon) {
    button.title = label;
    button.setAttribute("aria-label", label);
    button.replaceChildren();
    const glyph = document.createElement("i");
    glyph.className = `fa-solid ${icon}`;
    glyph.setAttribute("aria-hidden", "true");
    button.appendChild(glyph);
  }

  function cursorElement(replayer) {
    return replayer?.wrapper?.querySelector(".replayer-mouse") || null;
  }

  function installCursorIdle(replayer, replay) {
    const sourceWidth = replay.viewport?.width || 1068;
    const sourceHeight = replay.viewport?.height || 718;
    let mouse = null;
    let idleTimer = 0;
    let observer = null;

    function hide() {
      window.clearTimeout(idleTimer);
      const currentMouse = mouse || cursorElement(replayer);
      currentMouse?.classList.remove("is-moving");
    }

    function showBriefly() {
      if (!mouse) {
        return;
      }
      mouse.classList.add("is-moving");
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => mouse?.classList.remove("is-moving"), 520);
    }

    function setup() {
      if (observer) {
        return true;
      }

      mouse = cursorElement(replayer);
      if (!mouse) {
        return false;
      }

      mouse.style.left = `${sourceWidth / 2}px`;
      mouse.style.top = `${sourceHeight / 2}px`;
      mouse.classList.remove("is-moving");
      observer = new MutationObserver(() => showBriefly());
      observer.observe(mouse, { attributes: true, attributeFilter: ["style"] });
      return true;
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      window.setTimeout(setup, attempt * 50);
    }

    return { hide };
  }

  function renderControls(mount, replay, replayer, cursor, poster) {
    const controls = mount.querySelector("[data-demo-replay-controls]");
    if (!controls) {
      return { seekTo() {} };
    }

    let playing = false;
    const total = Math.max(1, durationOf(replay.events));

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "demo-replay-button";

    function setPlayButtonState(isPlaying) {
      setIconButton(playButton, isPlaying ? "Pause demo" : "Play demo", isPlaying ? "fa-pause" : "fa-play");
    }
    setPlayButtonState(false);

    const restartButton = document.createElement("button");
    restartButton.type = "button";
    restartButton.className = "demo-replay-button";
    setIconButton(restartButton, "Restart demo", "fa-rotate-right");

    const transport = document.createElement("div");
    transport.className = "demo-replay-transport";
    transport.append(playButton, restartButton);

    const time = document.createElement("span");
    time.className = "demo-replay-time";

    const seek = document.createElement("div");
    seek.className = "demo-replay-seek";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "demo-replay-slider";
    slider.min = "0";
    slider.max = `${total}`;
    slider.step = "100";
    slider.value = "0";
    slider.setAttribute("aria-label", "Demo timeline");

    const markers = document.createElement("div");
    markers.className = "demo-replay-markers";
    for (const chapter of replay.chapters || []) {
      const marker = document.createElement("span");
      marker.className = "demo-replay-marker";
      marker.title = chapter.title || chapter.label || chapter.keyword || "";
      marker.style.left = `${Math.min(100, Math.max(0, (chapter.atMs / total) * 100))}%`;
      markers.appendChild(marker);
    }
    seek.append(slider, markers);

    function updateTimeline(offset) {
      const clamped = Math.max(0, Math.min(total, offset));
      slider.value = `${clamped}`;
      slider.style.setProperty("--progress", `${(clamped / total) * 100}%`);
      time.textContent = `${formatTime(clamped)} / ${formatTime(total)}`;
    }

    function seekTo(offset, shouldPlay = playing) {
      const clamped = Math.max(0, Math.min(total, offset));
      if (shouldPlay) {
        playing = true;
        setPlayButtonState(true);
        poster.hide();
        replayer.play(clamped);
      } else {
        playing = false;
        setPlayButtonState(false);
        poster.hide();
        replayer.play(clamped);
        window.requestAnimationFrame(() => {
          replayer.pause(clamped);
          cursor.hide();
        });
      }
      updateTimeline(clamped);
    }

    playButton.addEventListener("click", () => {
      const offset = currentOffset(replayer, replay);
      if (playing) {
        replayer.pause();
        playing = false;
        setPlayButtonState(false);
        cursor.hide();
      } else {
        const nextOffset = offset >= total ? 0 : offset;
        poster.hide();
        replayer.play(nextOffset);
        playing = true;
        setPlayButtonState(true);
        updateTimeline(nextOffset);
        return;
      }
      updateTimeline(offset);
    });

    restartButton.addEventListener("click", () => {
      seekTo(0, false);
      cursor.hide();
    });

    slider.addEventListener("input", () => updateTimeline(Number(slider.value)));
    slider.addEventListener("change", () => seekTo(Number(slider.value)));

    markers.addEventListener("click", (event) => {
      const rect = markers.getBoundingClientRect();
      if (!rect.width) {
        return;
      }
      seekTo(((event.clientX - rect.left) / rect.width) * total);
    });

    controls.replaceChildren(transport, time, seek);
    updateTimeline(0);

    const progressTimer = window.setInterval(() => {
      if (!playing) {
        return;
      }

      const offset = currentOffset(replayer, replay);
      updateTimeline(offset);
      if (offset >= total) {
        playing = false;
        setPlayButtonState(false);
        poster.hide();
        cursor.hide();
      }
    }, 500);

    return { seekTo, dispose: () => window.clearInterval(progressTimer) };
  }

  function installKeyboardShortcuts(mount, replay, replayer, controls) {
    const handler = (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      const delta = event.key === "ArrowLeft" ? -1000 : 1000;
      const offset = Math.max(0, Math.min(durationOf(replay.events), currentOffset(replayer, replay) + delta));
      controls.seekTo(offset);
    };
    mount.addEventListener("keydown", handler);
    return () => mount.removeEventListener("keydown", handler);
  }

  // Per-mount teardown hooks (timer, listeners) + the original poster markup, so a
  // theme switch can rebuild the player on a different replay without leaking.
  const replayState = new WeakMap();

  function teardownReplay(mount) {
    const state = replayState.get(mount);
    if (!state) {
      return;
    }
    for (const dispose of state.cleanups) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
    state.cleanups = [];
  }

  function buildPoster(mount, state) {
    if (!state.posterHtml) {
      return null;
    }
    const holder = document.createElement("div");
    holder.innerHTML = state.posterHtml;
    const poster = holder.firstElementChild;
    const src = mount.getAttribute("data-demo-poster");
    const fallbackSrc = mount.getAttribute("data-demo-poster-fallback");
    if (poster) {
      if (fallbackSrc) {
        poster.onerror = () => {
          poster.onerror = null;
          poster.setAttribute("src", fallbackSrc);
        };
      }
      if (src) {
        poster.setAttribute("src", src);
      }
    }
    return poster;
  }

  async function initReplay(mount) {
    const target = mount.querySelector("[data-demo-replay-player]");
    const replayUrl = mount.getAttribute("data-demo-replay");
    if (!target || !replayUrl) {
      return;
    }

    let state = replayState.get(mount);
    if (!state) {
      state = { cleanups: [], posterHtml: target.querySelector(".demo-replay-poster")?.outerHTML || null };
      replayState.set(mount, state);
    }
    teardownReplay(mount);
    delete mount.dataset.demoReplayError;

    const Replayer = await waitForReplayer();
    let response = await fetch(replayUrl);
    // Until an engine's replay is captured its JSON is absent; fall back to podman's.
    const fallbackUrl = mount.getAttribute("data-demo-replay-fallback");
    if (!response.ok && fallbackUrl && fallbackUrl !== replayUrl) {
      response = await fetch(fallbackUrl);
    }
    if (!response.ok) {
      throw new Error(`Unable to load replay: ${response.status}`);
    }
    const replay = await response.json();
    const poster = buildPoster(mount, state);
    target.replaceChildren();
    if (poster) {
      target.appendChild(poster);
    }
    target.dataset.replayPoster = "loading";

    const replayer = new Replayer(replay.events, {
      root: target,
      speed: 1,
      skipInactive: false,
      mouseTail: false,
      showWarning: false,
      triggerFocus: false,
    });
    replayer.disableInteract();
    replayer.play(0);
    replayer.pause(0);

    resizeReplay(mount, replay, replayer);
    const cursor = installCursorIdle(replayer, replay);
    const posterControls = {
      show() {
        target.dataset.replayPoster = "loading";
      },
      hide() {
        target.dataset.replayPoster = "hidden";
      },
    };
    const controls = renderControls(mount, replay, replayer, cursor, posterControls);
    cursor.hide();
    window.requestAnimationFrame(() => {
      replayer.pause(0);
      posterControls.hide();
      cursor.hide();
    });
    const disposeKeys = installKeyboardShortcuts(mount, replay, replayer, controls);
    const onResize = () => resizeReplay(mount, replay, replayer);
    window.addEventListener("resize", onResize, { passive: true });
    state.cleanups.push(controls.dispose, disposeKeys, () => window.removeEventListener("resize", onResize));
  }

  function runReplay(mount) {
    initReplay(mount).catch((error) => {
      mount.dataset.demoReplayError = "true";
      console.error(error);
    });
  }

  // Re-rendered by theme-switcher.js when the swatch selects an engine whose
  // tutorial replay/poster differ from the one currently shown.
  window.__cdReplayReinit = () => {
    for (const mount of mounts) {
      runReplay(mount);
    }
  };

  for (const mount of mounts) {
    runReplay(mount);
  }
})();
