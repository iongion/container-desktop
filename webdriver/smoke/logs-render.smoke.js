// Drives the real Tauri app (WebKitGTK) to verify container-logs rendering: it dumps document state at intervals
// even if bootstrap stalls (location.href settles whether this binary loads the Vite dev URL or embedded
// frontendDist), then opens the continuously-logging cdtest-logger container's Logs and samples — WITHOUT any
// interaction — whether xterm paints into the DOM over ~5s. Mutations during the idle window ⇒ the compositor-awake
// fix paints streamed data on its own; none, over a container that is demonstrably still writing ⇒ the freeze remains.
//
// ONE screenshot, taken last. This harness allows a single saveScreenshot per session — a second wedges it, and the
// command after that hangs until wdio's connectionRetryTimeout, which reads as the app freezing rather than the
// suite doing it to itself. Everything else is read out of the DOM, which is also the only evidence a Wayland
// machine can capture at all.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { appModeReason, firstReason, runningContainerReason, skipSuite } from "../support/prerequisites.js";

const TARGET = process.env.E2E_CONTAINER_NAME || "cdtest-logger";

// The full id, asked of the engine that actually has it — the same either-engine lookup the gate does, because a
// container on one does not exist on the other. Needed only when the row is not rendered.
function containerIdOf(name) {
  for (const engine of ["docker", "podman"]) {
    try {
      const id = execFileSync(engine, ["inspect", "-f", "{{.Id}}", name], { encoding: "utf8", timeout: 20000 }).trim();
      if (id) return id;
    } catch {
      // That engine has not got it; the other one may.
    }
  }
  return undefined;
}

// Budgeted rather than merely "called once today": the next edit that adds a second call would silently re-arm the
// wedge. `PI_SHOTS=<n>` raises it for a run being debugged.
let shotsLeft = Number(process.env.PI_SHOTS ?? 1);
async function snap(name) {
  if (shotsLeft <= 0) return;
  shotsLeft -= 1;
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

describe("container logs rendering (WebKitGTK)", () => {
  // What this samples is a REAL stream: a container that keeps writing, opened through the app's own logs route.
  // Without it there is nothing for xterm to paint, so a failure would say "the app froze" about an absent
  // container. Start one yourself — e.g. `podman run -d --name cdtest-logger alpine:3 sh -c 'while :; do date;
  // sleep 0.2; done'` — or name another with E2E_CONTAINER_NAME.
  before(async function () {
    const blocked = await firstReason([
      () => appModeReason("real"),
      () => runningContainerReason(TARGET, "this samples a real, continuously-logging container"),
    ]);
    if (blocked) return skipSuite(this, blocked);
  });

  it("boots far enough to render anything at all (href tells dev-vs-prod)", async () => {
    await browser.pause(2500);
    await dump("2s");
    await browser.pause(4000);
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
    const booted = await dump("preload-final");
    // Asserted, not merely logged: the renderer blocks on window.Preloaded, so without it nothing below samples
    // rendering — it samples an empty window, and would report a freeze that is really a boot failure.
    assert.ok(booted?.preloaded, `the renderer never set window.Preloaded (href ${booted?.href})`);
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
    // The container name in the list is an <a class="ContainerLogsButton"> linking straight to its logs route
    // (ManageScreen.tsx). Click it — the faithful "open this container's logs" path, no fuzzy DOM guessing.
    const opened = await browser.execute(
      (name, id) => {
        const links = Array.from(document.querySelectorAll("a.ContainerLogsButton"));
        // Strictly the named container. There used to be a `|| links[0]` fallback here, and it is how this spec
        // reported a frozen renderer while looking at something else entirely: the first row was a container
        // writing nothing. A liveness window over the wrong container measures nothing at all.
        const named = links.find((el) => (el.textContent || "").includes(name));
        if (named) {
          const href = named.getAttribute("href");
          named.click();
          return { clicked: true, href, how: "row", linkCount: links.length };
        }
        // The table renders a window of rows, so a container further down the list is not in the DOM to click at
        // all — which is not the app being wrong. Navigate by the app's OWN route instead: the template is taken
        // from a real href on this page (never an invented path) and the id is the one the engine gave us.
        const template = links[0]?.getAttribute("href") || "";
        const hash = template.slice(template.indexOf("#"));
        const route = hash.replace(/^#\/screens\/container\/[^/]+\//, `#/screens/container/${id}/`);
        if (!id || !route.startsWith("#/screens/container/")) {
          return { clicked: false, seen: links.map((el) => (el.textContent || "").trim()).slice(0, 20) };
        }
        location.hash = route.slice(1);
        return { clicked: true, href: route, how: "route", linkCount: links.length };
      },
      TARGET,
      containerIdOf(TARGET),
    );
    console.log("OPEN LOGS:", JSON.stringify(opened));
    // Nothing below can mean anything if the logs route never opened: an idle window over a screen with no xterm
    // records zero mutations, which is indistinguishable from the freeze this exists to detect.
    assert.ok(
      opened.clicked,
      `no container named ${TARGET} in this app's list — start it on the engine the app is connected to. It listed: ${(opened.seen || []).join(", ")}`,
    );
    await browser.pause(2500);

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
    assert.ok(setup.observing || setup.canvasCount > 0, "no xterm mounted on the logs route to observe");
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
    // The session's one screenshot, taken AFTER the tally is read: a frame is forced by the capture itself, so
    // taking it earlier would paint the very rows whose absence is the thing under test.
    await snap("logs-final");
    // The gate upstream already established the container is writing continuously, so over a five-second window
    // with no WebDriver interaction at all, a renderer that paints on its own has moved something. Zero on both
    // counters is the compositor parked exactly as it was before the fix.
    assert.ok(
      liveness.renderMutations > 0 || liveness.webglDraws > 0,
      `xterm painted nothing in ${liveness.idleWindowMs}ms of idle over a container that is still logging`,
      );
  });
});
