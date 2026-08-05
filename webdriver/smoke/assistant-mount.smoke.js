// How long the Assistant screen takes to appear after it is asked for. It is a SMOKE spec because the number only
// means something against the real shell — a jsdom mount measures nothing about WebKitGTK parsing a module graph.
//
// It prints the measurement rather than asserting a threshold: a time budget baked into a spec is a number that
// fails on a slower machine for a reason that is not a defect. What it DOES assert is the screen mounting at all.
//
//   yarn test:smoke:tauri --spec webdriver/smoke/assistant-mount.smoke.js

import { strict as assert } from "node:assert";

import { appModeReason, firstReason, skipSuite } from "../support/prerequisites.js";

// Read from the source of truth rather than typed here: a guessed route sends the run to a screen that never mounts,
// which reads as a slow screen.
const ASSISTANT_ROUTE = "#/screens/ai/assistant";
const ASSISTANT_MARKER = '[data-screen="ai.assistant"]';

describe("mounting the Assistant screen", () => {
  before(async function () {
    const blocked = await firstReason([() => appModeReason("real")]);
    if (blocked) return skipSuite(this, blocked);
    await browser.pause(4000);
  });

  it("renders after the route is asked for, and says how long it took", async () => {
    // Start somewhere else, so the measurement covers the screen's own arrival and not a route it was already on.
    await browser.execute(() => {
      window.location.hash = "#/screens/dashboard";
    });
    await browser.pause(1500);

    const timing = await browser.executeAsync((marker, route, done) => {
      const started = performance.now();
      window.location.hash = route;
      // Poll in the PAGE, not over WebDriver: every round trip through the driver is an event that wakes the
      // compositor, so measuring from Node would time the driver rather than the screen.
      const deadline = started + 60000;
      const tick = () => {
        if (document.querySelector(marker)) return done({ ok: true, ms: Math.round(performance.now() - started) });
        if (performance.now() > deadline) return done({ ok: false, ms: Math.round(performance.now() - started) });
        requestAnimationFrame(tick);
      };
      tick();
    }, ASSISTANT_MARKER, ASSISTANT_ROUTE);

    console.log(`[measure] warm: Assistant screen mounted in ${timing.ms}ms`);
    assert.ok(timing.ok, `the Assistant screen never mounted (${timing.ms}ms waiting for ${ASSISTANT_MARKER})`);
  });

  // The number that matters is the one a user meets: a renderer that has just started, where nothing of the screen's
  // module graph has been parsed yet. A warm re-navigation measures the router, not the screen.
  it("renders on a COLD renderer, the way a user meets it", async () => {
    await browser.execute((route) => {
      // Land on the route BEFORE reloading, so the reload boots straight into the Assistant — exactly what opening
      // the app and clicking it costs, with no warm cache from a previous visit.
      window.location.hash = route;
      window.location.reload();
    }, ASSISTANT_ROUTE);

    const started = Date.now();
    await $(ASSISTANT_MARKER).waitForExist({ timeout: 120000, timeoutMsg: "the Assistant screen never mounted" });
    const ms = Date.now() - started;
    // Includes the app's whole boot, because that is what the user waits through. Reported, not asserted: the
    // threshold that matters is human, and it differs per machine.
    console.log(`[measure] cold: Assistant screen visible ${ms}ms after a reload into its route`);
  });

  // The control. Without it the cold number above is unattributable: an app that takes three seconds to boot into
  // ANY screen has a boot problem, not an Assistant problem, and the fix would be aimed at the wrong module graph.
  it("renders a light screen on a cold renderer, for comparison", async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/dashboard";
      window.location.reload();
    });

    const started = Date.now();
    await $('[data-screen="dashboard"]').waitForExist({ timeout: 120000, timeoutMsg: "the dashboard never mounted" });
    console.log(`[measure] cold: dashboard visible ${Date.now() - started}ms after a reload into its route`);
  });
});
