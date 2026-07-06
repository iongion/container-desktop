// Drives the real Tauri app (WebKitGTK) to verify container-logs rendering. Diagnostic-first: it captures
// location.href (settles whether this binary loads the Vite dev URL or embedded frontendDist), screenshots and
// dumps document state at intervals even if bootstrap stalls, then opens the continuously-logging cdtest-logger
// container's Logs and samples — WITHOUT any interaction — how many log lines xterm has rendered into the DOM
// over ~5s. Growing line counts + populated screenshots ⇒ the compositor-awake fix paints streamed data on its
// own; flat counts after data arrived ⇒ the freeze remains.

const TARGET = process.env.E2E_CONTAINER_NAME || "cdtest-logger";

async function snap(name) {
  try {
    await browser.saveScreenshot(`./webdriver/artifacts/${name}.png`);
  } catch (error) {
    console.log(`snap(${name}) failed:`, error.message);
  }
}

async function dump(label) {
  try {
    const state = await browser.execute(() => ({
      href: location.href,
      title: document.title,
      preloaded: window.Preloaded === true,
      osType: window.CURRENT_OS_TYPE || null,
      hasResourceSyncHost: !!window.__resourceSyncHost,
      rootChildren: (document.getElementById("app") || document.body || {}).childElementCount ?? -1,
      bodyText: (document.body ? document.body.innerText : "").replace(/\s+/g, " ").slice(0, 300),
    }));
    console.log(`DUMP[${label}]:`, JSON.stringify(state));
    return state;
  } catch (error) {
    console.log(`DUMP[${label}] failed:`, error.message);
    return null;
  }
}

function renderedLineProbe() {
  const xterm = document.querySelector(".xterm");
  const rowsEl = document.querySelector(".xterm-rows");
  const rowText = (rowsEl ? rowsEl.textContent || "" : "").replace(/\s+/g, " ").trim();
  // WebGL renderer draws to a canvas (not .xterm-rows). Signature the canvas backing store so we can tell if
  // xterm is actually drawing new frames over time (liveness) independent of compositing. toDataURL length is a
  // cheap proxy for "pixels changed". Both surfaces sampled so we cover whichever renderer is active.
  const canvases = Array.from(document.querySelectorAll(".xterm canvas"));
  let canvasSig = null;
  if (canvases.length) {
    try {
      const c = canvases[canvases.length - 1];
      const url = c.toDataURL ? c.toDataURL() : "";
      canvasSig = `${c.width}x${c.height}#${url.length}`;
    } catch (error) {
      canvasSig = `err:${error.message}`;
    }
  }
  return {
    xtermExists: !!xterm,
    canvasCount: canvases.length,
    canvasSig,
    rowTextLen: rowText.length,
    rowTail: rowText.slice(-70),
    timing: window.__logStreamTiming || null,
    awakeClassPresent: !!document.querySelector(".TerminalCompositorAwake"),
    animName: xterm ? getComputedStyle(xterm).animationName : null,
    hasFocus: document.hasFocus(),
  };
}

