// Scenario spec: what the app does when bootstrap ends with NOTHING connected. Needs the new scenario knob —
//   CONTAINER_DESKTOP_MOCK=podman CONTAINER_DESKTOP_MOCK_CONNECTED=none yarn test:e2e:tauri --spec webdriver/scenarios/no-engine-landing.e2e.js
// Deliberately NOT in webdriver/specs/: it would join the default suite, where no engine-less scenario is set and
// the branch under test cannot fire. Routes come from the screens' own Route.Path, never invented.

import { reloadApp } from "../support/appReload.js";

const CONNECTIONS = "/screens/connections/manage";
const CONTAINERS = "/screens/containers";

// The app's own readiness contract on <html>, minus the running=yes that the stock mock always satisfies: this
// scenario's whole point is a READY app with no engine up.
async function waitReadyWithNothingConnected(timeout = 90000) {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const html = document.documentElement;
        return html.dataset.phase === "ready" && html.dataset.running === "no";
      }),
    { timeout, interval: 500, timeoutMsg: "the app never reached ready with nothing connected" },
  );
}

const hash = () => browser.execute(() => window.location.hash);

describe("an app that booted with no engine connected", () => {
  it("reaches ready with nothing running — the scenario knob works at all", async () => {
    await waitReadyWithNothingConnected();
    // Without this the rest measures the stock mock: every other scenario reports an engine up, and the branch
    // under test would never be reached.
    const state = await browser.execute(() => ({ ...document.documentElement.dataset }));
    expect(state.running).toBe("no");
    expect(state.phase).toBe("ready");
  });

  it("lands on the connection manager, because the window was on the default route", async () => {
    await waitReadyWithNothingConnected();
    expect(await hash()).toBe(`#${CONNECTIONS}`);
  });

  it("does NOT hijack a route the user asked for", async () => {
    await waitReadyWithNothingConnected();
    // A deliberate route, then a reload — which keeps the hash, and is how a real window arrives somewhere other
    // than the default with bootstrap about to run again.
    await browser.execute((route) => {
      window.location.hash = route;
    }, CONTAINERS);
    await browser.waitUntil(async () => (await hash()) === `#${CONTAINERS}`, { timeout: 10000 });
    await reloadApp();
    await waitReadyWithNothingConnected();
    expect(await hash()).toBe(`#${CONTAINERS}`);
  });
});
