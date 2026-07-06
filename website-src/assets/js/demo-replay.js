// Screenshot "pseudo player": pages through an ordered array of captured screenshots with a full
// transport — play/pause, restart, a scrubber with a cue per frame, a time readout and arrow-key
// stepping. The manifest (per engine, swapped by theme-switcher.js) is
// { viewport, frameDurationMs, frames:[{screenshot,title}] }; the shell locks the viewport aspect-ratio
// so the image never distorts and never letterboxes on resize.
(() => {
  const mounts = document.querySelectorAll("[data-demo-replay]");
  if (!mounts.length) {
    return;
  }

  const TICK_MS = 100;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = `${totalSeconds % 60}`.padStart(2, "0");
    return `${minutes}:${seconds}`;
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

  function renderControls(mount, manifest, view) {
    const controls = mount.querySelector("[data-demo-replay-controls]");
    if (!controls) {
      return { seekTo() {}, dispose() {} };
    }

    const frameMs = Math.max(1, manifest.frameDurationMs || 3000);
    const total = Math.max(1, frameMs * manifest.frames.length);
    let offset = 0;
    let playing = false;
    let timer = 0;

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
    manifest.frames.forEach((frame, index) => {
      const marker = document.createElement("span");
      marker.className = "demo-replay-marker";
      marker.title = frame.title || "";
      marker.style.left = `${clamp((index * frameMs) / total, 0, 1) * 100}%`;
      markers.appendChild(marker);
    });
    seek.append(slider, markers);

    function stop() {
      playing = false;
      window.clearInterval(timer);
      setPlayButtonState(false);
    }

    function render(next) {
      offset = clamp(next, 0, total);
      slider.value = `${offset}`;
      slider.style.setProperty("--progress", `${(offset / total) * 100}%`);
      time.textContent = `${formatTime(offset)} / ${formatTime(total)}`;
      view.showFrameAt(offset);
    }

    function play(from) {
      const start = from >= total ? 0 : from;
      render(start);
      playing = true;
      setPlayButtonState(true);
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        render(offset + TICK_MS);
        if (offset >= total) {
          stop();
        }
      }, TICK_MS);
    }

    function seekTo(next, resumePlaying = playing) {
      const wasPlaying = resumePlaying;
      stop();
      render(next);
      if (wasPlaying) {
        play(offset);
      }
    }

    playButton.addEventListener("click", () => {
      if (playing) {
        stop();
      } else {
        play(offset);
      }
    });
    restartButton.addEventListener("click", () => seekTo(0, false));

    // Dragging the scrubber previews frames live; releasing keeps playing if it was.
    slider.addEventListener("input", () => {
      const wasPlaying = playing;
      stop();
      render(Number(slider.value));
      playing = wasPlaying;
    });
    slider.addEventListener("change", () => seekTo(Number(slider.value)));

    markers.addEventListener("click", (event) => {
      const rect = markers.getBoundingClientRect();
      if (rect.width) {
        seekTo(((event.clientX - rect.left) / rect.width) * total);
      }
    });

    const onKeydown = (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      event.preventDefault();
      const index = Math.floor(offset / frameMs);
      const nextIndex = clamp(index + (event.key === "ArrowLeft" ? -1 : 1), 0, manifest.frames.length - 1);
      seekTo(nextIndex * frameMs);
    };
    mount.addEventListener("keydown", onKeydown);

    controls.replaceChildren(transport, time, seek);
    render(0);

    return {
      seekTo,
      dispose: () => {
        window.clearInterval(timer);
        mount.removeEventListener("keydown", onKeydown);
      },
    };
  }

  const replayState = new WeakMap();

  function teardown(mount) {
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

  async function initReplay(mount) {
    const target = mount.querySelector("[data-demo-replay-player]");
    const url = mount.getAttribute("data-demo-replay");
    if (!target || !url) {
      return;
    }

    let state = replayState.get(mount);
    if (!state) {
      state = { cleanups: [] };
      replayState.set(mount, state);
    }
    teardown(mount);
    delete mount.dataset.demoReplayError;

    let response = await fetch(url);
    const fallbackUrl = mount.getAttribute("data-demo-replay-fallback");
    if (!response.ok && fallbackUrl && fallbackUrl !== url) {
      response = await fetch(fallbackUrl);
    }
    if (!response.ok) {
      throw new Error(`Unable to load demo manifest: ${response.status}`);
    }
    const manifest = await response.json();
    if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) {
      throw new Error("Demo manifest has no frames");
    }

    // Lock the shell to the capture aspect-ratio: the image then fills it exactly at any width, so it
    // never distorts and never letterboxes (the source of the pink border at narrow widths).
    const shell = mount.querySelector("[data-demo-replay-shell]");
    if (shell && manifest.viewport?.width && manifest.viewport?.height) {
      shell.style.setProperty("--demo-aspect", `${manifest.viewport.width} / ${manifest.viewport.height}`);
    }

    // Reuse the poster <img> as the frame surface (keeps theme-switcher's element wiring intact).
    let frame = target.querySelector(".demo-replay-poster");
    if (!frame) {
      frame = document.createElement("img");
      frame.className = "demo-replay-poster";
      target.appendChild(frame);
    }
    frame.classList.add("demo-replay-frame");
    frame.setAttribute("alt", "Container Desktop demo");
    frame.decoding = "async";

    // Warm the browser cache so paging between frames never flashes.
    for (const item of manifest.frames) {
      const pre = new Image();
      pre.src = item.screenshot;
    }

    let currentIndex = -1;
    function showFrameAt(offsetMs) {
      const index = clamp(Math.floor(offsetMs / (manifest.frameDurationMs || 3000)), 0, manifest.frames.length - 1);
      if (index !== currentIndex) {
        currentIndex = index;
        frame.setAttribute("src", manifest.frames[index].screenshot);
      }
    }
    showFrameAt(0);
    target.dataset.replayPoster = "ready";

    const controls = renderControls(mount, manifest, { showFrameAt });
    state.cleanups.push(controls.dispose);
  }

  function runReplay(mount) {
    initReplay(mount).catch((error) => {
      mount.dataset.demoReplayError = "true";
      console.error(error);
    });
  }

  // Re-rendered by theme-switcher.js when the swatch selects an engine whose demo manifest differs.
  window.__cdReplayReinit = () => {
    for (const mount of mounts) {
      runReplay(mount);
    }
  };

  for (const mount of mounts) {
    runReplay(mount);
  }
})();