describe("container logs rendering (WebKitGTK)", () => {
  it("captures boot state (href tells dev-vs-prod)", async () => {
    await browser.pause(2500);
    await snap("01-2s");
    await dump("2s");
    await browser.pause(4000);
    await snap("02-6s");
    const s = await dump("6s");
    // Wait up to 40s more for preload if it hasn't happened yet.
    if (!s || !s.preloaded) {
      try {
        await browser.waitUntil(async () => browser.execute(() => window.Preloaded === true), {
          timeout: 40000,
          interval: 500,
        });
      } catch {
        console.log("Preloaded still false after 46s total");
      }
    }
    await dump("preload-final");
  });

  it("opens the target container logs and samples rendered lines (no interaction)", async () => {
    if (process.env.E2E_DISABLE_FIX) {
      await browser.execute(() => {
        window.__CD_DISABLE_COMPOSITOR_FIX__ = true;
      });
      console.log("CONTROL: compositor-awake fix DISABLED for this run");
    }
    if (process.env.E2E_FORCE_WEBGL) {
      await browser.execute(() => {
        window.__CD_FORCE_WEBGL__ = true;
      });
      console.log("CONTROL: WebGL renderer FORCED for this run");
    }
    await browser.pause(2500);
    // Navigate straight into the containers list, then click the target row, then a Logs tab if present.
    await browser.execute(() => {
      location.hash = "#/screens/containers";
    });
    await browser.pause(3500);
    await snap("03-containers");
    // The container name in the list is an <a class="ContainerLogsButton"> linking straight to its logs route
    // (ManageScreen.tsx). Click it — the faithful "open this container's logs" path, no fuzzy DOM guessing.
    const opened = await browser.execute((name) => {
      const links = Array.from(document.querySelectorAll("a.ContainerLogsButton"));
      const link = links.find((el) => (el.textContent || "").includes(name)) || links[0];
      if (!link) return { clicked: false, linkCount: links.length, hash: location.hash };
      const href = link.getAttribute("href");
      link.click();
      return { clicked: true, href, linkCount: links.length, hash: location.hash };
    }, TARGET);
    console.log("OPEN LOGS:", JSON.stringify(opened));
    await browser.pause(2500);
    await snap("04-logs-open");

    // Rigorous liveness test. Polling with browser.execute is invalid — each execute wakes the compositor and
    // masks the freeze. Instead: install a MutationObserver that records WHEN xterm actually mutates the DOM
    // (i.e. renders), then sit FULLY IDLE (browser.pause only — no execute/screenshot, both of which act like OS
    // events and force a paint) for a window, then read the tally with a single execute. Fix ON ⇒ many mutations
    // during the idle window (rows render on their own). Fix OFF ⇒ ~zero (frozen until an event).
    const setup = await browser.execute(() => {
      window.__mut = [];
      window.__draws = 0;
      window.__mutStart = Math.round(performance.now());
      // DOM renderer: count row mutations (xterm renders by mutating .xterm-rows).
      const target = document.querySelector(".xterm-rows") || document.querySelector(".xterm");
      if (target) {
        window.__mutObs = new MutationObserver(() => window.__mut.push(Math.round(performance.now())));
        window.__mutObs.observe(target, { childList: true, subtree: true, characterData: true });
      }
      // WebGL renderer: canvas draws don't mutate the DOM, so count GL draw calls instead.
      const protos = [
        typeof WebGLRenderingContext !== "undefined" ? WebGLRenderingContext.prototype : null,
        typeof WebGL2RenderingContext !== "undefined" ? WebGL2RenderingContext.prototype : null,
      ].filter(Boolean);
      for (const p of protos) {
        for (const m of ["drawArrays", "drawElements"]) {
          if (p[m] && !p[m].__hooked) {
            const original = p[m];
            const wrapped = function (...args) {
              window.__draws += 1;
              return original.apply(this, args);
            };
            wrapped.__hooked = true;
            p[m] = wrapped;
          }
        }
      }
      const xterm = document.querySelector(".xterm");
      return {
        observing: !!target,
        canvasCount: document.querySelectorAll(".xterm canvas").length,
        anim: getComputedStyle(xterm || document.body).animationName,
      };
    });
    console.log("OBSERVER SETUP:", JSON.stringify(setup));
    await browser.pause(5000); // FULLY IDLE — no WebDriver interaction with the app during this window
    const liveness = await browser.execute(() => {
      const now = Math.round(performance.now());
      const muts = window.__mut || [];
      if (window.__mutObs) window.__mutObs.disconnect();
      return {
        idleWindowMs: now - (window.__mutStart || now),
        renderMutations: muts.length, // DOM renderer liveness
        webglDraws: window.__draws || 0, // WebGL renderer liveness
        canvasCount: document.querySelectorAll(".xterm canvas").length,
      };
    });
    console.log("IDLE-WINDOW LIVENESS:", JSON.stringify(liveness, null, 2));
    await snap("06-logs-final");
  });
});
